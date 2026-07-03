/**
 * Interrupt Evaluator — Layer 4
 *
 * 5-dimension priority scoring (based on Future Guidance Engine spec, 2026-07):
 *
 *   Risk Severity    30% — how bad is it if the user does nothing?
 *   Time Sensitivity 25% — how urgent is the action window right now?
 *   Preparation Value 20% — how much better is acting now vs later?
 *   Confidence       15% — how reliable is the underlying data source?
 *   Personal Relevance 10% — how relevant to this specific user?
 *
 * Final score = weighted sum (0-100) / 10 → 0-10.
 * SHOW_THRESHOLD = 4. Cards below this threshold are suppressed.
 *
 * Research basis: design spec docs/design/future-guidance-engine.md §12
 */

import type { ConsequenceSeverity, WindowUrgency, GuidanceEventType, GuidanceSource } from './types';

// ── Dimension: Risk Severity (30%) ────────────────────────────────────────────

function riskSeverityScore(severity: ConsequenceSeverity): number {
  // 0→0, 1→33, 2→66, 3→100
  return severity * 33.3;
}

// ── Dimension: Time Sensitivity (25%) ────────────────────────────────────────

const URGENCY_SCORE: Record<WindowUrgency, number> = {
  closed: 0, low: 25, medium: 50, high: 75, critical: 100,
};

function timeSensitivityScore(urgency: WindowUrgency): number {
  return URGENCY_SCORE[urgency];
}

// ── Dimension: Preparation Value (20%) ───────────────────────────────────────
// How much better is acting NOW vs acting later?
// High = time-gated opportunity (missing check-in window costs real money)
// Low = can do anytime today without significant quality difference

const PREPARATION_VALUE: Record<GuidanceEventType, number> = {
  flight:       90,  // check-in window is time-gated; missing it costs real money
  deadline:     85,  // starting earlier always improves outcome (non-linear returns)
  weather_cold: 80,  // can't add a layer after you've left home
  weather_rain: 80,
  travel:       75,  // earlier prep = less last-minute stress
  birthday:     65,  // ordering gift earlier is meaningfully better
  anniversary:  65,
  medical:      60,  // appointment is fixed; prep is helpful but not critical
  meeting:      55,  // 1h prep vs 30min prep is marginally better
  email_signal: 40,  // email can be handled anytime
  health_habit:   35,  // can do anytime today
  object_context: 30,  // context-triggered — nice to know but not urgent
};

function preparationValueScore(type: GuidanceEventType): number {
  return PREPARATION_VALUE[type] ?? 50;
}

// ── Dimension: Personal Relevance (10%) ──────────────────────────────────────
// Proxy: source type reliability as a signal of personal relevance.
// User-created (memory) or calendar = high; weather/habit = lower.
// Will be replaced by learned user-specific signals in Layer 7.

const SOURCE_RELEVANCE: Record<GuidanceSource, number> = {
  memory:  85,
  calendar: 80,
  email:   70,
  habit:   60,
  weather: 50,
};

function personalRelevanceScore(source: GuidanceSource): number {
  return SOURCE_RELEVANCE[source] ?? 60;
}

// ── Final score ───────────────────────────────────────────────────────────────

const SHOW_THRESHOLD = 4; // 0-10 scale

export function interruptPriority(
  severity: ConsequenceSeverity,
  urgency: WindowUrgency,
  type: GuidanceEventType,
  source: GuidanceSource,
  confidence: number = 75, // 0-100, from GuidanceEvent.confidence
): number {
  if (urgency === 'closed') return 0;

  const raw =
    riskSeverityScore(severity)      * 0.30 +
    timeSensitivityScore(urgency)    * 0.25 +
    preparationValueScore(type)      * 0.20 +
    confidence                       * 0.15 +
    personalRelevanceScore(source)   * 0.10;

  return Math.round(raw / 10); // normalize to 0-10
}

export function worthInterrupting(
  severity: ConsequenceSeverity,
  urgency: WindowUrgency,
  type: GuidanceEventType,
  source: GuidanceSource,
  confidence?: number,
): boolean {
  return interruptPriority(severity, urgency, type, source, confidence) >= SHOW_THRESHOLD;
}
