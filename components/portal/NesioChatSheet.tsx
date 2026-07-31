'use client';

/**
 * NesioChatSheet — 问一问
 * WeChat-style full-screen chat window.
 * Long-press center button to open.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import NesioMark from './NesioMark';

// 批次 139:统一「打开详情」—— 聊天引用卡与记忆页/今天页共用同一个完整详情组件
const MemoryNodeDetail = dynamic(() => import('./MemoryNodeDetail'), { ssr: false });
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { getLifeGraph, isBulkImported, isPrivateExternalNode, linkNodes, searchLifeGraphFuzzy, type LifeNode, updateLifeNode } from '@/lib/portal/life-graph';
import { recallByRecognition } from '@/lib/portal/photo-recall';
import { buildMemoryContext, fmtEventDate, extractCitations } from '@/lib/portal/memory-retrieval';
import { createCalendarEvent } from '@/lib/portal/calendar-client';
import { canUsePaidCloudAi, guardPaidCloudAi } from '@/lib/portal/entitlement';
import { loadProfileSettings } from '@/lib/portal/profile';
import { smartSearch } from '@/lib/portal/smart-search';
import { searchPhotos, warmClip } from '@/lib/portal/semantic-search/clip-search';
import { getLocalImage } from '@/lib/portal/local-image-store';
import { parseTemporalQuery, isInSpan } from '@/lib/portal/temporal-query';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import { refreshLocation } from '@/lib/portal/location-store';
import { formatEnvironmentContext, getCachedCalendarEvents } from '@/lib/portal/environment';
import { loadChatHistoryRaw, saveChatHistoryRaw, loadChatSessionsRaw, saveChatSessionsRaw, CHAT_STORE_UPDATED_EVENT } from '@/lib/portal/chat-store';
import { track } from '@/lib/portal/telemetry';
import { markdownToPlain } from '@/lib/portal/chat-markdown';
import { isInternalDiagnostic } from '@/lib/portal/chat-internal-text';
import { fileToUploadPayload, dataUrlToUploadPayload, describeUploadFailure } from '@/lib/portal/image-payload';
import { L } from '@/lib/portal/i18n';
import { resolveAirport } from '@/lib/portal/airports';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import MemoryFlashBanner, { useMemoryFlash } from '@/components/portal/MemoryFlashBanner';
import { executeWithDataProtection } from '@/lib/portal/client-flow-control';
import { recognizeImageLocally } from '@/lib/portal/local-tier0-handlers';
import { IconCamera, IconFile, IconHistory, IconImage, IconKeyboard, IconLink, IconMic, IconSmile, NodeTypeIcon, IconPlane, IconBed, IconUtensils, IconCar, IconCard, IconBook, IconCheckSquare, IconNote, IconMapPin, IconCalendar, IconBox, IconHelpCircle } from './icons';
import EmailComposeSheet from './EmailComposeSheet';

/** 从节点里取可读正文(供邮件回复的上下文参考)。 */
function nodeReadableText(n: LifeNode): string {
  const a = n.attributes as Record<string, unknown>;
  return [a.article, a.summary, a.snippet, a.body, n.rawInput]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 20) || n.rawInput || n.name;
}

/** 念念头像 — Nesio logo,替代 ✦ 占位 */
function NesioAvatar() {
  return (
    <span className="nesio-wechat-avatar nesio-wechat-avatar--logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <NesioMark size={30} />
    </span>
  );
}

interface ChatMessage { role: 'user' | 'model'; text: string; }

// 批次 68:问一问动作块 —— 行程条目(服务端已校验;客户端确认后 ingest 落库)。
export interface ChatPlanItem { name: string; date?: string; time?: string; place?: string; kind?: string; note?: string }

/** 批次 77(用户点名图标问题):emoji 图钉下岗 —— 关键词回退配设计系统线性图标。 */
function planKindIcon(kind?: string): ReactNode {
  const k = (kind || '').toLowerCase();
  const size = 15;
  if (/航班|机票|飞|flight|plane/.test(k)) return <IconPlane size={size} />;
  if (/酒店|住宿|民宿|旅馆|hotel|stay|airbnb/.test(k)) return <IconBed size={size} />;
  if (/餐|吃|饭|美食|food|dining|restaurant/.test(k)) return <IconUtensils size={size} />;
  if (/车|租车|火车|地铁|drive|train|transit|通勤/.test(k)) return <IconCar size={size} />;
  if (/会议|meeting|面试|interview/.test(k)) return <IconMic size={size} />;
  if (/买|购|shop|采购/.test(k)) return <IconCard size={size} />;
  if (/学|复习|读|study|course|练/.test(k)) return <IconBook size={size} />;
  if (/todo|待办|任务/.test(k)) return <IconCheckSquare size={size} />;
  if (/备注|note|提醒/.test(k)) return <IconNote size={size} />;
  if (/景|游|逛|visit|tour|activity|玩/.test(k)) return <IconMapPin size={size} />;
  return <IconCalendar size={size} />;
}

/** date(+time)→ start 属性:带时间给本地 ISO,只有日期保持 YYYY-MM-DD(全天语义,与日历一致)。 */
function planItemStart(it: ChatPlanItem): string | undefined {
  if (!it.date) return undefined;
  if (!it.time) return it.date;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(it.time);
  if (!dm || !tm) return it.date;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  return Number.isNaN(d.getTime()) ? it.date : d.toISOString();
}

// 批次 38:聊天引用卡 —— 存紧凑引用(id+名+来源),点击时再从 life-graph 取全节点做阅读/回复。
interface MsgRef { id: string; name: string; source: LifeNode['source'] }
interface UiMessage {
  id: string;
  role: 'user' | 'model' | 'status';
  text: string;
  sources?: Array<{ title: string; url: string }>;
  refs?: MsgRef[];
  savedToMemory?: boolean;
  /**
   * 2026-07-29(标注 A9-a):用户发的图,气泡里直接显示缩略图。
   * 存的是**缩到 200px 的 jpeg**,不是原图 —— 聊天历史整条存进 localStorage,
   * 塞原图两三张就把配额撑爆,后果是整段历史写不进去(不是少一张图那么轻)。
   */
  imageThumb?: string;
  /** 批次 140:这条答复的真实来路 —— 云端 AI(深问)还是本机记忆搜索(端上)。气泡徽章据此诚实标注。 */
  answerMode?: 'onDevice' | 'cloud';
  /** 批次 68:动作块 —— 澄清选项芯片 / 行程条目确认卡(点确认才真正入库) */
  options?: string[];
  planItems?: ChatPlanItem[];
  planTitle?: string;
  planSaved?: boolean;
  /** 批次 77:问卷式澄清(多题带选项,一次提交) */
  questions?: Array<{ q: string; options: string[] }>;
  questionsDone?: boolean;
  /** 日历事件草稿(念念提议加日历)—— 点确认才写入 Google 主日历。 */
  calendarEvents?: Array<{ summary: string; startISO: string; endISO?: string; allDay?: boolean; location?: string }>;
  calendarState?: 'idle' | 'saving' | 'ok' | 'error';
  calendarError?: string;
  /** Google 原样的失败原因(可展开看)——不看这个就永远只知道「没成功」。 */
  calendarDetail?: string;
  /** 已经写进日历的那几项的下标。重试只补没成的,不重复写。 */
  calendarDone?: number[];
  /** 🔴#2:这条回答时语义检索降级了(缺 AI 配置,只用了关键词匹配)。 */
  semanticDegraded?: boolean;
  semanticReason?: string; // 未生效的具体原因(no_key/rate_limited/provider/network/auth)
  /** 端上 CLIP 照片语义搜索命中(非阻塞:文本答案先出,模型就绪后补进来)。 */
  photos?: Array<{ id: string; thumb: string; score: number }>;
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

// 物品·问一问记物品:像发消息一样记物品(「红色 Nike 鞋放鞋柜」)。
// 门:记/加/收/买了 + 物品词,或「放在/放到/收进」;问句(哪/在哪/?/找)是找东西,走普通聊天。
const INVENTORY_ADD_RE = /(记|加|收|添|买了).{0,8}(物品|东西|收纳|库存)|收纳[::]|放(在|到|进)|add (an? )?item/i;
const INVENTORY_QUESTION_RE = /[??]|哪里|在哪|哪儿|找一?下|找找|去哪/;


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


const MAX_STORED = 60;
const MAX_SESSIONS = 20;

/** 归档的历史对话 — 「新对话」时把当前消息存档,历史记录里可回看 */
interface ChatSession { id: string; title: string; at: string; messages: UiMessage[] }

// 批次 52:对话持久化迁 IndexedDB(chat-store),localStorage 不再承载大件
function loadSessions(): ChatSession[] {
  try {
    return loadChatSessionsRaw() as ChatSession[];
  } catch { return []; }
}

function archiveSession(messages: UiMessage[]): void {
  const real = messages.filter((m) => m.role !== 'status' && m.text?.trim());
  if (real.length === 0) return;
  const firstUser = real.find((m) => m.role === 'user');
  // #19:气泡那一层已经把内部诊断换成人话了,但**历史列表的标题**没走这道 ——
  // 一段没有用户发言的对话,标题就直接取了模型那句「识别到:未检测到任何生命图谱条目」。
  // 一个漏口就够用户看见一次。
  const titleSource = firstUser?.text
    || real.find((m) => !isInternalDiagnostic(m.text))?.text
    || '';
  const session: ChatSession = {
    id: `s-${Date.now()}`,
    title: (titleSource || real[0].text).slice(0, 30),
    at: new Date().toISOString(),
    messages: real.slice(-MAX_STORED),
  };
  try {
    const next = [session, ...loadSessions()].slice(0, MAX_SESSIONS);
    saveChatSessionsRaw(next);
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
    const raw = loadChatHistoryRaw() as UiMessage[];
    // Filter out messages with empty text (from earlier bugs)
    return raw.filter((m) => m.text?.trim());
  } catch { return []; }
}
/**
 * 缩成气泡里够用的小图。
 * 200px / jpeg 0.65 ≈ 8–15KB,一条历史(最多 MAX_STORED 条)加起来还在 localStorage
 * 的安全区里。**必须缩** —— 直接存原图 dataURL 会让 saveHistory 抛 QuotaExceeded,
 * 而那个 catch 是静默的:表现是「聊天记录突然不保存了」,查起来毫无线索。
 * 缩不动(canvas 不可用等)就返回 null,宁可不显示缩略图,也不拿原图去撑爆配额。
 */
const THUMB_PX = 200;
function makeThumb(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, THUMB_PX / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.65));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch { resolve(null); }
  });
}

