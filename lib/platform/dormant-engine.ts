/**
 * Dormant Task Engine — platform layer
 *
 * Handles long-neglected / undated tasks that should not permanently occupy
 * attention, but should occasionally resurface for a deliberate judgment:
 * "Do this / Snooze / Let go"
 *
 * State machine:  Active → Dormant → (Review) → Archived | Active
 *
 * Score decay (no-due tasks, days since createdAt):
 *   day 0  → 50   day 3  → 40   day 7  → 30
 *   day 14 → 20   day 30 → 0    (enters Dormant)
 *
 * Review pop-up probability (days since dormant):
 *   7d → 10%   14d → 20%   30d → 35%   60d → 50%
 *
 * Max 1 review card shown per day. Probability roll is seeded by nodeId+date
 * so the same node doesn't randomly flip between "show" and "hide" on re-render.
 */

import type { FocusNode } from '@/lib/platform/view-models/today-view-model';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DormantStatus = 'active' | 'dormant' | 'archived';

export interface DormantRecord {
  status: DormantStatus;
  dormantSince?: string;   // ISO — when entered dormant
  lastReviewedAt?: string; // ISO — when review card was last shown
  reviewCount: number;
  snoozedUntil?: string;   // ISO — skip review before this date
  weightPenalty: number;   // accumulated score penalty from repeated snoozes
}

export type DormantStore = Record<string, DormantRecord>;

const STORE_KEY = 'nesio-dormant-store';

// ── Score decay ───────────────────────────────────────────────────────────────

const DECAY_TABLE: Array<{ days: number; score: number }> = [
  { days: 30, score: 0  },
  { days: 14, score: 20 },
  { days: 7,  score: 30 },
  { days: 3,  score: 40 },
  { days: 0,  score: 50 },
];

export function ageScore(createdAt: string, now: Date = new Date()): number {
  const ageDays = (now.getTime() - new Date(createdAt).getTime()) / 86_400_000;
  for (const { days, score } of DECAY_TABLE) {
    if (ageDays >= days) return score;
  }
  return 50;
}

// ── Review probability ────────────────────────────────────────────────────────

const PROB_TABLE: Array<{ days: number; prob: number }> = [
  { days: 60, prob: 0.50 },
  { days: 30, prob: 0.35 },
  { days: 14, prob: 0.20 },
  { days: 7,  prob: 0.10 },
  { days: 0,  prob: 0    },
];

function reviewProbability(dormantDays: number): number {
  for (const { days, prob } of PROB_TABLE) {
    if (dormantDays >= days) return prob;
  }
  return 0;
}

// Deterministic pseudo-random: same node shows/hides consistently within a day
function deterministicRoll(nodeId: string, dateStr: string): number {
  let hash = 0;
  const s = nodeId + dateStr;
  for (let i = 0; i < s.length; i++) {
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash % 100) / 100;
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
  return store[nodeId] ?? { status: 'active', reviewCount: 0, weightPenalty: 0 };
}

// ── State transitions ─────────────────────────────────────────────────────────

/**
 * Evaluate all undone nodes and transition any that have aged past 30 days
 * into Dormant. Returns the (possibly mutated) store and saves to localStorage.
 */
export function evaluateDormancy(
  allNodes: readonly FocusNode[],
  store: DormantStore,
  now: Date = new Date(),
): DormantStore {
  let changed = false;
  const next = { ...store };

  for (const node of allNodes) {
    const rec = getRecord(next, node.id);
    if (rec.status !== 'active') continue;

    const ageDays = (now.getTime() - new Date(node.createdAt).getTime()) / 86_400_000;
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
 * Uses a deterministic roll (seeded by nodeId + today's date) so the
 * result is stable across re-renders within the same day.
 */
export function selectReviewCandidate(
  allNodes: readonly FocusNode[],
  store: DormantStore,
  now: Date = new Date(),
): FocusNode | null {
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const candidates = allNodes.filter((node) => {
    const rec = getRecord(store, node.id);
    if (rec.status !== 'dormant') return false;

    // Respect snooze
    if (rec.snoozedUntil && new Date(rec.snoozedUntil) > now) return false;

    // Already shown today
    if (rec.lastReviewedAt?.startsWith(today)) return false;

    const dormantDays = rec.dormantSince
      ? (now.getTime() - new Date(rec.dormantSince).getTime()) / 86_400_000 : 0;

    const prob = reviewProbability(dormantDays);
    const roll = deterministicRoll(node.id, today);
    return roll < prob;
  });

  if (!candidates.length) return null;

  // Among eligible candidates pick the oldest (most neglected)
  return candidates.reduce((a, b) =>
    new Date(a.createdAt) < new Date(b.createdAt) ? a : b
  );
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
    // Reactivate — user wants to act on it now
    store[nodeId] = {
      ...rec,
      status: 'active',
      lastReviewedAt: now,
      reviewCount: rec.reviewCount + 1,
    };
  } else if (action === 'snooze') {
    const until = new Date(Date.now() + snoozeDays * 86_400_000).toISOString();
    store[nodeId] = {
      ...rec,
      lastReviewedAt: now,
      reviewCount: rec.reviewCount + 1,
      snoozedUntil: until,
      // Each snooze increases the penalty — task surfaces less aggressively
      weightPenalty: Math.min(rec.weightPenalty + 5, 30),
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

/** Returns 0 for archived/dormant. Used by Attention Engine if integration needed. */
export function dormantAttentionScore(
  node: FocusNode,
  store: DormantStore,
  now: Date = new Date(),
): number {
  const rec = getRecord(store, node.id);
  if (rec.status === 'archived' || rec.status === 'dormant') return 0;
  return Math.max(0, ageScore(node.createdAt, now) - rec.weightPenalty);
}
