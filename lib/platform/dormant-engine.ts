/**
 * Dormant Task Engine — platform layer
 *
 * Handles long-neglected / undated tasks that should not permanently occupy
 * attention, but should occasionally resurface for a deliberate judgment:
 * "Do this / Snooze / Let go"
 *
 * State machine:  Active → Dormant → (Review) → Archived | Active
 *
 * Decay is based on lastTouchedAt (updated on any interaction), falling back
 * to createdAt. Tasks with explicit due-date attributes are excluded entirely.
 *
 * Score decay (days since last touch):
 *   day 0  → 50   day 3  → 40   day 7  → 30
 *   day 14 → 20   day 30 → 0    (enters Dormant)
 *
 * Review pop-up probability (days since dormant, before snooze penalty):
 *   7d → 8%   14d → 18%   30d → 30%   60d → 40%   (intentionally capped — "偶尔")
 *
 * Snooze penalty: each snooze × 0.75 multiplier on base probability (min 15%).
 * So a 3× snoozed task at 30d has 30% × 0.75³ ≈ 13% → floored to 15%.
 *
 * Max 1 review card shown per day.
 * Candidate selection is deterministic per day (hash-seeded), but randomly
 * distributed among all eligible dormant nodes (not always the oldest).
 */

import type { FocusNode } from '@/lib/platform/view-models/today-view-model';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DormantStatus = 'active' | 'dormant' | 'archived';

export interface DormantRecord {
  status: DormantStatus;
  dormantSince?: string;    // ISO — when entered dormant
  lastReviewedAt?: string;  // ISO — when review card was last shown
  lastTouchedAt?: string;   // ISO — any user interaction resets decay clock
  reviewCount: number;
  snoozedUntil?: string;    // ISO — skip review before this date
  snoozeCount: number;      // accumulated snoozes — drives pop probability down
}

export type DormantStore = Record<string, DormantRecord>;

const STORE_KEY = 'nesio-dormant-store';

// Date attribute keys — nodes with any of these are excluded from dormant engine
const DUE_DATE_KEYS = ['start', 'end', 'date', 'dueDate', 'due', 'deadline', 'datetime', 'scheduledAt', 'remindAt'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasDueDate(node: FocusNode): boolean {
  for (const key of DUE_DATE_KEYS) {
    const v = node.attributes[key];
    if (typeof v === 'string' && v.length >= 10 && !Number.isNaN(new Date(v).getTime())) return true;
  }
  return false;
}

function effectiveAgeRef(rec: DormantRecord, node: FocusNode): string {
  return rec.lastTouchedAt ?? node.createdAt;
}

// ── Score decay ───────────────────────────────────────────────────────────────

const DECAY_TABLE: Array<{ days: number; score: number }> = [
  { days: 30, score: 0  },
  { days: 14, score: 20 },
  { days: 7,  score: 30 },
  { days: 3,  score: 40 },
  { days: 0,  score: 50 },
];

export function ageScore(ref: string, now: Date = new Date()): number {
  const ageDays = (now.getTime() - new Date(ref).getTime()) / 86_400_000;
  for (const { days, score } of DECAY_TABLE) {
    if (ageDays >= days) return score;
  }
  return 50;
}

// ── Review probability ────────────────────────────────────────────────────────

// Base probabilities — intentionally moderate. "偶尔" not "经常".
// Numbers are starting points for empirical tuning, not final values.
const PROB_TABLE: Array<{ days: number; prob: number }> = [
  { days: 60, prob: 0.40 },
  { days: 30, prob: 0.30 },
  { days: 14, prob: 0.18 },
  { days: 7,  prob: 0.08 },
  { days: 0,  prob: 0    },
];

const SNOOZE_PROB_MULTIPLIER = 0.75; // each snooze × this; floored at MIN_PROB
const MIN_PROB = 0.15;               // never drop below — task shouldn't fully vanish

function reviewProbability(dormantDays: number, snoozeCount: number): number {
  let base = 0;
  for (const { days, prob } of PROB_TABLE) {
    if (dormantDays >= days) { base = prob; break; }
  }
  if (base === 0) return 0;
  // Each snooze multiplies probability down; floor at MIN_PROB so it never disappears
  const adjusted = base * Math.pow(SNOOZE_PROB_MULTIPLIER, snoozeCount);
  return Math.max(adjusted, MIN_PROB);
}

// ── Deterministic randomness ───────────────────────────────────────────────────

function deterministicHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function deterministicRoll(nodeId: string, dateStr: string): number {
  return (deterministicHash(nodeId + dateStr) % 100) / 100;
}

// Among eligible candidates, pick one deterministically per day —
// but distributed across all candidates (not always the oldest).
function pickCandidate(candidates: FocusNode[], dateStr: string): FocusNode {
  if (candidates.length === 1) return candidates[0];
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const idx = deterministicHash('pick' + dateStr) % sorted.length;
  return sorted[idx];
}

// ── Storage ───────────────────────────────────────────────────────────────────

export function loadDormantStore(): DormantStore {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as DormantStore; }
  catch { return {}; }
}

