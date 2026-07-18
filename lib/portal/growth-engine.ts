/**
 * growth-engine — 智能引导统一引擎(用户定核心洞见:今日引导/帮你吵/思维利器/多面镜
 * 本质是同一件事 = 把一个「心智模型镜头」套到一段「真实记忆」上,换一次成长时刻)。
 *
 * 架构三层(都基于真实记忆,不是题库):
 *  ① 源:collectSeeds() 从真实数据(情绪/认知笔记/财务趋势/久放记忆)找可观察的「种子」;
 *  ② 镜头库 LENSES:每个镜头 = { 匹配器 match() + 呈现态 mode + AI 提示 buildPrompt/parse }。
 *     加镜头 = 往数组加一个对象。视角部分复用多面镜(盲区/斯多葛/苏格拉底)。
 *  ③ 呈现三态:nudge(主动疏导「念念想聊聊」)/ quiz(小测:选项+解释,思维利器形式,
 *     但题是你的真实想法)/ trend(趋势卡)。
 * 生成走 /api/portal/chat(登录+限流);无 key/失败时上层回落规则卡。
 */
import { getLifeGraph, type LifeNode } from './life-graph';
import { loadBankTx } from './bank-tx';

export type ObservationMode = 'nudge' | 'quiz' | 'trend';
/** 心智维度(成长图鉴的轴;比 righthere 的纯逻辑更宽)。 */
export type MindDimension = 'emotion' | 'reframe' | 'logic' | 'blindspot' | 'control' | 'selfaware';

export interface Seed {
  id: string;              // 幂等键:`${lensId}:${sourceId}`
  lensId: string;
  mode: ObservationMode;
  sourceId: string;
  sourceText: string;      // 引用的真实内容(记忆原文/趋势事实)
  meta?: Record<string, string | number>;
}

/** 生成后的观察(nudge/trend 用 body;quiz 用 quiz)。 */
export interface Observation extends Seed {
  dimension: MindDimension;
  title: string;
  body?: string;                          // nudge/trend 的文本
  quiz?: { question: string; options: string[]; correctIndex: number; explanation: string };
}

export interface Lens {
  id: string;
  name: string; nameEn: string;
  mode: ObservationMode;
  dimension: MindDimension;
  /** 从候选记忆/数据里挑出适配本镜头的种子(纯规则、零成本)。返回 0-1 个。 */
  match: (ctx: MatchContext) => Seed | null;
  /** 生成用的 message(喂 /api/portal/chat)。quiz 要求返回严格 JSON。 */
  buildPrompt: (seed: Seed) => string;
  /** 把 AI 文本解析成 Observation 内容。 */
  parse: (seed: Seed, aiText: string) => Pick<Observation, 'title' | 'body' | 'quiz'> | null;
}

interface MatchContext {
  nodes: LifeNode[];
  now: number;
  answered: Set<string>;      // 已回应过的 seed id(不重复出)
}

const DAY = 86_400_000;
const DISTRESS_RE = /累|沮丧|难过|焦虑|烦|压力|失望|委屈|不开心|心情不好|崩溃|想哭|扛不住|emo/i;
const SELF_BLAME_RE = /我(真|太|就是|怎么这么)?(没用|不行|不够|差劲|失败|搞砸|做不好|笨)|都怪我|是我的错|我应该|要是我/i;
// 对「控制不了/未来/别人怎么看」的挂心 → 斯多葛控制二分
const CONTROL_WORRY_RE = /担心|万一|会不会|如果.{0,8}(怎么办|咋办|办)|别人(怎么|会)?(看|想|说|评价)|控制不了|左右不了|掌控不了|不受.{0,4}控制|失控|结果会/;
// 笃定的以偏概全/绝对判断 → 苏格拉底追问
const ABSOLUTE_RE = /总是|老是|永远|从来(没|不)|所有人都|没有人|大家都|每次都|一定是|肯定是|绝对|根本(不|没)|只会|不可能|注定/;

