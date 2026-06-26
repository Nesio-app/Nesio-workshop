/**
 * Reasoning view-model types + feedback store (leaf module).
 *
 * The reasoning LOGIC now lives in lib/intelligence/dec.ts (the Decision Engine).
 * This file keeps only the UI view-model type (RecommendationCard), the feedback
 * store, and scoring — things both the DEC and the Experience layer depend on,
 * so they live in a dependency-free leaf to avoid cycles.
 */

export type CardDomain = 'weather' | 'work' | 'family' | 'home' | 'health' | 'vehicle' | 'learning' | 'finance';

export interface EvidenceRef {
  source: string;
  label: string;
  value: string;
  /** Traceable pointer to a Signal id when the evidence came from the Life Graph. */
  signalId?: string;
}

export interface RecommendationCard {
  id: string;
  domain: CardDomain;
  domainLabel: string;
  confidence: number;
  urgency: 1 | 2 | 3 | 4 | 5;
  icon: string;
  iconBg: string;
  title: string;
  body: string;
  tags?: string[];
  evidence: EvidenceRef[];
  primaryAction: string;
  secondaryAction?: string;
  type: 'standard' | 'audio' | 'compact';
  expiresAt: string;
  feedback?: 'useful' | 'wrong' | 'not_now' | 'too_much';
}

/** score = urgency * confidence * 0.5 + timing bonus */
export function scoreCard(card: RecommendationCard): number {
  const timingBonus = new Date(card.expiresAt).getTime() - Date.now() < 3_600_000 ? 0.2 : 0;
  return card.urgency * card.confidence * 0.5 + timingBonus;
}

// ── Feedback store ──────────────────────────────────────

const FEEDBACK_KEY = 'nesio-card-feedback-v1';

export type FeedbackRecord = { feedback: RecommendationCard['feedback']; at: string };

export function readCardFeedbackAll(): Record<string, FeedbackRecord> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}') as Record<string, FeedbackRecord>;
  } catch {
    return {};
  }
}

export function recordCardFeedback(cardId: string, feedback: RecommendationCard['feedback']): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readCardFeedbackAll();
    existing[cardId] = { feedback, at: new Date().toISOString() };
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(existing));
    window.dispatchEvent(new CustomEvent('nesio-feedback-recorded', { detail: { cardId, feedback } }));
  } catch {
    /* ignore */
  }
}

