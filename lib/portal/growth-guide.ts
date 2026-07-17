/**
 * growth-guide — 成长引导(用户定:被动观察的数据 → 个性化引导提升)。
 *
 * v0 纯规则、零 AI 成本:从本机既有数据挑「值得回头看一眼」的事,生成每日
 * 引导卡;回答落成一等公民 Signal(type growth.reflection,跨端同步、可导出
 * /删除,与检索反馈同款数据主权模式)。三条规则:
 *  1) commitment_review:记了 5–30 天还没完成的承诺 → 还想做吗?
 *  2) spend_shift:本月某类花费比上月涨得最多(≥$50 且 ≥30%)→ 是忙,还是别的?
 *  3) dusty_memory:高置信但 ≥21 天没再碰的记忆 → 这条还重要吗?
 * 日幂等:同一天出同一批卡;已回答的(kind+refId)不再出。
 */
import { getLifeGraph } from './life-graph';
import { loadBankTx } from './bank-tx';
import { createSignal } from '../life-domain/create-signal';
import { getSignals } from '../life-domain/signal';

export const GROWTH_REFLECTION_TYPE = 'growth.reflection';

export type GrowthCardKind = 'commitment_review' | 'spend_shift' | 'dusty_memory';

export interface GrowthCard {
  id: string;            // `${kind}:${refId}`
  kind: GrowthCardKind;
  question: string;
  questionEn: string;
  context: string;       // 数据快照(回看流里与回答一起存)
  refId: string;
}

export interface GrowthAnswer {
  at: string;
  kind: GrowthCardKind;
  refId: string;
  question: string;
  context: string;
  answer: string;
}

const DAY_MS = 86_400_000;

function answeredKeys(): Set<string> {
  const keys = new Set<string>();
  for (const s of getSignals({ types: [GROWTH_REFLECTION_TYPE] })) {
    const p = s.payload as { kind?: string; refId?: string } | undefined;
    if (p?.kind && p?.refId) keys.add(`${p.kind}:${p.refId}`);
  }
  return keys;
}

