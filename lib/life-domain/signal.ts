/**
 * Signal — the platform's unified data atom (PRD Ch.4.1).
 *
 * A Signal is one interpretable, traceable, normalized piece of information
 * the system received from the real world. Every source (voice, photo,
 * calendar, gmail, health, weather, connectors) must normalize into a Signal.
 * A Signal states a fact/observation — it never directly states a recommendation.
 *
 * Migration strategy (PRD 3.3): additive. Signals are projected from the
 * existing Life Graph (LifeNode) via an adapter, so no data migration is
 * needed. New capture paths can write Signals directly; legacy nodes are
 * adapted on read. This keeps the running app intact.
 */

import { getLifeGraph, type LifeNode, type LifeNodeType, type LifeNodeSource } from '../portal/life-graph';

export type SignalSource =
  | 'voice'
  | 'photo'
  | 'calendar'
  | 'gmail'
  | 'health'
  | 'weather'
  | 'manual'
  | 'ai_observation'
  | 'flomo'
  | 'notion'
  | 'toggl'
  | 'reminder'
  | 'keep'
  | 'wechat_reading'
  | 'device';

export type SignalType =
  | 'event'
  | 'symptom'
  | 'commitment'
  | 'reminder'
  | 'document'
  | 'message'
  | 'location'
  | 'metric'
  | 'observation';

export type SignalSensitivity = 'normal' | 'private' | 'health' | 'financial' | 'family' | 'work';

export interface EntityRef {
  id: string;
  type: string;
  name: string;
}

export interface SignalSourceRef {
  source: SignalSource;
  externalId?: string;
  raw?: string;
}

export interface Signal {
  id: string;
  source: SignalSource;
  type: SignalType;
  occurredAt: string; // when the fact happened
  capturedAt: string; // when the system recorded it
  title: string;
  content: string | Record<string, unknown>;
  entities: EntityRef[];
  confidence: number; // 0-1
  sensitivity: SignalSensitivity;
  evidence: SignalSourceRef;
  tags?: string[];
}

// ── LifeNode → Signal adapter ────────────────────────────────────────────────

const NODE_TYPE_TO_SIGNAL: Record<LifeNodeType, SignalType> = {
  event: 'event',
  commitment: 'commitment',
  health_state: 'symptom',
  object: 'observation',
  person: 'observation',
  place: 'location',
  preference: 'observation',
};

const NODE_SOURCE_TO_SIGNAL: Record<LifeNodeSource, SignalSource> = {
  manual: 'manual',
  photo: 'photo',
  calendar: 'calendar',
  email: 'gmail',
  system: 'device',
  voice: 'voice',
};

function inferSensitivity(node: LifeNode): SignalSensitivity {
  const tags = (node.tags || []).join(' ').toLowerCase();
  if (node.type === 'health_state' || tags.includes('健康') || tags.includes('health')) return 'health';
  if (tags.includes('finance') || tags.includes('财务') || tags.includes('账单')) return 'financial';
  if (tags.includes('family') || tags.includes('家庭')) return 'family';
  if (tags.includes('work') || tags.includes('工作') || tags.includes('会议') || node.source === 'calendar') return 'work';
  return 'normal';
}

/** Convert a legacy Life Graph node into a normalized Signal */
export function lifeNodeToSignal(node: LifeNode): Signal {
  const occurredAt =
    (typeof node.attributes['start'] === 'string' && node.attributes['start']) ||
    (typeof node.attributes['date'] === 'string' && node.attributes['date']) ||
    node.createdAt;

  return {
    id: `sig_${node.id}`,
    source: NODE_SOURCE_TO_SIGNAL[node.source] ?? 'manual',
    type: NODE_TYPE_TO_SIGNAL[node.type] ?? 'observation',
    occurredAt: String(occurredAt),
    capturedAt: node.createdAt,
    title: node.name,
    content: node.rawInput || node.attributes,
    entities: node.relations.map((r) => ({ id: r.targetId, type: r.relation, name: r.targetId })),
    confidence: node.confidence,
    sensitivity: inferSensitivity(node),
    evidence: { source: NODE_SOURCE_TO_SIGNAL[node.source] ?? 'manual', externalId: node.id, raw: node.rawInput },
    tags: node.tags,
  };
}

// ── Signal queries ───────────────────────────────────────────────────────────

/** Get all signals, projected from the Life Graph (newest first). */
export function getSignals(opts?: { since?: number; sources?: SignalSource[]; types?: SignalType[] }): Signal[] {
  let signals = getLifeGraph().map(lifeNodeToSignal);
  if (opts?.since) {
    signals = signals.filter((s) => new Date(s.capturedAt).getTime() >= opts.since!);
  }
  if (opts?.sources?.length) {
    signals = signals.filter((s) => opts.sources!.includes(s.source));
  }
  if (opts?.types?.length) {
    signals = signals.filter((s) => opts.types!.includes(s.type));
  }
  return signals.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
}

/** Signals captured within the last N hours. */
export function getRecentSignals(hours = 168): Signal[] {
  return getSignals({ since: Date.now() - hours * 3_600_000 });
}
