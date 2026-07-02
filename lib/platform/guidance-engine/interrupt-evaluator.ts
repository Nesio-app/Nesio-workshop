/**
 * Interrupt Evaluator — Layer 4
 *
 * Combines consequence severity (how bad if ignored) with window urgency
 * (is now the right time?) into a single priority score.
 *
 * A high-severity event outside its action window scores 0.
 * A low-severity event in a critical window also scores low.
 * Both dimensions must be meaningful.
 */

import type { ConsequenceSeverity, WindowUrgency } from './types';

//                     closed  low   medium  high  critical
const PRIORITY_MATRIX: Record<ConsequenceSeverity, Record<WindowUrgency, number>> = {
  3: { closed: 0, low: 4, medium: 6, high: 8,  critical: 10 }, // flight / deadline / medical
  2: { closed: 0, low: 2, medium: 4, high: 6,  critical: 8  }, // meeting / birthday / travel
  1: { closed: 0, low: 1, medium: 2, high: 4,  critical: 6  }, // weather / habit
  0: { closed: 0, low: 0, medium: 0, high: 0,  critical: 0  },
};

// Minimum priority to generate a card. Raises the bar against noise.
const SHOW_THRESHOLD = 3;

export function interruptPriority(severity: ConsequenceSeverity, urgency: WindowUrgency): number {
  return PRIORITY_MATRIX[severity]?.[urgency] ?? 0;
}

export function worthInterrupting(severity: ConsequenceSeverity, urgency: WindowUrgency): boolean {
  return interruptPriority(severity, urgency) >= SHOW_THRESHOLD;
}
