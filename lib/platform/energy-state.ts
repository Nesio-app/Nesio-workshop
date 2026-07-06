/**
 * Energy State — the missing bridge between 此刻 (MoodSheet) records and the
 * guidance engine.
 *
 * moment-analytics.ts implements the EWMA baseline (α=0.15, Kinnunen 2020 /
 * Oura-style personal baseline comparison) but previously had no consumer:
 * MoodSheet saved attributes.energyValue onto LifeGraph nodes and nobody
 * ever computed the baseline. This module maintains the persisted baseline
 * from those records and answers one question for the guidance pipeline:
 * "is the user's energy low right now?"
 *
 * Client-side only (localStorage).
 */

import { getLifeGraph } from '@/lib/portal/life-graph';
import {
  defaultEnergyBaseline,
  updateEnergyBaseline,
  energyStd,
  meanExcludingLatest,
  type EnergyBaseline,
} from '@/lib/portal/moment-analytics';

const STORE_KEY = 'nesio-energy-baseline-v1';

interface EnergyStore {
  baseline: EnergyBaseline;
  /** createdAt ISO of the newest moment folded into the baseline */
  lastFoldedAt: string;
}

export type EnergyState = 'low' | 'normal' | 'high' | 'unknown';

function loadStore(): EnergyStore {
  if (typeof window === 'undefined') return { baseline: defaultEnergyBaseline(), lastFoldedAt: '' };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as EnergyStore | null;
    if (raw?.baseline) return raw;
  } catch { /* ignore */ }
  return { baseline: defaultEnergyBaseline(), lastFoldedAt: '' };
}

function saveStore(store: EnergyStore): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* ignore */ }
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
  const store = loadStore();
  const fresh = momentEnergyReadings().filter((r) => r.at > store.lastFoldedAt);
  if (fresh.length === 0) return store;
  let baseline = store.baseline;
  for (const r of fresh) baseline = updateEnergyBaseline(baseline, r.value);
  const next: EnergyStore = { baseline, lastFoldedAt: fresh[fresh.length - 1].at };
  saveStore(next);
  return next;
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
