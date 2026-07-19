import type { RecommendationCard } from '../portal/reasoning-engine';
import { createSignal } from './create-signal';
import type { Signal } from './signal';
import { logDropped } from '../portal/storage-health';

const SIGNAL_FEEDBACK_KEY = 'nesio-signal-feedback-v1';

export interface SignalFeedbackRecord {
  cardId: string;
  feedback: RecommendationCard['feedback'];
  feedbackSignalIds: string[];
  decEngineId: string;
  preferencePatch: Record<string, unknown>;
  createdAt: string;
}

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

function readRecords(): SignalFeedbackRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SIGNAL_FEEDBACK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as SignalFeedbackRecord[] : [];
  } catch {
    return [];
  }
}

function writeRecords(records: SignalFeedbackRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SIGNAL_FEEDBACK_KEY, JSON.stringify(records.slice(-500)));
    window.dispatchEvent(new CustomEvent('nesio-signal-feedback-recorded'));
  } catch (err) {
    // feedback is best-effort;可见动作不该因此失败,但也别全静默 —— 留可 grep 日志。
    logDropped('signal_feedback.write', err);
  }
}

function writeCloudSignalFeedback(record: SignalFeedbackRecord, feedbackSignal?: Signal): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;

  if (feedbackSignal) {
    fetch('/api/cloud/signals', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signal: { ...feedbackSignal, schemaVersion: 'Signal@v1' } }),
    }).catch(() => {
      /* Explicit feedback Signal is best-effort during Signal dual-write. */
    });
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
  }).catch(() => {
    /* Cloud feedback is best-effort during Signal dual-write. */
  });
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
  writeRecords([...readRecords(), record]);
  const feedbackSignal = createSignal({
    source: 'ai_observation',
    type: 'feedback.today_card',
    title: `反馈：${card.title}`,
    payload: {
      cardId: record.cardId,
      feedback: record.feedback,
      feedbackSignalIds: record.feedbackSignalIds,
      decEngineId: record.decEngineId,
      preferencePatch: record.preferencePatch,
    },
    confidence: 1,
    retentionPolicy: 'LongLiving',
    tags: ['feedback', card.domain],
    raw: `${card.title} ${feedback}`,
  });
  writeCloudSignalFeedback(record, feedbackSignal);
  return record;
}

export function readSignalFeedback(): SignalFeedbackRecord[] {
  return readRecords();
}
