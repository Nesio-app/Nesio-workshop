/**
 * practice — 练习场(artifact 59587b8d)。用户定:想磨的时候来,你去找它(不推给你)。
 * 两块:① 每日一练(照真实记忆改写的场景题 → 选项 → 讲解)② 利器图鉴(24 把思维利器,
 * 你在自己生活里一把把认出它们,met 从回看流派生)。题从真实记忆改写,不搞题库/段位。
 */
import { getLifeGraph } from './life-graph';

export type ToolDim = 'emotion' | 'reframe' | 'logic' | 'blind' | 'decide';

export interface ThinkingTool {
  id: string;
  name: string; nameEn: string;
  dim: ToolDim;
  spot: string;        // 「怎么一眼认出」的短提示(也喂给 AI 出题)
}

export const TOOL_DIM_LABEL: Record<ToolDim, { zh: string; en: string }> = {
  emotion: { zh: '情绪', en: 'Feeling' },
  reframe: { zh: '认知', en: 'Reframe' },
  logic: { zh: '逻辑', en: 'Logic' },
  blind: { zh: '盲点', en: 'Blind spot' },
  decide: { zh: '决策', en: 'Decision' },
};
export const DIM_ORDER: ToolDim[] = ['emotion', 'reframe', 'logic', 'blind', 'decide'];

/** 每维一个描线图标(与图鉴格子一致)。 */
export const DIM_ICON: Record<ToolDim, string> = {
  emotion: '<path d="M3 12h4l2-5 3 9 2-6 1 2h6"/>',
  reframe: '<rect x="4" y="5" width="11" height="11" rx="2"/><path d="M9 20h9a2 2 0 0 0 2-2V9"/>',
  logic: '<path d="M12 4v6M12 10l-5 10M12 10l5 10"/>',
  blind: '<path d="M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5z"/><path d="M4 5l15 15"/>',
  decide: '<path d="M12 21v-7M12 14L6 5M12 14l6-9"/>',
};

/** 24 把思维利器(5 维)。名字都可见,不搞盲盒 —— 你是在自己生活里认出它们。 */
export const THINKING_TOOLS: ThinkingTool[] = [
  // 情绪
  { id: 'catastrophize', name: '灾难化', nameEn: 'Catastrophizing', dim: 'emotion', spot: '把一件事的后果想到最坏、最远' },
  { id: 'mindread', name: '读心术', nameEn: 'Mind reading', dim: 'emotion', spot: '断定别人心里怎么想,却没问过' },
  { id: 'emo-reason', name: '情绪化推理', nameEn: 'Emotional reasoning', dim: 'emotion', spot: '「我觉得糟，所以事情一定糟」' },
  { id: 'should', name: '应该式思维', nameEn: 'Should statements', dim: 'emotion', spot: '满是「我应该/必须/本该」的硬标准' },
  // 认知
  { id: 'hasty', name: '以偏概全', nameEn: 'Overgeneralizing', dim: 'reframe', spot: '一两件事 →「我这个人就是…」' },
  { id: 'blackwhite', name: '非黑即白', nameEn: 'All-or-nothing', dim: 'reframe', spot: '只有全好或全坏,没有中间' },
  { id: 'label', name: '贴标签', nameEn: 'Labeling', dim: 'reframe', spot: '给自己/别人贴一个死标签' },
  { id: 'filter', name: '心理过滤', nameEn: 'Mental filtering', dim: 'reframe', spot: '只盯着坏的那一点,滤掉其余' },
  // 逻辑
  { id: 'gambler', name: '赌徒谬误', nameEn: "Gambler's fallacy", dim: 'logic', spot: '「都这么多次了，该轮到我了」' },
  { id: 'slippery', name: '滑坡谬误', nameEn: 'Slippery slope', dim: 'logic', spot: '一步没做好 → 推到彻底完蛋' },
  { id: 'strawman', name: '稻草人', nameEn: 'Straw man', dim: 'logic', spot: '把对方观点歪曲成好打的样子' },
  { id: 'circular', name: '循环论证', nameEn: 'Circular reasoning', dim: 'logic', spot: '结论拿来当理由,绕回自己' },
  { id: 'appeal-emo', name: '诉诸情绪', nameEn: 'Appeal to emotion', dim: 'logic', spot: '用情绪代替论证来说服' },
  { id: 'equivocate', name: '偷换概念', nameEn: 'Equivocation', dim: 'logic', spot: '同一个词,前后悄悄换了意思' },
  // 盲点
  { id: 'confirm', name: '确认偏误', nameEn: 'Confirmation bias', dim: 'blind', spot: '只找支持自己的证据' },
  { id: 'survivor', name: '幸存者偏差', nameEn: 'Survivorship bias', dim: 'blind', spot: '只看见活下来的,没看见沉默的' },
  { id: 'hindsight', name: '事后归因', nameEn: 'Hindsight bias', dim: 'blind', spot: '「我早就知道」——其实是事后才知道' },
  { id: 'anchor', name: '锚定效应', nameEn: 'Anchoring', dim: 'blind', spot: '被第一个数字/印象拖着走' },
  { id: 'halo', name: '光环效应', nameEn: 'Halo effect', dim: 'blind', spot: '一点好 → 觉得处处都好' },
  { id: 'dunning', name: '达克效应', nameEn: 'Dunning-Kruger', dim: 'blind', spot: '懂得越少,越觉得自己懂' },
  // 决策
  { id: 'sunk', name: '沉没成本', nameEn: 'Sunk cost', dim: 'decide', spot: '「都投这么多了，不能停」' },
  { id: 'loss-averse', name: '损失厌恶', nameEn: 'Loss aversion', dim: 'decide', spot: '怕失去,远大过想得到' },
  { id: 'status-quo', name: '现状偏好', nameEn: 'Status quo bias', dim: 'decide', spot: '不改比改更「安全」,即使不划算' },
  { id: 'overconfident', name: '过度自信', nameEn: 'Overconfidence', dim: 'decide', spot: '把估计当成事实,不留余地' },
];

