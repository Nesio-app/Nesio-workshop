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
import {
  ACTION_STALL_HINT,
  detectActionStall,
  isGrowthAiSlop,
  ZHANG_LI_EQUATION,
} from './growth-protocols';

export const GROWTH_REFLECTION_TYPE = 'growth.reflection';

export type GrowthCardKind = 'commitment_review' | 'spend_shift' | 'dusty_memory';

export interface GrowthCard {
  id: string;            // `${kind}:${refId}`
  kind: GrowthCardKind;
  question: string;
  questionEn: string;
  context: string;       // 数据快照(回看流里与回答一起存)
  refId: string;
  dimension?: string;    // 心智维度(MindDimension);答完点亮成长图鉴
}

export interface GrowthAnswer {
  at: string;
  kind: GrowthCardKind;
  refId: string;
  question: string;
  context: string;
  answer: string;
  dimension?: string;    // 心智维度(回看流据此聚合成图鉴)
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
  const notes = String(n.attributes?.notes || n.rawInput || '');
  const stall = detectActionStall(`${n.name} ${notes}`);
  const stallTip = stall === 'generic' ? '' : `（或许是${ACTION_STALL_HINT[stall].zh}）`;
  return {
    id: `commitment_review:${n.id}`,
    kind: 'commitment_review',
    refId: n.id,
    question: `${days} 天前你记下「${n.name}」—— 还想做吗?当时为什么它重要?${stallTip}`,
    questionEn: `${days} days ago you noted "${n.name}" — still on? Why did it matter then?${stall === 'generic' ? '' : ` (${ACTION_STALL_HINT[stall].en})`}`,
    context: `记于 ${n.createdAt.slice(0, 10)} · 未完成`,
    dimension: 'control',
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
    dimension: 'blindspot',
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
    dimension: 'selfaware',
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
    source: 'manual',
    type: GROWTH_REFLECTION_TYPE,
    title: `成长回看:${card.question.slice(0, 40)}`,
    payload: { kind: card.kind, refId: card.refId, question: card.question, context: card.context, answer: text, dimension: card.dimension },
    confidence: 1,
    retentionPolicy: 'LongLiving',
    tags: ['成长引导'],
    epistemic: 'user_asserted',
    generator: 'user',
    derivedFrom: card.refId ? [card.refId] : undefined,
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
        dimension: p.dimension,
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
    id: 'dyp-three',
    name: '段永平三问', nameEn: "Duan Yongping's three questions",
    desc: '看一门生意/一家公司:十年后还在吗?我真看得懂吗?管理层可信吗', descEn: 'For a business: will it exist in 10 years? Do I truly understand it? Is management trustworthy?',
    prompt: '用段永平的三个问题帮我审视下面这家公司/这门生意,每问都要给出「凭什么这么判断」的依据,不确定就明说不确定:\n1. 这门生意十年后还在吗?靠什么活着?\n2. 我真的看得懂它怎么赚钱吗?哪里是我理解的边界?\n3. 管理层过往的言行可信吗?\n\n【粘贴公司/生意】',
  },
  {
    id: 'circle-check',
    name: '能力圈检查', nameEn: 'Circle of competence check',
    desc: '判断一件事是否真在自己能力圈内,而不是「感觉懂」', descEn: 'Test whether something is truly inside your circle, not just familiar',
    prompt: '帮我做能力圈检查:对下面这个领域/标的,列出 5 个「真正懂的人一定答得上」的问题逐一问我的描述里有没有答案;最后诚实结论——它在我能力圈内、边缘、还是圈外?圈外的话,补什么才能进圈?\n\n【粘贴领域/标的与我的理解】',
  },
  {
    id: 'fallacy',
    name: '谬误辨识', nameEn: 'Spot the fallacy',
    desc: '这段话哪里逻辑不对?(偷换概念/滑坡/稻草人…)', descEn: "Where's the logic off? (equivocation, slippery slope, straw man…)",
    prompt: '帮我辨识下面这段话里的逻辑谬误:逐条指出用了哪种谬误(如偷换概念、稻草人、滑坡、诉诸情绪、以偏概全、循环论证等),为什么算这种,并给一句「怎么点破它」的回法。没有明显谬误就照实说。\n\n【粘贴内容】',
  },
  {
    id: 'premortem',
    name: '事前验尸', nameEn: 'Premortem',
    desc: '假设这个决定一年后失败了,倒推原因', descEn: 'Assume the decision failed in a year — work backwards',
    prompt: '假设我下面这个决定一年后被证明是错的,最可能的三个原因是什么?现在有什么低成本动作能提前排掉它们?\n\n【粘贴决定】',
  },
  {
    id: 'zhangli-mind',
    name: '张丽心智方程', nameEn: "Zhang Li's mind-share equation",
    desc: ZHANG_LI_EQUATION.formulaZh, descEn: ZHANG_LI_EQUATION.formulaEn,
    prompt: `用张丽心智经营方程帮我诊断下面这件事:\n${ZHANG_LI_EQUATION.formulaZh}\n\n请分别评估:\n1. 触达力——出现在谁眼前、多常出现\n2. 内容力——信息增量够不够\n3. 触动力——注意力有没有变成信任/行动\n4. 人机协同——哪步该人判断、哪步可交给 AI\n最后指出「此刻最短的一力」+ 本周可验证的一个微动作。不确定就明说不确定。\n\n【粘贴事业/内容/产品现状】`,
  },
  {
    id: 'one-sentence-read',
    name: '读后一句话', nameEn: 'One sentence after reading',
    desc: '用自己的话落下一句,再看是复述还是生出新问题', descEn: 'Land one sentence in your words — restating or a new question?',
    prompt: '读完下面这段后,请只帮我做两件事(不要长摘要):\n1) 逼我用自己的话写「读后一句话」(你先示范一句我可以改的)\n2) 判断这句话更像 L1 复述、L2 有判断、还是 L3 生出新问题,并给一句追问让我往 L3 走。\n\n【粘贴段落】',
  },
  {
    id: 'action-diag',
    name: '执行力诊断', nameEn: 'Action diagnosis',
    desc: '区分准备/想太多/换方向/先学 —— 然后最小一步', descEn: 'Spot preparing / overthinking / pivoting / learning-as-delay — then one tiny step',
    prompt: '我对下面这件事「知道该做却没动」。请诊断最像哪一种卡点(准备在替代执行 / 思考在回避行动 / 换方向在逃避深入 / 学习在推迟动手 / 就是还没开始),用一句温柔点破,再给我「今天 10 分钟内能做完的最小一步」。\n\n【粘贴卡住的事】',
  },
  {
    id: 'slow-is-fast',
    name: '慢就是快', nameEn: 'Slow is fast',
    desc: '先问值不值得加速,再谈怎么做', descEn: 'Ask if speeding up is worth it before how',
    prompt: '用「慢就是快」审视下面这个想加速的决定:先问值不值得快、快了会牺牲什么复利、哪一步其实必须慢;再给一个「故意变慢但更稳」的版本。\n\n【粘贴想加速的事】',
  },
];


