/**
 * 可打断性 · Naïve Bayes(cross-region-reasoning.md §2.4)——纯函数,可单测。
 *
 * 学「什么情境下用户愿意被打断」:P(受纳 | 时段, 星期类型, 活动态)。极轻、每用户可训、
 * 可解释。非 critical 洞察须 P(受纳) ≥ 阈(默认 0.5)才投递。
 *
 * 特征都是类目型(Laplace 平滑的多项 NB)。冷启动(样本 < minSamples)返回温和先验
 * (默认 0.6 ≥ 0.5 → 默认可投),复刻「冷启动不更差:先按默认放行,攒够反馈再收紧」。
 */

/** @typedef {{ tod: string; day: string; activity: string }} InterruptContext */
/** @typedef {{ ctx: InterruptContext; accepted: boolean }} InterruptSample */

const FEATURES = ['tod', 'day', 'activity'];

/** 时间戳 → 情境特征(时段 4 档 + 工作日/周末;活动态由调用方补,默认 unknown)。 */
export function contextFromTime(date, activity = 'unknown') {
  const h = date.getHours();
  const tod = h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const dow = date.getDay();
  const day = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
  return { tod, day, activity };
}

/**
 * 训练:计数每个 (feature=value | class) 与 class 先验。
 * @param {InterruptSample[]} samples
 */
export function trainInterruptibility(samples) {
  const cls = { true: 0, false: 0 };
  const counts = {}; // feature -> value -> {true, false}
  const values = {}; // feature -> Set of seen values (for Laplace denominator)
  for (const f of FEATURES) { counts[f] = {}; values[f] = new Set(); }

  for (const s of samples || []) {
    if (!s || !s.ctx) continue;
    const k = s.accepted ? 'true' : 'false';
    cls[k] += 1;
    for (const f of FEATURES) {
      const v = String(s.ctx[f] ?? 'unknown');
      values[f].add(v);
      const bucket = counts[f][v] || { true: 0, false: 0 };
      bucket[k] += 1;
      counts[f][v] = bucket;
    }
  }
  return { cls, counts, values: Object.fromEntries(FEATURES.map((f) => [f, [...values[f]]])), n: cls.true + cls.false };
}

/**
 * 预测 P(受纳 | ctx)。样本不足(< minSamples)→ 先验 prior。
 * @param {InterruptContext} ctx
 * @param {ReturnType<typeof trainInterruptibility>} model
 */
export function predictAccept(ctx, model, { minSamples = 8, prior = 0.6 } = {}) {
  if (!model || model.n < minSamples) return prior;
  const { cls, counts, values } = model;
  // 对数概率避免下溢;Laplace α=1
  let logT = Math.log((cls.true + 1) / (model.n + 2));
  let logF = Math.log((cls.false + 1) / (model.n + 2));
  for (const f of FEATURES) {
    const v = String(ctx?.[f] ?? 'unknown');
    const card = (values[f] || []).length || 1; // 该特征取值基数
    const b = counts[f]?.[v] || { true: 0, false: 0 };
    logT += Math.log((b.true + 1) / (cls.true + card));
    logF += Math.log((b.false + 1) / (cls.false + card));
  }
  const mT = Math.max(logT, logF);
  const pT = Math.exp(logT - mT);
  const pF = Math.exp(logF - mT);
  return pT / (pT + pF);
}

export const INTERRUPTIBILITY_DEFAULTS = Object.freeze({ minSamples: 8, prior: 0.6, threshold: 0.5 });
