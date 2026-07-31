/**
 * mention —— 记一笔的时候打 `@` 直接连到一条已有的记忆。
 *
 * ## 为什么这个比看起来重要
 *
 * Notion 和 Roam 的图之所以密,不是因为它们的 relation 属性多强,是因为**打字的时候
 * 顺手就能连**。我们现在要连两条记忆得:进详情页 → 点关联 → 搜 → 挑,四步摩擦,
 * 所以图长不密 —— 自动关联建的那些边旁边,几乎没有你自己建的。
 *
 * ## 设计:纯文本 + 提交时结算
 *
 * 输入框是 `<textarea>`,不是富文本。所以 mention **不在文本里留特殊标记** ——
 * 插进去的就是那条记忆的名字,你可以正常编辑、正常删。
 *
 * 代价是要在提交时**结算**:只有名字还留在最终文本里的 mention 才真的连。
 * 你插了「Linda 的生日」又把它删掉,就不该连 —— 这是唯一诚实的做法。
 * (富文本方案能精确追踪,但那要换掉整个输入框,而且粘贴/语音输入都得跟着改。)
 *
 * ## 不猜
 *
 * `@` 后面的词只做**前缀/包含匹配**,不做模糊。打 `@lin` 弹出 Linda 是对的;
 * 打 `@生日` 就去猜「Linda 的生日」不是 —— 猜错了你会连上一条不相干的记忆,
 * 而这种错很难发现:它长得像是你自己连的。
 */

/**
 * ## 2026-07-31 图访问收进来了(修构建)
 *
 * 第一版把 `getLifeGraph()` 和 `linkNodes()` 直接写在 CaptureBar / TodayFeed 里,
 * 撞了 `scripts/check-platform-leak.mjs` 的一条架构规则:
 * **「今天」页只能消费 TodayViewModel,不许静态 import `@/lib/portal/life-graph`。**
 * 那条检查跑在 `npm run build` 里(`check:leak`),不在 tsc 也不在 test:security ——
 * 我当时只跑了 `npx next build`,把 build 脚本前面五步全跳过了,所以没看见。
 *
 * 同文件里已有 `await import('@/lib/portal/life-graph')` 的写法能躲过检查器,
 * 但那是躲不是修。规则要的是「今天页不自己决定数据从哪来」,所以正解是把图访问
 * 挪到这个领域模块里:UI 只说「给我候选」「把这些连上」,不知道背后是图还是别的。
 */

import { getLifeGraph } from './life-graph';

export interface MentionCandidate {
  id: string;
  name: string;
}

/** 一次待结算的 mention:插入时记下,提交时按名字是否还在文本里决定连不连。 */
export interface PendingMention {
  id: string;
  name: string;
}

/** 触发字符。中文输入法下 `@` 常被打成全角 `＠`,两个都认。 */
const TRIGGER = /[@＠]/;
/** `@` 后面最多吃多少字 —— 再长就不像在提名字了,是正常写句子。 */
const MAX_QUERY = 24;

export interface ActiveQuery {
  /** `@` 在文本里的下标。 */
  at: number;
  /** `@` 和光标之间那段字(不含 `@`)。 */
  query: string;
}

/**
 * 光标处正在打的 `@查询`,没有就是 null。
 *
 * 规则:
 *   · `@` 必须在**词首**(开头,或前面是空白/标点)—— 否则邮箱 `a@b.com` 会一直弹框;
 *   · `@` 和光标之间不能有换行(换行了就是另一段话);
 *   · 超过 MAX_QUERY 个字就不再算(你在正常写字,不是在提名字)。
 */
