'use client';

/**
 * NesioChatSheet — 问一问
 * WeChat-style full-screen chat window.
 * Long-press center button to open.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { getLifeGraph, searchLifeGraphFuzzy, type LifeNode } from '@/lib/portal/life-graph';
import { loadProfileSettings } from '@/lib/portal/profile';
import { smartSearch } from '@/lib/portal/smart-search';
import { domainInsightsContextBlock } from '@/lib/portal/domain-insights';
import { parseTemporalQuery, isInSpan } from '@/lib/portal/temporal-query';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import { refreshLocation } from '@/lib/portal/location-store';
import { formatEnvironmentContext, getCachedCalendarEvents } from '@/lib/portal/environment';
import { semanticRerankMeta } from '@/lib/portal/semantic-rerank';
import { detectCrossLingualGap } from '@/lib/portal/cross-lingual-gap.mjs';
import { track } from '@/lib/portal/telemetry';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import MemoryFlashBanner, { useMemoryFlash } from '@/components/portal/MemoryFlashBanner';
import { IconCamera, IconFile, IconHistory, IconImage, IconKeyboard, IconLink, IconMic, IconSmile, NodeTypeIcon } from './icons';
import EmailComposeSheet from './EmailComposeSheet';

/** 从节点里取可读正文(供邮件回复的上下文参考)。 */
function nodeReadableText(n: LifeNode): string {
  const a = n.attributes as Record<string, unknown>;
  return [a.article, a.summary, a.snippet, a.body, n.rawInput]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 20) || n.rawInput || n.name;
}

/** 小娜头像 — Nesio logo,替代 ✦ 占位 */
function NesioAvatar() {
  return (
    <span className="nesio-wechat-avatar nesio-wechat-avatar--logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/logo/nesio-mark.svg" alt="" width={30} height={30} draggable={false} className="nesio-logo-day" />
      <img src="/assets/logo/nesio-mark-night.svg" alt="" width={30} height={30} draggable={false} className="nesio-logo-night" />
    </span>
  );
}

interface ChatMessage { role: 'user' | 'model'; text: string; }

// 批次 38:聊天引用卡 —— 存紧凑引用(id+名+来源),点击时再从 life-graph 取全节点做阅读/回复。
interface MsgRef { id: string; name: string; source: LifeNode['source'] }
interface UiMessage {
  id: string;
  role: 'user' | 'model' | 'status';
  text: string;
  sources?: Array<{ title: string; url: string }>;
  refs?: MsgRef[];
  savedToMemory?: boolean;
  /** 🔴#2:这条回答时语义检索降级了(缺 AI 配置,只用了关键词匹配)。 */
  semanticDegraded?: boolean;
  semanticReason?: string; // 未生效的具体原因(no_key/rate_limited/provider/network/auth)
}

/** 🔴#1:从模型回答里抽出它自报的【依据:#1,#3】,并把这行从展示文本里剥掉。
 *  ids===null = 模型没写(不合规,回退);ids=[] = 明确"无"(不出引用卡);ids=[...] = 只引这些。 */
