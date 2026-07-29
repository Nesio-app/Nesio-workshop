/**
 * health-narrative — 健康数据的「叙事化」+ 模式检测(批次 40)。
 * 借鉴以前 health 工具的:叙事呈现(不是冷数字)+ 高峰/低谷/anomaly 标注。
 * 纯规则,读 HealthMetric.series(按月),输出可读句子 + 图上要标的点。
 */
import type { HealthMetric } from './apple-health';

export interface SeriesPattern {
  dir: 'up' | 'down' | 'flat';
  peakIdx: number;   // 最高点
  valleyIdx: number; // 最低点
  anomalyIdx: number | null; // 明显偏离趋势的点(| >2σ)
}

export function analyzeSeries(series: Array<{ ym: string; v: number }>): SeriesPattern | null {
  const n = series.length;
  if (n < 3) return null;
  const vals = series.map((s) => s.v);
  const third = Math.max(1, Math.floor(n / 3));
  const head = vals.slice(0, third).reduce((a, b) => a + b, 0) / third;
  const tail = vals.slice(-third).reduce((a, b) => a + b, 0) / third;
  const spread = Math.max(...vals) - Math.min(...vals) || 1;
  const rel = (tail - head) / spread;
  // 双口径判向(QA:静息心率 62→77 却说「平稳」):离群点会把 spread 撑大、把真实趋势
  // 稀释成 flat —— 再叠加「相对水平变化」口径,首末段均值差超过水平的 10% 就不算平稳。
  const relLevel = Math.abs(head) > 1e-9 ? (tail - head) / Math.abs(head) : 0;
  const dir: SeriesPattern['dir'] = (rel > 0.15 || relLevel > 0.1) ? 'up' : (rel < -0.15 || relLevel < -0.1) ? 'down' : 'flat';

  let peakIdx = 0;
  let valleyIdx = 0;
  vals.forEach((v, i) => { if (v > vals[peakIdx]) peakIdx = i; if (v < vals[valleyIdx]) valleyIdx = i; });

  // anomaly:偏离整体均值超过 2σ 的最极端点
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  let anomalyIdx: number | null = null;
  let maxZ = 2;
  vals.forEach((v, i) => { const z = Math.abs(v - mean) / sd; if (z > maxZ) { maxZ = z; anomalyIdx = i; } });

  return { dir, peakIdx, valleyIdx, anomalyIdx };
}

const DIR_WORD: Record<SeriesPattern['dir'], [string, string]> = {
  up: ['上升', 'rising'], down: ['下降', 'falling'], flat: ['平稳', 'steady'],
};
// 对这些指标,「下降」是好事(值越低越好)
const LOWER_BETTER = new Set(['restingHR', 'bpSys', 'bpDia', 'glucose', 'bodyFat', 'weight']);

/** 单条指标的一句叙事;不够数据返回 null。 */
export function narrateMetric(m: HealthMetric, dict: string): string | null {
  const p = analyzeSeries(m.series || []);
  if (!p) return null;
  const label = dict === 'en' ? m.label[1] : m.label[0];
  const first = m.series[0];
  const last = m.series[m.series.length - 1];
  const dirWord = dict === 'en' ? DIR_WORD[p.dir][1] : DIR_WORD[p.dir][0];
  const months = m.series.length;
  const goodBad = p.dir !== 'flat'
    ? (LOWER_BETTER.has(m.key) ? (p.dir === 'down' ? '(好)' : '') : (p.dir === 'up' ? '(好)' : ''))
    : '';
  const goodBadEn = p.dir !== 'flat'
    ? (LOWER_BETTER.has(m.key) ? (p.dir === 'down' ? ' (good)' : '') : (p.dir === 'up' ? ' (good)' : ''))
    : '';
  if (dict === 'en') {
    return `${label}: ${dirWord}${goodBadEn} over ${months} months (${first.v}→${last.v}${m.unit ? ' ' + m.unit : ''}).`;
  }
  return `${label}:近 ${months} 个月${dirWord}${goodBad}(${first.v}→${last.v}${m.unit || ''})。`;
}

/** 挑最值得说的几条指标,生成叙事段落。 */
export function healthNarrative(metrics: HealthMetric[], dict: string): string[] {
  const priority = ['weight', 'restingHR', 'steps', 'hrv', 'vo2max', 'sleep', 'bodyFat', 'glucose', 'bpSys'];
  const out: string[] = [];
  for (const key of priority) {
    const m = metrics.find((x) => x.key === key);
    if (!m) continue;
    const s = narrateMetric(m, dict);
    if (s) out.push(s);
    if (out.length >= 4) break;
  }
  return out;
}
