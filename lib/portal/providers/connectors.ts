/**
 * Connectors — fetch live signals and write to shared cache + Life Graph.
 * Called on TodayFeed mount. Results read by Reasoning Engine.
 */

import { fetchWeatherAt, readGeo, reverseGeocode } from './weather';
import { PORTAL_CACHE_KEYS, writePortalCache, readPortalCache } from '../prefetch-cache';
import { getLifeGraph } from '../life-graph';
import type { CalendarEvent } from '../types';
import { createSignal } from '../../life-domain/create-signal';
import { normalizeCalendarToSignal, normalizeWeatherToSignal } from '../../life-domain/normalizers';
import { recordLiveVisit } from '../place-trail';

// ── Weather ──────────────────────────────────────────────────────────────────

export async function refreshWeather(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return;
  // 批次 24:天气缓存只挡「重复拉天气」,不再挡地点足迹——此前 cached 存在
  // 就整个早退,recordLiveVisit 永远没机会跑(用户报「足迹一直空」)。
  const cached = readPortalCache<unknown>(PORTAL_CACHE_KEYS.weather);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lon } = pos.coords;
          let placeName = '';
          try {
            const geo = await reverseGeocode(lat, lon);
            placeName = geo.label || geo.city || '';
          } catch { /* ignore */ }

          // 地点足迹:每次拿到定位都记(2h 同地去重),不受天气缓存影响
          if (placeName) recordLiveVisit(placeName, lat, lon);

          // 天气:有缓存就不重复拉
          if (!cached) {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto';
            const snapshot = await fetchWeatherAt(lat, lon, timezone, placeName);
            writePortalCache(PORTAL_CACHE_KEYS.weather, snapshot);
            createSignal(normalizeWeatherToSignal({ ...snapshot, placeName }));
            window.dispatchEvent(new CustomEvent('nesio-weather-updated', { detail: snapshot }));
          }
        } catch { /* fetch failed */ }
        resolve();
      },
      () => resolve(), // permission denied or timeout
      { timeout: 8000, maximumAge: 300_000, enableHighAccuracy: false },
    );
  });
}

// ── Calendar → cache + Life Graph ───────────────────────────────────────────

export async function refreshCalendar(): Promise<void> {
  try {
    const res = await fetch('/api/portal/calendar', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json() as { events?: CalendarEvent[]; feeds?: unknown };
    if (!data?.events?.length && !data?.feeds) return;

    writePortalCache(PORTAL_CACHE_KEYS.calendar, data);
    window.dispatchEvent(new CustomEvent('nesio-calendar-updated', { detail: data }));

    // Add upcoming events to Life Graph (deduplicate by event id)
    if (data.events?.length) {
      const existingIds = new Set(getLifeGraph()
        .map((n) => (n.attributes['externalId'] || n.attributes['calendarId']) as string)
        .filter(Boolean));
      const now = Date.now();

      data.events
        .filter((e) => new Date(e.start).getTime() > now - 3_600_000) // not more than 1h in the past
        .slice(0, 10)
        .forEach((event) => {
          const calId = event.id || event.start;
          if (existingIds.has(calId)) return; // already in Life Graph

          createSignal(normalizeCalendarToSignal({
            id: calId,
            title: event.title || 'Calendar Event',
            start: event.start,
            end: event.end,
            location: event.location,
            calendarName: event.calendarName,
          }));
        });
    }
  } catch { /* offline */ }
}

// ── Run all connectors ───────────────────────────────────────────────────────

export async function runConnectors(): Promise<void> {
  await Promise.allSettled([
    refreshWeather(),
    refreshCalendar(),
  ]);
  window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
}
