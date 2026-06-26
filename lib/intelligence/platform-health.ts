/**
 * Platform Self-Awareness (PRD v3.0 §2.2).
 *
 * Before the DEC runs cross-domain reasoning, it must know whether the data is
 * good enough to reason on. When freshness/quality/coverage drop below grade A,
 * the platform self-aware-degrades: it retreats to the single-domain rule engine
 * and skips cross-signal inference, so it never produces confident-sounding
 * garbage from stale or thin data (GIGO defense).
 */

import { getRecentSignals, type Signal } from '../life-domain/signal';

export type HealthGrade = 'A' | 'B' | 'C';

export interface PlatformHealth {
  grade: HealthGrade;
  /** Hours since the most recent signal (Infinity if none). */
  dataFreshnessHours: number;
  signalCount: number;
  avgConfidence: number;
  /** When true, the DEC must retreat to single-domain rules only. */
  degraded: boolean;
  reason?: string;
}

const STALE_HOURS = 72;

export function checkPlatformHealth(): PlatformHealth {
  const signals: Signal[] = getRecentSignals();
  const signalCount = signals.length;

  if (signalCount === 0) {
    return {
      grade: 'C',
      dataFreshnessHours: Infinity,
      signalCount: 0,
      avgConfidence: 0,
      degraded: true,
      reason: 'no_signals',
    };
  }

  const newest = Math.max(...signals.map((s) => new Date(s.capturedAt).getTime()));
  const dataFreshnessHours = (Date.now() - newest) / 3_600_000;
  const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signalCount;

  let grade: HealthGrade = 'A';
  let reason: string | undefined;

  if (dataFreshnessHours > STALE_HOURS) {
    grade = 'C';
    reason = 'data_stale';
  } else if (avgConfidence < 0.5) {
    grade = 'B';
    reason = 'low_confidence';
  } else if (signalCount < 3) {
    grade = 'B';
    reason = 'thin_coverage';
  }

  // Degrade on B (low confidence / thin) or C (stale / empty).
  const degraded = grade !== 'A';

  return { grade, dataFreshnessHours, signalCount, avgConfidence, degraded, reason };
}