// ── 内联 AI(用户定:去掉复制粘贴,点一下直接出结果)────────────────────────────
// 走既有 /api/portal/chat(登录 + guardAiRoute + 限流)。把框架 prompt 里的
// 占位符替换成用户粘的内容,直接返回文本,组件内联渲染,不跳「问一问」。

export async function runFrameworkInline(promptTemplate: string, content: string, locale: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const filled = promptTemplate.replace(/【[^】]*】/g, `\n\n"""${content.trim()}"""`);
  try {
    const res = await fetch('/api/portal/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: filled, uiLocale: locale.toLowerCase().startsWith('en') ? 'en' : 'zh' }),
    });
    if (res.status === 401) return { ok: false, error: 'auth' };
    if (res.status === 429) return { ok: false, error: 'rate' };
    const data = await res.json() as { ok?: boolean; response?: string; error?: string };
    if (data.ok && data.response && !isGrowthAiSlop(data.response)) return { ok: true, text: data.response };
    if (data.ok && data.response && isGrowthAiSlop(data.response)) return { ok: false, error: 'busy' };
    return { ok: false, error: data.error || 'unknown' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** 「帮你吵」:把对方的话 + 场合,组成一条按「前提·事实·逻辑·情绪」拆解并给回法的 message。 */
export function composeArgumentTeardown(said: string, context: string): string {
  const ctx = context.trim() ? `\n场合:${context.trim()}` : '';
  return `别人对我说了这句话,帮我把这一架吵清楚(不是把人说哑,是把理讲明):${ctx}\n\n对方说:"""${said.trim()}"""\n\n请按四步来:\n1. 前提——这句话默认了什么我没同意的前提?\n2. 事实——哪些是事实、哪些是他的主观判断?站得住吗?\n3. 逻辑——推理有没有跳步、偷换、以偏概全?\n4. 情绪——它想让我产生什么情绪、好让我不反驳?\n最后给我两三句「可以怎么平静而有力地回」——就事论事,不攻击人。`;
}
