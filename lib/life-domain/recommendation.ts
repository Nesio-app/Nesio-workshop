/**
 * Recommendation — the canonical guidance object (PRD Ch.5.2).
 *
 * Today's core output. Not a notification. Every Recommendation must carry
 * recommendation + reasoning + evidence + confidence + action + feedback so
 * AI output stays explainable (PRD: "any proactive suggestion must include
 * evidenceIds, otherwise it must not enter Today").
 *
 * This aligns with the existing reasoning-engine RecommendationCard. The
 * adapter below converts between the two so the running UI keeps working while
 * the platform standardizes on this schema.
 */

import type { RecommendationCard, CardDomain } from '../portal/reasoning-engine';

export type RecommendationCategory =
  | 'health' | 'work' | 'family' | 'travel' | 'finance' | 'learning' | 'home' | 'general';

export type RecommendationFeedback = 'helpful' | 'not_helpful' | 'wrong_reason';

export interface ActionOption {
  id: string;
  label: string;
  kind: 'accept' | 'snooze' | 'dismiss' | 'mute' | 'open';
}

export interface Recommendation {
  id: string;
  category: RecommendationCategory;
  recommendation: string;       // user-readable suggestion
  reasoningSummary: string;     // short why
  evidenceIds: string[];        // Signal / Relationship ids — required
  confidence: number;           // 0-1
  impact: string;               // estimated value
  actionOptions: ActionOption[];
  expiresAt: string;
  feedback?: RecommendationFeedback;
}

const DOMAIN_TO_CATEGORY: Record<CardDomain, RecommendationCategory> = {
  weather: 'travel',
  work: 'work',
  family: 'family',
  home: 'home',
  health: 'health',
  vehicle: 'travel',
  learning: 'learning',
  finance: 'finance',
};

const DEFAULT_ACTIONS: ActionOption[] = [
  { id: 'accept', label: '好的', kind: 'accept' },
  { id: 'snooze', label: '稍后', kind: 'snooze' },
  { id: 'dismiss', label: '忽略', kind: 'dismiss' },
  { id: 'mute', label: '不再提示', kind: 'mute' },
];

/** Convert a reasoning-engine card into the canonical Recommendation schema. */
export function cardToRecommendation(card: RecommendationCard): Recommendation {
  return {
    id: card.id,
    category: DOMAIN_TO_CATEGORY[card.domain] ?? 'general',
    recommendation: card.title,
    reasoningSummary: card.body,
    // Prefer traceable Signal ids; fall back to a source:value ref.
    evidenceIds: card.evidence.map((e) => e.signalId ?? `${e.source}:${e.value}`),
    confidence: card.confidence,
    impact: card.evidence.find((e) => e.label.includes('影响'))?.value ?? '',
    actionOptions: [
      { id: 'accept', label: card.primaryAction, kind: 'accept' },
      ...(card.secondaryAction ? [{ id: 'secondary', label: card.secondaryAction, kind: 'snooze' as const }] : []),
      { id: 'mute', label: '不再提示', kind: 'mute' },
    ],
    expiresAt: card.expiresAt,
    feedback: card.feedback === 'useful' ? 'helpful' : card.feedback === 'wrong' ? 'wrong_reason' : undefined,
  };
}

/** Validate that a recommendation carries evidence (PRD gate for entering Today). */
export function hasEvidence(rec: Recommendation): boolean {
  return rec.evidenceIds.length > 0;
}

export { DEFAULT_ACTIONS };
