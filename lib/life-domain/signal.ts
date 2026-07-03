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

import { getLifeGraph, deleteLifeNode, type LifeNode, type LifeNodeType, type LifeNodeSource } from '../portal/life-graph';
import type { SignalContext } from './context';

export type SignalSource =
  | 'voice'
  | 'photo'
  | 'calendar'
  | 'gmail'
  | 'health'
  | 'task'
  | 'weather'
  | 'hardware_pulse'
  | 'manual'
  | 'ai_observation'
  | 'flomo'
  | 'notion'
  | 'toggl'
  | 'reminder'
  | 'keep'
  | 'wechat_reading'
  | 'device';

export type SignalType = string;

export type SignalSensitivity = 'normal' | 'private' | 'health' | 'financial' | 'family' | 'work';

/**
 * Retention policy (PRD v3.0 §2.3) — drives the Pruning Engine.
 * AlwaysAlive: core family/assets/major health → never pruned, always hot.
 * LongLiving:  long-term knowledge/finance → no physical delete, warm-compress.
 * Normal:      meetings/todos → 30-90d inactivity → cold/dormant.
 * Disposable:  weather/transient notices/voice scraps → consumed within 24h,
 *              must not pollute the long-term Life Graph.
 */
export type RetentionPolicy = 'AlwaysAlive' | 'LongLiving' | 'Normal' | 'Disposable';

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
  /** Canonical lightweight fact payload. Prefer this for new code. */
  payload?: Record<string, unknown>;
  /** Backward-compatible view over payload/raw attributes for existing UI. */
  content: string | Record<string, unknown>;
  entities: EntityRef[];
  confidence: number; // 0-1
  sensitivity: SignalSensitivity;
  retentionPolicy: RetentionPolicy;
  evidence: SignalSourceRef;
  tags?: string[];
  /** Structured semantics on the signal (domain / people / places / objects /
   *  intent). Suggestion until the user confirms (Domain-Capability PRD §7). */
  context?: SignalContext;
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

function inferRetention(node: LifeNode): RetentionPolicy {
  const tags = (node.tags || []).join(' ').toLowerCase();
  // Core family / major assets / major health → never prune
  if (tags.includes('家庭') || tags.includes('family') || tags.includes('tesla') || node.type === 'person') {
    return 'AlwaysAlive';
  }
  // Long-term knowledge / finance
  if (tags.includes('finance') || tags.includes('财务') || tags.includes('读书') ||
      tags.includes('learning') || tags.includes('notion') || node.type === 'preference') {
    return 'LongLiving';
  }
  // Transient: weather / one-off notices / quick voice scraps with no entities
  const transient = tags.includes('天气') || tags.includes('weather') ||
    (node.source === 'voice' && node.relations.length === 0 && !node.rawInput);
  if (transient) return 'Disposable';
  return 'Normal';
}

/** Convert a legacy Life Graph node into a normalized Signal */
export function lifeNodeToSignal(node: LifeNode): Signal {
  const signalId = typeof node.attributes['signalId'] === 'string'
    ? node.attributes['signalId']
    : `sig_${node.id}`;
  const signalType = typeof node.attributes['signalType'] === 'string'
    ? node.attributes['signalType']
    : NODE_TYPE_TO_SIGNAL[node.type] ?? 'observation';
  const payload = Object.fromEntries(
    Object.entries(node.attributes).filter(([key]) => !key.startsWith('signal') && key !== 'context'),
  );
  let context: SignalContext | undefined;
  const ctxRaw = node.attributes['context'];
  if (typeof ctxRaw === 'string' && ctxRaw) {
    try { context = JSON.parse(ctxRaw) as SignalContext; } catch { /* ignore malformed */ }
  }
  const source = typeof node.attributes['signalSource'] === 'string'
    ? node.attributes['signalSource'] as SignalSource
    : NODE_SOURCE_TO_SIGNAL[node.source] ?? 'manual';
  const occurredAt =
    (typeof node.attributes['start'] === 'string' && node.attributes['start']) ||
    (typeof node.attributes['date'] === 'string' && node.attributes['date']) ||
    (typeof node.attributes['occurredAt'] === 'string' && node.attributes['occurredAt']) ||
    node.createdAt;

  return {
    id: signalId,
    source,
    type: signalType,
    occurredAt: String(occurredAt),
    capturedAt: node.createdAt,
    title: node.name,
    payload,
    content: node.rawInput || payload,
    entities: (node.relations ?? []).map((r) => ({ id: r.targetId, type: r.relation, name: r.targetId })),
    confidence: node.confidence,
    sensitivity: inferSensitivity(node),
    retentionPolicy: inferRetention(node),
    evidence: { source, externalId: node.id, raw: node.rawInput },
    tags: node.tags,
    context,
  };
}

// ── Signal queries ───────────────────────────────────────────────────────────

const DISPOSABLE_TTL_MS = 24 * 3_600_000;

function isExpiredDisposable(s: Signal): boolean {
  return s.retentionPolicy === 'Disposable' &&
    Date.now() - new Date(s.capturedAt).getTime() > DISPOSABLE_TTL_MS;
}

/** Get all signals, projected from the Life Graph (newest first).
 *  Expired Disposable signals are filtered out so they never reach reasoning. */
export function getSignals(opts?: { since?: number; sources?: SignalSource[]; types?: SignalType[] }): Signal[] {
  let signals = getLifeGraph().map(lifeNodeToSignal).filter((s) => !isExpiredDisposable(s));
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

/**
 * Pruning Engine (PRD §2.3) — physically delete expired Disposable nodes from
 * the Life Graph so transient data (weather, one-off scraps) never accumulates.
 * Safe to call on app mount. Returns the number of nodes pruned.
 */
export function pruneDisposableSignals(): number {
  if (typeof window === 'undefined') return 0;
  const expired = getLifeGraph()
    .filter((node) => isExpiredDisposable(lifeNodeToSignal(node)));
  if (!expired.length) return 0;
  expired.forEach((node) => deleteLifeNode(node.id));
  return expired.length;
}

/** Signals captured within the last N hours. */
export function getRecentSignals(hours = 168): Signal[] {
  return getSignals({ since: Date.now() - hours * 3_600_000 });
}
