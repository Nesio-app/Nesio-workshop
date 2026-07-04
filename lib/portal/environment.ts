/**
 * Environment — single source for "where is the user right now and what's
 * around them": weather, location, time-of-day, and cached calendar events.
 *
 * Replaces per-consumer duplicates: TodayFeed / DailyBriefCard / NesioChatSheet /
 * daily-brief route each declared their own Weather interface and their own
 * "localStorage first, portal cache fallback" calendar read. Client-side only.
 */

import { readPortalCache, PORTAL_CACHE_KEYS } from './prefetch-cache';
import { loadCalendarFromLocal } from './calendar-local-store';
import { loadLastLocation, formatLocationAge, type StoredLocation } from './location-store';
import { isInSpan, type TemporalSpan } from './temporal-query';
import type { CalendarEvent } from './types';

export interface WeatherView {
  temperatureC: number;
  condition: string;
  forecastNote?: string;
  placeLabel?: string;
}

export type TimeOfDay = 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'night';

export interface Environment {
  weather: WeatherView | null;
  location: StoredLocation | null;
  timeOfDay: TimeOfDay;
  hour: number;
}

export function timeOfDay(now: Date = new Date()): TimeOfDay {
  const h = now.getHours();
  if (h < 5) return 'night';
  if (h < 9) return 'early_morning';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

/** Synchronous snapshot from caches — refreshLocation() elsewhere keeps it warm. */
export function getEnvironment(now: Date = new Date()): Environment {
  return {
    weather: readPortalCache<WeatherView>(PORTAL_CACHE_KEYS.weather) ?? null,
    location: loadLastLocation(),
    timeOfDay: timeOfDay(now),
    hour: now.getHours(),
  };
}

/**
 * One canonical Chinese-language environment block for AI prompts
 * (问一问 / 听简报 share this so the model hears the same facts).
 */
export function formatEnvironmentContext(env: Environment = getEnvironment()): string {
  const parts: string[] = [];
  if (env.location) {
    parts.push(`当前位置：${env.location.label}（${formatLocationAge(env.location.ts)}）`);
  }
  if (env.weather?.condition) {
    const place = env.weather.placeLabel && !env.location ? `${env.weather.placeLabel} ` : '';
    parts.push(
      `当前天气：${place}${env.weather.temperatureC}°C ${env.weather.condition}` +
      (env.weather.forecastNote ? `，${env.weather.forecastNote}` : ''),
    );
  }
  if (parts.length === 0) return '';
  return `【实时环境】\n${parts.join('\n')}`;
}

// ── Calendar (cached) ─────────────────────────────────────────────────────────

/** Calendar events: localStorage (24h TTL) first, portal cache fallback. */
export function getCachedCalendarEvents(): CalendarEvent[] {
  const local = loadCalendarFromLocal() as CalendarEvent[];
  if (local.length > 0) return local;
  const cached = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
  return cached?.events ?? [];
}

/** Cached events whose start falls inside the span, sorted by start. */
export function getCalendarEventsIn(span: TemporalSpan): CalendarEvent[] {
  return getCachedCalendarEvents()
    .filter((ev) => {
      if (!ev.start) return false;
      const d = new Date(ev.start);
      return !Number.isNaN(d.getTime()) && isInSpan(d, span);
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}
