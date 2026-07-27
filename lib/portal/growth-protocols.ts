/**
 * growth-protocols — 成长提问协议(融合 ljg-read 伴读 / dbskill 行动·目标 / 张丽心智方程)。
 * 纯函数,供 growth-engine / growth-guide / GrowthTab 共用;不直接调 AI。
 */

/** 读后一句话 / 回看回答的质量层级(ljg-read Phase 4)。 */
export type ReflectionGrade = 0 | 1 | 2 | 3;

export const REFLECTION_GRADE_LABEL: Record<ReflectionGrade, { zh: string; en: string }> = {
  0: { zh: '还没落地', en: 'Not landed' },
  1: { zh: '复述', en: 'Restating' },
  2: { zh: '有判断', en: 'Judging' },
  3: { zh: '生出新问题', en: 'New question' },
};

const JUDGE_RE = /因为|但是|其实|我觉得|我认为|可能是|不一定|反过来|前提|关键是|真正|不如|比起|所以/;
const Q_RE = /[?？]|为什么|怎么办|如何|怎样|要不要|会不会/;

/** 启发式给回看分级:短/空=L0;多复述源文=L1;有判断=L2;判断+新问=L3。 */
export function gradeReflection(answer: string, sourceText = ''): ReflectionGrade {
  const a = (answer || '').trim();
  if (a.length < 6) return 0;
  const srcTokens = (sourceText || '')
    .replace(/[「」""'']/g, '')
    .split(/[\s,，。.!！?？、；;:：]+/)
    .filter((t) => t.length >= 2);
  let overlap = 0;
  for (const t of srcTokens.slice(0, 24)) {
    if (a.includes(t)) overlap += 1;
  }
  const mostlyEcho = srcTokens.length >= 3 && overlap / Math.min(srcTokens.length, 12) >= 0.55 && a.length < sourceText.length * 1.2;
  if (mostlyEcho && !JUDGE_RE.test(a)) return 1;
  const hasJudge = JUDGE_RE.test(a) || a.length >= 24;
  const hasQ = Q_RE.test(a);
  if (hasJudge && hasQ) return 3;
  if (hasJudge) return 2;
  if (a.length >= 16) return 1;
  return 0;
}

/** dbskill 式行动卡点信号(轻量关键词,只用于挑种子)。 */
export type ActionStallKind = 'simulate' | 'overthink' | 'pivot' | 'knowledge' | 'generic';

const STALL_PATTERNS: Array<{ kind: ActionStallKind; re: RegExp }> = [
  { kind: 'simulate', re: /再看看|帮我看看|你觉得|模拟|先评估|能不能做/ },
  { kind: 'overthink', re: /再想想|想清楚|准备好了再|方案还没|再研究/ },
  { kind: 'pivot', re: /换一个|换方向|不太适合|发现更好|上一个太/ },
  { kind: 'knowledge', re: /先学|再学|课程|教程|补课|还不会/ },
];

export function detectActionStall(text: string): ActionStallKind {
  for (const p of STALL_PATTERNS) {
    if (p.re.test(text)) return p.kind;
  }
  return 'generic';
}

export const ACTION_STALL_HINT: Record<ActionStallKind, { zh: string; en: string }> = {
  simulate: { zh: '准备在替代执行', en: 'Preparing instead of doing' },
  overthink: { zh: '思考在回避行动', en: 'Thinking to avoid starting' },
  pivot: { zh: '换方向在逃避深入', en: 'Switching to avoid going deep' },
  knowledge: { zh: '学习在推迟动手', en: 'Learning to postpone action' },
  generic: { zh: '知道却没开始', en: 'Knows but hasn\'t started' },
};

/** 聊天路由假成功兜底文案 —— 成长引擎必须拒收,回落规则卡。 */
export const GROWTH_AI_SLOP_RE =
  /云端脑子有点挤|cloud brain is a bit busy|AI 暂时不可用|过几分钟再问|快速匹配,可能没找全|找到了这些相关线索/;

export function isGrowthAiSlop(text: string): boolean {
  return GROWTH_AI_SLOP_RE.test(text || '');
}

/**
 * 张丽 · AI 时代心智经营方程(媒介力学论坛):
 * 心智经营 = (触达力 + 内容力 + 触动力) × 人机协同
 * 个人/事业语境下的三力释义,给框架书架与 biz 镜头共用。
 */
export const ZHANG_LI_EQUATION = {
  id: 'zhangli-mind',
  formulaZh: '心智经营 =（触达力 + 内容力 + 触动力）× 人机协同',
  formulaEn: 'Mind share = (Reach + Substance + Conversion) × Human–AI synergy',
  forces: [
    { id: 'reach', zh: '触达力', en: 'Reach', tipZh: '你出现在谁眼前、多常出现', tipEn: 'Who sees you, and how often' },
    { id: 'substance', zh: '内容力', en: 'Substance', tipZh: '你给出的东西有没有信息增量', tipEn: 'Does what you offer add real information' },
    { id: 'convert', zh: '触动力', en: 'Conversion', tipZh: '注意力有没有变成信任/行动', tipEn: 'Does attention become trust or action' },
    { id: 'synergy', zh: '人机协同', en: 'Human–AI synergy', tipZh: '哪步该你判断、哪步可交给 AI', tipEn: 'Where you judge vs where AI amplifies' },
  ],
} as const;
