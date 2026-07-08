/**
 * Dormant Task Engine — platform layer
 *
 * Handles three classes of neglected tasks:
 *
 * 1. DORMANT (undated, passively neglected ≥ 30 days)
 *    State: active → dormant → archived → finalized
 *    Review prompt: "这个还属于你吗？" [现在做] [以后再说] [放下]
 *
 * 2. OVERDUE (dated tasks past their due date by ≥ 3 days)
 *    State: active (with overdueEnteredAt set) → archived → finalized
 *    Review prompt: "截止日期过了，还想继续吗？" [还是要做] [以后再说] [放下]
 *
 * 3. SOFT-ARCHIVE RESURFACE (archived ≥ 90 days ago, one final check)
 *    State: archived → active | finalized
 *    Review prompt: "你曾经放下了这件事，现在还这样觉得吗？" [重新拾起] [彻底告别]
 *
 * Snooze intervals: exponential (7 → 14 → 30 → 60 → 90d cap).
 * Review pop probability: increases with dormant days, decays with snooze count.
 * Escalating message: snoozeCount 3+ → stronger prompt; 5+ → letting-go primary CTA.
 */

import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import type { FocusNode } from '@/lib/platform/view-models/today-view-model';
import { firstNodeDate } from '@/lib/platform/node-dates';

// ── Types ─────────────────────────────────────────────────────────────────────

// 'finalized' = truly gone after soft-archive confirmation. Never resurfaces.
export type DormantStatus = 'active' | 'dormant' | 'archived' | 'finalized';

export interface DormantRecord {
  status: DormantStatus;
  dormantSince?: string;      // ISO — when undated task entered dormant
  lastReviewedAt?: string;    // ISO — when review card was last shown
  lastTouchedAt?: string;     // ISO — any user interaction resets decay clock
  reviewCount: number;
  snoozedUntil?: string;      // ISO — skip review before this date
  snoozeCount: number;
  // P0: overdue pool for dated tasks
  overdueEnteredAt?: string;  // set when a dated task is 3+ days past its due date
  originalDueDate?: string;   // preserved for display ("截止日期是 XX")
  // P2: soft archive
  archivedAt?: string;        // set on 'archive' action; enables 90-day resurface
}

// Describes why a candidate was selected — used by UI to choose prompt/actions
export type DormantCandidateKind =
  | 'dormant'        // undated, passively neglected
  | 'overdue'        // dated, past due date
  | 'soft-archive';  // archived 90d ago, final confirmation

export interface DormantCandidate {
  node: FocusNode;
  kind: DormantCandidateKind;
  rec: DormantRecord;
}

export type DormantStore = Record<string, DormantRecord>;

const STORE_KEY = 'nesio-dormant-store';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDueDate(node: FocusNode): Date | null {
  return firstNodeDate(node.attributes);
}

function effectiveAgeRef(rec: DormantRecord, node: FocusNode): string {
  return rec.lastTouchedAt ?? node.createdAt;
}

// ── Score decay (undated tasks only) ─────────────────────────────────────────

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

const PROB_TABLE: Array<{ days: number; prob: number }> = [
  { days: 60, prob: 0.40 },
  { days: 30, prob: 0.30 },
  { days: 14, prob: 0.18 },
  { days: 7,  prob: 0.08 },
  { days: 0,  prob: 0    },
];

const SNOOZE_PROB_MULTIPLIER = 0.75;
const MIN_PROB = 0.15;

function reviewProbability(dormantDays: number, snoozeCount: number): number {
  let base = 0;
  for (const { days, prob } of PROB_TABLE) {
    if (dormantDays >= days) { base = prob; break; }
  }
  if (base === 0) return 0;
  const adjusted = base * Math.pow(SNOOZE_PROB_MULTIPLIER, snoozeCount);
  return Math.max(adjusted, MIN_PROB);
}

// ── Exponential snooze intervals (P1 — FSRS-inspired) ────────────────────────

// Each successive snooze waits longer — reflects increasing signal that user
// doesn't want to think about this task right now.
const SNOOZE_SCHEDULE_DAYS = [7, 14, 30, 60, 90] as const;