function save(store: DormantStore): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
}

function getRecord(store: DormantStore, nodeId: string): DormantRecord {
  return store[nodeId] ?? { status: 'active', reviewCount: 0, snoozeCount: 0 };
}

// ── Touch tracking ────────────────────────────────────────────────────────────

/**
 * Call this on any meaningful user interaction with a node (opening detail,
 * starting momentum, etc.) to reset its decay clock.
 */
export function touchNode(nodeId: string): DormantStore {
  const store = loadDormantStore();
  const rec = getRecord(store, nodeId);
  if (rec.status === 'archived') return store;
  store[nodeId] = { ...rec, lastTouchedAt: new Date().toISOString() };
  if (rec.status === 'dormant') {
    // Touching a dormant node reactivates it
    store[nodeId] = { ...store[nodeId], status: 'active', dormantSince: undefined };
  }
  save(store);
  return store;
}

// ── State transitions ─────────────────────────────────────────────────────────

/**
 * Evaluate all undone nodes and transition those that have been silent for 30+
 * days into Dormant. Skips nodes with explicit due-date attributes.
 */
export function evaluateDormancy(
  allNodes: readonly FocusNode[],
  store: DormantStore,
  now: Date = new Date(),
): DormantStore {
  let changed = false;
  const next = { ...store };

  for (const node of allNodes) {
    // Nodes with a due date are managed by urgency, not dormancy
    if (hasDueDate(node)) continue;

    const rec = getRecord(next, node.id);
    if (rec.status !== 'active') continue;

    const ref = effectiveAgeRef(rec, node);
    const ageDays = (now.getTime() - new Date(ref).getTime()) / 86_400_000;
    if (ageDays >= 30) {
      next[node.id] = { ...rec, status: 'dormant', dormantSince: now.toISOString() };
      changed = true;
    }
  }

  if (changed) save(next);
  return next;
}

// ── Review candidate selection ────────────────────────────────────────────────

/**
 * Pick at most one node to show a review card for today.
 * Each eligible dormant node rolls independently; among those that pass,
 * one is chosen deterministically per day (distributed, not always oldest).
 */
export function selectReviewCandidate(
  allNodes: readonly FocusNode[],
  store: DormantStore,
  now: Date = new Date(),
): FocusNode | null {
  const today = now.toISOString().slice(0, 10);

  const eligible = allNodes.filter((node) => {
    if (hasDueDate(node)) return false;

    const rec = getRecord(store, node.id);
    if (rec.status !== 'dormant') return false;
    if (rec.snoozedUntil && new Date(rec.snoozedUntil) > now) return false;
    if (rec.lastReviewedAt?.startsWith(today)) return false;

    const dormantDays = rec.dormantSince
      ? (now.getTime() - new Date(rec.dormantSince).getTime()) / 86_400_000 : 0;

    const prob = reviewProbability(dormantDays, rec.snoozeCount);
    return deterministicRoll(node.id, today) < prob;
  });

  if (!eligible.length) return null;
  return pickCandidate(eligible, today);
}

// ── User action handlers ──────────────────────────────────────────────────────

export type ReviewAction = 'do' | 'snooze' | 'archive';

export function applyReviewAction(
  nodeId: string,
  action: ReviewAction,
  snoozeDays: 7 | 14 | 30 = 7,
): DormantStore {
  const store = loadDormantStore();
  const rec = getRecord(store, nodeId);
  const now = new Date().toISOString();

  if (action === 'do') {
    store[nodeId] = {
      ...rec,
      status: 'active',
      lastReviewedAt: now,
      lastTouchedAt: now,
      reviewCount: rec.reviewCount + 1,
    };
  } else if (action === 'snooze') {
    const until = new Date(Date.now() + snoozeDays * 86_400_000).toISOString();
    store[nodeId] = {
      ...rec,
      lastReviewedAt: now,
      reviewCount: rec.reviewCount + 1,
      snoozeCount: rec.snoozeCount + 1,
      snoozedUntil: until,
    };
  } else if (action === 'archive') {
    store[nodeId] = {
      ...rec,
      status: 'archived',
      lastReviewedAt: now,
      reviewCount: rec.reviewCount + 1,
    };
  }

  save(store);
  return store;
}

// ── Attention score for a dormant node ───────────────────────────────────────

/** Returns 0 for archived/dormant nodes. */
export function dormantAttentionScore(
  node: FocusNode,
  store: DormantStore,
  now: Date = new Date(),
): number {
  const rec = getRecord(store, node.id);
  if (rec.status === 'archived' || rec.status === 'dormant') return 0;
  const ref = effectiveAgeRef(rec, node);
  return Math.max(0, ageScore(ref, now));
}
