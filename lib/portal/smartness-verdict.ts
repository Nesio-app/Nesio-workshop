/**
 * smartness-verdict —— 「聪明度」这个总分该配什么评语(2026-07-30,bug #40)。
 *
 * 现场:雷达图里「功能走通率」只有 29 分,旁边「AI 可用性 100」「响应速度 82」,
 * 而顶上总评仍然写着「72 · 良好」。
 *
 * 平均数就是这么工作的 —— 一个塌下去的维度被四个正常的抬起来了。
 * 用户的话是「不确定这是否符合设计意图,但从展示上看容易让人误判整体健康度」——
 * 说得对:**这块面板是拿来发现问题的**,而它恰恰把最该被发现的那一项抹平了。
 *
 * 判据:评语由**总分和最弱的那一项共同决定**,不是只看总分。
 *   · 有任何一个**测出来的**维度低于 50 → 评语最多到「一般」;
 *   · 低于 35 → 直接「待打磨」。
 * 样本不足(thin,按 50 中性填的)的维度不参与这个封顶 ——
 * 它不是「差」,是「还不知道」,拿它压评语等于拿没有的数据下结论。
 *
 * 总分本身不改。改的是「一句话结论」不许盖住那条腿,并且把最弱的一项点名说出来。
 *
 * 纯函数。
 */

export type SmartnessBand = 'good' | 'fair' | 'needs-work';

export interface SmartnessDim {
  dim: string;
  score: number;
  /** 样本不足,按 50 中性填的 —— 不是「差」,是「还不知道」。 */
  thin?: boolean;
}

export interface SmartnessVerdict {
  band: SmartnessBand;
  /** 拖后腿的那一维(只在它真的把评语压下来时给出)。 */
  weakest: SmartnessDim | null;
  /** 评语是被最弱一项压下来的吗 —— UI 据此决定要不要点名。 */
  cappedByWeakest: boolean;
}

function bandOfScore(score: number): SmartnessBand {
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'needs-work';
}

const RANK: Record<SmartnessBand, number> = { good: 2, fair: 1, 'needs-work': 0 };

export function smartnessVerdict(score: number, dims: readonly SmartnessDim[]): SmartnessVerdict {
  const fromScore = bandOfScore(score);
  // 只有真的测出来的维度才有资格压评语
  const measured = dims.filter((d) => !d.thin);
  if (!measured.length) return { band: fromScore, weakest: null, cappedByWeakest: false };

  const weakest = measured.reduce((a, b) => (b.score < a.score ? b : a));
  const cap: SmartnessBand = weakest.score < 35 ? 'needs-work' : weakest.score < 50 ? 'fair' : 'good';
  const band = RANK[cap] < RANK[fromScore] ? cap : fromScore;
  return { band, weakest, cappedByWeakest: band !== fromScore };
}

/** 评语文案(zh, en)。 */
export const BAND_LABEL: Record<SmartnessBand, [string, string]> = {
  good: ['良好', 'Good'],
  fair: ['一般', 'Fair'],
  'needs-work': ['待打磨', 'Needs work'],
};
