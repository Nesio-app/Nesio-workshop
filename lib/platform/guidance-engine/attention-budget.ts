/**
 * Attention Budget — Layer 5
 *
 * How much of today's attention is already committed to high-stakes events?
 * A day with a flight + doctor appointment leaves little room for nudges.
 * A quiet day with only a team standup can absorb more.
 *
 * Budget is computed from AttentionObject scores (from the Attention Engine).
 * Scores run ~25–97 per event. Thresholds are starting points for tuning.
 *
 * Budget gates:
 *   ample      → all severity levels pass
 *   limited    → only severity 2+ (skip low-consequence nudges)
 *   exhausted  → only severity 3 (critical events only — flight, deadline, medical)
 */

import type { AttentionObject } from '@/lib/platform/attention-engine';
import type { AttentionBudget, ConsequenceSeverity } from './types';

// Sum of attention scores for today's events
const THRESHOLD_LIMITED   = 130; // ~2 high-importance events (e.g. flight + meeting)
const THRESHOLD_EXHAUSTED = 230; // ~3 high-importance events (e.g. flight + medical + exam)

export function computeAttentionBudget(todayObjects: AttentionObject[]): AttentionBudget {
  const total = todayObjects
    .filter((o) => o.isToday)
    .reduce((sum, o) => sum + o.score, 0);

  if (total >= THRESHOLD_EXHAUSTED) return 'exhausted';
  if (total >= THRESHOLD_LIMITED)   return 'limited';
  return 'ample';
}

export function passesBudgetGate(budget: AttentionBudget, severity: ConsequenceSeverity): boolean {
  if (budget === 'ample')     return true;
  if (budget === 'limited')   return severity >= 2;
  /* exhausted */             return severity >= 3;
}
