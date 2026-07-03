/**
 * Calendar local persistence — stores fetched calendar events in localStorage
 * with a 24-hour TTL, replacing the 5-minute sessionStorage cache as the
 * source of truth for NesioChatSheet context building.
 */

const KEY = 'nesio-calendar-local-v1';
const TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface StoredCalendarEvent {
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  calendarName?: string;
  description?: string;
  location?: string;
  url?: string;
}

interface StoredPayload {
  events: StoredCalendarEvent[];
  savedAt: number;
}

export function saveCalendarToLocal(events: StoredCalendarEvent[]): void {
  if (typeof window === 'undefined') return;
  const payload: StoredPayload = { events, savedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // quota exceeded or private mode — silent
  }
}

export function loadCalendarFromLocal(): StoredCalendarEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw) as StoredPayload;
    if (Date.now() - payload.savedAt > TTL) {
      localStorage.removeItem(KEY);
      return [];
    }
    return payload.events ?? [];
  } catch {
    return [];
  }
}
