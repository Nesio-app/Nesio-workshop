/**
 * 基线学习 —— 让分析师学「这个 app 自己的正常水位」,而不是拍脑袋的固定阈值。
 *
 * 用鲁棒统计(中位数 + MAD)估计中心与散度:MAD(绝对中位差)对离群点不敏感,
 * 比均值±标准差稳得多(一次异常尖峰不会把阈值带偏)。σ ≈ 1.4826·MAD 是正态下的一致估计。
 * 今日值偏离历史中心 ≥ k·σ 即判为异常。纯函数、可测、可解释。
 */

function q50(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const m = Math.floor(n / 2);
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/** 鲁棒统计:{ n, median, mad, sigma }。sigma 由 MAD 换算(1.4826·MAD)。 */
export function robustStats(values) {
  const xs = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v)).slice().sort((a, b) => a - b);
  const n = xs.length;
  if (!n) return { n: 0, median: null, mad: null, sigma: null };
  const median = q50(xs);
  const absdev = xs.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = q50(absdev);
  return { n, median, mad, sigma: mad * 1.4826 };
}

/**
 * 今日值相对历史序列是否异常。
 * @returns {{ok:boolean, cold:boolean, isAnomaly:boolean, z:number|null, center:number|null,
 *            sigma:number|null, direction:'up'|'down'|'flat'}}
 *   cold=true 表示历史样本不足,调用方应退回固定阈值。
 */
export function anomaly(today, series, opts = {}) {
  const minSamples = opts.minSamples ?? 7;
  const k = opts.k ?? 3;
  const { n, median, sigma } = robustStats(series);

  if (typeof today !== 'number' || !Number.isFinite(today) || n < minSamples || median == null) {
    return { ok: false, cold: true, isAnomaly: false, z: null, center: median, sigma, direction: 'flat' };
  }
  const direction = today > median ? 'up' : today < median ? 'down' : 'flat';

  // 历史完全无波动(sigma=0):只有当今日明显偏离中心(>50%)才算异常,避免被 0 除。
  if (!sigma || sigma === 0) {
    const rel = median === 0 ? (today === 0 ? 0 : 1) : Math.abs(today - median) / Math.abs(median);
    const isAnomaly = rel > 0.5;
    return { ok: true, cold: false, isAnomaly, z: isAnomaly ? (direction === 'up' ? Infinity : -Infinity) : 0, center: median, sigma: 0, direction };
  }

  const z = (today - median) / sigma;
  return { ok: true, cold: false, isAnomaly: Math.abs(z) >= k, z, center: median, sigma, direction };
}

/** 人话解释一条基线判断(给预警的 explain 用)。 */
export function explainBaseline(today, a, unit = '') {
  if (a.cold) return '冷启动:历史不足,暂用固定阈值,攒够天数后自动改用你自己的水位';
  const c = a.center == null ? '—' : Math.round(a.center * 100) / 100;
  if (!Number.isFinite(a.z)) return `今日 ${today}${unit},历史几乎无波动而今日明显偏离(常态约 ${c}${unit})`;
  return `今日 ${today}${unit},偏离 30 天常态 ${c}${unit} 约 ${Math.abs(Math.round(a.z * 10) / 10)}σ`;
}