export function computeSnoozeDays(currentSnoozeCount: number): number {
  return SNOOZE_SCHEDULE_DAYS[Math.min(currentSnoozeCount, SNOOZE_SCHEDULE_DAYS.length - 1)];
}

// ── Escalating review message tier (P1 — GTD principle) ──────────────────────

// Used by UI to choose prompt text and button prominence
export type ReviewTier = 'normal' | 'gentle-nudge' | 'letting-go';

export function getReviewTier(snoozeCount: number): ReviewTier {
  if (snoozeCount >= 5) return 'letting-go';
  if (snoozeCount >= 3) return 'gentle-nudge';
  return 'normal';
}

// ── Deterministic randomness ──────────────────────────────────────────────────

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

function pickCandidate(candidates: FocusNode[], dateStr: string): FocusNode {
  if (candidates.length === 1) return candidates[0];
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const idx = deterministicHash('pick' + dateStr) % sorted.length;
  return sorted[idx];
}

// ── Storage ───────────────────────────────────────────────────────────────────

// 存储完整性批:localStorage → IDB blob(同步缓存读 + 旧值自动迁移 + 备份/删除收口)。
const blob = createBlobStore<DormantStore>({
  key: STORE_KEY, updateEvent: `${STORE_KEY}-updated`,
  validate: (v) => typeof v === 'object' && v !== null, onWriteError: reportStorageDropped,
});

export function loadDormantStore(): DormantStore {
  if (typeof window === 'undefined') return {};
  const v = blob.load();
  return v && typeof v === 'object' ? v : {};
}

function save(store: DormantStore): void {
  if (typeof window === 'undefined') return;
  blob.save(store);
}

function getRecord(store: DormantStore, nodeId: string): DormantRecord {
  return store[nodeId] ?? { status: 'active', reviewCount: 0, snoozeCount: 0 };
}

// ── Touch tracking ────────────────────────────────────────────────────────────

export function touchNode(nodeId: string): DormantStore {
  const store = loadDormantStore();
  const rec = getRecord(store, nodeId);
  if (rec.status === 'archived' || rec.status === 'finalized') return store;
  store[nodeId] = { ...rec, lastTouchedAt: new Date().toISOString() };
  if (rec.status === 'dormant') {
    store[nodeId] = { ...store[nodeId], status: 'active', dormantSince: undefined };
  }
  // Touching a task that was overdue clears the overdue state
  if (rec.overdueEnteredAt) {
    store[nodeId] = { ...store[nodeId], overdueEnteredAt: undefined, originalDueDate: undefined };
  }
  save(store);
  return store;
}

// ── State transitions ─────────────────────────────────────────────────────────

/**
 * Evaluate all nodes and transition into dormant / overdue states.
 *
 * Undated tasks: active → dormant after 30 days of no interaction.
 * Dated tasks:   active → overdue pool after 3 days past their due date.
 *                (They don't enter 'dormant' status — instead overdueEnteredAt is set.)
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
    if (rec.status === 'archived' || rec.status === 'finalized') continue;

    const dueDate = getDueDate(node);

    if (dueDate) {
      // Dated task: check if 3+ days past due and not yet in overdue pool
      if (rec.status === 'active' && !rec.overdueEnteredAt) {
        const daysPastDue = (now.getTime() - dueDate.getTime()) / 86_400_000;
        if (daysPastDue >= 3) {
          next[node.id] = {
            ...rec,
            overdueEnteredAt: now.toISOString(),
            originalDueDate: dueDate.toISOString(),
          };
          changed = true;
        }
      }
    } else {
      // Undated task: active → dormant after 30 days
      if (rec.status !== 'active') continue;
      const ref = effectiveAgeRef(rec, node);
      const ageDays = (now.getTime() - new Date(ref).getTime()) / 86_400_000;
      if (ageDays >= 30) {
        next[node.id] = { ...rec, status: 'dormant', dormantSince: now.toISOString() };
        changed = true;
      }
    }
  }

  if (changed) save(next);
  return next;
}

// ── Review candidate selection ────────────────────────────────────────────────

/**
 * Pick at most one node to show a review card for today.
 *
 * Priority order:
 *   1. Soft-archive resurface (archived 90+ days ago — final confirmation)
 *   2. Overdue dated tasks (past due 3+ days)
 *   3. Dormant undated tasks (neglected 30+ days)
 *
 * Returns DormantCandidate (node + kind + rec) so the UI can adapt its prompt.
 */