function saveHistory(msgs: UiMessage[]) {
  try {
    saveChatHistoryRaw(msgs.filter((m) => m.role !== 'status').slice(-MAX_STORED));
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
function BubbleMenu({ msg, onClose, onSave, onCopy, onContinue }: {
  msg: UiMessage; onClose: () => void; onSave: () => void; onCopy: () => void; onContinue: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  return (
    <>
      <button type="button" className="nesio-bubble-menu-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-bubble-menu">
        {/* 批次 135·设计长按菜单:存入记忆 / 复制 / 以此为题继续问 */}
        {!msg.savedToMemory && (
          <button type="button" className="nesio-bubble-menu-item" onClick={() => { onSave(); onClose(); }}>
            <span className="nesio-bubble-menu-icon"><IconBox size={15} /></span>{L(dict, '存入记忆', 'Save to Memory')}
          </button>
        )}
        <button type="button" className="nesio-bubble-menu-item" onClick={() => { onCopy(); onClose(); }}>
          <span className="nesio-bubble-menu-icon"><IconLink size={15} /></span>{L(dict, '复制', 'Copy')}
        </button>
        <button type="button" className="nesio-bubble-menu-item" onClick={() => { onContinue(); onClose(); }}>
          <span className="nesio-bubble-menu-icon"><IconHelpCircle size={15} /></span>{L(dict, '以此为题继续问', 'Continue on this')}
        </button>
        <button type="button" className="nesio-bubble-menu-item nesio-bubble-menu-item--cancel" onClick={onClose}>{L(dict, '取消', 'Cancel')}</button>
      </div>
    </>
  );
}

// ─── Memory detail ─────────────────────────────────────────────────────────────
// ─── Camera view ──────────────────────────────────────────────────────────────
function CameraView({ onResult, onClose, autoOpen = false }: {
  /** label 空 + failure 有值 = 没认出来(诚实说明,不冒充结果)。
   *  imageDataUrl:这次识别的原图 —— 上层缩成缩略图挂在气泡上(标注 A9-a)。 */
  onResult: (label: string, nodes: LifeNode[], failure?: string, imageDataUrl?: string) => void;
  onClose: () => void;
  autoOpen?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());

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
      setCameraError(L(dict, '无法访问摄像头，请检查权限或改用相册', 'Camera unavailable — check permissions or use the album'));
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
    // 必须先缩:原图 base64 越过 Vercel 的 4.5MB 请求体上限就是 413,
    // 而 413 的响应体不是 JSON,r.json() 抛错后只会显示一句「识别失败」(见 image-payload.ts)。
    const { base64, mimeType } = await fileToUploadPayload(file);
    void analyze(`data:${mimeType};base64,${base64}`);
  }

  async function analyze(dataUrl: string) {
    setAnalyzing(true);
    try {
      const [header, base64] = dataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';

      // Phase 2: 客户端前置分流 + 数据保护
      const result = await executeWithDataProtection(
        'image',
        { dataUrl, mimeType },
        // Tier 0: 本地图片识别（免费用户走这路）
        async () => {
          const localResult = await recognizeImageLocally(dataUrl);
          return {
            ok: true,
            nodes: localResult.result.tags.map(tag => ({
              name: tag,
              type: 'tag',
            })),
            // 认出字了就用原文;认不了就用桥给的那句人话(「这台设备认不了字」),
            // 别再回一句「（本地识别）」——那句什么也没说。
            summary: localResult.result.text || localResult.result.unavailable || '',
          };
        },
        // Cloud: 云端 AI 识别（付费用户走这路）
        async () => {
          const res = await fetch('/api/portal/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'image', imageBase64: base64, mimeType }),
          });
          const data = await res.json() as { ok: boolean; nodes?: Array<{ name: string; type: string; tags?: string[] }>; summary?: string };
          return {
            ok: data.ok === true,
            nodes: data.nodes || [],
            summary: data.summary || L(dict, '（云端识别）', 'Cloud recognition'),
          };
        }
      );

      const data = result.data;
      if (data.ok && data.nodes?.length) {
        const names = data.nodes.map((n) => n.name).join(L(dict, '、', ', '));
        // 显示识别来源（本地/云端）
        const sourceHint = result.source === 'local'
          ? L(dict, '(在这台设备上读的,图没有发出去)', ' (read on this device — the photo never left)')
          : '';
        onResult(
          (names || data.summary || L(dict, '（未识别到）', 'Nothing recognized')) + sourceHint,
          recallByRecognition(data.nodes, data.summary),
          undefined,
          dataUrl
        );
      } else {
        const recalled = data.summary ? recallByRecognition([], data.summary) : [];
        onResult(
          '',
          recalled,
          data.summary || L(dict, '这张图没看清,换个角度再拍一张试试。', 'Could not read this photo — try another angle.'),
          dataUrl
        );
      }
    } catch (error) {
      onResult(
        '',
        [],
        L(dict, '识别没成功,再试一次。', 'Recognition did not go through — try again.'),
        dataUrl
      );
    }
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
        <button type="button" className="nesio-chat-camera-shutter" onClick={capture} aria-label={L(dict, '拍照', 'Take photo')}>
          <span className="nesio-camera-shutter-ring" />
        </button>
        {analyzing && <p className="nesio-camera-status">{L(dict, '识别中…', 'Recognizing…')}</p>}
      </div>
    );
  }

  return (
    <div className="nesio-camera-entry">
      <button type="button" className="nesio-wechat-back-btn" onClick={onClose}>← {L(dict, '返回', 'Back')}</button>
      {analyzing ? (
        <p className="nesio-camera-status">{L(dict, '识别中…', 'Recognizing…')}</p>
      ) : (
        <>
          {cameraError && <p className="nesio-camera-status" style={{ color: 'var(--status-risk)' }}>{cameraError}</p>}
          <div className="nesio-camera-entry-btns">
            <button type="button" className="nesio-wechat-plus-item" onClick={openCamera}>
              <span className="nesio-wechat-plus-icon"><IconCamera /></span><span>{L(dict, '打开摄像头', 'Open camera')}</span>
            </button>
            <button type="button" className="nesio-wechat-plus-item" onClick={() => fileRef.current?.click()}>
              <span className="nesio-wechat-plus-icon"><IconImage /></span><span>{L(dict, '从相册选图', 'Choose from album')}</span>
            </button>
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="nesio-visually-hidden" onChange={handleFile} />
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
  // 有权益就深问(云端认真综合),没有就端上(本机记忆搜索)—— 不再让用户先选一次。
  // 图7/图9 把那个分段器划掉了:自己用的东西,问个问题前不该先做选择题。
  const deepMode = canUsePaidCloudAi();
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
  // 批次 77:问卷选择(消息 id → 题号 → 选中项)
  const [quizPicks, setQuizPicks] = useState<Record<string, Record<number, string>>>({});
  const [detailNode, setDetailNode] = useState<LifeNode | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null); // 照片放大(端上 CLIP 命中)

  // 点缩略图 → 取本机大图放大(取不到就用缩略图兜底)
  const openPhoto = useCallback(async (assetId: string, fallbackThumb: string) => {
    const full = await getLocalImage(assetId);
    setLightbox(full || fallbackThumb);
  }, []);

  // 非阻塞地给一条「找东西」答复补上端上 CLIP 照片命中:文本答案已先出,这里模型就绪后回填。
  // 全程端上、失败静默(照片是加成,不该影响文本答案)。低于阈值的弱匹配不展示,免得答非所问。
  const augmentWithPhotos = useCallback(async (msgId: string, query: string) => {
    try {
      warmClip(); // 触发模型加载 + 后台增量索引宝盒相册(幂等)
      const hits = (await searchPhotos(query, 4)).filter((h) => h.score >= 0.2);
      if (!hits.length) return;
      const photos = hits.map((h) => ({ id: h.id, thumb: h.thumb, score: h.score }));
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === msgId ? { ...m, photos } : m));
        saveHistory(next);
        return next;
      });
    } catch { /* 照片是加成,失败静默 */ }
  }, []);
  const [replyNode, setReplyNode] = useState<LifeNode | null>(null); // 批次 38:引用卡直接回复邮件
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop(): void } | null>(null);
  // 输入框随字数自增高:重置到 auto 再取 scrollHeight,封顶 ~5 行(120px)后内部滚动。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTextRef = useRef('');
  // Loaded file context — persists across messages in this session
  const fileContextRef = useRef<{ name: string; content: string } | null>(null);

  useEffect(() => { if (open) setMessages(loadHistory()); }, [open]);
  // 批次 52:IDB 水合晚于打开时补齐历史(只在当前为空时,不覆盖进行中的对话)
  useEffect(() => {
    if (!open) return;
    const onHydrated = () => setMessages((prev) => (prev.length ? prev : loadHistory()));
    window.addEventListener(CHAT_STORE_UPDATED_EVENT, onHydrated);
    return () => window.removeEventListener(CHAT_STORE_UPDATED_EVENT, onHydrated);
  }, [open]);
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
    const userMsg: UiMessage = { id: `u-${Date.now()}`, role: 'user', text: L(dict, `［图片］${pending.name || '这张图'}`, `[Image] ${pending.name || 'this photo'}`) };
    setMessages((prev) => { const next = [...prev, userMsg]; return next; });
    // 记忆详情里的图是本机图库原图,同样可能越过请求体上限 —— 先过一遍缩图判据。
    // 2026-07-31 workshop 不分收费免费:原来免费用户到这里直接 return,
    // 于是记忆详情里的图发进聊天后什么都不发生。产品仓保留那道门,workshop 拆掉。

    void dataUrlToUploadPayload(dataUrl).then(({ base64, mimeType }) => fetch('/api/portal/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image', imageBase64: base64, mimeType }),
    })).then((r) => { if (!r.ok) throw new Error(`http_${r.status}`); return r.json(); }).then((data: { ok?: boolean; nodes?: Array<{ name: string }>; summary?: string }) => {
      // 2026-07-28(标注 图8):没认出来别说「识别到:未检测到任何生命图谱条目」—— 直说没看清。
      const names = data.nodes?.map((n) => n.name).join(L(dict, '、', ', ')) || '';
      const text = names
        ? L(dict, `识别到：${names}\n\n可以继续问我关于这张图的问题。`, `Recognized: ${names}\n\nAsk me anything about this photo.`)
        : data.summary || L(dict, '这张图没看清,换个角度再拍一张试试。', 'Could not read this photo — try another angle.');
      const aiMsg: UiMessage = { id: `a-${Date.now()}`, role: 'model', text };
      setMessages((prev) => { const withAi = [...prev, aiMsg]; saveHistory(withAi); return withAi; });
    }).catch((err) => {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'model', text: describeUploadFailure(err, dict !== 'en') }]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // 阅读器划词「问念念」→ 把引用预填进输入框(不自动发送,等用户补问题)
  useEffect(() => {
    if (!open) return;
    let quote = '';
    try {
      quote = sessionStorage.getItem('nesio-pending-ask-text') || '';
      if (quote) sessionStorage.removeItem('nesio-pending-ask-text');
    } catch { /* ignore */ }
    if (!quote) return;
    const snippet = quote.length > 120 ? `${quote.slice(0, 120)}…` : quote;
    setInput(L(dict, `关于「${snippet}」，`, `About “${snippet}”, `));
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
    if (INVENTORY_ADD_RE.test(text) && !INVENTORY_QUESTION_RE.test(text) && guardPaidCloudAi('inventory_extract')) {
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

    // 成本护栏(A):分层启用后,免费层不打付费云问答 —— 退成端上语义搜索 + 升级引导
    //("问一问 → 搜一搜")。分层未启用(当前 PWA)→ canUsePaidCloudAi() 恒 true,此段不触发,
    // 行为完全不变、当前用户无回归。
    // 批次 148:端上模式(用户手动选)或免费层 → 本机记忆搜索,不打云。深问 + 有权益才走云。
    if (!deepMode || !canUsePaidCloudAi()) {
      // 隐私红线:未登录/未知态不把邮件主题、日程标题(私密外部节点 name)显示到聊天气泡里。
      const hits = searchLifeGraphFuzzy(text.trim(), 6).filter((n) => canUsePrivateData || !isPrivateExternalNode(n));
      const body = hits.length
        ? L(dict, `在你的记忆里找到 ${hits.length} 条:\n${hits.map((n) => `• ${n.name}`).join('\n')}`,
            `Found ${hits.length} in your memory:\n${hits.map((n) => `• ${n.name}`).join('\n')}`)
        : L(dict, '记忆库里没找到相关的。', 'Nothing matching in your memory yet.');
      // 免费层引导升级;有权益却手动选端上的(已是 Pro)只提示可切深问,不推销。
      const hint = !canUsePaidCloudAi()
        ? L(dict, '\n\n升级 Pro 可用 AI 对话式问答。', '\n\nUpgrade to Pro for conversational AI answers.')
        : L(dict, '\n\n想让我认真综合一遍?切「深问」。', '\n\nWant a fuller take? Switch to Deep.');
      const aiMsg: UiMessage = { id: nextMsgId('a'), role: 'model', text: body + hint, answerMode: 'onDevice' };
      setMessages((prev) => { const next = [...prev, aiMsg]; saveHistory(next); return next; });
      setSending(false);
      sendingRef.current = false;
      // 「找东西」类问句 → 非阻塞补端上照片命中(文本答案已出,照片模型就绪后回填)。
      // 只在 find 意图触发,避免闲聊也加载 150MB 模型。
      if (INVENTORY_QUESTION_RE.test(text)) void augmentWithPhotos(aiMsg.id, text.trim());
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      // 🔴#3:把最近几条用户提问作为召回线索,让"第二封讲啥"这类追问仍能重新召回邮件。
      const convoHint = messages.filter((m) => m.role === 'user').slice(-2).map((m) => m.text).join(' ');
      const { context: memoryContext, refCandidates, semanticDegraded, semanticReason } = await buildMemoryContext(text.trim(), convoHint, canUsePrivateData);
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
          calendarContext: canUsePrivateData ? buildCalendarContext(text.trim()) : undefined,
          environmentContext: formatEnvironmentContext(),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json() as { ok?: boolean; response?: string; sources?: Array<{ title: string; url: string }>; actions?: { options?: string[]; planItems?: ChatPlanItem[]; planTitle?: string; questions?: Array<{ q: string; options: string[] }>; calendarEvents?: Array<{ summary: string; startISO: string; endISO?: string; allDay?: boolean; location?: string }> } };
      const rawResp = data.response?.trim() || L(dict, '（暂时没有找到相关信息）', '(Nothing relevant found)');
      // 🔴#1:只保留模型真正引用的记忆节点。ids===null(没自报)→ 回退到前 3 候选作"相关记忆";
      // ids=[](明确"无")→ 不出引用卡(修"模型说没记录、下面还渲染 6 张伪造依据卡")。
      const { text: cleanResp, ids } = extractCitations(rawResp);
      // 批次 53:模型没自报引用(ids===null)时,只把**可辩护的依据**当"相关记忆"渲染:
      // date/email 层是确定性命中;search 层是弱文本匹配(会把联系人/地点凑成伪依据,
      // 用户实测:「今日总结」下面挂着张玉洋/李冰冰)。批量导入的联系人一律不当兜底依据。
      const citedNodes: LifeNode[] = ids === null
        ? refCandidates
            .filter((r) => r.layer !== 'search' && !(r.node.type === 'person' && isBulkImported(r.node)))
            .slice(0, 3)
            .map((r) => r.node)
        : ids.map((id) => refCandidates.find((r) => r.shortId === id)?.node).filter((n): n is LifeNode => Boolean(n));
      // 批次 47:「快速匹配可能没找全」只该出现在**兜底回复**旁 —— AI 真答成功时
      // 挂一条降级警告,用户读作报错(客户只能感到更聪明)。真实原因照旧在 reason 里。
      const isFallbackReply = /云端脑子有点挤|cloud brain is a bit busy/i.test(cleanResp);
      const aiMsg: UiMessage = {
        id: nextMsgId('a'),
        role: 'model',
        answerMode: 'cloud', // 批次 140:走了 /api/portal/chat 云端 —— 徽章诚实标「深问·云端」
        // 兜底剥掉 markdown 强调记号 — 气泡是纯文本,裸 ** 很出戏
        text: cleanResp.replace(/\*\*/g, ''),
        sources: data.sources ?? [],
        refs: citedNodes.map((n) => ({ id: n.id, name: n.name, source: n.source })),
        semanticDegraded: semanticDegraded && isFallbackReply,
        semanticReason,
        ...(data.actions?.options ? { options: data.actions.options } : {}),
        ...(data.actions?.planItems ? { planItems: data.actions.planItems } : {}),
        ...(data.actions?.planTitle ? { planTitle: data.actions.planTitle } : {}),
        ...(data.actions?.questions ? { questions: data.actions.questions } : {}),
        ...(data.actions?.calendarEvents ? { calendarEvents: data.actions.calendarEvents, calendarState: 'idle' as const } : {}),
      };
      // 函数式追加 + 用最终列表存档,别用可能已过期的 nextMsgs 快照覆盖并发消息。
      setMessages((prev) => { const next = [...prev, aiMsg]; saveHistory(next); return next; });
      // 找东西类问句 → 非阻塞补端上照片命中(云端/端上两路都补,照片检索与文本答复无关)。
      if (INVENTORY_QUESTION_RE.test(text)) void augmentWithPhotos(aiMsg.id, text.trim());
    } catch (err) {
      clearTimeout(timeout);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      // 兜底：从本地记忆模糊搜索(隐私红线:未登录/未知态不带出邮件主题、日程标题)
      const localHits = searchLifeGraphFuzzy(text.trim(), 5).filter((n) => canUsePrivateData || !isPrivateExternalNode(n));
      const fallbackText = localHits.length
        ? L(dict, `AI 暂时不可用，但我在记忆库里找到了这些相关线索：\n${localHits.map((n) => `• ${n.name}`).join('\n')}`, `AI is briefly unavailable, but I found these related clues in your memory:\n${localHits.map((n) => `• ${n.name}`).join('\n')}`)
        : isTimeout ? L(dict, '响应超时，请重试。', 'The response timed out — please try again.') : L(dict, 'AI 暂时不可用，记忆库里也没找到相关线索。', 'AI is briefly unavailable, and nothing related turned up in your memory.');
      const errMsg: UiMessage = { id: nextMsgId('e'), role: 'model', text: fallbackText, refs: localHits.map((n) => ({ id: n.id, name: n.name, source: n.source })) };
      setMessages((prev) => [...prev, errMsg]);
    }
    setSending(false);
    sendingRef.current = false;
  }, [messages]);

  // 批次 68:行程确认卡 → 真正落库(带日期的自动进今日聚焦/引导卡;航班等类型由词典自动识别)
  function savePlanItems(msg: UiMessage) {
    if (!msg.planItems?.length || msg.planSaved) return;
    // 批次 70:计划分层 —— 有计划名且多条时先立容器节点(宏观层),
    // 条目双向 relations 挂进去;条目进今日聚焦后天然获得拆解卡(AI+本地双层)。
    const container = msg.planTitle && msg.planItems.length > 1
      ? ingestLifeNode({
          name: msg.planTitle, type: 'event', source: 'manual', confidence: 0.9,
          tags: ['行程', '计划'], relations: [], rawInput: msg.planTitle,
          attributes: { planContainer: true },
        })
      : null;
    const itemIds: string[] = [];
    for (const it of msg.planItems) {
      const start = planItemStart(it);
      // 批次 71(用户实锤 KEF 被地图定位到突尼斯 Kef 城):三字机场码确定性
      // 解析成机场真名 + 坐标 —— 地图按坐标打开,不再靠文字搜索猜。
      const airport = it.place ? resolveAirport(it.place) : null;
      const saved = ingestLifeNode({
        name: it.name,
        type: it.kind === 'todo' ? 'commitment' : 'event',
        source: 'manual',
        confidence: 0.9,
        tags: ['行程'],
        relations: container ? [{ targetId: container.id, relation: 'part_of_plan' }] : [],
        rawInput: [it.name, it.date, it.time, it.place, it.note].filter(Boolean).join(' · '),
        attributes: {
          ...(start ? { start } : {}),
          ...(airport
            ? { location: L(dict, airport.label, airport.labelEn), lat: airport.lat, lon: airport.lon }
            : it.place ? { location: it.place } : {}),
          ...(it.note ? { note: it.note } : {}),
          ...(it.kind ? { planKind: it.kind } : {}),
          planImported: true,
        },
      });
      itemIds.push(saved.id);
    }
    if (container) {
      // R1:走 linkNodes —— 条目在创建时已经写了 part_of_plan(那时容器还没有 id 可指),
      // 这里补容器 → 条目那一半。linkNodes 自带去重,反向那条不会重复写。
      // 原来是 updateLifeNode 整块替换 relations,容器上别的关系会被一起冲掉。
      for (const id of itemIds) linkNodes(container.id, id, 'plan_item');
    }
    setMessages((prev) => { const next = prev.map((m) => m.id === msg.id ? { ...m, planSaved: true } : m); saveHistory(next); return next; });
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  }

  // 日历确认卡 → 逐个写进 Google 主日历。异步动作显式失败态(红线):失败保留可重试。
  async function confirmCalendarEvents(msg: UiMessage) {
    if (!msg.calendarEvents?.length || msg.calendarState === 'saving' || msg.calendarState === 'ok') return;
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, calendarState: 'saving' as const, calendarError: undefined, calendarDetail: undefined } : m));

    // 已经写成功的那几项跳过 —— 之前是无脑重跑整批:3 项成了 2 项,点一次「重试」
    // 就会把那 2 项再写进日历一遍(真的会多出重复日程)。
    const done = new Set(msg.calendarDone ?? []);
    let firstErr = '';
    let firstDetail = '';
    for (let i = 0; i < msg.calendarEvents.length; i += 1) {
      if (done.has(i)) continue;
      const ev = msg.calendarEvents[i];
      const res = await createCalendarEvent({ summary: ev.summary, startISO: ev.startISO, endISO: ev.endISO, allDay: ev.allDay, location: ev.location });
      if (res.ok) { done.add(i); continue; }
      if (!firstErr) {
        firstErr = res.message || L(dict, '写入日历失败', 'Failed to add to calendar');
        firstDetail = res.detail || res.error || '';
      }
    }
    const allDone = done.size === msg.calendarEvents.length;
    setMessages((prev) => {
      const next = prev.map((m) => m.id === msg.id
        ? {
            ...m,
            calendarState: (allDone ? 'ok' : 'error') as 'error' | 'ok',
            calendarError: allDone ? undefined : firstErr,
            calendarDetail: allDone ? undefined : (firstDetail || undefined),
            calendarDone: [...done],
          }
        : m);
      saveHistory(next);
      return next;
    });
  }

  // 批次 72:回答里的列表行(*/-/1. 开头)解析成可勾选清单项
  function parseChecklist(text: string): string[] {
    const items: string[] = [];
    for (const line of text.split('\n')) {
      const m = /^\s*(?:[-*·•]|\d+[.、)])\s*(.+)$/.exec(line);
      if (!m) continue;
      const rawItem = m[1].replace(/[**]/g, '').trim();
      // 批次 74(用户实锤):「重要证件与财务:」是分类标题不是待办项 —— 冒号结尾跳过
      if (/[::]$/.test(rawItem)) continue;
      const t = rawItem.trim();
      if (t.length >= 2 && t.length <= 60) items.push(t);
    }
    return items;
  }

  function handleSave(msg: UiMessage) {
    // 批次 72(用户定案):清单型回答存成**可勾选清单**,不是一坨文字。
    // 名字优先取含「清单/list」的行;认亲:这条回答检索时引用过的记忆
    // (msg.refs,比如「收拾行李」)自动连上 —— 引用即证据,确定性可解释。
    const items = parseChecklist(msg.text);
    const isChecklist = items.length >= 3;
    const titleLine = msg.text.split('\n').map((l) => l.trim()).find((l) => /清单|list/i.test(l) && l.length <= 30 && !/^[-*·•\d]/.test(l));
    const refRelations = (msg.refs || []).slice(0, 3).map((r) => ({ targetId: r.id, relation: 'related_plan' }));
    const savedNode = ingestLifeNode({
      name: isChecklist
        ? (titleLine || L(dict, `清单 · ${items.length} 项`, `Checklist · ${items.length} items`))
        : msg.text.slice(0, 60),
      type: isChecklist ? 'commitment' : 'event',
      source: 'manual', confidence: 0.9,
      tags: isChecklist ? ['宝盒对话', '清单'] : ['宝盒对话'],
      attributes: {
        fullText: msg.text, savedFromChat: true,
        ...(isChecklist ? {
          checklist: true,
          subtasksJson: JSON.stringify(items.slice(0, 20).map((name, i) => ({ id: `c-${Date.now()}-${i}`, name, done: false }))),
        } : {}),
      },
      relations: refRelations, rawInput: msg.text,
    });
    // 反向认亲:被引用的计划节点也指回这份清单
    // R1:走 linkNodes —— 一次读写把两边写完、自带去重、反向关系自动推
    // (has_checklist ↔ checklist_of)。原来只写了被引用那一侧,
    // 从清单点进去看不到它属于哪个计划。
    for (const r of refRelations) {
      linkNodes(r.targetId, savedNode.id, 'has_checklist');
    }
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, savedToMemory: true } : m));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    triggerFlash(savedNode);
  }

  function handleCopy(msg: UiMessage) {
    navigator.clipboard.writeText(msg.text).catch(() => undefined);
  }

  /**
   * 「+」菜单里的「识别图片」:选一张 → 识别 → 顺带在记忆里找相关的。
   *
   * 2026-07-29:这段原来是**写在 JSX 里的一整行 inline 处理器**(2500 字符),
   * 和 handleFileUpload 的图片分支干同一件事却各写各的 —— 于是「传图发原图」这个 bug
   * 得在两个地方分别修。提出来放这儿,两处共用同一套缩图和同一套失败文案。
   */
  function pickAndRecognizeImage() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const uid = nextMsgId('u');
      setMessages((prev) => [...prev, { id: uid, role: 'user', text: L(dict, '[图片] 识别图片', '[Image] Recognize image') }]);
      try {
        // 缩略图是异步做出来的,先把消息放上去再回填,别让气泡等着缩图
        const { base64, mimeType } = await fileToUploadPayload(f);
        void makeThumb(`data:${mimeType};base64,${base64}`).then((th) => {
          if (th) setMessages((prev) => prev.map((m) => (m.id === uid ? { ...m, imageThumb: th } : m)));
        });

        // Phase 2: 使用分流逻辑处理图片识别
        const result = await executeWithDataProtection(
          'image',
          { base64, mimeType },
          async () => {
            const localResult = await recognizeImageLocally(`data:${mimeType};base64,${base64}`);
            return {
              ok: true,
              nodes: localResult.result.tags.map(tag => ({ name: tag, type: 'tag' })),
              // 认出字了就用原文;认不了就用桥给的那句人话(「这台设备认不了字」),
              // 别再回一句「（本地识别）」——那句什么也没说。
              summary: localResult.result.text || localResult.result.unavailable || '',
              source: 'local',
            };
          },
          async () => {
            const r = await fetch('/api/portal/analyze', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'image', imageBase64: base64, mimeType }),
            });
            if (!r.ok) throw new Error(`http_${r.status}`);
            return r.json() as Promise<{ ok?: boolean; nodes?: Array<{ name: string; type: string }>; summary?: string }>;
          }
        );

        const data = result.data;
        let aiText: string;
        if (data.ok && data.nodes?.length) {
          const names = data.nodes.map((n) => n.name).join(L(dict, '、', ', '));
          const nodes = recallByRecognition(data.nodes, data.summary);
          const sourceHint = result.source === 'local' ? L(dict, '(在这台设备上读的,图没有发出去)', ' (read on this device — the photo never left)') : '';
          aiText = nodes.length > 0
            ? L(dict, `识别到：${names}${sourceHint}\n\n找到 ${nodes.length} 条相关记录：\n${nodes.map((n) => `• ${n.name}`).join('\n')}`,
              `Recognized: ${names}${sourceHint}\n\nFound ${nodes.length} related record(s):\n${nodes.map((n) => `• ${n.name}`).join('\n')}`)
            : L(dict, `识别到：${names}${sourceHint}\n\n这件东西还没记过 —— 要我存进记忆吗?`,
              `Recognized: ${names}${sourceHint}\n\nNot in your memory yet — want me to save it?`);
        } else {
          const recalled = data.summary ? recallByRecognition([], data.summary) : [];
          const base = data.summary || L(dict, '这张图没看清,换个角度再拍一张试试。', 'Could not read this photo — try another angle.');
          aiText = recalled.length > 0
            ? L(dict, `${base}\n\n从描述里找到 ${recalled.length} 条相关记录：\n${recalled.map((n) => `• ${n.name}`).join('\n')}`,
              `${base}\n\nFound ${recalled.length} related record(s) from the description:\n${recalled.map((n) => `• ${n.name}`).join('\n')}`)
            : base;
        }
        setMessages((prev) => { const withAi = [...prev, { id: nextMsgId('a'), role: 'model' as const, text: aiText }]; saveHistory(withAi); return withAi; });
      } catch (err) {
        setMessages((prev) => [...prev, { id: nextMsgId('a'), role: 'model', text: describeUploadFailure(err, dict !== 'en') }]);
      }
    };
    inp.click();
  }

  async function handleFileUpload(file: File) {
    setShowPlus(false);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isText = ['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log'].includes(ext);
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp'].includes(ext) || file.type.startsWith('image/');

    // 图片 → 走识别流程
    if (isImage) {
      const userMsg: UiMessage = { id: nextMsgId('u'), role: 'user', text: L(dict, `［图片］这是什么？`, `[Image] What's this?`) };
      setMessages((prev) => [...prev, userMsg]); // 函数式追加,别覆盖并发发送的消息
      try {
        // 先缩再发 —— 原图 base64 会越过 Vercel 的 4.5MB 请求体上限(见 image-payload.ts)。
        const { base64, mimeType } = await fileToUploadPayload(file);

        // Phase 2: 使用分流逻辑处理图片识别
        const result = await executeWithDataProtection(
          'image',
          { base64, mimeType },
          async () => {
            const localResult = await recognizeImageLocally(`data:${mimeType};base64,${base64}`);
            return {
              ok: true,
              nodes: localResult.result.tags.map(tag => ({ name: tag, type: 'tag' })),
              // 认出字了就用原文;认不了就用桥给的那句人话(「这台设备认不了字」),
              // 别再回一句「（本地识别）」——那句什么也没说。
              summary: localResult.result.text || localResult.result.unavailable || '',
              source: 'local',
            };
          },
          async () => {
            const r = await fetch('/api/portal/analyze', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'image', imageBase64: base64, mimeType }),
            });
            if (!r.ok) throw new Error(`http_${r.status}`);
            return r.json() as Promise<{ ok?: boolean; nodes?: Array<{ name: string; type: string }>; summary?: string }>;
          }
        );

        const data = result.data;
        const names = data.nodes?.map((n) => n.name).join(L(dict, '、', ', ')) || '';
        const sourceHint = result.source === 'local' ? L(dict, '(在这台设备上读的,图没有发出去)', ' (read on this device — the photo never left)') : '';
        const text = names
          ? L(dict, `识别到：${names}${sourceHint}\n\n可以继续问我关于这张图片的问题。`, `Recognized: ${names}${sourceHint}\n\nAsk me anything about this image.`)
          : data.summary || L(dict, '这张图没看清,换个角度再拍一张试试。', 'Could not read this photo — try another angle.');
        const aiMsg: UiMessage = { id: nextMsgId('a'), role: 'model', text };
        setMessages((prev) => { const withAi = [...prev, aiMsg]; saveHistory(withAi); return withAi; });
      } catch (err) {
        const aiMsg: UiMessage = { id: nextMsgId('a'), role: 'model', text: describeUploadFailure(err, dict !== 'en') };
        setMessages((prev) => [...prev, aiMsg]);
      }
      return;
    }

    if (!isText) {
      const notice: UiMessage = {
        id: `m-${Date.now()}`, role: 'model',
        text: L(dict, `暂时只支持文本（CSV/TXT/JSON 等）和图片文件。"${file.name}" 是 .${ext || '未知'} 格式，暂不支持。`, `For now, only text files (CSV/TXT/JSON, etc.) and images are supported. "${file.name}" is .${ext || 'unknown'} — not supported yet.`),
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
        ? L(dict, `${raw.trim().split(/\r?\n/).length - 1} 行数据`, `${raw.trim().split(/\r?\n/).length - 1} rows`)
        : `${(raw.length / 1024).toFixed(1)} KB`;

      const notice: UiMessage = {
        id: `f-${Date.now()}`, role: 'model',
        text: L(dict, `已加载 **${file.name}**（${rowCount}）\n\n可以问我这个文件里的任何问题，比如：\n• 这里有多少条记录？\n• 帮我总结一下\n• 谁的金额最高？`, `Loaded **${file.name}** (${rowCount})\n\nAsk me anything about this file, for example:\n• How many records are here?\n• Give me a summary\n• Who has the highest amount?`),
      };
      setMessages((prev) => [...prev, notice]);
    } catch {
      const errMsg: UiMessage = {
        id: `e-${Date.now()}`, role: 'model',
        text: L(dict, `读取文件失败，请确认文件没有损坏。`, `Couldn't read the file — please make sure it isn't corrupted.`),
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
      const errMsg: UiMessage = { id: `e-${Date.now()}`, role: 'model', text: L(dict, '当前浏览器不支持语音输入，请切换到键盘文字输入。', 'Your browser does not support voice input — switch to keyboard text input.') };
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

  async function handleCameraResult(label: string, nodes: LifeNode[], failure?: string, imageDataUrl?: string) {
    setShowCamera(false);
    // 标注 A9-a:气泡里显示你发的那张图,而不是一句「[图片] 识别图片」的占位。
    const thumb = imageDataUrl ? await makeThumb(imageDataUrl) : null;
    const userMsg: UiMessage = {
      id: `u-${Date.now()}`, role: 'user',
      text: L(dict, '[图片] 识别图片', '[Image] Recognize image'),
      ...(thumb ? { imageThumb: thumb } : {}),
    };
    // 2026-07-28(标注 图8):三态分开说 —— 没认出来 / 认出来但没记过 / 认出来且翻到了旧记录。
    const aiText = failure
      ? failure
      : nodes.length > 0
      ? L(dict, `识别到：${label}\n\n记忆库里找到 ${nodes.length} 条相关记录：\n${nodes.map((n) => `• ${n.name}（${n.type}）`).join('\n')}`, `Recognized: ${label}\n\nFound ${nodes.length} related record(s) in your memory:\n${nodes.map((n) => `• ${n.name} (${n.type})`).join('\n')}`)
      : L(dict, `识别到：${label}\n\n这件东西还没记过 —— 要我存进记忆吗?`, `Recognized: ${label}\n\nNot in your memory yet — want me to save it?`);
    const aiMsg: UiMessage = { id: `a-${Date.now()}`, role: 'model', text: aiText };
    const next = [...messages, userMsg, aiMsg];
    setMessages(next); saveHistory(next);
  }

  if (!open) return null;

  if (showCamera) {
    return (
      <div className="nesio-wechat-fullscreen" role="dialog" aria-label={L(dict, '拍照识别', 'Camera capture')}>
        <CameraView
          onResult={handleCameraResult}
          onClose={() => { setShowCamera(false); setCameraAutoOpen(false); }}
          autoOpen={cameraAutoOpen}
        />
      </div>
    );
  }

  if (detailNode) {
    // 批次 139:统一「打开详情」—— 用与记忆页/今天页同一个完整 MemoryNodeDetail
    // (友好分类 + 来源行 + 阅读原文/回复 + 关键信息 + 分类型 section),不再用聊天内裸简版。
    return (
      <MemoryNodeDetail
        node={detailNode}
        onClose={() => setDetailNode(null)}
        onOpenNode={(n) => setDetailNode(n)}
      />
    );
  }

  return (
    <div className="nesio-wechat-fullscreen" role="dialog" aria-modal="true" aria-label={L(dict, '问一问', 'Ask')}>
      {/* 关联记忆闪现 */}
      <MemoryFlashBanner nodes={flashNodes} onDismiss={dismissFlash} />

      {/* 照片放大(端上 CLIP 命中);复用 imgzoom 样式,不加 role=dialog 以守 NesioSheet 原语契约 */}
      {lightbox && createPortal(
        <div className="nesio-imgzoom-overlay">
          <button type="button" className="nesio-imgzoom-backdrop" onClick={() => setLightbox(null)} aria-label={L(dict, '关闭', 'Close')} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="nesio-imgzoom-img" src={lightbox} alt="" onClick={() => setLightbox(null)} />
        </div>,
        document.body,
      )}

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
        <button type="button" className="nesio-wechat-back-btn" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>←</button>
        {/* 2026-07-28 UI 精修(标注 图7):模式副标删掉 —— 底部分段器已经是「端上/深问」的
            唯一事实源,标题下再复述一遍,加上每条气泡下的徽章,一屏出现三四次「深问·云端」。 */}
        <div className="nesio-wechat-brand">
          <span className="nesio-wechat-title">{L(dict, '念念', 'Nessa')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <button
            type="button"
            className="nesio-wechat-more-btn"
            onClick={() => { setSessions(loadSessions()); setShowHistory(true); }}
            aria-label={L(dict, '历史记录', 'History')}
            title={L(dict, '历史记录', 'History')}
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
          <button type="button" className="nesio-settings-sheet-backdrop" onClick={() => setShowHistory(false)} aria-label={L(dict, '关闭', 'Close')} />
          <div className="nesio-chat-history-card">
            <p className="nesio-chat-history-title">{L(dict, '历史对话', 'Past chats')}</p>
            {sessions.length === 0 && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', margin: 'var(--space-2) 0' }}>{L(dict, '还没有归档的对话。点「新对话」会把当前对话存到这里。', 'No archived chats yet. "New chat" stores the current one here.')}</p>
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
                    saveChatSessionsRaw(loadSessions().filter((x) => x.id !== s.id));
                  } catch { /* ignore */ }
                  setShowHistory(false);
                }}
              >
                {/* 早先存下的标题里可能已经躺着一句内部诊断 —— 渲染这一层也挡一道,不改历史数据 */}
                <span className="nesio-chat-history-item-title">
                  {isInternalDiagnostic(s.title) ? L(dict, '(那次没答好)', '(that one went wrong)') : markdownToPlain(s.title)}
                </span>
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
              <NesioMark size={52} />
            </p>
            <p className="nesio-wechat-empty-title">{L(dict, '我是念念', "I'm Nessa")}</p>
            {/* 批次 99:助理拟人化 —— 空态由念念自我介绍(设计规范 命名 NAME LOCKED)。
                导航仍叫「问一问」(动作名),念念是她本人。 */}
            <p className="nesio-wechat-empty-sub">
              {L(dict, '替你记得的那一个。不预测,只在对的时候,把你存过的轻轻翻给你。', 'The one who remembers for you — no predictions, just your own moments handed back at the right time.')}
            </p>
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
                  {msg.imageThumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={msg.imageThumb} alt={L(dict, '你发的图片', 'Image you sent')}
                      className="nesio-chat-sent-thumb" />
                  )}
                  {/* 有缩略图时,「[图片] 识别图片」这句占位就没必要再占一行了 */}
                  {!(msg.imageThumb && /^\[图片\]|^\[Image\]/.test(msg.text)) && (
                    // 模型爱用 markdown 列表/粗体作答,而气泡是纯文本渲染 ——
                    // 不脱记号的话用户看到的就是「* 7月28日（周二）」这种星号糊在正文里。
                    // 只脱记号、不渲染 HTML:聊天里混着邮件正文和日程标题,当 HTML 渲染等于开注入口子。
                    //
                    // 2026-07-29 QA #17:再加一道 —— 历史里存着「识别到:未检测到任何生命图谱条目」
                    // 这种内部诊断(产生它的三个入口 07-28 已修,但**已经存下的对话**照样天天再显示一遍)。
                    // 在这儿换成人话,不动用户的历史数据:万一判重了,原文还在。
                    <p className="nesio-wechat-bubble-text">
                      {msg.role === 'model' && isInternalDiagnostic(msg.text)
                        ? L(dict, '（这条当时没答好 —— 我把内部说明发出来了。再问我一次就行。）',
                          '(This one didn’t come out right — I sent you an internal note by mistake. Just ask me again.)')
                        : markdownToPlain(msg.text)}
                    </p>
                  )}
                  {msg.photos && msg.photos.length > 0 && (
                    <div className="nesio-chat-photo-hits" role="group" aria-label={L(dict, '相关照片', 'Related photos')}>
                      {msg.photos.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="nesio-chat-photo-thumb"
                          onClick={() => openPhoto(p.id, p.thumb)}
                          aria-label={L(dict, '放大照片', 'Enlarge photo')}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.thumb} alt="" draggable={false} />
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.savedToMemory && <p className="nesio-wechat-saved-badge">✓ {L(dict, '已存入记忆', 'Saved to Memory')}</p>}
                </div>
                {/* 2026-07-28 UI 精修(标注 图7):逐条气泡的「✦ 深问·云端」徽章删掉 —— 每答一句挂一个,
                    滚三屏就是三个一模一样的 chip。来路诚实标注改由底部分段器承担(它显示当前模式)。 */}
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
                      if (r === 'provider' || r === 'network') return L(dict, '这次先用了快速匹配,可能没找全 —— 等会儿再问一次会更准。', 'Semantic search briefly unavailable (provider hiccup/quota); used keyword matching — cross-language records may be missed.');
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
                {/* 批次 68:行程确认卡 —— AI 只提议,用户点确认才入库(不再有"嘴上已存入") */}
                {!isUser && msg.planItems && msg.planItems.length > 0 && (
                  <div className="nesio-chat-plan-card">
                    <span className="nesio-chat-plan-title">{L(dict, `整理出 ${msg.planItems.length} 条 · 确认后存入记忆`, `${msg.planItems.length} items ready · confirm to save`)}</span>
                    {msg.planItems.map((it, i) => (
                      <div key={i} className="nesio-chat-plan-row">
                        <span className="nesio-chat-plan-icon">{planKindIcon(it.kind)}</span>
                        <div className="nesio-chat-plan-main">
                          <span className="nesio-chat-plan-name">{it.name}</span>
                          {(it.date || it.place) && (
                            <span className="nesio-chat-plan-meta">{[it.date ? `${it.date}${it.time ? ' ' + it.time : ''}` : '', it.place || ''].filter(Boolean).join(' · ')}</span>
                          )}
                          {it.note ? <span className="nesio-chat-plan-note">{it.note}</span> : null}
                        </div>
                      </div>
                    ))}
                    <button type="button" className="nesio-chat-plan-save" disabled={msg.planSaved} onClick={() => savePlanItems(msg)}>
                      {msg.planSaved
                        ? L(dict, '已存入 ✓ 带日期的会按时出现在今日聚焦', 'Saved ✓ dated items will surface in Today focus')
                        : L(dict, `存入记忆 · ${msg.planItems.length} 条`, `Save ${msg.planItems.length} to Memory`)}
                    </button>
                  </div>
                )}
                {/* 日历确认卡 —— 念念只提议,点确认才写进 Google 主日历 */}
                {!isUser && msg.calendarEvents && msg.calendarEvents.length > 0 && (
                  <div style={{ marginTop: 'var(--space-2)', padding: 'var(--space-3)', border: '1px solid var(--portal-accent-border)', borderRadius: 'var(--radius-md)', background: 'var(--portal-accent-soft)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {msg.calendarEvents.map((ev, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '2px', opacity: msg.calendarDone?.includes(i) ? 0.55 : 1 }}>
                        <span style={{ color: 'var(--portal-ink)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' as unknown as number }}>{ev.summary}</span>
                        <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-xs)' }}>
                          {[ev.allDay ? ev.startISO.slice(0, 10) : ev.startISO.replace('T', ' ').slice(0, 16), ev.location || ''].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    ))}
                    {msg.calendarState === 'error' && msg.calendarDetail && (
                      <details style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                        <summary style={{ cursor: 'pointer' }}>{L(dict, '看看原因', 'Why')}</summary>
                        <p style={{ margin: 'var(--space-1) 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>{msg.calendarDetail}</p>
                      </details>
                    )}
                    {msg.calendarState === 'error' && msg.calendarError && (
                      <span style={{ color: 'var(--status-risk)', fontSize: 'var(--text-xs)' }}>{msg.calendarError}</span>
                    )}
                    {/* 2026-07-29(标注 图1「写入日历没成功」):授权不足时「重试」是错的出路 ——
                        Google 不会追认 scope,再点一万次也还是 403。这种情况唯一能救的动作是
                        **重新授权**(connect 路由带 prompt=consent,会重新弹同意页拿全 scope)。
                        判据放宽到「403 / 权限 / scope」几种写法都认,宁可多给一个入口。 */}
                    {msg.calendarState === 'error' && /403|permission|scope|insufficient|授权/i.test(`${msg.calendarError ?? ''} ${msg.calendarDetail ?? ''}`) && (
                      <a
                        href="/api/portal/calendar/connect"
                        style={{
                          alignSelf: 'flex-start', marginTop: '2px', padding: 'var(--space-2) var(--space-3)',
                          borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)',
                          color: 'var(--portal-accent)', fontSize: 'var(--text-sm)', textDecoration: 'none',
                        }}
                      >
                        {L(dict, '重新授权「管理日程」', 'Re-authorize calendar access')}
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={msg.calendarState === 'saving' || msg.calendarState === 'ok'}
                      onClick={() => confirmCalendarEvents(msg)}
                      style={{
                        marginTop: '2px', padding: 'var(--space-2) var(--space-3)', border: 'none', borderRadius: 'var(--radius-sm)',
                        background: msg.calendarState === 'ok' ? 'var(--status-go-soft)' : 'var(--portal-accent)',
                        color: msg.calendarState === 'ok' ? 'var(--portal-ink)' : '#fff',
                        fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)', fontWeight: 'var(--weight-medium)' as unknown as number,
                        cursor: msg.calendarState === 'saving' || msg.calendarState === 'ok' ? 'default' : 'pointer',
                      }}
                    >
                      {msg.calendarState === 'ok'
                        ? L(dict, '已加到日历 ✓', 'Added to calendar ✓')
                        : msg.calendarState === 'saving'
                          ? L(dict, '正在加入…', 'Adding…')
                          : msg.calendarState === 'error'
                            ? (() => {
                                const left = msg.calendarEvents!.length - (msg.calendarDone?.length ?? 0);
                                return left === msg.calendarEvents!.length
                                  ? L(dict, '重试加入日历', 'Retry')
                                  : L(dict, `再试剩下的 ${left} 项`, `Retry remaining ${left}`);
                              })()
                            : L(dict, `加入日历 · ${msg.calendarEvents.length} 项`, `Add ${msg.calendarEvents.length} to calendar`)}
                    </button>
                  </div>
                )}
                {/* 批次 77:问卷卡 —— 多题带选项,选完一键提交(参考小马AI形态,一轮收齐) */}
                {!isUser && msg.questions && msg.questions.length > 0 && !msg.questionsDone && (
                  <div className="nesio-chat-quiz">
                    {msg.questions.map((qu, qi) => (
                      <div key={qi} className="nesio-chat-quiz-q">
                        <p className="nesio-chat-quiz-title">{qu.q}</p>
                        <div className="nesio-chat-opts">
                          {qu.options.map((o) => (
                            <button
                              key={o}
                              type="button"
                              className={`nesio-chat-opt-chip${quizPicks[msg.id]?.[qi] === o ? ' is-picked' : ''}`}
                              onClick={() => setQuizPicks((prev) => ({ ...prev, [msg.id]: { ...prev[msg.id], [qi]: o } }))}
                            >
                              {o}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="nesio-chat-plan-save"
                      disabled={!quizPicks[msg.id] || Object.keys(quizPicks[msg.id] || {}).length === 0}
                      onClick={() => {
                        const picks = quizPicks[msg.id] || {};
                        const answer = msg.questions!
                          .map((qu, qi) => (picks[qi] ? `${qu.q.replace(/[??]$/, '')}:${picks[qi]}` : null))
                          .filter(Boolean)
                          .join(';');
                        setMessages((prev) => { const next = prev.map((m) => m.id === msg.id ? { ...m, questionsDone: true } : m); saveHistory(next); return next; });
                        void sendMessage(answer);
                      }}
                    >
                      {L(dict, '提交选择', 'Submit answers')}
                    </button>
                  </div>
                )}
                {/* 批次 68:澄清选项芯片(只挂在最新一条,点一下即回答) */}
                {!isUser && msg.options && msg.options.length > 0 && msg.id === messages[messages.length - 1]?.id && !sending && (
                  <div className="nesio-chat-opts">
                    {msg.options.map((o) => (
                      <button key={o} type="button" className="nesio-chat-opt-chip" onClick={() => void sendMessage(o)}>{o}</button>
                    ))}
                  </div>
                )}
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
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); pickAndRecognizeImage(); }}>            <span className="nesio-wechat-plus-icon"><IconImage /></span>
            <span>{L(dict, '相册', 'Photos')}</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); setCameraAutoOpen(true); setShowCamera(true); }}>
            <span className="nesio-wechat-plus-icon"><IconCamera /></span>
            <span>{L(dict, '拍摄', 'Camera')}</span>
          </button>
          {/* 2026-07-28 标注 图9:「+」面板里的「语音输入」划掉 —— 输入栏右边那个麦克风
              就是同一个功能(setVoiceMode(true)),同一屏摆两个入口是重复不是方便。 */}
          <button type="button" className="nesio-wechat-plus-item" onClick={() => filePickerRef.current?.click()}>
            <span className="nesio-wechat-plus-icon"><IconFile /></span>
            <span>{L(dict, '文件', 'File')}</span>
          </button>
          <button type="button" className="nesio-wechat-plus-item" onClick={() => { setShowPlus(false); setShowEmoji(true); }}>
            <span className="nesio-wechat-plus-icon"><IconSmile /></span>
            <span>{L(dict, '表情', 'Emoji')}</span>
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

      {/* 2026-07-28 标注 图7/图9:底部「端上 / 深问 Pro」分段器整个划掉。
          自己用,不需要每次问问题前先选一次引擎 —— 有权益就深问,没有就端上,
          由 canUsePaidCloudAi() 直接决定。答复气泡下的来路徽章仍照实标,
          所以「这条是云答还是本机搜的」并没有变得不可见,只是不再要你先做选择题。 */}

      {/* Input bar */}
      <div className="nesio-wechat-input-bar">
        {voiceMode ? (
          /* Voice mode: keyboard toggle | Hold to Talk | emoji | + */
          <>
            <button
              type="button"
              className="nesio-wechat-mode-btn"
              onClick={() => setVoiceMode(false)}
              aria-label={L(dict, '切换到键盘', 'Switch to keyboard')}
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
              aria-label={L(dict, '按住说话', 'Hold to talk')}
            >
              {recording ? L(dict, '松开发送', 'Release to send') : L(dict, '按住 说话', 'Hold to talk')}
            </button>
            <button
              type="button"
              className={`nesio-wechat-plus-btn${showPlus ? ' nesio-wechat-plus-btn--active' : ''}`}
              onClick={() => { setShowPlus((v) => !v); setShowEmoji(false); }}
              aria-label={L(dict, '更多', 'More')}
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
              aria-label={L(dict, '切换到语音', 'Switch to voice')}
            >
              <IconMic />
            </button>
            <textarea
              ref={inputRef}
              className="nesio-wechat-input"
              rows={1}
              placeholder={L(dict, '问一问…', 'Ask…')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendMessage(input); } }}
              disabled={sending}
            />
            {/* 「＋」常驻:打字后也能加图片/拍摄/文件/表情,不再被发送键顶掉 */}
            <button
              type="button"
              className={`nesio-wechat-plus-btn${showPlus ? ' nesio-wechat-plus-btn--active' : ''}`}
              onClick={() => { setShowPlus((v) => !v); setShowEmoji(false); }}
              aria-label={L(dict, '更多', 'More')}
            >
              ＋
            </button>
            {input.trim() && (
              <button
                type="button"
                className="nesio-wechat-send-btn"
                onClick={() => void sendMessage(input)}
                disabled={sending}
                aria-label={L(dict, '发送', 'Send')}
              >
                {L(dict, '发送', 'Send')}
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
          onSave={() => { handleSave(menuMsg); setMenuMsg(null); }}
          onCopy={() => { handleCopy(menuMsg); setMenuMsg(null); }}
          onContinue={() => {
            // 批次 135·以此为题继续问:把这条内容作话题预填输入框,聚焦让用户接着追问(不跳页)
            const full = (menuMsg.text || '').replace(/\s+/g, ' ').trim();
            const snip = full.slice(0, 20);
            setInput(L(dict, `关于「${snip}${full.length > 20 ? '…' : ''}」,`, `About "${snip}${full.length > 20 ? '…' : ''}": `));
            setMenuMsg(null);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      )}
    </div>
  );
}