export function toolById(id: string): ThinkingTool | undefined { return THINKING_TOOLS.find((t) => t.id === id); }

/** 遇见状态:从回看流派生 —— 答过的题里出现过该利器名字 = 你在生活里认出过它。 */
export function toolsMet(history: Array<{ question?: string; answer?: string; context?: string }>): Set<string> {
  const hay = history.map((h) => `${h.question || ''} ${h.answer || ''} ${h.context || ''}`).join('\n');
  const met = new Set<string>();
  for (const t of THINKING_TOOLS) if (hay.includes(t.name)) met.add(t.id);
  return met;
}

/** 掌握感一句话(跟自己比,不搞段位)。 */
export function masteryLine(history: Array<{ question?: string; answer?: string; context?: string }>): { zh: string; en: string } {
  const met = toolsMet(history);
  if (met.size === 0) return { zh: '练着练着,你会越来越会认出这些陷阱 —— 在你自己的生活里', en: 'Practice, and you’ll spot these traps in your own life' };
  // 出现最多的那把
  const hay = history.map((h) => `${h.question || ''} ${h.answer || ''}`).join('\n');
  let top = ''; let n = 0;
  for (const id of met) {
    const name = toolById(id)!.name;
    const c = hay.split(name).length - 1;
    if (c > n) { n = c; top = name; }
  }
  return { zh: `你越来越会认出「${top}」了`, en: `You’re getting sharper at spotting “${toolById([...met][0])!.nameEn}”` };
}

// ── 每日一练 ─────────────────────────────────────────────────────────────────
export interface Practice {
  toolId: string; toolName: string; toolNameEn: string; dim: ToolDim;
  source?: string;              // 「照你 X 的记录改写」;静态起手题时为空
  scene: string;                // 场景引文(第一人称)
  question: string;
  options: string[];            // 3 项
  correctIndex: number;
  lesson: { how: string; spot: string; life: string };  // 怎么回事 / 怎么一眼认出 / 连回你的生活
}

/** 无 AI/无记忆时的静态起手题(按天轮换,保证练习场永远不空)。 */
export const STATIC_PRACTICES: Practice[] = [
  {
    toolId: 'gambler', toolName: '赌徒谬误', toolNameEn: "Gambler's fallacy", dim: 'logic',
    scene: '「投了 8 家都没回音…… 按概率,第 9 家总该轮到我了吧。」',
    question: '这句话里的思维,问题出在哪?',
    options: ['把每次投递当成会「找平」的事 —— 前面被拒,不会让下一家更可能成', '投得还不够多', '运气本来就说不准'],
    correctIndex: 0,
    lesson: {
      how: '以为独立的事会「找平」。8 次被拒,不会让第 9 次更可能成 —— 就像硬币连出 8 次正面,第 9 次还是一半一半。',
      spot: '话里有「都这么多次了,该轮到…」「按概率总该…」,又把彼此独立的事当成会互相补偿 —— 多半就是它。',
      life: '抓住它不是让你悲观。把「我该走运了」换成:这 8 次里,有没有一个共同的、我能改的点?',
    },
  },
  {
    toolId: 'sunk', toolName: '沉没成本', toolNameEn: 'Sunk cost', dim: 'decide',
    scene: '「这门课我都买了大半年了,虽然一直没兴趣,但不学完太可惜。」',
    question: '「太可惜」这个理由,问题出在哪?',
    options: ['已花的钱回不来了,它不该替「接下来值不值得」做决定', '再逼自己学学就好了', '买都买了,确实可惜'],
    correctIndex: 0,
    lesson: {
      how: '已经付出的、拿不回的,叫沉没成本。它已经沉了 —— 该看的是「从现在起,继续投入值不值」,不是「已经投了多少」。',
      spot: '只要理由是「都已经…了,不能停」,而不是「往后它还值得吗」—— 多半是沉没成本在替你做主。',
      life: '把「都买了」放下,问一句:如果今天从零开始,我还会选它吗?',
    },
  },
  {
    toolId: 'hasty', toolName: '以偏概全', toolNameEn: 'Overgeneralizing', dim: 'reframe',
    scene: '「这次汇报又卡壳了。我就是不擅长在人前说话,天生的。」',
    question: '从「这次卡壳」到「我天生不擅长」,跳步在哪?',
    options: ['把一两次的表现,推成了「我这个人永远如此」的定论', '就是不擅长,认清事实而已', '多练也没用'],
    correctIndex: 0,
    lesson: {
      how: '以偏概全:用一两件事,给自己下了一个关于「整个人、永远」的结论。样本太小,结论太大。',
      spot: '话里有「我就是…」「我天生…」「永远…」,底下却只站着一两件具体的事 —— 就是它。',
      life: '把「我天生不行」换成「这一次哪个环节卡住了」—— 一次一个环节,是能练的。',
    },
  },
];