export function selectReviewCandidate(
  allNodes: readonly FocusNode[],
  store: DormantStore,
  now: Date = new Date(),
): DormantCandidate | null {
  const today = now.toISOString().slice(0, 10);

  // Priority 1: soft-archive resurface — show after 90 days, once only
  for (const node of allNodes) {
    const rec = getRecord(store, node.id);
    if (rec.status !== 'archived' || !rec.archivedAt) continue;
    if (rec.lastReviewedAt?.startsWith(today)) continue;
    const daysSince = (now.getTime() - new Date(rec.archivedAt).getTime()) / 86_400_000;
    if (daysSince >= 90) return { node, kind: 'soft-archive', rec };
  }

  // Priority 2 + 3: overdue dated tasks and dormant undated tasks
  const eligible: Array<{ node: FocusNode; kind: DormantCandidateKind; refDate: string }> = [];

  for (const node of allNodes) {
    const rec = getRecord(store, node.id);
    const dueDate = getDueDate(node);

    const isOverdue = !!rec.overdueEnteredAt && rec.status === 'active';
    const isDormant = rec.status === 'dormant' && !dueDate;

    if (!isOverdue && !isDormant) continue;
    if (rec.snoozedUntil && new Date(rec.snoozedUntil) > now) continue;
    if (rec.lastReviewedAt?.startsWith(today)) continue;

    const refDate = isOverdue
      ? rec.overdueEnteredAt!
      : (rec.dormantSince ?? node.createdAt);

    const daysSinceRef = (now.getTime() - new Date(refDate).getTime()) / 86_400_000;
    const prob = reviewProbability(daysSinceRef, rec.snoozeCount);

    if (deterministicRoll(node.id, today) < prob) {
      eligible.push({ node, kind: isOverdue ? 'overdue' : 'dormant', refDate });
    }
  }

  if (!eligible.length) return null;

  // Overdue takes priority over dormant among eligible candidates
  const overdueOnly = eligible.filter((e) => e.kind === 'overdue');
  const pool = overdueOnly.length > 0 ? overdueOnly : eligible;
  const picked = pickCandidate(pool.map((e) => e.node), today);
  const pickedMeta = pool.find((e) => e.node.id === picked.id)!;

  return { node: picked, kind: pickedMeta.kind, rec: getRecord(store, picked.id) };
}

// ── User action handlers ──────────────────────────────────────────────────────

export type ReviewAction = 'do' | 'snooze' | 'archive' | 'finalize';

/**
 * Apply a review action from the user.
 *
 * 'do'       → reactivate (clears dormant + overdue state, resets decay clock)
 * 'snooze'   → defer with exponential interval based on snoozeCount
 * 'archive'  → soft archive (will resurface after 90 days for final check)
 * 'finalize' → permanent removal after the soft-archive resurface confirmation
 */
export function applyReviewAction(
  nodeId: string,
  action: ReviewAction,
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
      dormantSince: undefined,
      overdueEnteredAt: undefined,
      originalDueDate: undefined,
    };
  } else if (action === 'snooze') {
    const days = computeSnoozeDays(rec.snoozeCount);
    const until = new Date(Date.now() + days * 86_400_000).toISOString();
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
      archivedAt: now,
      overdueEnteredAt: undefined,
      originalDueDate: undefined,
    };
  } else if (action === 'finalize') {
    // After soft-archive resurface: user confirms "彻底告别"
    store[nodeId] = {
      ...rec,
      status: 'finalized',
      lastReviewedAt: now,
      reviewCount: rec.reviewCount + 1,
    };
  }

  save(store);
  return store;
}

// ── Attention score for active nodes ─────────────────────────────────────────

export function dormantAttentionScore(
  node: FocusNode,
  store: DormantStore,
  now: Date = new Date(),
): number {
  const rec = getRecord(store, node.id);
  if (rec.status === 'archived' || rec.status === 'dormant' || rec.status === 'finalized') return 0;
  const ref = effectiveAgeRef(rec, node);
  return Math.max(0, ageScore(ref, now));
}
