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
  const cooldown = COOLDOWN_MS[urgency] ?? COOLDOWN_MS.medium;
  return now.getTime() - new Date(entry.lastShownAt).getTime() < cooldown;
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
    },
  };
}

export function saveCoolingStore(store: CoolingStore): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
}
