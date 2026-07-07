/**
 * 原语②·Baseline —— 学个人常态,今天算偏离(proposal §2)。收敛 energy(EWMA)/ analyst(robust MAD)/
 * fitness(HRV)三处基线数学。估计器可插:'ewma' | 'robust'(默认 robust)。
 *
 * 不订阅反馈总线(基线吃的是**数值样本**不是反馈动词);由各域调 foldSample 折样。
 */

import { loadJson, saveJson } from './persist';

const KEY = 'nesio-baseline-v1';
const EWMA_ALPHA = 0.15;
const ROBUST_CAP = 60;   // 保留最近 N 个样本算 median+MAD
const COLD_MIN = 3;      // 少于这么多样本 = 冷启动,不敢报偏离

export type Estimator = 'ewma' | 'robust';

interface EwmaState { kind: 'ewma'; mean: number; varq: number; n: number }
interface RobustState { kind: 'robust'; samples: number[] }
type BaselineState = Record<string, EwmaState | RobustState>;

export function foldSample(signal: string, value: number, estimator: Estimator = 'robust'): void {
  if (!Number.isFinite(value)) return;
  const st = loadJson<BaselineState>(KEY, {});
  const prev = st[signal];
  if (estimator === 'ewma') {
    const e = prev && prev.kind === 'ewma' ? prev : { kind: 'ewma' as const, mean: value, varq: 0, n: 0 };
    const d = value - e.mean;
    e.mean += EWMA_ALPHA * d;
    e.varq = (1 - EWMA_ALPHA) * (e.varq + EWMA_ALPHA * d * d); // EWMA 方差
    e.n += 1;
    st[signal] = e;
  } else {
    const r = prev && prev.kind === 'robust' ? prev : { kind: 'robust' as const, samples: [] };
    r.samples.push(value);
    if (r.samples.length > ROBUST_CAP) r.samples.splice(0, r.samples.length - ROBUST_CAP);
    st[signal] = r;
  }
  saveJson(KEY, st);
}

/** ewma 内部态读取(域层特殊读法用,如 energy 的"排除最近样本的均值"反解)。无/非 ewma → null。 */
export function ewmaState(signal: string): { mean: number; varq: number; n: number } | null {
  const s = loadJson<BaselineState>(KEY, {})[signal];
  return s && s.kind === 'ewma' ? { mean: s.mean, varq: s.varq, n: s.n } : null;
}

/**
 * 迁移/先验种子入口:装一个 ewma 初始态(旧 store 收编,或域先验如 energy 的 {mean:50,varq:100})。
 * 默认只在该 signal 尚无状态时生效(不盖已学的)。
 */
export function seedEwma(
  signal: string,
  state: { mean: number; varq: number; n: number },
  { overwrite = false }: { overwrite?: boolean } = {},
): void {
  if (!Number.isFinite(state.mean) || !Number.isFinite(state.varq)) return;
  const st = loadJson<BaselineState>(KEY, {});
  if (!overwrite && st[signal]) return;
  st[signal] = { kind: 'ewma', mean: state.mean, varq: state.varq, n: state.n };
  saveJson(KEY, st);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 个人常态:center(中心)/ spread(离散)/ cold(样本不足)。 */
export function baseline(signal: string): { center: number | null; spread: number | null; cold: boolean } {
  const s = loadJson<BaselineState>(KEY, {})[signal];
  if (!s) return { center: null, spread: null, cold: true };
  if (s.kind === 'ewma') {
    return { center: s.mean, spread: Math.sqrt(Math.max(0, s.varq)), cold: s.n < COLD_MIN };
  }
  if (s.samples.length < COLD_MIN) return { center: s.samples.length ? median(s.samples) : null, spread: null, cold: true };
  const med = median(s.samples);
  const mad = median(s.samples.map((x) => Math.abs(x - med))) * 1.4826; // MAD→σ 换算
  return { center: med, spread: mad, cold: false };
}

/** 今天相对个人常态偏几个"标准差"。冷启动或无离散 → null(不敢报)。 */
export function zScore(signal: string, today: number): number | null {
  const b = baseline(signal);
  if (b.cold || b.center == null || !b.spread) return null;
  return (today - b.center) / b.spread;
}