function extractCitations(raw: string): { text: string; ids: number[] | null } {
  const m = raw.match(/【依据[:：]?\s*([^】]*)】\s*$/) || raw.match(/【依据[:：]?\s*([^】]*)】/);
  if (!m) return { text: raw, ids: null };
  const inner = m[1] || '';
  const ids = /无|none/i.test(inner) ? [] : Array.from(inner.matchAll(/#?(\d+)/g)).map((x) => Number(x[1]));
  return { text: raw.replace(m[0], '').trim(), ids };
}

// ─── Client-side context builder (3-layer hybrid retrieval) ──────────────────
// Inspired by Chronos (2025) temporal-aware retrieval + IA-RAG interval algebra.
// Runs in the browser where localStorage and sessionStorage are available.
//
// Layer 1 — Temporal/structured retrieval (highest priority):
//   Parse date expressions ("7月9号", "下周", "今天") → filter by attributes.start
// Layer 2 — Text + entity match (smartSearch, already includes temporal boost):
//   BM25-style token matching + entity extraction
// Layer 3 — Temporal baseline (always injected at top):
//   Today + next 7 days events, so AI always has a time horizon
//
// Research: U-shaped context recall curve → important info at HEAD of context.

type CalendarEvent = { id?: string; title?: string; start?: string; end?: string; calendarName?: string };

function fmtEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
}

// 物品·问一问记物品:像发消息一样记物品(「红色 Nike 鞋放鞋柜」)。
// 门:记/加/收/买了 + 物品词,或「放在/放到/收进」;问句(哪/在哪/?/找)是找东西,走普通聊天。
const INVENTORY_ADD_RE = /(记|加|收|添|买了).{0,8}(物品|东西|收纳|库存)|收纳[::]|放(在|到|进)|add (an? )?item/i;
const INVENTORY_QUESTION_RE = /[??]|哪里|在哪|哪儿|找一?下|找找|去哪/;

const SOURCE_LABEL: Record<string, string> = {
  email: 'Gmail',
  calendar: '日历',
  manual: '手动',
  voice: '语音',
  photo: '照片',
  system: '系统',
};

function fmtNode(n: LifeNode): string {
  // 批次 37:邮件节点给 AI 真实内容(发件人 + 真实收件日期 + 摘要),否则只有主题一行
  // AI 会凭空编造邮件内容(用户遇到的「今天的邮件」被虚构成面试/物业通知)。
  if (n.source === 'email') {
    const from = typeof n.attributes.from === 'string' ? n.attributes.from : '';
    const dateStr = typeof n.attributes.date === 'string' ? n.attributes.date : n.createdAt;
    const d = new Date(dateStr);
    const dateLabel = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    const body = [n.attributes.snippet, n.attributes.article, n.rawInput]
      .find((v): v is string => typeof v === 'string' && v.trim().length > 0) || '';
    const snippet = body.replace(/\s+/g, ' ').slice(0, 140);
    return `• [邮件] 主题「${n.name}」${from ? ` · 来自 ${from}` : ''}${dateLabel ? ` · ${dateLabel}` : ''}${snippet ? ` · 摘要:${snippet}` : ''}`;
  }
  const startStr = n.attributes.start as string | undefined;
  const dateLabel = startStr
    ? fmtEventDate(startStr)
    : new Date(n.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  const src = SOURCE_LABEL[n.source] || n.source;
  return `• [${src}] ${n.name} (${dateLabel})`;
}

interface RefCandidate { shortId: number; node: LifeNode }

async function buildMemoryContext(query: string, convoHint = ''): Promise<{ context: string; refCandidates: RefCandidate[]; semanticDegraded: boolean; semanticReason: string }> {
  const graph = getLifeGraph();
  const temporal = parseTemporalQuery(query);

  // Layer 1: date-matched nodes (attributes.start matches the parsed date)
  const dateNodes: LifeNode[] = temporal.hasDate
    ? graph.filter((n) => {
        const s = n.attributes.start as string | undefined;
        return s ? isInSpan(new Date(s), temporal) : false;
      })
    : [];

  // Layer 2: text/entity search + semantic re-rank (embedding cosine blend;
  // falls back to pure text order when the embed endpoint is unavailable)
  const textRanked = smartSearch(query, null).nodes.slice(0, 20);
  const reranked = await semanticRerankMeta(query, textRanked);
  const searchNodes = reranked.nodes.slice(0, 12);
  // 🔴#2:语义检索没用上 embedding(缺 AI key / 端点挂了)= 静默降级,跨语言记录会被漏。
  // 但只在库里真的有"另一种语言"的记录时提示才有意义 —— 纯中文用户查纯中文库不该被
  // 无端提示"英文邮件可能没找全"。用 detectCrossLingualGap 精确判定,消除误报噪音。
  // 只有「真的出了问题」才算降级:候选太少(not_needed)本就无需语义,不该吓用户。
  const realFailure = !reranked.semantic && reranked.reason !== 'not_needed';
  const semanticDegraded = realFailure && detectCrossLingualGap({
    query,
    corpusTexts: graph.slice(0, 200).map((n) => `${n.name} ${n.rawInput || ''}`),
    embeddingsApplied: reranked.semantic,
  }).gap;
  const semanticReason = reranked.reason;

  // Layer 3: upcoming 7-day events (always in context — temporal baseline)
  const now = Date.now();
  const week7 = now + 7 * 86_400_000;
  const upcomingNodes = graph
    .filter((n) => {
      const s = n.attributes.start as string | undefined;
      if (!s) return false;
      const t = new Date(s).getTime();
      return t >= now - 86_400_000 && t <= week7;
    })
    .sort((a, b) =>
      new Date(a.attributes.start as string).getTime() -
      new Date(b.attributes.start as string).getTime(),
    )
    .slice(0, 8);

  // Layer 4 (批次 37):查询提到邮件时,显式带上邮件节点。否则英文主题的邮件在中文
  // 提问("我的邮件")下文本匹配不到,永远进不了 candidates —— 用户会觉得「同步了却问不出来」。
  // 「今天的邮件」按邮件真实收件日期(attributes.date)过滤,而不是 attributes.start(邮件没有)。
  // 🔴#3:多轮承接 —— 追问"第二封讲啥"本身没有"邮件"关键词,但上一轮问的是邮件。
  // 用最近对话作为线索,让后续追问仍能重新召回邮件节点(否则邮件掉出上下文,模型只能编)。
  const EMAIL_RE = /邮件|邮箱|email|e-mail|\bmail\b|收件|inbox|gmail/i;
  const wantsEmail = EMAIL_RE.test(query) || EMAIL_RE.test(convoHint);
  const emailReceived = (n: LifeNode): number => {
    const s = typeof n.attributes.date === 'string' ? n.attributes.date : n.createdAt;
    const t = new Date(s).getTime();
    return Number.isNaN(t) ? new Date(n.createdAt).getTime() : t;
  };
  const pickEmailNodes = (g: LifeNode[]): LifeNode[] => {
    const allEmail = g.filter((n) => n.source === 'email');
    return (temporal.hasDate
      ? allEmail.filter((n) => isInSpan(new Date(emailReceived(n)), temporal))
      : allEmail
    ).sort((a, b) => emailReceived(b) - emailReceived(a)).slice(0, 12);
  };
  let emailNodes: LifeNode[] = [];
  if (wantsEmail) {
    emailNodes = pickEmailNodes(graph);
    // 问一问修复批:问到邮件但目标时段没有邮件节点(常见:「今天的邮件」但后台
    // 还没轮到同步)→ 当场触发一次增量同步再重读,而不是回答「还没同步过来」。
    // 15 秒兜底超时:同步太慢就先按现有数据回答,不吊死输入框。
    if (emailNodes.length === 0) {
      try {
        const { runGmailSync } = await import('@/lib/portal/connector-sync');
        const done = await Promise.race([
          runGmailSync({ force: true }),
          new Promise<null>((resolve) => { setTimeout(() => resolve(null), 15_000); }),
        ]);
        if (done && (done as { extracted?: number }).extracted) emailNodes = pickEmailNodes(getLifeGraph());
      } catch { /* 同步失败按现有数据回答 */ }
    }
  }

  // Assemble: date matches HEAD → email (if asked) → upcoming → search → recent
  const seen = new Set<string>();
  const head: LifeNode[] = [];
  const body: LifeNode[] = [];

  for (const n of dateNodes) { if (!seen.has(n.id)) { seen.add(n.id); head.push(n); } }
  for (const n of emailNodes) { if (!seen.has(n.id)) { seen.add(n.id); head.push(n); } }
  for (const n of upcomingNodes) { if (!seen.has(n.id)) { seen.add(n.id); head.push(n); } }
  for (const n of searchNodes) { if (!seen.has(n.id)) { seen.add(n.id); body.push(n); } }
  // Fill remaining slots with recent nodes
  for (const n of graph.slice(0, 10)) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    body.push(n);
    if (body.length >= 12) break;
  }

  // 🔴#1:给"可被引用"的候选(日期命中/邮件/搜索命中)编号,让模型只引用真正用到的,
  // 而不是无条件把前 6 条当"依据"渲染(模型说"没这方面记录"时也不该出引用卡)。
  const refCandidates: RefCandidate[] = [];
  const refSeen = new Set<string>();
  for (const n of [...dateNodes, ...emailNodes, ...searchNodes]) {
    if (refSeen.has(n.id)) continue;
    refSeen.add(n.id);
    refCandidates.push({ shortId: refCandidates.length + 1, node: n });
    if (refCandidates.length >= 8) break;
  }
  const idOf = new Map(refCandidates.map((r) => [r.node.id, r.shortId]));
  const fmtCite = (n: LifeNode): string => (idOf.has(n.id) ? `[#${idOf.get(n.id)}] ` : '') + fmtNode(n);

  const parts: string[] = [`【用户记忆库】共 ${graph.length} 条`];

  // 统一域洞察读出口(Cross-Insight Reader v0):把即时算的健康/财务判定接进「问一问」的
  // 回答上下文 —— 此前它只读记忆图,看不到 findings,问"血糖达标吗/有没有订阅涨价"只能说没记录。
  const insightBlock = domainInsightsContextBlock();
  if (insightBlock) parts.push(insightBlock);

  if (dateNodes.length > 0) {
    parts.push(`\n【${temporal.label}的日程/事件】（精确命中，优先参考）`);
    parts.push(...dateNodes.map(fmtCite));
  }

  if (upcomingNodes.length > 0 && !temporal.hasDate) {
    parts.push('\n【今天起7天内的安排】');
    parts.push(...upcomingNodes.map(fmtNode));
  }

  if (emailNodes.length > 0) {
    const label = temporal.hasDate ? `${temporal.label}的邮件` : '最近的邮件';
    parts.push(`\n【${label}】（下面是记忆里真实的邮件,只能根据这些回答,禁止虚构主题、发件人或内容;要总结就逐封说这几封）`);
    parts.push(...emailNodes.map(fmtCite));
  } else if (wantsEmail) {
    // 关键防幻觉:问到邮件但没有匹配 → 明确告诉 AI 没有,别编。
    const label = temporal.hasDate ? temporal.label : '最近';
    parts.push(`\n【邮件】记忆库里${label}没有邮件记录。请如实告诉用户${label}没有邮件,绝对不要编造任何邮件主题或内容。`);
  }

  if (body.length > 0) {
    parts.push('\n【相关记忆与近期记录】');
    parts.push(...body.slice(0, 12).map(fmtCite));
  }

  // 🔴#1:让模型自报"依据了哪几条"。回答末尾另起一行写【依据:#1,#3】(只列真正用到的编号);
  // 没用到任何记忆(比如你答"没有相关记录")就写【依据:无】。前端据此只渲染被真正引用的
  // 记忆卡,避免"伪造接地证明"。
  if (refCandidates.length > 0) {
    parts.push('\n【回答规则】上面标了 [#编号] 的记忆是可引用来源。回答完后在最后单独一行注明依据:用到了哪几条就写「【依据:#编号,#编号】」,一条都没用到就写「【依据:无】」。这一行只放编号,不要写别的。');
  }

  return { context: parts.join('\n'), refCandidates, semanticDegraded, semanticReason };
}

function buildCalendarContext(query: string): string {
  const events: CalendarEvent[] = getCachedCalendarEvents();
  if (events.length === 0) return '';

  const temporal = parseTemporalQuery(query);

  // Split into date-specific vs general
  const dateEvents: CalendarEvent[] = [];
  const otherEvents: CalendarEvent[] = [];
  for (const ev of events) {
    if (!ev.start) continue;
    if (temporal.hasDate && isInSpan(new Date(ev.start), temporal)) {
      dateEvents.push(ev);
    } else {
      otherEvents.push(ev);
    }
  }

  const fmtEv = (ev: CalendarEvent) => {
    const d = ev.start ? fmtEventDate(ev.start) : '';
    return `• ${ev.title || '未命名'}${d ? ` (${d})` : ''}`;
  };

  const parts: string[] = [`【Google日历】共 ${events.length} 条`];

  if (dateEvents.length > 0) {
    parts.push(`\n【${temporal.label}的日历事件】（精确匹配，优先参考）`);
    parts.push(...dateEvents.map(fmtEv));
  }

  // Always include upcoming 30 events as time horizon
  const now = Date.now();
  const upcoming = otherEvents
    .filter((ev) => ev.start && new Date(ev.start).getTime() >= now - 86_400_000)
    .slice(0, 30);
  if (upcoming.length > 0) {
    parts.push('\n【近期日程】');
    parts.push(...upcoming.map(fmtEv));
  }

  return parts.join('\n');
}


const CHAT_HISTORY_KEY = 'nesio-chat-history-v1';
const CHAT_SESSIONS_KEY = 'nesio-chat-sessions-v1';
const MAX_STORED = 60;
const MAX_SESSIONS = 20;

/** 归档的历史对话 — 「新对话」时把当前消息存档,历史记录里可回看 */
interface ChatSession { id: string; title: string; at: string; messages: UiMessage[] }

function loadSessions(): ChatSession[] {
  try {
    return JSON.parse(localStorage.getItem(CHAT_SESSIONS_KEY) ?? '[]') as ChatSession[];
  } catch { return []; }
}

function archiveSession(messages: UiMessage[]): void {
  const real = messages.filter((m) => m.role !== 'status' && m.text?.trim());
  if (real.length === 0) return;
  const firstUser = real.find((m) => m.role === 'user');
  const session: ChatSession = {
    id: `s-${Date.now()}`,
    title: (firstUser?.text || real[0].text).slice(0, 30),
    at: new Date().toISOString(),
    messages: real.slice(-MAX_STORED),
  };
  try {
    const next = [session, ...loadSessions()].slice(0, MAX_SESSIONS);
    localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}
const MAX_FILE_CHARS = 60_000; // ~15k tokens, safe for Haiku context

// ─── CSV / File parsing ───────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if ((c === ',' || c === '\t') && !inQ) {
      result.push(cur.trim()); cur = '';
    } else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

function csvToMarkdown(raw: string): string {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return raw;
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((l) => parseCSVLine(l));
  const header = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.slice(0, 200).map((r) => `| ${r.join(' | ')} |`); // cap at 200 rows in table
  const extra = rows.length > 200 ? [`\n（共 ${rows.length} 行，显示前 200 行）`] : [];
  return [header, divider, ...body, ...extra].join('\n');
}

function isCsvLike(name: string): boolean {
  return /\.(csv|tsv)$/i.test(name);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string ?? '');
    reader.onerror = () => reject(new Error('read error'));
    reader.readAsText(file, 'UTF-8');
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n…（内容过长，已截断至 ${max} 字符）`;
}

function loadHistory(): UiMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) ?? '[]') as UiMessage[];
    // Filter out messages with empty text (from earlier bugs)
    return raw.filter((m) => m.text?.trim());
  } catch { return []; }
}
function saveHistory(msgs: UiMessage[]) {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY,
      JSON.stringify(msgs.filter((m) => m.role !== 'status').slice(-MAX_STORED)));
  } catch { /* ignore */ }
}

// ─── SpeechRecognition type ────────────────────────────────────────────────────
type SR = new () => {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start(): void; stop(): void;
};

// ─── Bubble context menu ───────────────────────────────────────────────────────
function BubbleMenu({ msg, onClose, onSave, onCopy }: {
  msg: UiMessage; onClose: () => void; onSave: () => void; onCopy: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  return (
    <>
      <button type="button" className="nesio-bubble-menu-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-bubble-menu">
        <button type="button" className="nesio-bubble-menu-item" onClick={() => { onCopy(); onClose(); }}>
          <span className="nesio-bubble-menu-icon">⎘</span>{L(dict, '复制', 'Copy')}
        </button>
        {!msg.savedToMemory && (
          <button type="button" className="nesio-bubble-menu-item" onClick={() => { onSave(); onClose(); }}>
            <span className="nesio-bubble-menu-icon">＋</span>{L(dict, '存入记忆', 'Save to Memory')}
          </button>
        )}
        <button type="button" className="nesio-bubble-menu-item nesio-bubble-menu-item--cancel" onClick={onClose}>{L(dict, '取消', 'Cancel')}</button>
      </div>
    </>
  );
}

// ─── Memory detail ─────────────────────────────────────────────────────────────
function MemoryDetail({ node, onClose }: { node: LifeNode; onClose: () => void }) {
  const attrs = Object.entries(node.attributes)
    .filter(([k, v]) => v !== null && !['subtasksJson', 'context', 'done', 'doneAt', 'savedFromChat', 'fullText'].includes(k));
  return (
    <div className="nesio-memory-detail">
      <div className="nesio-memory-detail-header">
        <button type="button" className="nesio-wechat-back-btn" onClick={onClose}>←</button>
        <span className="nesio-wechat-title">记忆详情</span>
        <span />
      </div>
      <div className="nesio-memory-detail-body">
        <h3 className="nesio-memory-detail-name">{node.name}</h3>
        <p className="nesio-memory-detail-meta">{node.type} · {new Date(node.createdAt).toLocaleDateString('zh-CN')}</p>
        {node.rawInput && <p className="nesio-memory-detail-raw">{node.rawInput}</p>}
        {attrs.length > 0 && (
          <ul className="nesio-memory-detail-attrs">
            {attrs.map(([k, v]) => (
              <li key={k}><span className="nesio-memory-detail-key">{k}</span><span className="nesio-memory-detail-val">{String(v)}</span></li>
            ))}
          </ul>
        )}
        {(node.tags ?? []).length > 0 && (
          <div className="nesio-memory-detail-tags">
            {(node.tags ?? []).map((t) => <span key={t} className="nesio-focus-card-hint">{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Camera view ──────────────────────────────────────────────────────────────
function CameraView({ onResult, onClose, autoOpen = false }: {
  onResult: (label: string, nodes: LifeNode[]) => void;
  onClose: () => void;
  autoOpen?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [cameraError, setCameraError] = useState('');

  // Stop tracks on unmount
  useEffect(() => () => { stream?.getTracks().forEach((t) => t.stop()); }, [stream]);

  // Attach stream to video element AFTER React renders it
  useEffect(() => {
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    videoRef.current.addEventListener('loadedmetadata', () => {
      videoRef.current?.play().catch(() => undefined);
    }, { once: true });
    // Fallback play in case loadedmetadata already fired
    videoRef.current.play().catch(() => undefined);
  }, [stream]);

  // Auto-open camera when launched from 拍摄 button
  useEffect(() => { if (autoOpen) void openCamera(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openCamera() {
    setCameraError('');
    try {
      // Try back camera first, fall back to any camera
      let s: MediaStream | null = null;
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      } catch {
        s = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      setStream(s);
    } catch (err) {
      console.warn('[camera] getUserMedia failed:', err);
      setCameraError('无法访问摄像头，请检查权限或改用相册');
    }
  }

  async function capture() {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    await analyze(canvas.toDataURL('image/jpeg', 0.8));
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => void analyze(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function analyze(dataUrl: string) {
    setAnalyzing(true);
    try {
      const [header, base64] = dataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
      const res = await fetch('/api/portal/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image', imageBase64: base64, mimeType }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: Array<{ name: string; type: string }>; summary?: string };
      if (data.ok && data.nodes?.length) {
        const names = data.nodes.map((n) => n.name).join('、');
        const found = new Map<string, LifeNode>();
        for (const node of data.nodes) {
          for (const n of searchLifeGraphFuzzy(node.name, 2)) found.set(n.id, n);
        }
        onResult(names || data.summary || '（未识别到）', Array.from(found.values()).slice(0, 6));
      } else {
        onResult(data.summary || '（未识别到）', []);
      }
    } catch { onResult('识别失败', []); }
    setAnalyzing(false);
  }

  // Show camera live view once stream is ready (video srcObject set by useEffect)
  if (stream) {
    return (
      <div className="nesio-camera-live">
        <button
          type="button"
          className="nesio-wechat-back-btn nesio-camera-back"
          onClick={() => { stream.getTracks().forEach((t) => t.stop()); setStream(null); onClose(); }}
        >←</button>
        {/* muted + playsInline required on iOS for autoplay in PWA */}
        <video ref={videoRef} autoPlay muted playsInline className="nesio-camera-video" />
        <button type="button" className="nesio-chat-camera-shutter" onClick={capture} aria-label="拍照">
          <span className="nesio-camera-shutter-ring" />
        </button>
        {analyzing && <p className="nesio-camera-status">识别中…</p>}
      </div>
    );
  }

  return (
    <div className="nesio-camera-entry">
      <button type="button" className="nesio-wechat-back-btn" onClick={onClose}>← 返回</button>
      {analyzing ? (
        <p className="nesio-camera-status">识别中…</p>
      ) : (
        <>
          {cameraError && <p className="nesio-camera-status" style={{ color: 'var(--status-risk)' }}>{cameraError}</p>}
          <div className="nesio-camera-entry-btns">
            <button type="button" className="nesio-wechat-plus-item" onClick={openCamera}>
              <span className="nesio-wechat-plus-icon"><IconCamera /></span><span>打开摄像头</span>
            </button>
            <button type="button" className="nesio-wechat-plus-item" onClick={() => fileRef.current?.click()}>
              <span className="nesio-wechat-plus-icon"><IconImage /></span><span>从相册选图</span>
            </button>
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="nesio-hidden" onChange={handleFile} />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function NesioChatSheet({
  open,
  onClose,
  canUsePrivateData = false,
}: {
  open: boolean;
  onClose: () => void;
  canUsePrivateData?: boolean;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // 同步的发送闭锁:setSending 是异步的,快速两次 Enter 两个闭包都读到 sending===false → 双发。
  const sendingRef = useRef(false);
  // 单调消息 id:此前用 Date.now(),同毫秒(双发/图片+文本并发)会撞 React key。
  const msgSeqRef = useRef(0);
  const nextMsgId = (p: string) => `${p}-${Date.now().toString(36)}-${msgSeqRef.current++}`;
  const { flashNodes, triggerFlash, dismiss: dismissFlash } = useMemoryFlash();
  // voiceMode: false = text input, true = hold-to-talk bar
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showPlus, setShowPlus] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraAutoOpen, setCameraAutoOpen] = useState(false);
  const [menuMsg, setMenuMsg] = useState<UiMessage | null>(null);
  const [detailNode, setDetailNode] = useState<LifeNode | null>(null);
  const [replyNode, setReplyNode] = useState<LifeNode | null>(null); // 批次 38:引用卡直接回复邮件
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop(): void } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTextRef = useRef('');
  // Loaded file context — persists across messages in this session
  const fileContextRef = useRef<{ name: string; content: string } | null>(null);

  useEffect(() => { if (open) setMessages(loadHistory()); }, [open]);
  // 批次 23:接收节点详情传来的图片,自动跑识别问答
  useEffect(() => {
    if (!open) return;
    let pending: { url?: string; name?: string } | null = null;
    try {
      const raw = sessionStorage.getItem('nesio-pending-ask-image');
      if (raw) { pending = JSON.parse(raw); sessionStorage.removeItem('nesio-pending-ask-image'); }
    } catch { /* ignore */ }
    if (!pending?.url) return;
    const dataUrl = pending.url;
    const b64 = dataUrl.split(',')[1] || '';
    const mime = dataUrl.match(/:(.*?);/)?.[1] || 'image/jpeg';
    const userMsg: UiMessage = { id: `u-${Date.now()}`, role: 'user', text: L(dict, `［图片］${pending.name || '这张图'}`, `[Image] ${pending.name || 'this photo'}`) };
    setMessages((prev) => { const next = [...prev, userMsg]; return next; });
    fetch('/api/portal/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image', imageBase64: b64, mimeType: mime }),
    }).then((r) => r.json()).then((data: { ok?: boolean; nodes?: Array<{ name: string }>; summary?: string }) => {
      const names = data.nodes?.map((n) => n.name).join(L(dict, '、', ', ')) || data.summary || L(dict, '（未识别到内容）', '(nothing recognized)');
      const aiMsg: UiMessage = { id: `a-${Date.now()}`, role: 'model', text: L(dict, `识别到：${names}\n\n可以继续问我关于这张图的问题。`, `Recognized: ${names}\n\nAsk me anything about this photo.`) };
      setMessages((prev) => { const withAi = [...prev, aiMsg]; saveHistory(withAi); return withAi; });
    }).catch(() => {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'model', text: L(dict, '图片识别失败，请重试。', 'Image recognition failed — try again.') }]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Opportunistically refresh device location so 问一问 knows where the user is.
  useEffect(() => { if (open) void refreshLocation(); }, [open]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sendingRef.current) return;
    sendingRef.current = true; // 同步闭锁,挡住同一 tick 的第二次触发
    const userMsg: UiMessage = { id: nextMsgId('u'), role: 'user', text: text.trim() };
    const nextMsgs = [...messages, userMsg];
    setMessages((prev) => [...prev, userMsg]); // 函数式追加,别覆盖并发(图片分析)刚追加的消息
    setInput('');
    setSending(true);
    setShowPlus(false);

    const history: ChatMessage[] = nextMsgs
      .slice(-21, -1)
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role as 'user' | 'model', text: m.text }));

    track('chat_send', { has_file: Boolean(fileContextRef.current) });

    // ── 物品·问一问记物品:命中意图门 → AI 拆物品直接入库,气泡确认;
    //    提取为空/失败 → 静默落回普通聊天(不打断,不报错)。
    if (INVENTORY_ADD_RE.test(text) && !INVENTORY_QUESTION_RE.test(text)) {
      try {
        const invCtrl = new AbortController();
        const invTimeout = setTimeout(() => invCtrl.abort(), 12_000);
        const invRes = await fetch('/api/portal/inventory-extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.trim() }),
          signal: invCtrl.signal,
        });
        clearTimeout(invTimeout);
        const invData = await invRes.json() as { ok?: boolean; items?: Array<{ name: string; quantity?: number; location?: string; category?: string; tags?: string[]; price?: number; note?: string }> };
        if (invData.ok && invData.items && invData.items.length) {
          const { addInventoryItem } = await import('@/lib/portal/inventory');
          const lines = invData.items.map((it) => {
            addInventoryItem(it);
            const bits = [it.quantity && it.quantity > 1 ? `×${it.quantity}` : '', it.location ? `→ ${it.location}` : '', it.price != null ? `$${it.price}` : ''].filter(Boolean).join(' ');
            return `• ${it.name}${bits ? ` ${bits}` : ''}`;
          });
          const doneMsg: UiMessage = {
            id: nextMsgId('a'),
            role: 'model',
            text: L(dict,
              `已存进收纳 ${invData.items.length} 件:
${lines.join('\n')}

位置/估值想改的话,到「收纳」里点开就能编辑。`,
              `Saved ${invData.items.length} item(s) to storage:
${lines.join('\n')}

Edit location/value anytime in Storage.`),
            savedToMemory: true,
          };
          setMessages((prev) => { const next = [...prev, doneMsg]; saveHistory(next); return next; });
          window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
          setSending(false);
          sendingRef.current = false;
          return;
        }
      } catch { /* 落回普通聊天 */ }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      // 🔴#3:把最近几条用户提问作为召回线索,让"第二封讲啥"这类追问仍能重新召回邮件。
      const convoHint = messages.filter((m) => m.role === 'user').slice(-2).map((m) => m.text).join(' ');
      const { context: memoryContext, refCandidates, semanticDegraded, semanticReason } = await buildMemoryContext(text.trim(), convoHint);
      const res = await fetch('/api/portal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          history,
          coachStyle: loadProfileSettings().coachStyle || 'warm',
          uiLocale: dict,
          fileContext: fileContextRef.current
            ? { name: fileContextRef.current.name, content: fileContextRef.current.content }
            : undefined,
          memoryContext,
          calendarContext: buildCalendarContext(text.trim()),
          environmentContext: formatEnvironmentContext(),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json() as { ok?: boolean; response?: string; sources?: Array<{ title: string; url: string }> };
      const rawResp = data.response?.trim() || L(dict, '（暂时没有找到相关信息）', '(Nothing relevant found)');
      // 🔴#1:只保留模型真正引用的记忆节点。ids===null(没自报)→ 回退到前 3 候选作"相关记忆";
      // ids=[](明确"无")→ 不出引用卡(修"模型说没记录、下面还渲染 6 张伪造依据卡")。
      const { text: cleanResp, ids } = extractCitations(rawResp);
      const citedNodes: LifeNode[] = ids === null
        ? refCandidates.slice(0, 3).map((r) => r.node)
        : ids.map((id) => refCandidates.find((r) => r.shortId === id)?.node).filter((n): n is LifeNode => Boolean(n));
      const aiMsg: UiMessage = {
        id: nextMsgId('a'),
        role: 'model',
        // 兜底剥掉 markdown 强调记号 — 气泡是纯文本,裸 ** 很出戏
        text: cleanResp.replace(/\*\*/g, ''),
        sources: data.sources ?? [],
        refs: citedNodes.map((n) => ({ id: n.id, name: n.name, source: n.source })),
        semanticDegraded,
        semanticReason,
      };
      // 函数式追加 + 用最终列表存档,别用可能已过期的 nextMsgs 快照覆盖并发消息。
      setMessages((prev) => { const next = [...prev, aiMsg]; saveHistory(next); return next; });
    } catch (err) {
      clearTimeout(timeout);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      // 兜底：从本地记忆模糊搜索
      const localHits = searchLifeGraphFuzzy(text.trim(), 5);
      const fallbackText = localHits.length
        ? `AI 暂时不可用，但我在记忆库里找到了这些相关线索：\n${localHits.map((n) => `• ${n.name}`).join('\n')}`
        : isTimeout ? '响应超时，请重试。' : 'AI 暂时不可用，记忆库里也没找到相关线索。';
      const errMsg: UiMessage = { id: nextMsgId('e'), role: 'model', text: fallbackText, refs: localHits.map((n) => ({ id: n.id, name: n.name, source: n.source })) };
      setMessages((prev) => [...prev, errMsg]);
    }
    setSending(false);
    sendingRef.current = false;
  }, [messages]);

  function handleSave(msg: UiMessage) {
    const savedNode = ingestLifeNode({
      name: msg.text.slice(0, 60), type: 'event', source: 'manual', confidence: 0.9,
      tags: ['宝盒对话'], attributes: { fullText: msg.text, savedFromChat: true },
      relations: [], rawInput: msg.text,
    });
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, savedToMemory: true } : m));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    triggerFlash(savedNode);
  }

  function handleCopy(msg: UiMessage) {
    navigator.clipboard.writeText(msg.text).catch(() => undefined);
  }

  async function handleFileUpload(file: File) {
    setShowPlus(false);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isText = ['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log'].includes(ext);
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'].includes(ext) || file.type.startsWith('image/');

    // 图片 → 走识别流程
    if (isImage) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const [hdr, b64] = dataUrl.split(',');
        const mime = hdr.match(/:(.*?);/)?.[1] || 'image/jpeg';
        const userMsg: UiMessage = { id: nextMsgId('u'), role: 'user', text: L(dict, `［图片］这是什么？`, `[Image] What's this?`) };
        setMessages((prev) => [...prev, userMsg]); // 函数式追加,别覆盖并发发送的消息
        fetch('/api/portal/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'image', imageBase64: b64, mimeType: mime }),
        }).then((r) => r.json()).then((data: { ok?: boolean; nodes?: Array<{ name: string; type: string }>; summary?: string }) => {
          const names = data.nodes?.map((n) => n.name).join(L(dict, '、', ', ')) || data.summary || L(dict, '（未识别到内容）', '(nothing recognized)');
          const aiMsg: UiMessage = { id: nextMsgId('a'), role: 'model', text: L(dict, `识别到：${names}\n\n可以继续问我关于这张图片的问题。`, `Recognized: ${names}\n\nAsk me anything about this image.`) };
          setMessages((prev) => { const withAi = [...prev, aiMsg]; saveHistory(withAi); return withAi; });
        }).catch(() => {
          const aiMsg: UiMessage = { id: nextMsgId('a'), role: 'model', text: L(dict, '图片识别失败，请重试。', 'Image recognition failed — try again.') };
          setMessages((prev) => [...prev, aiMsg]);
        });
      };
      reader.readAsDataURL(file);
      return;
    }

    if (!isText) {
      const notice: UiMessage = {
        id: `m-${Date.now()}`, role: 'model',
        text: `暂时只支持文本（CSV/TXT/JSON 等）和图片文件。"${file.name}" 是 .${ext || '未知'} 格式，暂不支持。`,
      };
      setMessages((prev) => [...prev, notice]);
      return;
    }

    try {
      let raw = await readFileAsText(file);
      let content = raw;

      if (isCsvLike(file.name)) {
        // Convert CSV to readable Markdown table
        content = `文件：${file.name}\n行数：${raw.trim().split(/\r?\n/).length - 1} 条记录\n\n${csvToMarkdown(raw)}`;
      } else {
        content = `文件：${file.name}\n\n${raw}`;
      }

      content = truncate(content, MAX_FILE_CHARS);
      fileContextRef.current = { name: file.name, content };

      const rowCount = isCsvLike(file.name)
        ? `${raw.trim().split(/\r?\n/).length - 1} 行数据`
        : `${(raw.length / 1024).toFixed(1)} KB`;

      const notice: UiMessage = {
        id: `f-${Date.now()}`, role: 'model',
        text: `已加载 **${file.name}**（${rowCount}）\n\n可以问我这个文件里的任何问题，比如：\n• 这里有多少条记录？\n• 帮我总结一下\n• 谁的金额最高？`,
      };
      setMessages((prev) => [...prev, notice]);
    } catch {
      const errMsg: UiMessage = {
        id: `e-${Date.now()}`, role: 'model',
        text: `读取文件失败，请确认文件没有损坏。`,
      };
      setMessages((prev) => [...prev, errMsg]);
    }
  }

  // Voice input (tap mic → voiceMode; hold-to-talk in voiceMode)
  function getSR(): InstanceType<SR> | null {
    const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return null;
    const r = new Ctor();
    r.lang = 'zh-CN'; r.interimResults = true; r.continuous = false;
    return r;
  }

  function startRecording() {
    voiceTextRef.current = '';
    const r = getSR();
    if (!r) {
      // SpeechRecognition not available — surface a clear message
      const errMsg: UiMessage = { id: `e-${Date.now()}`, role: 'model', text: '当前浏览器不支持语音输入，请切换到键盘文字输入。' };
      setMessages((prev) => [...prev, errMsg]);
      setVoiceMode(false);
      return;
    }
    r.onresult = (e) => {
      voiceTextRef.current = Array.from(e.results).map((res) => res[0].transcript).join('');
    };
    // onend fires after all results are delivered — safe to send here
    r.onend = () => {
      setRecording(false);
      const text = voiceTextRef.current.trim();
      voiceTextRef.current = '';
      if (text) void sendMessage(text);
    };
    r.onerror = () => { setRecording(false); voiceTextRef.current = ''; };
    r.start();
    recognitionRef.current = r;
    setRecording(true);
  }

  function stopRecording() {
    // Just stop; onend will fire and handle sending
    recognitionRef.current?.stop();
  }

  function startBubbleLongPress(msg: UiMessage) {
    longPressRef.current = setTimeout(() => setMenuMsg(msg), 500);
  }
  function cancelBubbleLongPress() {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
  }

  function handleCameraResult(label: string, nodes: LifeNode[]) {
    setShowCamera(false);
    const userMsg: UiMessage = { id: `u-${Date.now()}`, role: 'user', text: '[图片] 识别图片' };
    const aiText = nodes.length > 0
      ? `识别到：${label}\n\n记忆库里找到 ${nodes.length} 条相关记录：\n${nodes.map((n) => `• ${n.name}（${n.type}）`).join('\n')}`
      : `识别到：${label}\n\n记忆库里暂时没有找到相关记录。`;
    const aiMsg: UiMessage = { id: `a-${Date.now()}`, role: 'model', text: aiText };
    const next = [...messages, userMsg, aiMsg];
    setMessages(next); saveHistory(next);
  }

  if (!open) return null;

  if (showCamera) {
    return (
      <div className="nesio-wechat-fullscreen" role="dialog" aria-label="拍照识别">
        <CameraView
          onResult={handleCameraResult}
          onClose={() => { setShowCamera(false); setCameraAutoOpen(false); }}
          autoOpen={cameraAutoOpen}
        />
      </div>
    );
  }

  if (detailNode) {
    return (
      <div className="nesio-wechat-fullscreen" role="dialog" aria-label="记忆详情">
        <MemoryDetail node={detailNode} onClose={() => setDetailNode(null)} />
      </div>
    );
  }

  return (
    <div className="nesio-wechat-fullscreen" role="dialog" aria-modal="true" aria-label="问一问">
      {/* 关联记忆闪现 */}
      <MemoryFlashBanner nodes={flashNodes} onDismiss={dismissFlash} />

      {/* 批次 38:从引用卡直接回复邮件(AI 帮我写 + 发送都在里面) */}
      {replyNode && (
        <EmailComposeSheet
          open
          onClose={() => setReplyNode(null)}
          context={{
            emailId: typeof replyNode.attributes.emailId === 'string' ? replyNode.attributes.emailId : undefined,
            from: typeof replyNode.attributes.from === 'string' ? replyNode.attributes.from : '',
            subject: replyNode.name,
            snippet: typeof replyNode.attributes.snippet === 'string' ? replyNode.attributes.snippet : undefined,
            article: nodeReadableText(replyNode),
          }}
        />
      )}

      {/* Header */}
      <div className="nesio-wechat-header">
        <button type="button" className="nesio-wechat-back-btn" onClick={onClose} aria-label="关闭">←</button>
        <span className="nesio-wechat-title">{L(dict, '问一问', 'Ask')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
          <button
            type="button"
            className="nesio-wechat-more-btn"
            onClick={() => { setSessions(loadSessions()); setShowHistory(true); }}
            aria-label="历史记录"
            title="历史记录"
          >
            <IconHistory size={18} />
          </button>
          <button type="button" className="nesio-wechat-more-btn" onClick={() => { archiveSession(messages); setMessages([]); saveHistory([]); }}>
            {L(dict, '新对话', 'New chat')}
          </button>
        </div>
      </div>

      {/* 历史记录面板 */}
      {showHistory && (
        <div className="nesio-chat-history-panel">
          <button type="button" className="nesio-settings-sheet-backdrop" onClick={() => setShowHistory(false)} aria-label="关闭" />
          <div className="nesio-chat-history-card">
            <p className="nesio-chat-history-title">{L(dict, '历史对话', 'Past chats')}</p>
            {sessions.length === 0 && (
              <p style={{ fontSize: '0.78rem', color: 'var(--portal-muted)', margin: '0.5rem 0' }}>{L(dict, '还没有归档的对话。点「新对话」会把当前对话存到这里。', 'No archived chats yet. "New chat" stores the current one here.')}</p>
            )}
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="nesio-chat-history-item"
                onClick={() => {
                  archiveSession(messages);
                  setMessages(s.messages);
                  saveHistory(s.messages);
                  try {
                    localStorage.setItem(CHAT_SESSIONS_KEY,
                      JSON.stringify(loadSessions().filter((x) => x.id !== s.id)));
                  } catch { /* ignore */ }
                  setShowHistory(false);
                }}
              >
                <span className="nesio-chat-history-item-title">{s.title}</span>
                <span className="nesio-chat-history-item-date">
                  {new Date(s.at).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' })} · {s.messages.length} {L(dict, '条', 'msgs')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="nesio-wechat-messages" ref={listRef}>
        {messages.length === 0 && !sending && (
          <div className="nesio-wechat-empty">
            <p className="nesio-wechat-empty-icon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/logo/nesio-mark.svg" alt="" width={52} height={52} draggable={false} className="nesio-logo-day" />
              <img src="/assets/logo/nesio-mark-night.svg" alt="" width={52} height={52} draggable={false} className="nesio-logo-night" />
            </p>
            <p className="nesio-wechat-empty-title">{L(dict, '问我任何事', 'Ask me anything')}</p>
            <div className="nesio-wechat-suggestions">
              {[L(dict, '我的护照放在哪里', 'Where did I put my passport?'), L(dict, '今天该吃什么', 'What should I eat today?'), L(dict, '帮我总结这周做了什么', 'Summarize my week')].map((s) => (
                <button key={s} type="button" className="nesio-wechat-suggestion" onClick={() => void sendMessage(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === 'status') {
            return (
              <div key={msg.id} className="nesio-wechat-status-bubble">
                <span className="nesio-wechat-status-dot" />{msg.text}
              </div>
            );
          }
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} className={`nesio-wechat-row nesio-wechat-row--${isUser ? 'user' : 'ai'}`}>
              {!isUser && <NesioAvatar />}
              <div className="nesio-wechat-bubble-wrap">
                <div
                  className={`nesio-wechat-bubble nesio-wechat-bubble--${isUser ? 'user' : 'ai'}`}
                  onPointerDown={() => !isUser && startBubbleLongPress(msg)}
                  onPointerUp={cancelBubbleLongPress}
                  onPointerLeave={cancelBubbleLongPress}
                  onPointerCancel={cancelBubbleLongPress}
                  onContextMenu={(e) => { e.preventDefault(); if (!isUser) setMenuMsg(msg); }}
                >
                  <p className="nesio-wechat-bubble-text">{msg.text}</p>
                  {msg.savedToMemory && <p className="nesio-wechat-saved-badge">✓ {L(dict, '已存入记忆', 'Saved to Memory')}</p>}
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="nesio-wechat-sources">
                    {/* 只渲染 http(s) 链接 —— 模型返回的 URL 未必可信,挡 javascript:/data: 等伪协议 */}
                    {msg.sources.filter((s) => /^https?:\/\//i.test(s.url)).map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="nesio-wechat-source-chip">
                        <IconLink size={11} /> {s.title || s.url.replace(/^https?:\/\//, '').split('/')[0]}
                      </a>
                    ))}
                  </div>
                )}
                {/* 🔴#2:语义检索降级的可见失败态 —— 明确区分"AI 未配置只用了关键词"与"真没数据" */}
                {!isUser && msg.semanticDegraded && (
                  <p className="nesio-chat-degraded-hint">
                    {(() => {
                      // 按真实原因给话术 —— 「key 没配」和「key 好好的但这次限流/配额没成」是两回事
                      const r = msg.semanticReason;
                      if (r === 'rate_limited') return L(dict, '检索有点频繁,这次先用了关键词匹配(稍后自动恢复)—— 跨语言的记录可能没找全。', 'Search briefly rate-limited; used keyword matching this time — cross-language records may be missed.');
                      if (r === 'provider' || r === 'network') return L(dict, '语义检索这次没连上(嵌入服务临时故障或配额),先用了关键词匹配 —— 跨语言的记录可能没找全。', 'Semantic search briefly unavailable (provider hiccup/quota); used keyword matching — cross-language records may be missed.');
                      if (r === 'auth') return L(dict, '会话需要重新登录后语义检索才能生效,这次用了关键词匹配。', 'Sign in again to re-enable semantic search; used keyword matching this time.');
                      return L(dict, '语义检索未启用(缺嵌入模型 key:Gemini 或 OpenAI 任一即可),这次只用了关键词匹配 —— 跨语言的记录(如英文邮件)可能没找全。', 'Semantic search is off (needs a Gemini or OpenAI key); only keyword matching was used — cross-language records may be missed.');
                    })()}
                  </p>
                )}
                {/* 批次 38:引用卡 —— 模型自报引用的记忆,点开可回看/阅读/回复(邮件多一颗直达回复) */}
                {!isUser && msg.refs && msg.refs.length > 0 && (() => {
                  const g = getLifeGraph();
                  const live = msg.refs!.map((r) => ({ ref: r, node: g.find((n) => n.id === r.id) })).filter((x) => x.node);
                  if (!live.length) return null;
                  return (
                    <div className="nesio-wechat-refs">
                      <span className="nesio-wechat-refs-label">{L(dict, '相关记忆 · 点开可回看/回复', 'Related memories · tap to view/reply')}</span>
                      {live.map(({ ref, node }) => (
                        <div key={ref.id} className="nesio-wechat-ref-row">
                          <button type="button" className="nesio-wechat-ref-chip" onClick={() => setDetailNode(node!)}>
                            <NodeTypeIcon type={node!.type} size={12} />
                            <span className="nesio-wechat-ref-name">{ref.name}</span>
                          </button>
                          {ref.source === 'email' && (
                            <button type="button" className="nesio-wechat-ref-reply" onClick={() => setReplyNode(node!)}>{L(dict, '回复', 'Reply')}</button>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}

        {sending && (
          <div className="nesio-wechat-row nesio-wechat-row--ai">
            <NesioAvatar />
            <div className="nesio-wechat-bubble nesio-wechat-bubble--ai nesio-wechat-bubble--thinking">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      {/* Emoji picker panel */}
      {showEmoji && (
        <div className="nesio-emoji-panel">
          {['😊','😂','🥰','😍','😭','🤔','👍','🙏','❤️','🔥','✅','⚠️','📌','💡','🎉','👏','💪','🫡','😅','🥲','🤣','😁','🙂','😏','😒','😤','🥳','🤩','😴','😇'].map((em) => (
            <button
              key={em}
              type="button"
              className="nesio-emoji-btn-item"
              onClick={() => { setInput((v) => v + em); setShowEmoji(false); inputRef.current?.focus(); }}
            >
              {em}
            </button>
          ))}
        </div>
      )}

      {/* Plus panel */}
      {showPlus && (
        <div className="nesio-wechat-plus-panel">
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange=(e)=>{ const f=(e.target as HTMLInputElement).files?.[0]; if(!f) return; const reader=new FileReader(); reader.onload=(ev)=>{ const dataUrl=ev.target?.result as string; const [hdr,b64]=dataUrl.split(','); const mime=hdr.match(/:(.*?);/)?.[1]||'image/jpeg'; const userMsg:UiMessage={id:nextMsgId('u'),role:'user',text:'[图片] 识别图片'}; setMessages(prev=>[...prev,userMsg]); fetch('/api/portal/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'image',imageBase64:b64,mimeType:mime})}).then(r=>r.json()).then((data:{ ok?:boolean; nodes?:Array<{name:string;type:string}>; summary?:string })=>{ if(data.ok&&data.nodes?.length){const names=data.nodes.map(n=>n.name).join('、'); const found=new Map<string,LifeNode>(); for(const node of data.nodes){for(const n of searchLifeGraphFuzzy(node.name,2))found.set(n.id,n);} const nodes=Array.from(found.values()).slice(0,6); const aiText=nodes.length>0?`识别到：${names}\n\n找到 ${nodes.length} 条相关记录：\n${nodes.map(n=>`• ${n.name}`).join('\n')}`:`识别到：${names}\n\n记忆库里暂时没有相关记录。`; const aiMsg:UiMessage={id:nextMsgId('a'),role:'model',text:aiText}; setMessages(prev=>{const withAi=[...prev,aiMsg]; saveHistory(withAi); return withAi;});}else{const aiMsg:UiMessage={id:nextMsgId('a'),role:'model',text:data.summary||'图片识别暂时不可用。'}; setMessages(prev=>{const withAi=[...prev,aiMsg]; saveHistory(withAi); return withAi;});}}).catch(()=>{const aiMsg:UiMessage={id:nextMsgId('a'),role:'model',text:'图片识别失败，请重试。'}; setMessages(prev=>[...prev,aiMsg]);});}; reader.readAsDataURL(f);}; inp.click(); }}>
            <span className="nesio-wechat-plus-icon"><IconImage /></span>
            <span>{L(dict, '相册', 'Photos')}</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); setCameraAutoOpen(true); setShowCamera(true); }}>
            <span className="nesio-wechat-plus-icon"><IconCamera /></span>
            <span>{L(dict, '拍摄', 'Camera')}</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); setVoiceMode(true); }}>
            <span className="nesio-wechat-plus-icon"><IconMic /></span>
            <span>{L(dict, '语音输入', 'Voice')}</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => filePickerRef.current?.click()}>
            <span className="nesio-wechat-plus-icon"><IconFile /></span>
            <span>{L(dict, '文件', 'File')}</span>
          </button>
        </div>
      )}

      {/* Hidden file picker for document/CSV upload */}
      <input
        ref={filePickerRef}
        type="file"
        accept=".csv,.tsv,.txt,.md,.json,.xml,.yaml,.yml,.log,image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileUpload(file);
          e.target.value = '';
        }}
      />

      {/* Input bar */}
      <div className="nesio-wechat-input-bar">
        {voiceMode ? (
          /* Voice mode: keyboard toggle | Hold to Talk | emoji | + */
          <>
            <button
              type="button"
              className="nesio-wechat-mode-btn"
              onClick={() => setVoiceMode(false)}
              aria-label="切换到键盘"
            >
              <IconKeyboard />
            </button>
            <button
              type="button"
              className={`nesio-wechat-hold-btn${recording ? ' nesio-wechat-hold-btn--active' : ''}`}
              onPointerDown={(e) => { e.preventDefault(); startRecording(); }}
              onPointerUp={stopRecording}
              onPointerLeave={() => { if (recording) stopRecording(); }}
              onPointerCancel={() => { if (recording) stopRecording(); }}
              aria-label="按住说话"
            >
              {recording ? L(dict, '松开发送', 'Release to send') : L(dict, '按住 说话', 'Hold to talk')}
            </button>
            <button
              type="button"
              className={`nesio-wechat-emoji-btn${showEmoji ? ' nesio-wechat-emoji-btn--active' : ''}`}
              onClick={() => { setShowEmoji((v) => !v); setShowPlus(false); }}
              aria-label="表情"
            >
              <IconSmile />
            </button>
            <button
              type="button"
              className={`nesio-wechat-plus-btn${showPlus ? ' nesio-wechat-plus-btn--active' : ''}`}
              onClick={() => setShowPlus((v) => !v)}
              aria-label="更多"
            >
              ＋
            </button>
          </>
        ) : (
          /* Text mode: mic toggle | input | send or + */
          <>
            <button
              type="button"
              className="nesio-wechat-mode-btn"
              onClick={() => setVoiceMode(true)}
              aria-label="切换到语音"
            >
              <IconMic />
            </button>
            <input
              ref={inputRef}
              className="nesio-wechat-input"
              type="text"
              placeholder={L(dict, '问一问…', 'Ask…')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendMessage(input); } }}
              disabled={sending}
            />
            <button
              type="button"
              className={`nesio-wechat-emoji-btn${showEmoji ? ' nesio-wechat-emoji-btn--active' : ''}`}
              onClick={() => { setShowEmoji((v) => !v); setShowPlus(false); }}
              aria-label="表情"
            >
              <IconSmile />
            </button>
            {input.trim() ? (
              <button
                type="button"
                className="nesio-wechat-send-btn"
                onClick={() => void sendMessage(input)}
                disabled={sending}
                aria-label="发送"
              >
                {L(dict, '发送', 'Send')}
              </button>
            ) : (
              <button
                type="button"
                className={`nesio-wechat-plus-btn${showPlus ? ' nesio-wechat-plus-btn--active' : ''}`}
                onClick={() => setShowPlus((v) => !v)}
                aria-label="更多"
              >
                ＋
              </button>
            )}
          </>
        )}
      </div>

      {/* Bubble context menu */}
      {menuMsg && (
        <BubbleMenu
          msg={menuMsg}
          onClose={() => setMenuMsg(null)}
          onSave={() => handleSave(menuMsg)}
          onCopy={() => handleCopy(menuMsg)}
        />
      )}
    </div>
  );
}