/** 按天挑一条静态起手题(日内幂等)。 */
export function pickDailyStatic(now = Date.now()): Practice {
  const dayNum = Math.floor(now / 86_400_000);
  return STATIC_PRACTICES[dayNum % STATIC_PRACTICES.length];
}

/** 为个性化出题挑一个种子:一段有判断/情绪的真实记忆 + 一把当天的利器。 */
export interface PracticeSeed { toolId: string; sourceId: string; sourceText: string; dim: ToolDim; }
export function pickPracticeSeed(now = Date.now()): PracticeSeed | null {
  let nodes: Array<{ id: string; name: string; createdAt: string; attributes?: Record<string, unknown>; rawInput?: string }> = [];
  try { nodes = getLifeGraph() as never; } catch { return null; }
  const withText = nodes
    .map((n) => ({ n, text: `${n.name} ${(n.attributes?.notes as string) || n.rawInput || ''}`.trim() }))
    .filter((x) => x.text.length >= 8)
    .sort((a, b) => new Date(b.n.createdAt).getTime() - new Date(a.n.createdAt).getTime());
  if (!withText.length) return null;
  const { n, text } = withText[0];
  const dayNum = Math.floor(now / 86_400_000);
  const tool = THINKING_TOOLS[dayNum % THINKING_TOOLS.length];
  return { toolId: tool.id, sourceId: n.id, sourceText: text, dim: tool.dim };
}

/** 照真实记忆改写一道练习题(走 /api/portal/chat);失败/无 key → null(上层回落静态)。 */
export async function generatePractice(seed: PracticeSeed, locale: string): Promise<Practice | null> {
  const tool = toolById(seed.toolId);
  if (!tool) return null;
  const message = `照这段真实记忆改写一道"认出思维陷阱"的练习题 —— 换掉具体细节(别用原文的人名地名),但留住那个思维模式:"""${seed.sourceText}"""。\n目标陷阱=「${tool.name}」(${tool.spot})。\n给:一句第一人称口语的场景引文(scene)、一个问题(question,固定问"这句话里的思维,问题出在哪?")、3 个选项(第 1 个点出「${tool.name}」+ 2 个似是而非但不对)、正确项下标 correctIndex、以及讲解三段——how(这是怎么回事)、spot(怎么一眼认出这类陷阱)、life(连回 ta 的生活:一句能落到行动、不悲观的话)。中文,温和,不说教。\n只输出严格 JSON:{"scene":"","question":"这句话里的思维,问题出在哪?","options":["","",""],"correctIndex":0,"lesson":{"how":"","spot":"","life":""}}`;
  try {
    const res = await fetch('/api/portal/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, uiLocale: locale.toLowerCase().startsWith('en') ? 'en' : 'zh' }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; response?: string };
    if (!data.ok || !data.response) return null;
    const j = safeJson(data.response);
    if (!j?.scene || !j?.question || !Array.isArray(j.options) || j.options.length < 2 || typeof j.correctIndex !== 'number' || !j.lesson) return null;
    return {
      toolId: tool.id, toolName: tool.name, toolNameEn: tool.nameEn, dim: tool.dim,
      source: '照你近来一条记录改写 —— 换了细节,留了那个念头',
      scene: String(j.scene), question: String(j.question),
      options: j.options.slice(0, 3).map(String),
      correctIndex: Math.max(0, Math.min(2, j.correctIndex)),
      lesson: { how: String(j.lesson.how || ''), spot: String(j.lesson.spot || ''), life: String(j.lesson.life || '') },
    };
  } catch { return null; }
}

interface PracticeJson { scene?: string; question?: string; options?: string[]; correctIndex?: number; lesson?: { how?: string; spot?: string; life?: string } }
function safeJson(text: string): PracticeJson | null {
  const t = text.trim().replace(/^```json?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t) as PracticeJson; } catch {
    const m = t.match(/\{[\s\S]*\}/); if (!m) return null;
    try { return JSON.parse(m[0]) as PracticeJson; } catch { return null; }
  }
}