function commitmentReviewCard(now: number): GrowthCard | null {
  const nodes = getLifeGraph().filter((n) => {
    if (n.type !== 'commitment') return false;
    if (n.attributes?.done) return false;
    if (n.tags?.includes('meeting-notes')) return false; // 会议记录本体不是待办
    const age = now - new Date(n.createdAt).getTime();
    return age >= 5 * DAY_MS && age <= 30 * DAY_MS;
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const n = nodes[0];
  if (!n) return null;
  const days = Math.round((now - new Date(n.createdAt).getTime()) / DAY_MS);
  return {
    id: `commitment_review:${n.id}`,
    kind: 'commitment_review',
    refId: n.id,
    question: `${days} 天前你记下「${n.name}」—— 还想做吗?当时为什么它重要?`,
    questionEn: `${days} days ago you noted "${n.name}" — still on? Why did it matter then?`,
    context: `记于 ${n.createdAt.slice(0, 10)} · 未完成`,
  };
}

function monthKey(d: string): string { return d.slice(0, 7); }

function spendShiftCard(now: number): GrowthCard | null {
  const txs = loadBankTx();
  if (!txs.length) return null;
  const cur = monthKey(new Date(now).toISOString());
  const prev = monthKey(new Date(now - 30 * DAY_MS).toISOString());
  if (cur === prev) return null;
  const sum = (m: string) => {
    const by = new Map<string, number>();
    for (const t of txs) {
      if (monthKey(t.date) !== m || !(t.amount > 0)) continue;
      const c = t.category || '其他';
      by.set(c, (by.get(c) || 0) + t.amount);
    }
    return by;
  };
  const a = sum(prev); const b = sum(cur);
  let best: { cat: string; from: number; to: number } | null = null;
  for (const [cat, to] of b) {
    const from = a.get(cat) || 0;
    const jump = to - from;
    if (jump >= 50 && (from === 0 || jump / from >= 0.3)) {
      if (!best || jump > best.to - best.from) best = { cat, from, to };
    }
  }
  if (!best) return null;
  return {
    id: `spend_shift:${best.cat}:${cur}`,
    kind: 'spend_shift',
    refId: `${best.cat}:${cur}`,
    question: `这个月「${best.cat}」花了 $${best.to.toFixed(0)},比上月多 $${(best.to - best.from).toFixed(0)} —— 是有原因的,还是顺手就花了?`,
    questionEn: `"${best.cat}" is $${best.to.toFixed(0)} this month, up $${(best.to - best.from).toFixed(0)} — intentional, or just drift?`,
    context: `${prev}: $${best.from.toFixed(0)} → ${cur}: $${best.to.toFixed(0)}`,
  };
}

function dustyMemoryCard(now: number, dayKey: string): GrowthCard | null {
  const nodes = getLifeGraph().filter((n) => {
    if ((n.confidence ?? 0) < 0.8) return false;
    if (n.type === 'commitment' || n.type === 'event') return false;
    const age = now - new Date(n.createdAt).getTime();
    return age >= 21 * DAY_MS;
  });
  if (!nodes.length) return null;
  // 日幂等的"随机":用日期做种挑一条,同一天稳定
  let seed = 0;
  for (const ch of dayKey) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const n = nodes[seed % nodes.length];
  return {
    id: `dusty_memory:${n.id}`,
    kind: 'dusty_memory',
    refId: n.id,
    question: `「${n.name}」在记忆里躺了 ${Math.round((now - new Date(n.createdAt).getTime()) / DAY_MS)} 天 —— 它还重要吗?`,
    questionEn: `"${n.name}" has sat in Memory for ${Math.round((now - new Date(n.createdAt).getTime()) / DAY_MS)} days — does it still matter?`,
    context: `记于 ${n.createdAt.slice(0, 10)}`,
  };
}

/** 今日引导卡(≤limit 张;已回答的不再出;规则顺序=优先级)。 */
export function todayGrowthCards(limit = 2, now = Date.now()): GrowthCard[] {
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const answered = answeredKeys();
  const out: GrowthCard[] = [];
  for (const make of [commitmentReviewCard, spendShiftCard, (t: number) => dustyMemoryCard(t, dayKey)]) {
    if (out.length >= limit) break;
    try {
      const c = make(now);
      if (c && !answered.has(`${c.kind}:${c.refId}`) && !out.some((x) => x.id === c.id)) out.push(c);
    } catch { /* 单条规则失败不拦其余 */ }
  }
  return out;
}

/** 回答落成 Signal:跨端同步、可导出/删除;回看流据此重建。 */
export function recordGrowthAnswer(card: GrowthCard, answer: string): void {
  const text = (answer || '').trim();
  if (!text) return;
  createSignal({
    source: 'ai_observation',
    type: GROWTH_REFLECTION_TYPE,
    title: `成长回看:${card.question.slice(0, 40)}`,
    payload: { kind: card.kind, refId: card.refId, question: card.question, context: card.context, answer: text },
    confidence: 1,
    retentionPolicy: 'LongLiving',
    tags: ['成长引导'],
  });
}

/** 回看流:已答卡的时间线(新→旧)。 */
export function growthHistory(): GrowthAnswer[] {
  return getSignals({ types: [GROWTH_REFLECTION_TYPE] })
    .map((s) => {
      const p = (s.payload || {}) as Partial<GrowthAnswer> & { kind?: GrowthCardKind };
      return {
        at: s.capturedAt,
        kind: (p.kind || 'dusty_memory') as GrowthCardKind,
        refId: p.refId || '',
        question: p.question || '',
        context: p.context || '',
        answer: p.answer || '',
      };
    })
    .filter((a) => a.question)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** 连续回看天数(今天答过才算今天;向前数连续有回答的天)。 */
export function growthStreakDays(now = Date.now()): number {
  const days = new Set(growthHistory().map((a) => a.at.slice(0, 10)));
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    if (days.has(d)) streak++;
    else if (i === 0) continue; // 今天还没答不打断昨天起的连续
    else break;
  }
  return streak;
}

/** 框架书架:结构化提问模板,复制后带着自己的内容去问一问。 */
export interface GrowthFramework { id: string; name: string; nameEn: string; desc: string; descEn: string; prompt: string }

export const GROWTH_FRAMEWORKS: GrowthFramework[] = [
  {
    id: 'four-spine',
    name: '四维拆解', nameEn: 'Four-way teardown',
    desc: '把一段话/一个判断拆成:前提、事实、逻辑、情绪', descEn: 'Split a claim into premise, facts, logic, emotion',
    prompt: '帮我按「前提·事实·逻辑·情绪」四个维度拆解下面这段话:它隐含了什么前提?事实站得住吗?推理有没有跳步?情绪占了几成?\n\n【粘贴内容】',
  },
  {
    id: 'five-whys',
    name: '连问五个为什么', nameEn: 'Five whys',
    desc: '顺着一个现象往根因追', descEn: 'Chase a symptom down to its root cause',
    prompt: '对下面这件事连问五个为什么,帮我找到根因,而不是停在表面解释:\n\n【粘贴内容】',
  },
  {
    id: 'premortem',
    name: '事前验尸', nameEn: 'Premortem',
    desc: '假设这个决定一年后失败了,倒推原因', descEn: 'Assume the decision failed in a year — work backwards',
    prompt: '假设我下面这个决定一年后被证明是错的,最可能的三个原因是什么?现在有什么低成本动作能提前排掉它们?\n\n【粘贴决定】',
  },
];
