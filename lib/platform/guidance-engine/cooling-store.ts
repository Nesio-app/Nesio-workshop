/**
 * Cooling Store — Layer 6
 *
 * Prevents the same event type from appearing repeatedly.
 * Cooldown duration scales with urgency: critical events can re-appear sooner
 * (after 2h the situation has changed), while low-urgency nudges wait 24h.
 *
 * Per the design principle: if a user ignores a card today, don't re-show
 * the same category until the cooldown expires. Exception: critical urgency
 * (flight leaving, meeting starting) has a shorter window because the window
 * itself closes soon anyway.
 */

import type { WindowUrgency } from './types';

const STORE_KEY = 'nesio-guidance-cooling';

// Cooldown per urgency level (ms)
const COOLDOWN_MS: Record<WindowUrgency, number> = {
  critical: 2  * 3_600_000,   // 2h — situation changes fast
  high:     6  * 3_600_000,   // 6h
  medium:   12 * 3_600_000,   // 12h
  low:      24 * 3_600_000,   // 24h — one nudge per day max
  closed:   0,
};

interface CooldownEntry {
  lastShownAt: string;   // ISO
  showCount: number;     // times shown (today, resets at midnight)
  dismissCount: number;  // times user dismissed without acting (persistent — drives adaptive cooling)
}

export type CoolingStore = Record<string, CooldownEntry>;

export function loadCoolingStore(): CoolingStore {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as CoolingStore; }
  catch { return {}; }
}

export function isOnCooldown(
  eventType: string,
  urgency: WindowUrgency,
  store: CoolingStore,
  now: Date = new Date(),
): boolean {
  const entry = store[eventType];
  if (!entry) return false;
  const baseCooldown = COOLDOWN_MS[urgency] ?? COOLDOWN_MS.medium;
  // Adaptive: if user has dismissed this type 3+ times without acting, double the cooldown.
  // Inspired by PRISM's asymmetric cost model: persistent false-alarm patterns cost trust.
  const multiplier = (entry.dismissCount ?? 0) >= 3 ? 2 : 1;
  return now.getTime() - new Date(entry.lastShownAt).getTime() < baseCooldown * multiplier;
}

export function recordShown(eventType: string, store: CoolingStore): CoolingStore {
  const today = new Date().toISOString().slice(0, 10);
  const existing = store[eventType];
  const sameDay = existing?.lastShownAt.startsWith(today) ?? false;
  return {
    ...store,
    [eventType]: {
      lastShownAt: new Date().toISOString(),
      showCount: sameDay ? (existing!.showCount + 1) : 1,
      dismissCount: existing?.dismissCount ?? 0,
    },
  };
}

// Call when user explicitly dismisses a card without acting on it.
// Increments dismissCount which is used by isOnCooldown's adaptive multiplier.
export function recordDismissed(eventType: string, store: CoolingStore): CoolingStore {
  const existing = store[eventType];
  return {
    ...store,
    [eventType]: {
      lastShownAt: existing?.lastShownAt ?? new Date().toISOString(),
      showCount: existing?.showCount ?? 0,
      dismissCount: (existing?.dismissCount ?? 0) + 1,
    },
  };
}

export function saveCoolingStore(store: CoolingStore): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
}
