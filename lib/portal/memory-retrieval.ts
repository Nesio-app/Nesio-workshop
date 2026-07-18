/**
 * memory-retrieval — 问一问的记忆检索算法(批次 176 从 NesioChatSheet 抽出以复用)。
 *
 * 单一事实源:问一问(NesioChatSheet)和每日简报(DailyBriefSheet)共用这一套 buildMemoryContext,
 * 简报不再单独攒数据 —— 简报 = 用同一算法检索「今天的安排/提醒」+ 漂亮排版。
 * 纯客户端(读 life-graph),会在缺邮件时按需触发一次 Gmail 增量同步。
 */

import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { smartSearch } from '@/lib/portal/smart-search';
import { domainInsightsContextBlock } from '@/lib/portal/domain-insights';
import { parseTemporalQuery, isInSpan } from '@/lib/portal/temporal-query';
import { semanticRerankMeta } from '@/lib/portal/semantic-rerank';
import { detectCrossLingualGap } from '@/lib/portal/cross-lingual-gap.mjs';
import { getEmailBody } from '@/lib/portal/local-email-body';
import { ensureEmailFulltextIndex } from '@/lib/portal/email-fulltext-index';

// 里程碑 B:邮件进 RAG 时喂全文(本机 IndexedDB),不再只给 ≤140 字预览 —— 否则模型对着
// 半句预览「总结邮件」只能编。query-aware 取窗:围绕查询词命中处取一段,命不中取开头。
const EMAIL_CTX_BUDGET = 500;
function emailContextBody(fullBody: string | undefined, preview: string, query: string): string {
  const source = fullBody && fullBody.trim().length > preview.trim().length ? fullBody : preview;
  const text = source.replace(/\s+/g, ' ').trim();
  if (!text || text.length <= EMAIL_CTX_BUDGET) return text;
  const toks = query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of toks) { const i = lower.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
  if (idx < 0) return `${text.slice(0, EMAIL_CTX_BUDGET)}…`;
  const start = Math.max(0, idx - 140);
  const end = Math.min(text.length, start + EMAIL_CTX_BUDGET);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function fmtEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
}

/** 🔴#1:从模型回答里抽出它自报的【依据:#1,#3】,并把这行从展示文本里剥掉。
 *  ids===null = 模型没写(不合规,回退);ids=[] = 明确"无"(不出引用卡);ids=[...] = 只引这些。
 *  批次 47:弱模型会写错闭合符(实拍「【依据:#1,#5}」)—— 闭合放宽到 】)}]、
 *  或干脆没闭合(到行尾);剥离后再兜底扫一遍,任何残留的【依据…片段都不许见人。
 *  批次 176:与 buildMemoryContext 一起抽出,问一问 + 每日简报共用同一套引用解析。 */
export function extractCitations(raw: string): { text: string; ids: number[] | null } {
  const m = raw.match(/[【\[（(]\s*依据\s*[:：]?\s*([^】\]）)}\n]*)[】\]）)}]?\s*$/)
    || raw.match(/依据\s*[:：]\s*((?:#?\d+[,，、\s]*)+|无|none)\s*[】\]）)}]?\s*$/i)
    || raw.match(/【依据[:：]?\s*([^】\n]*)[】\]）)}]/);
  if (!m) return { text: raw, ids: null };
  const inner = m[1] || '';
  const ids = /无|none/i.test(inner) ? [] : Array.from(inner.matchAll(/#?(\d+)/g)).map((x) => Number(x[1]));
  const text = raw.replace(m[0], '')
    // 兜底扫尾:剥离主匹配后若还挂着残缺的依据片段(嵌套/重复/断行),一并清掉
    .replace(/[【\[（(]\s*依据[^】\]）)}\n]*[】\]）)}]?/g, '')
    .trim();
  return { text, ids };
}

const SOURCE_LABEL: Record<string, string> = {
  email: 'Gmail',
  calendar: '日历',
  manual: '手动',
  voice: '语音',
  photo: '照片',
  system: '系统',
};