export function activeMentionQuery(text: string, caret: number): ActiveQuery | null {
  if (caret < 1 || caret > text.length) return null;
  for (let i = caret - 1; i >= 0 && caret - i <= MAX_QUERY + 1; i--) {
    const ch = text[i];
    if (ch === '\n') return null;
    if (!TRIGGER.test(ch)) continue;
    // 词首判定:开头,或前一个字是空白/常见标点
    const prev = i > 0 ? text[i - 1] : '';
    if (prev && !/[\s(（【「,，。;；:：]/.test(prev)) return null;   // a@b.com 这种不算
    return { at: i, query: text.slice(i + 1, caret) };
  }
  return null;
}

/**
 * 把选中的记忆插进文本,替换掉 `@查询` 那一段。
 *
 * 返回新文本 + 新光标位置(插入名字之后再加一个空格,好接着往下写)。
 */
export function applyMention(
  text: string, q: ActiveQuery, pick: MentionCandidate,
): { text: string; caret: number } {
  const before = text.slice(0, q.at);
  const after = text.slice(q.at + 1 + q.query.length);
  const inserted = `${pick.name} `;
  return { text: before + inserted + after, caret: before.length + inserted.length };
}

/**
 * 候选:名字里**包含**这个查询的记忆。不做模糊 —— 猜错了会连上不相干的东西,
 * 而且看起来像是你自己连的,很难发现。
 *
 * 排序:前缀命中排在包含命中前面(打 `@lin` 时 Linda 该在「客厅灯」前面),
 * 同类按名字短的优先(名字越短越可能是你想提的那个实体)。
 */
export function mentionCandidates(
  query: string,
  nodes: ReadonlyArray<{ id: string; name?: string }>,
  opts: { max?: number; excludeId?: string } = {},
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Array<{ c: MentionCandidate; prefix: boolean }> = [];
  for (const n of nodes) {
    if (!n.name || n.id === opts.excludeId) continue;
    const lower = n.name.toLowerCase();
    const at = lower.indexOf(q);
    if (at < 0) continue;
    hits.push({ c: { id: n.id, name: n.name }, prefix: at === 0 });
    if (hits.length > 200) break;   // 上限:全图线性扫,别在主线程上扫太久
  }
  return hits
    .sort((a, b) => (a.prefix === b.prefix ? a.c.name.length - b.c.name.length : a.prefix ? -1 : 1))
    .slice(0, opts.max ?? 6)
    .map((h) => h.c);
}

/**
 * 提交时结算:哪些 mention 真的要连。
 *
 * 只认**名字还留在最终文本里**的。你插了又删掉,就不连 ——
 * 文本是纯的,这是唯一能诚实判断「你还想不想连它」的依据。
 *
 * 同一条记忆被提了两次只连一次(`linkNodes` 本身也幂等,这里先去重省一次读写)。
 */
export function settleMentions(text: string, pending: readonly PendingMention[]): PendingMention[] {
  const seen = new Set<string>();
  const out: PendingMention[] = [];
  for (const m of pending) {
    if (seen.has(m.id)) continue;
    if (!m.name || !text.includes(m.name)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/* ═══ 图访问:UI 层不碰图,只说「给我候选」「把这些连上」 ═══════════════════ */

/**
 * 从整图里找候选。UI 调这个,不自己 `getLifeGraph()`。
 *
 * 分开一层不只是为了过检查器:候选池将来可能不只是图(邮件全文、联系人…),
 * 那时改这里就行,输入框不用动。
 */
export function mentionCandidatesFromGraph(
  query: string, opts: { max?: number; excludeId?: string } = {},
): MentionCandidate[] {
  if (typeof window === 'undefined') return [];
  try { return mentionCandidates(query, getLifeGraph(), opts); } catch { return []; }
}

/** 一次结算的结果:连上几条、总共该连几条。差额要让用户看见,不能静默。 */
export interface MentionLinkResult { linked: number; total: number }

/**
 * 把结算后的 mention 真的连上。
 *
 * **连不上不抛**:这条记录本身是你要的东西,为了一条关联把它丢掉更糟。
 * 但返回差额 —— 调用方必须把「有几条没连上」说出来。
 */
export async function linkSettledMentions(
  sourceId: string, settled: readonly PendingMention[],
): Promise<MentionLinkResult> {
  if (!settled.length) return { linked: 0, total: 0 };
  let linked = 0;
  try {
    const { linkNodes } = await import('./life-graph');
    for (const m of settled) {
      try { if (linkNodes(sourceId, m.id, 'user_linked').ok) linked += 1; } catch { /* 差额由调用方报出 */ }
    }
  } catch { /* 整个模块加载不出来:linked 停在 0,调用方照样会说 */ }
  return { linked, total: settled.length };
}
