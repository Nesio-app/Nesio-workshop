/**
 * 健康指南语料库 + 检索(批次 51 / 医疗级路线 ④层)。
 *
 * "让 AI 引用真指南":不训模型、也不靠通用大模型的记忆——把一小份**策展的指南要点**
 * 作为语料,按上面确定性判定(findings/scores)的**主题**做检索(不是向量相似度,
 * 而是按结构化 id 精确取,更可靠),注入 prompt 的 <guidelines> 块让 LLM 接地+引用。
 *
 * 说明:这是「策展语料 + 主题键检索」的接地,不是 embedding 向量库(那需要向量存储,
 * 属更大基建,列为后续)。对我们这种结论已结构化的场景,主题键检索反而更准、可审计。
 * 纯函数、可单测、无网络。
 */

export interface GuidelineSnippet {
  topic: string;            // 与 finding/score 的 id 前缀对应
  text: [string, string];   // [zh, en] 指南要点
  source: string;
  url: string;
}

// 语料:每条一句可引用的指南要点 + 出处 + 链接。
const CORPUS: GuidelineSnippet[] = [
  {
    topic: 'glucose-tir',
    text: ['国际共识:大多数糖尿病人应有 ≥70% 时间在 3.9–10.0 mmol/L(70–180 mg/dL)目标范围内(TIR)。', 'International consensus: most people should keep ≥70% time in the 3.9–10.0 mmol/L range (TIR).'],
    source: 'International Consensus on Time in Range (2019)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6973648/',
  },
  {
    topic: 'glucose-tbr',
    text: ['国际共识:低于范围(<3.9 mmol/L)的时间应 <4%,其中 <3.0 mmol/L 应 <1%;低血糖是需优先处理的安全指标。', 'Consensus: time below range (<3.9 mmol/L) should be <4%; hypoglycemia is a priority safety metric.'],
    source: 'International Consensus on Time in Range (2019)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6973648/',
  },
  {
    topic: 'glucose-cv',
    text: ['国际共识:血糖变异系数 CV <36% 视为稳定;≥36% 提示波动偏大。', 'Consensus: glucose CV <36% is stable; ≥36% indicates higher variability.'],
    source: 'International Consensus on Time in Range (2019)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6973648/',
  },
  {
    topic: 'gmi-band',
    text: ['GMI 由平均血糖估算,近似糖化血红蛋白(A1c);ADA 参考:<5.7% 正常、5.7–6.4% 前期、≥6.5% 糖尿病区间。GMI 非诊断,确诊需实验室 A1c。', 'GMI approximates A1c; ADA bands: <5.7% normal, 5.7–6.4% increased risk, ≥6.5% diabetes range. GMI is not diagnostic.'],
    source: 'ADA Standards of Care / GMI (Bergenstal 2018)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6973648/',
  },
  {
    topic: 'glucose-dawn',
    text: ['黎明现象:清晨(约 4–8 点)因激素节律血糖生理性升高;持续明显升高值得与医生讨论调整。', 'Dawn phenomenon: a physiological early-morning glucose rise; a persistent marked rise is worth discussing with a clinician.'],
    source: '临床常见模式(黎明现象)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6973648/',
  },
  {
    topic: 'sleep-deep',
    text: ['成人睡眠分期参考:深睡(N3)约占总睡眠 13–23%,REM 约 20–25%;深睡偏低可关注睡眠质量与作息。', 'Adult sleep: deep sleep (N3) ~13–23% of total, REM ~20–25%; low deep sleep is worth watching.'],
    source: 'AASM 睡眠分期参考', url: 'https://support.ouraring.com/hc/en-us/articles/11752397946003-Sleep-Stages',
  },
  {
    topic: 'rhr-vs-baseline',
    text: ['静息心率较个人基线持续升高,可能反映疲劳、感染早期、压力或过度训练;结合 HRV 一起看。', 'A sustained rise in resting HR above your baseline can reflect fatigue, early infection, stress or overtraining.'],
    source: '自主神经/恢复(个人基线偏离)', url: 'https://support.whoop.com/s/article/WHOOP-Sleep',
  },
  {
    topic: 'hrv-vs-baseline',
    text: ['心率变异 HRV 低于个人基线,常提示恢复不足或应激升高;单点意义有限,看趋势。', 'HRV below your baseline often indicates under-recovery or elevated stress; trends matter more than a single value.'],
    source: '自主神经/恢复(个人基线偏离)', url: 'https://support.whoop.com/s/article/WHOOP-Sleep',
  },
  {
    topic: 'vo2max-fitness',
    text: ['心肺适能(VO₂max)是最强的全因死亡预测之一;按年龄、性别对照常模分级,提升靠规律有氧+间歇。', 'Cardiorespiratory fitness (VO₂max) is among the strongest predictors of all-cause mortality; graded against age/sex norms.'],
    source: 'ACSM / Cooper Institute 常模', url: 'https://www.liebertpub.com/doi/10.1089/dia.2019.0034',
  },
  {
    topic: 'bmi',
    text: ['WHO BMI 分级:<18.5 偏瘦、18.5–24.9 正常、25–29.9 偏重、≥30 肥胖(亚洲人群风险切点可更低)。', 'WHO BMI: <18.5 underweight, 18.5–24.9 normal, 25–29.9 overweight, ≥30 obese (Asian cut-offs may be lower).'],
    source: 'WHO BMI 分级', url: 'https://www.who.int/health-topics/obesity',
  },
];

/** 按确定性判定的 id(finding/score id)取相关指南要点;id 的主题前缀匹配 topic。去重。 */
export function retrieveGuidelines(ids: string[]): GuidelineSnippet[] {
  const seen = new Set<string>();
  const out: GuidelineSnippet[] = [];
  for (const id of ids) {
    const snip = CORPUS.find((c) => c.topic === id);
    if (snip && !seen.has(snip.topic)) { seen.add(snip.topic); out.push(snip); }
  }
  return out;
}
