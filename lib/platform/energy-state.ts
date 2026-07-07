/**
 * Energy State — the missing bridge between 此刻 (MoodSheet) records and the
 * guidance engine.
 *
 * moment-analytics.ts implements the EWMA baseline (α=0.15, Kinnunen 2020 /
 * Oura-style personal baseline comparison); this module folds MoodSheet
 * self-reports into it and answers one question for the guidance pipeline:
 * "is the user's energy low right now?"
 *
 * 2a 收编(A 计划):基线的**存储真源移到 Baseline 原语**(personalization/baseline-store,
 * signal='energy',estimator='ewma' —— 折算公式与 moment-analytics.updateEnergyBaseline 同式)。
 * 本文件保留:折样水位(哪些 moment 已折入,业务簿记)+ 域读法(std 下限 / 排除最近样本的均值反解,
 * 在 moment-analytics)。旧 blob 首次访问一次性灌进 Baseline;先验 {mean:50, varq:100} 保证
 * 迁移前后折算轨迹逐字等价。对外 API(refreshEnergyBaseline/getEnergyState)不变。
 */

import { getLifeGraph } from '@/lib/portal/life-graph';
import {
  defaultEnergyBaseline,
  energyStd,
  meanExcludingLatest,
  type EnergyBaseline,
} from '@/lib/portal/moment-analytics';
import { foldSample, ewmaState, seedEwma } from '@/lib/platform/personalization';

const STORE_KEY = 'nesio-energy-baseline-v1';
const ENERGY_SIGNAL = 'energy';

interface EnergyStore {
  baseline: EnergyBaseline;
  /** createdAt ISO of the newest moment folded into the baseline */
  lastFoldedAt: string;
}

/** 旧 blob 形态(baseline 内嵌);迁移后只存水位。 */
interface LegacyEnergyStore {
  baseline?: EnergyBaseline;
  lastFoldedAt?: string;
}

export type EnergyState = 'low' | 'normal' | 'high' | 'unknown';

// 一次性迁移:旧 blob 的 baseline 灌进 Baseline 原语;无论有无旧数据都确保 energy 的
// EWMA 先验(mean 50 / varq 100)在位 —— 折算从先验起步,与原 updateEnergyBaseline 轨迹逐字一致。
let migrated = false;
function ensureMigrated(): void {
  if (migrated || typeof window === 'undefined') return;
  migrated = true;
  let legacy: LegacyEnergyStore | null = null;
  try { legacy = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as LegacyEnergyStore | null; } catch { /* ignore */ }
  if (legacy?.baseline && typeof legacy.baseline.mean === 'number') {
    seedEwma(ENERGY_SIGNAL, { mean: legacy.baseline.mean, varq: legacy.baseline.variance, n: legacy.baseline.sampleCount });
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ lastFoldedAt: legacy.lastFoldedAt ?? '' })); } catch { /* ignore */ }
  }
  const prior = defaultEnergyBaseline();
  seedEwma(ENERGY_SIGNAL, { mean: prior.mean, varq: prior.variance, n: prior.sampleCount }); // 只补缺
}

function readWatermark(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as LegacyEnergyStore | null;
    return raw?.lastFoldedAt ?? '';
  } catch {
    return '';
  }
}

function saveWatermark(lastFoldedAt: string): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ lastFoldedAt })); } catch { /* ignore */ }
}

/** Baseline 原语里的 energy 态,装配成域形态(EnergyBaseline)。 */
function currentBaseline(): EnergyBaseline {
  const s = ewmaState(ENERGY_SIGNAL);
  return s ? { mean: s.mean, variance: s.varq, sampleCount: s.n } : defaultEnergyBaseline();
}

/** Moment nodes carrying an energy self-report, oldest first. */
function momentEnergyReadings(): Array<{ value: number; at: string }> {
  return getLifeGraph()
    .filter((n) => typeof n.attributes.energyValue === 'number' && (n.tags || []).includes('moment'))
    .map((n) => ({ value: n.attributes.energyValue as number, at: n.createdAt }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Fold any new moment readings into the persisted EWMA baseline. */
export function refreshEnergyBaseline(): EnergyStore {
  ensureMigrated();
  const watermark = readWatermark();
  const fresh = momentEnergyReadings().filter((r) => r.at > watermark);
  if (fresh.length > 0) {
    for (const r of fresh) foldSample(ENERGY_SIGNAL, r.value, 'ewma');
    saveWatermark(fresh[fresh.length - 1].at);
  }
  return { baseline: currentBaseline(), lastFoldedAt: fresh.length ? fresh[fresh.length - 1].at : watermark };
}

/**
 * Current energy vs personal baseline. 'unknown' until ~3 self-reports exist.
 * "Low" = today's latest reading sits more than one standard deviation below
 * the EWMA mean (personal baseline, not a population norm).
 */
export function getEnergyState(now: Date = new Date()): EnergyState {
  const store = refreshEnergyBaseline();
  if (store.baseline.sampleCount < 3) return 'unknown';

  const readings = momentEnergyReadings();
  const latest = readings[readings.length - 1];
  if (!latest) return 'unknown';
  // Only readings from today describe "right now"
  const latestDate = new Date(latest.at);
  if (latestDate.toDateString() !== now.toDateString()) return 'unknown';

  // 🟠#6 SD 下限统一走 energyStd(floor 4/std≥2),不再用本地 max(var,1);
  // delta 拿「排除当前读数」的基线比,避免均值已折进 latest 而系统性偏向 'normal'。
  const sd = energyStd(store.baseline);
  const delta = latest.value - meanExcludingLatest(store.baseline, latest.value);
  if (delta < -sd) return 'low';
  if (delta > sd) return 'high';
  return 'normal';
}