function fmtNode(n: LifeNode, fullBody?: string, query = ''): string {
  // 批次 37:邮件节点给 AI 真实内容(发件人 + 真实收件日期 + 摘要),否则只有主题一行
  // AI 会凭空编造邮件内容(用户遇到的「今天的邮件」被虚构成面试/物业通知)。
  // 里程碑 B:优先喂本机全文(fullBody),query-aware 取窗;无全文退到预览。
  if (n.source === 'email') {
    const from = typeof n.attributes.from === 'string' ? n.attributes.from : '';
    const dateStr = typeof n.attributes.date === 'string' ? n.attributes.date : n.createdAt;
    const d = new Date(dateStr);
    const dateLabel = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    const preview = [n.attributes.snippet, n.attributes.article, n.rawInput]
      .find((v): v is string => typeof v === 'string' && v.trim().length > 0) || '';
    const snippet = emailContextBody(fullBody, preview, query);
    return `• [邮件] 主题「${n.name}」${from ? ` · 来自 ${from}` : ''}${dateLabel ? ` · ${dateLabel}` : ''}${snippet ? ` · 内容:${snippet}` : ''}`;
  }
  const startStr = n.attributes.start as string | undefined;
  const dateLabel = startStr
    ? fmtEventDate(startStr)
    : new Date(n.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  const src = SOURCE_LABEL[n.source] || n.source;
  // QA 实锤:此前普通节点只喂 name —— 标题一截断("…in the ha"),AI 就对着残句瞎猜
  // (handbag/hall closet)。补上原句 rawInput(与 name 不同才带)+ 关键属性
  // (存放位置/备注/详情),AI 拿到的才是完整事实。
  const extras: string[] = [];
  const raw = (n.rawInput || '').replace(/\s+/g, ' ').trim();
  if (raw && raw !== n.name) extras.push(`原句:${raw.slice(0, 140)}`);
  for (const key of ['location', 'note', 'detail'] as const) {
    const v = n.attributes[key];
    if (typeof v === 'string' && v.trim()) {
      extras.push(`${key === 'location' ? '位置' : key === 'note' ? '备注' : '详情'}:${v.trim().slice(0, 80)}`);
    }
  }
  return `• [${src}] ${n.name} (${dateLabel})${extras.length ? ` · ${extras.join(' · ')}` : ''}`;
}

// layer:候选来自哪一层 —— date/email 是确定性命中(可辩护的"依据"),
// search 是文本/语义弱匹配(模型没点名引用时不配当依据渲染,批次 53)。
export interface RefCandidate { shortId: number; node: LifeNode; layer: 'date' | 'email' | 'search' }

// 批次 39/43:天气信号是环境数据不是用户记忆,从问一问候选整体剔除。
// 批次 43 加宽:老天气节点 tags 可能只有 '天气'(source/type 追加是后来的事),
// 名字可能是「Cary 天气」;signalSource 是最可靠的身份标。
export function isWeatherNode(n: LifeNode): boolean {
  const tags = n.tags || [];
  return tags.includes('weather') || tags.includes('weather.forecast') || tags.includes('天气')
    || n.attributes?.signalSource === 'weather'
    || /天气信号|天气$/.test(n.name);
}

export async function buildMemoryContext(query: string, convoHint = ''): Promise<{ context: string; refCandidates: RefCandidate[]; semanticDegraded: boolean; semanticReason: string }> {
  const graph = getLifeGraph().filter((n) => !isWeatherNode(n));
  const temporal = parseTemporalQuery(query);
  // 里程碑 B:惰性水合邮件全文检索索引(不阻塞本次;让后续 smartSearch 能按正文命中排序)。
  void ensureEmailFulltextIndex();

  // Layer 1: date-matched nodes (attributes.start matches the parsed date)
  const dateNodes: LifeNode[] = temporal.hasDate
    ? graph.filter((n) => {
        const s = n.attributes.start as string | undefined;
        return s ? isInSpan(new Date(s), temporal) : false;
      })
    : [];

  // Layer 2: text/entity search + semantic re-rank (embedding cosine blend;
  // falls back to pure text order when the embed endpoint is unavailable)
  // 批次 43:smartSearch 内部读的是未过滤全量图谱 —— 天气信号曾从这条路
  // 漏进「相关记忆」引用卡(图谱级过滤只罩住了 dateNodes/upcoming)。
  const textRanked = smartSearch(query, null).nodes.filter((n) => !isWeatherNode(n)).slice(0, 20);
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

  // 里程碑 B:给入选邮件节点预取本机全文(隐私红线:全文只在本机 IndexedDB),
  // 拼进 RAG 上下文,让「总结邮件/这封讲了啥」拿到真正的正文而不是 140 字预览。
  const emailBodyById = new Map<string, string>();
  await Promise.all(emailNodes.map(async (n) => {
    const eid = typeof n.attributes.emailId === 'string' ? n.attributes.emailId : '';
    if (!eid) return;
    try { const b = await getEmailBody(eid); if (b) emailBodyById.set(n.id, b); } catch { /* 取不到退预览 */ }
  }));

  // 批次 174:手动关联喂进检索(闭环)—— 你在记忆详情里亲手 user_linked 的两条,
  // 问到其中一条,另一条就一起进上下文。只从"话题命中"(日期命中 + 搜索命中)顺藤,
  // 不从 upcoming/recent 噪音节点扩,避免把整张图拉进来。上限 6 条护住上下文预算。
  const byId = new Map(graph.map((n) => [n.id, n]));
  const hitIds = new Set([...dateNodes, ...searchNodes].map((n) => n.id));
  const linkedNodes: LifeNode[] = [];
  const linkedSeen = new Set<string>();
  for (const hit of [...dateNodes, ...searchNodes]) {
    if (linkedNodes.length >= 6) break;
    for (const rel of hit.relations || []) {
      if (rel.relation !== 'user_linked') continue;
      if (hitIds.has(rel.targetId) || linkedSeen.has(rel.targetId)) continue;
      const t = byId.get(rel.targetId);
      if (t && !isWeatherNode(t)) { linkedSeen.add(rel.targetId); linkedNodes.push(t); }
      if (linkedNodes.length >= 6) break;
    }
  }

  // Assemble: date matches HEAD → email (if asked) → upcoming → search → linked → recent
  const seen = new Set<string>();
  const head: LifeNode[] = [];
  const body: LifeNode[] = [];

  for (const n of dateNodes) { if (!seen.has(n.id)) { seen.add(n.id); head.push(n); } }
  for (const n of emailNodes) { if (!seen.has(n.id)) { seen.add(n.id); head.push(n); } }
  for (const n of upcomingNodes) { if (!seen.has(n.id)) { seen.add(n.id); head.push(n); } }
  for (const n of searchNodes) { if (!seen.has(n.id)) { seen.add(n.id); body.push(n); } }
  for (const n of linkedNodes) { if (!seen.has(n.id)) { seen.add(n.id); body.push(n); } }
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
  const layered: Array<[LifeNode, RefCandidate['layer']]> = [
    ...dateNodes.map((n): [LifeNode, RefCandidate['layer']] => [n, 'date']),
    ...emailNodes.map((n): [LifeNode, RefCandidate['layer']] => [n, 'email']),
    ...searchNodes.map((n): [LifeNode, RefCandidate['layer']] => [n, 'search']),
    ...linkedNodes.map((n): [LifeNode, RefCandidate['layer']] => [n, 'search']),
  ];
  for (const [n, layer] of layered) {
    if (refSeen.has(n.id)) continue;
    refSeen.add(n.id);
    // 批次 43:同名+同一天的节点只出一张引用卡(日历老节点重复入库的历史遗留
    // 会让「廿七」这类农历条目连出两张一模一样的 chip)
    const day = typeof n.attributes.start === 'string' ? n.attributes.start.slice(0, 10) : '';
    const dupKey = `${n.name}|${day}`;
    if (refSeen.has(dupKey)) continue;
    refSeen.add(dupKey);
    refCandidates.push({ shortId: refCandidates.length + 1, node: n, layer });
    if (refCandidates.length >= 8) break;
  }
  const idOf = new Map(refCandidates.map((r) => [r.node.id, r.shortId]));
  const fmtCite = (n: LifeNode): string => (idOf.has(n.id) ? `[#${idOf.get(n.id)}] ` : '') + fmtNode(n, emailBodyById.get(n.id), query);

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
    parts.push(...upcomingNodes.map((n) => fmtNode(n)));
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
