/**
 * 健康风险分层(批次 50 / 医疗级路线 ③层)—— 已验证的临床/流行病学评分,数据齐才算,带出处。
 *
 * 只做「你确实有数据」的三项(不为凑指标编需要血脂/吸烟史的评分):
 *   · VO₂max 体适能分级(按年龄+性别,ACSM/Cooper 参考)—— 心肺适能是最强的全因死亡预测之一
 *   · BMI 分级(WHO)
 *   · GMI→估算糖化血红蛋白(eA1c)糖尿病风险带(ADA;非诊断)
 * ASCVD/FINDRISC 等需完整血脂+血压+吸烟/家族史,数据不全不硬算(见文档「待补」)。
 * 纯函数、可单测、非诊断。
 */
import type { GlucoseAnalysis, HealthMetric, Profile } from './apple-health';

export type RiskCategory = 'info' | 'low' | 'moderate' | 'high';

export interface RiskScore {
  id: string;
  label: [string, string];
  value: string;              // 展示值(分级/百分比区间)
  category: RiskCategory;
  detail: [string, string];
  source: string;
}

export interface RiskInput {
  metrics: HealthMetric[];
  glucose?: GlucoseAnalysis;
  profile?: Profile;
}

const latest = (metrics: HealthMetric[], key: string): number | null => {
  const m = metrics.find((x) => x.key === key);
  return m ? m.latest : null;
};

// VO₂max(mL/kg·min)参考分级门槛:[fair, good, excellent, superior],低于 fair = poor(体适能偏低)。
// 近似 ACSM/Cooper Institute 常模,按性别 + 年龄段。
const VO2_F: Record<string, [number, number, number, number]> = {
  '20': [24, 31, 38, 49], '30': [20, 28, 34, 45], '40': [17, 24, 31, 42], '50': [15, 21, 28, 38], '60': [13, 18, 24, 35],
};
const VO2_M: Record<string, [number, number, number, number]> = {
  '20': [32, 39, 46, 56], '30': [30, 36, 43, 53], '40': [27, 33, 40, 50], '50': [24, 30, 37, 46], '60': [21, 26, 33, 43],
};
function ageBand(age: number): string {
  if (age < 30) return '20';
  if (age < 40) return '30';
  if (age < 50) return '40';
  if (age < 60) return '50';
  return '60';
}

export function computeRiskScores(input: RiskInput): RiskScore[] {
  const out: RiskScore[] = [];
  const p = input.profile;

  // ── VO₂max 体适能分级(需 vo2max + 年龄 + 性别)──
  const vo2 = latest(input.metrics, 'vo2max');
  if (vo2 != null && p?.age && (p.sex === 'male' || p.sex === 'female')) {
    const table = p.sex === 'female' ? VO2_F : VO2_M;
    const [fair, good, exc, sup] = table[ageBand(p.age)];
    let cat: RiskCategory; let zh: string; let en: string;
    if (vo2 < fair) { cat = 'high'; zh = '偏低'; en = 'low'; }
    else if (vo2 < good) { cat = 'moderate'; zh = '一般'; en = 'fair'; }
    else if (vo2 < exc) { cat = 'low'; zh = '良好'; en = 'good'; }
    else if (vo2 < sup) { cat = 'low'; zh = '优秀'; en = 'excellent'; }
    else { cat = 'info'; zh = '卓越'; en = 'superior'; }
    out.push({
      id: 'vo2max-fitness', label: ['心肺适能', 'Cardio fitness'], value: `${zh}(VO₂max ${vo2})`, category: cat,
      detail: [`按 ${p.age} 岁${p.sex === 'female' ? '女' : '男'}性常模,VO₂max ${vo2} 属${zh}`, `For ${p.age}y ${p.sex}, VO₂max ${vo2} is ${en}`],
      source: 'ACSM / Cooper Institute 心肺适能常模(参考)',
    });
  }

  // ── BMI 分级(WHO)──
  let bmi = latest(input.metrics, 'bmi');
  if (bmi == null) {
    const w = latest(input.metrics, 'weight'); const hCm = latest(input.metrics, 'height');
    if (w != null && hCm != null && hCm > 0) bmi = w / ((hCm / 100) ** 2);
  }
  if (bmi != null && bmi > 0) {
    const b = Math.round(bmi * 10) / 10;
    let cat: RiskCategory; let zh: string; let en: string;
    if (b < 18.5) { cat = 'moderate'; zh = '偏瘦'; en = 'underweight'; }
    else if (b < 25) { cat = 'info'; zh = '正常'; en = 'normal'; }
    else if (b < 30) { cat = 'moderate'; zh = '偏重'; en = 'overweight'; }
    else { cat = 'high'; zh = '肥胖'; en = 'obese'; }
    out.push({
      id: 'bmi', label: ['BMI 分级', 'BMI category'], value: `${b} · ${zh}`, category: cat,
      detail: [`BMI ${b}(WHO:正常 18.5–24.9)`, `BMI ${b} — ${en} (WHO normal 18.5–24.9)`],
      source: 'WHO BMI 分级',
    });
  }

  // ── GMI → 估算 A1c 糖尿病风险带(ADA;非诊断)──
  const gmi = input.glucose?.gmi;
  if (gmi != null) {
    let cat: RiskCategory; let zh: string; let en: string;
    if (gmi < 5.7) { cat = 'info'; zh = '正常范围'; en = 'normal range'; }
    else if (gmi < 6.5) { cat = 'moderate'; zh = '偏高(糖尿病前期区间)'; en = 'elevated (prediabetes range)'; }
    else { cat = 'high'; zh = '糖尿病区间'; en = 'diabetes range'; }
    out.push({
      id: 'gmi-band', label: ['GMI ≈ 糖化血红蛋白', 'GMI ≈ A1c'], value: `${gmi}% · ${zh}`, category: cat,
      detail: [`GMI ${gmi}% 近似糖化血红蛋白(ADA:<5.7 正常 / 5.7–6.4 前期 / ≥6.5 糖尿病)—— 非诊断,请与医生确认`, `GMI ${gmi}% ≈ A1c (ADA bands) — not a diagnosis`],
      source: 'ADA A1c 分层 + GMI 换算(国际共识)',
    });
  }

  const rank: Record<RiskCategory, number> = { high: 0, moderate: 1, low: 2, info: 3 };
  return out.sort((a, b) => rank[a.category] - rank[b.category]);
}