// ── 镜头库(加镜头 = 往这加一个对象)────────────────────────────────────────────
export const LENSES: Lens[] = [
  // ① 情绪疏导(nudge)—— 检测到低落情绪 → 念念主动想聊聊
  {
    id: 'soothe', name: '情绪疏导', nameEn: 'A gentle check-in', mode: 'nudge', dimension: 'emotion',
    match: ({ nodes, now, answered }) => {
      const n = nodes.find((x) => {
        if (now - new Date(x.createdAt).getTime() > 3 * DAY) return false;
        const text = `${x.name} ${(x.attributes?.notes as string) || x.rawInput || ''}`;
        return (x.tags?.includes('情绪') || DISTRESS_RE.test(text)) && DISTRESS_RE.test(text);
      });
      if (!n) return null;
      const src = `${n.name}${n.attributes?.notes ? ' —— ' + n.attributes.notes : ''}`;
      return { id: `soothe:${n.id}`, lensId: 'soothe', mode: 'nudge', sourceId: n.id, sourceText: src };
    },
    buildPrompt: (s) => `你是念念,一个温柔、不评判、像认识很久的朋友。对方今天记下了这样一段心情:"""${s.sourceText}"""。\n用一两句轻轻关心一下,再问 ta 要不要陪着一起看看,它是不是真有那么重(是把话看清,不是分析 ta)。别重复 ta 的原话(卡片上会单独引出来)。中文,口语,别用"您",别列点。只输出这几句话。`,
    parse: (_s, t) => ({ title: '念念想和你聊聊', body: t.trim() }),
  },
  // ② 认知重评(quiz)—— 检测到自责/灾难化的想法 → 考考你这想法哪里可能不对
  {
    id: 'reframe', name: '认知重评', nameEn: 'Reframe check', mode: 'quiz', dimension: 'reframe',
    match: ({ nodes, now, answered }) => {
      const n = nodes.find((x) => {
        if (now - new Date(x.createdAt).getTime() > 4 * DAY) return false;
        const text = `${x.name} ${(x.attributes?.notes as string) || x.rawInput || ''}`;
        return SELF_BLAME_RE.test(text) || (DISTRESS_RE.test(text) && (text.length > 8));
      });
      if (!n) return null;
      const src = `${n.name}${n.attributes?.notes ? ' —— ' + n.attributes.notes : ''}`;
      return { id: `reframe:${n.id}`, lensId: 'reframe', mode: 'quiz', sourceId: n.id, sourceText: src };
    },
    buildPrompt: (s) => `对方在记录里写下了一个带着情绪的想法:"""${s.sourceText}"""。\n做成一道温和的认知偏差小测:\n- **question 必须先用「」把 ta 这句原话引出来**(像:你写「原话」),再接一句「这句话里藏着一个常见的思维陷阱 —— 你抓得出是哪个吗?」;\n- 选出最可能的一种认知扭曲(灾难化/以偏概全/非黑即白/读心术/应该式/贴标签自责/情绪化推理),给 4 个选项(1 个最贴切 + 3 个似是而非但不对),打乱顺序;\n- explanation 先点破陷阱名,再把「具体那件事」和「我这个人不行」分开(前者能修,后者是错觉),温柔、不否定情绪。\n只输出严格 JSON:{"question":"你写「…」。这句话里藏着一个常见的思维陷阱 —— 你抓得出是哪个吗?","options":["…","…","…","…"],"correctIndex":0,"explanation":"…"}`,
    parse: (_s, t) => {
      const j = safeJson(t);
      if (!j?.question || !Array.isArray(j.options) || typeof j.correctIndex !== 'number') return null;
      return { title: '来考考这个想法', quiz: { question: j.question, options: j.options.slice(0, 4), correctIndex: Math.max(0, Math.min(3, j.correctIndex)), explanation: j.explanation || '' } };
    },
  },
  // ③ 斯多葛·控制二分(nudge)—— 对控制不了的事挂心 → 帮 ta 分清能做什么、放下什么
  {
    id: 'stoic', name: '控制二分', nameEn: 'Dichotomy of control', mode: 'nudge', dimension: 'control',
    match: ({ nodes, now }) => {
      const n = nodes.find((x) => {
        if (now - new Date(x.createdAt).getTime() > 4 * DAY) return false;
        const text = `${x.name} ${(x.attributes?.notes as string) || x.rawInput || ''}`;
        return CONTROL_WORRY_RE.test(text);
      });
      if (!n) return null;
      const src = `${n.name}${n.attributes?.notes ? ' —— ' + n.attributes.notes : ''}`;
      return { id: `stoic:${n.id}`, lensId: 'stoic', mode: 'nudge', sourceId: n.id, sourceText: src };
    },
    buildPrompt: (s) => `对方记下了一件让 ta 挂心的事:"""${s.sourceText}"""。\n像温和的斯多葛式向导,把这件事分成两半:哪些是自己能决定、能行动的,哪些是控制不了、只能先接受的;末尾把落点收到「自己此刻能做的一件小事」上。别重复 ta 的原话(卡片上会单独引出来)。两三句,口语,别用"您",别列点。只输出这几句话。`,
    parse: (_s, t) => ({ title: '哪些在你手里', body: t.trim() }),
  },
  // ④ 苏格拉底追问(nudge)—— 笃定的绝对判断 → 用一个问题邀 ta 自己检视
  {
    id: 'socratic', name: '苏格拉底追问', nameEn: 'A Socratic question', mode: 'nudge', dimension: 'logic',
    match: ({ nodes, now }) => {
      const n = nodes.find((x) => {
        if (now - new Date(x.createdAt).getTime() > 4 * DAY) return false;
        const text = `${x.name} ${(x.attributes?.notes as string) || x.rawInput || ''}`;
        return ABSOLUTE_RE.test(text);
      });
      if (!n) return null;
      const src = `${n.name}${n.attributes?.notes ? ' —— ' + n.attributes.notes : ''}`;
      return { id: `socratic:${n.id}`, lensId: 'socratic', mode: 'nudge', sourceId: n.id, sourceText: src };
    },
    buildPrompt: (s) => `对方在记录里写下了一个挺笃定的判断:"""${s.sourceText}"""。\n像苏格拉底那样用一个温和、不带评判的追问,邀 ta 自己检视它的依据或例外(如「真的每一次都这样吗?」「有没有哪怕一次不是?」「这是事实,还是此刻的感受?」)。只问一个问题,不给答案。别重复原话(卡片上会单独引出来)。中文,口语。只输出这一句问题。`,
    parse: (_s, t) => ({ title: '念念想追问一句', body: t.trim() }),
  },
  // ⑤ 趋势洞察(trend)—— 财务:近一周快递/购物笔数偏多 → 温和点出花销趋势
  {
    id: 'trend-spend', name: '趋势洞察', nameEn: 'Trend nudge', mode: 'trend', dimension: 'blindspot',
    match: ({ now }) => {
      let txs: Array<{ date: string; name: string; amount: number; category?: string }> = [];
      try { txs = loadBankTx() as never; } catch { return null; }
      const weekAgo = now - 7 * DAY;
      const recent = txs.filter((t) => new Date(t.date).getTime() >= weekAgo && t.amount > 0);
      const parcels = recent.filter((t) => /amazon|快递|shop|购物|delivery/i.test(`${t.name} ${t.category || ''}`));
      const spend = parcels.reduce((a, b) => a + b.amount, 0);
      if (parcels.length < 4 || spend < 80) return null;
      return { id: `trend-spend:${new Date(now).toISOString().slice(0, 10)}`, lensId: 'trend-spend', mode: 'trend', sourceId: 'finance-week', sourceText: `近 7 天购物/快递 ${parcels.length} 笔,共 $${spend.toFixed(0)}`, meta: { count: parcels.length, spend: Math.round(spend) } };
    },
    buildPrompt: (s) => `观察到一个真实的花销趋势(数字见此,别重复念):${s.sourceText}。\n用一句温和、不说教、不制造焦虑的话,问对方要不要自己看看这个趋势(像:不是说该省 —— 是你自己想看看吗?)。中文。只输出这一句。`,
    parse: (s, t) => ({ title: '一个小趋势', body: t.trim() }),
  },
];

