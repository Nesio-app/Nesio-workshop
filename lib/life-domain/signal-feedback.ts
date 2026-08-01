/**
 * Today 卡反馈 → Signal 事实(唯一落点)。
 * 2026-07-27:删平行反馈数组(无读方、与 Signal 完全重复)。
 * 读回看 getSignals(type=feedback.today_card)。
 */
import type { RecommendationCard } from '../portal/reasoning-engine';
import { createSignal } from './create-signal';
import { getSignals, type Signal } from './signal';

export interface SignalFeedbackRecord {
  cardId: string;
  feedback: RecommendationCard['feedback'];
  feedbackSignalIds: string[];
  decEngineId: string;
  preferencePatch: Record<string, unknown>;
  createdAt: string;
}

export const TODAY_CARD_FEEDBACK_TYPE = 'feedback.today_card';

function feedbackSignalIds(card: RecommendationCard): string[] {
  return Array.from(new Set([
    ...(card.evidenceSignalIds || []),
    ...card.evidence.map((entry) => entry.signalId).filter((id): id is string => Boolean(id)),
  ]));
}

function preferencePatch(card: RecommendationCard, feedback: RecommendationCard['feedback']): Record<string, unknown> {
  if (feedback === 'too_much') return { muteDomain: card.domain, reason: 'too_much' };
  if (feedback === 'wrong') return { lowerTrustForDomain: card.domain, reason: 'wrong' };
  if (feedback === 'useful') return { reinforceDomain: card.domain, reason: 'useful' };
  return { deferDomain: card.domain, reason: 'not_now' };
}

function writeCloudSignalFeedback(record: SignalFeedbackRecord, feedbackSignal?: Signal): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;

  if (feedbackSignal) {
    fetch('/api/cloud/signals', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signal: { ...feedbackSignal, schemaVersion: 'Signal@v1' } }),
    }).catch(() => { /* best-effort */ });
  }

  if (!record.feedbackSignalIds.length) return;
  fetch('/api/cloud/signals', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signalIds: record.feedbackSignalIds,
      feedbackValue: record.feedback,
      decEngineId: record.decEngineId,
      preferencePatch: record.preferencePatch,
      feedback: {
        cardId: record.cardId,
        feedback: record.feedback,
        source: 'today_card',
        createdAt: record.createdAt,
      },
    }),
  }).catch(() => { /* best-effort */ });
}

export function recordSignalFeedback(card: RecommendationCard, feedback: RecommendationCard['feedback']): SignalFeedbackRecord {
  const record: SignalFeedbackRecord = {
    cardId: card.id,
    feedback,
    feedbackSignalIds: feedbackSignalIds(card),
    decEngineId: card.domain,
    preferencePatch: preferencePatch(card, feedback),
    createdAt: new Date().toISOString(),
  };
  const feedbackSignal = createSignal({
    source: 'Entry',
    type: TODAY_CARD_FEEDBACK_TYPE,
    title: `反馈：${card.title}`,
    payload: {
      cardId: record.cardId,
      feedback: record.feedback,
      feedbackSignalIds: record.feedbackSignalIds,
      decEngineId: record.decEngineId,
      preferencePatch: record.preferencePatch,
      surface: 'today',
      dimension: 'card',
      key: record.cardId,
      reaction: record.feedback === 'not_now' ? 'snooze' : record.feedback,
      at: record.createdAt,
    },
    confidence: 1,
    retentionPolicy: 'LongLiving',
    tags: ['feedback', card.domain],
    raw: `${card.title} ${feedback}`,
    epistemic: 'feedback',
    generator: 'user',
    derivedFrom: record.feedbackSignalIds,
  });
  writeCloudSignalFeedback(record, feedbackSignal);
  return record;
}

/** 从 Signal 事实表读回(替代已删的平行反馈数组)。 */
export function readSignalFeedback(): SignalFeedbackRecord[] {
  const out: SignalFeedbackRecord[] = [];
  for (const s of getSignals({ types: [TODAY_CARD_FEEDBACK_TYPE] })) {
    const p = (s.payload || {}) as Partial<SignalFeedbackRecord> & { feedback?: RecommendationCard['feedback'] };
    if (!p.cardId || !p.feedback) continue;
    out.push({
      cardId: String(p.cardId),
      feedback: p.feedback,
      feedbackSignalIds: Array.isArray(p.feedbackSignalIds) ? p.feedbackSignalIds.map(String) : [],
      decEngineId: String(p.decEngineId || ''),
      preferencePatch: (p.preferencePatch && typeof p.preferencePatch === 'object')
        ? p.preferencePatch as Record<string, unknown>
        : {},
      createdAt: s.capturedAt,
    });
  }
  return out;
}
