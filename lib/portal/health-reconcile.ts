/**
 * health-reconcile —— 同屏两条结论看起来打架时,把它们**接起来**(2026-07-30,bug #28)。
 *
 * 现场:健康 → 分析,上面两条绿字
 *   「血糖达标率良好 — 达标 98.5%」「血糖稳定 — 正常」
 * 紧接着风险分层卡里一条橙字
 *   「GMI ≈ 糖化血红蛋白 — 5.9% · 偏高(糖尿病前期区间)」
 *
 * 三条**各自都对**,这不是数据错:
 *   · TIR 说的是「有多少时间落在目标区间里」;
 *   · CV 说的是「起伏有多大」;
 *   · GMI 说的是「平均水平在哪」。
 * 一个人完全可以「大部分时间在区间内、也很平稳」,而**平均线本身偏高** ——
 * 三个指标量的根本不是同一件事。
 *
 * 错的是屏幕上没有任何一句话说明这一点。用户只看到「正常 / 正常 / 糖尿病前期」,
 * 只能猜哪个是真的。这里就补这一句 —— 不删任何一条结论(删了才是骗人),
 * 只把它们的关系讲清楚。
 *
 * 判据是正向的:**确实同时出现了「我们说好」和「我们说偏高」**,才补这句;
 * 只有其中一边时什么都不说(那没有可解释的矛盾,多一句话就是噪音)。
 *
 * 纯函数。
 */

export interface ReconcileFinding {
  id: string;
  severity: 'info' | 'attention' | 'flag';
}

export interface ReconcileRisk {
  id: string;
  category: 'info' | 'low' | 'moderate' | 'high';
}

/** 说「血糖没问题」的那几条(判定各自的口径见 health-clinical)。 */
const GLUCOSE_OK_IDS = new Set(['glucose-tir', 'glucose-cv']);

/**
 * 血糖这一族要不要补一句「为什么两边都对」。
 * 返回 [zh, en];没有可解释的矛盾时返回 null。
 */
export function glucoseReconcileNote(
  findings: readonly ReconcileFinding[],
  risks: readonly ReconcileRisk[],
): [string, string] | null {
  const saidFine = findings.some((f) => GLUCOSE_OK_IDS.has(f.id) && f.severity === 'info');
  const band = risks.find((r) => r.id === 'gmi-band');
  const saidElevated = !!band && band.category !== 'info';
  if (!saidFine || !saidElevated) return null;
  return [
    '这两条不冲突:达标率和波动说的是「多少时间在区间里、稳不稳」,GMI 说的是「平均线在哪」。'
      + '平稳且大部分时间在区间内,平均线仍可能偏高 —— 它们量的不是同一件事。要不要处理,请与医生确认。',
    'These agree, not conflict: time-in-range and variability describe how much time you spend in range and how steady it is; '
      + 'GMI describes where your average sits. Steady and mostly in range can still come with a higher average — '
      + 'they measure different things. Whether it needs action is a question for your clinician.',
  ];
}