// ── 引擎:选种子 → (上层)逐个 AI 生成 ─────────────────────────────────────────
export function collectSeeds(now = Date.now(), answered: Set<string> = new Set(), limit = 2): Seed[] {
  const nodes = getLifeGraph();
  const ctx: MatchContext = { nodes, now, answered };
  const out: Seed[] = [];
  for (const lens of LENSES) {
    if (out.length >= limit) break;
    try {
      const seed = lens.match(ctx);
      // 同一段记忆只出一张卡(镜头顺序 = 优先级);已回应的不再出
      if (seed && !answered.has(seed.id) && !out.some((s) => s.id === seed.id || s.sourceId === seed.sourceId)) out.push(seed);
    } catch { /* 单镜头失败不拦其余 */ }
  }
  return out;
}

export function lensOf(id: string): Lens | undefined { return LENSES.find((l) => l.id === id); }

/** 客户端:对一个种子生成观察内容(走 /api/portal/chat)。 */
export async function generateObservation(seed: Seed, locale: string): Promise<Observation | null> {
  const lens = lensOf(seed.lensId);
  if (!lens) return null;
  try {
    const res = await fetch('/api/portal/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: lens.buildPrompt(seed), uiLocale: locale.toLowerCase().startsWith('en') ? 'en' : 'zh' }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; response?: string };
    if (!data.ok || !data.response) return null;
    const content = lens.parse(seed, data.response);
    if (!content) return null;
    return { ...seed, dimension: lens.dimension, title: content.title, body: content.body, quiz: content.quiz };
  } catch { return null; }
}

async function chatText(message: string, locale: string): Promise<string | null> {
  try {
    const res = await fetch('/api/portal/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, uiLocale: locale.toLowerCase().startsWith('en') ? 'en' : 'zh' }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; response?: string };
    return data.ok && data.response ? data.response.trim() : null;
  } catch { return null; }
}

/**
 * 情绪卡「和念念聊聊」升级为引导链:念念先陪你看清(reflection),再带一道
 * 「这份感受背后是哪种想法习惯」的小测(quiz,选项=图鉴里的思维利器,tool=命中的利器名)。
 * 选错由 explanation 继续引导;答完记入维度 + 点亮图鉴。JSON 解析失败则只给 reflection。
 */
export interface NudgeGuide {
  reflection: string;
  quiz?: { question: string; options: string[]; correctIndex: number; explanation: string; tool: string };
}
export async function deepenNudge(sourceText: string, locale: string): Promise<NudgeGuide | null> {
  const t = await chatText(
    `你是念念,温柔、不评判、像认识很久的朋友。对方记下了这样的心情:"""${sourceText}"""。\n` +
    `分两部分:\n① reflection:三四句话陪 ta 把这份情绪看清楚(先接住并正常化;再轻轻提一个换角度看的可能;最后一件此刻能做的很小的事)。口语,别用"您",别说教。\n` +
    `② quiz:一道温和的小测 —— 这份感受背后,最可能是哪种「想法习惯」在放大它。从这些思维利器里选最贴切的一种(以偏概全/应该式思维/灾难化/贴标签/非黑即白/读心术/情绪化推理),给 4 个选项(1 个最贴切 + 3 个似是而非),打乱;correctIndex 是正确项下标;explanation 温柔点破(把「这一件具体的事」和「我这个人」分开,前者能修,后者是错觉);tool 填命中的那把利器名(如「以偏概全」)。\n` +
    `只输出严格 JSON:{"reflection":"","quiz":{"question":"这份感受背后,最可能是哪种想法习惯在放大它?","options":["","","",""],"correctIndex":0,"explanation":"","tool":"以偏概全"}}`,
    locale,
  );
  if (!t) return null;
  const j = safeJson(t) as unknown as (NudgeGuide & { quiz?: Record<string, unknown> }) | null;
  if (!j?.reflection) return { reflection: t };  // 非 JSON → 整段当疏导话
  const q = j.quiz as { question?: string; options?: string[]; correctIndex?: number; explanation?: string; tool?: string } | undefined;
  const quiz = (q?.question && Array.isArray(q.options) && q.options.length >= 2 && typeof q.correctIndex === 'number')
    ? { question: String(q.question), options: q.options.slice(0, 4).map(String), correctIndex: Math.max(0, Math.min(3, q.correctIndex)), explanation: String(q.explanation || ''), tool: String(q.tool || '') }
    : undefined;
  return { reflection: String(j.reflection), quiz };
}

/** 趋势卡「看看明细」:近 7 天购物/快递明细(金额降序)。 */
export function recentSpendItems(now = Date.now(), limit = 6): Array<{ date: string; name: string; amount: number }> {
  try {
    const txs = loadBankTx() as Array<{ date: string; name: string; amount: number; category?: string }>;
    const weekAgo = now - 7 * DAY;
    return txs
      .filter((t) => new Date(t.date).getTime() >= weekAgo && t.amount > 0 && /amazon|快递|shop|购物|delivery/i.test(`${t.name} ${t.category || ''}`))
      .sort((a, b) => b.amount - a.amount).slice(0, limit)
      .map((t) => ({ date: t.date, name: t.name, amount: t.amount }));
  } catch { return []; }
}

export const DIMENSION_LABEL: Record<MindDimension, { zh: string; en: string }> = {
  emotion: { zh: '情绪理解', en: 'Emotional insight' },
  reframe: { zh: '认知重构', en: 'Reframing' },
  logic: { zh: '逻辑推理', en: 'Reasoning' },
  blindspot: { zh: '盲点发掘', en: 'Blind spots' },
  control: { zh: '掌控感', en: 'Sense of control' },
  selfaware: { zh: '自我觉察', en: 'Self-awareness' },
};

/** 图鉴里六维的固定排序(展示顺序稳定;对齐成长页 v2 心智成长环)。 */
export const DIMENSION_ORDER: MindDimension[] = ['emotion', 'reframe', 'blindspot', 'control', 'logic', 'selfaware'];

/** 老规则卡没有 dimension 字段时的兜底映射(让历史回答也能点亮图鉴)。 */
const KIND_DIMENSION_FALLBACK: Record<string, MindDimension> = {
  commitment_review: 'control',
  spend_shift: 'blindspot',
  dusty_memory: 'selfaware',
};

/** 一维的成长等级:答的次数越多越熟。0=未点亮。 */
export type DimensionLevel = 0 | 1 | 2 | 3;
export function levelOf(count: number): DimensionLevel {
  if (count <= 0) return 0;       // 未点亮
  if (count < 3) return 1;        // 萌芽
  if (count < 6) return 2;        // 成形
  return 3;                       // 纯熟
}
export const LEVEL_LABEL: Record<DimensionLevel, { zh: string; en: string }> = {
  0: { zh: '未点亮', en: 'Locked' },
  1: { zh: '萌芽', en: 'Sprouting' },
  2: { zh: '成形', en: 'Forming' },
  3: { zh: '纯熟', en: 'Fluent' },
};

/** 心智成长环:底部被 clip 掉的百分比(越小=填得越满);0 次=100(不画弧)。 */
export function ringEmptyPct(count: number): number {
  if (count <= 0) return 100;
  if (count < 3) return 64;
  if (count < 6) return 42;
  if (count < 10) return 20;
  return 8;
}

export interface DimensionStat { dimension: MindDimension; count: number; level: DimensionLevel }

/**
 * 心智成长图鉴聚合:把回看流(答过的观察/卡)按维度归并计数。
 * 每条优先用它自己的 dimension;老卡缺字段时用 kind 兜底映射。
 * 返回六维全量(未点亮的 count=0),顺序 = DIMENSION_ORDER。
 */
export function summarizeDimensions(entries: Array<{ dimension?: string; kind?: string }>): DimensionStat[] {
  const counts = new Map<MindDimension, number>(DIMENSION_ORDER.map((d) => [d, 0]));
  for (const e of entries) {
    const dim = (e.dimension && DIMENSION_ORDER.includes(e.dimension as MindDimension))
      ? (e.dimension as MindDimension)
      : (e.kind ? KIND_DIMENSION_FALLBACK[e.kind] : undefined);
    if (dim) counts.set(dim, (counts.get(dim) || 0) + 1);
  }
  return DIMENSION_ORDER.map((dimension) => {
    const count = counts.get(dimension) || 0;
    return { dimension, count, level: levelOf(count) };
  });
}

function safeJson(text: string): { question?: string; options?: string[]; correctIndex?: number; explanation?: string } | null {
  const t = text.trim().replace(/^```json?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {
    const m = t.match(/\{[\s\S]*\}/); if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}
