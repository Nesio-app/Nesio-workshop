export interface CalendarLinkSettings {
  googleCalendarUrl: string;
}

const CALENDAR_LINK_KEY = 'treasurebox-calendar-links-v1';
export const CALENDAR_LINK_UPDATED_EVENT = 'treasurebox-calendar-link-updated';

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function loadCalendarLinkSettings(): CalendarLinkSettings {
  if (typeof window === 'undefined') return { googleCalendarUrl: '' };
  try {
    const raw = localStorage.getItem(CALENDAR_LINK_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      googleCalendarUrl: normalizeUrl(
        typeof parsed?.googleCalendarUrl === 'string' ? parsed.googleCalendarUrl : '',
      ),
    };
  } catch {
    return { googleCalendarUrl: '' };
  }
}

export function saveCalendarLinkSettings(settings: CalendarLinkSettings): CalendarLinkSettings {
  const next = { googleCalendarUrl: normalizeUrl(settings.googleCalendarUrl) };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(CALENDAR_LINK_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(CALENDAR_LINK_UPDATED_EVENT));
    } catch { /* ignore */ }
  }
  return next;
}
