/**
 * Connectors — fetch live signals and write to shared cache + Life Graph.
 * Called on TodayFeed mount. Results read by Reasoning Engine.
 */

import { fetchWeatherAt, readGeo, reverseGeocode } from './weather';
import { PORTAL_CACHE_KEYS, writePortalCache, readPortalCache } from './prefetch-cache';
import { getLifeGraph } from './life-graph';
import type { CalendarEvent } from './types';
import { createSignal } from '../life-domain/create-signal';
import { normalizeCalendarToSignal, normalizeWeatherToSignal, normalizeTeslaDriveToSignal, normalizeTeslaChargeToSignal } from '../life-domain/normalizers';
import { recordLiveVisit } from './place-trail';

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

// ── Tesla → Life Graph ───────────────────────────────────────────────────────

type TeslaDriveDTO = Parameters<typeof normalizeTeslaDriveToSignal>[0];
type TeslaChargeDTO = Parameters<typeof normalizeTeslaChargeToSignal>[0];

/**
 * Read the Tesla snapshot and write drive/charge signals (deduped by
 * externalId). Accepts a prefetched payload so the sync button doesn't
 * pay for a second Tesla API round-trip.
 */
export async function refreshTesla(
  prefetched?: { drives?: TeslaDriveDTO[]; charges?: TeslaChargeDTO[] },
): Promise<void> {
  try {
    let data = prefetched;
    if (!data) {
      const res = await fetch('/api/portal/tesla', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json() as { ok?: boolean; drives?: TeslaDriveDTO[]; charges?: TeslaChargeDTO[] };
      if (!json.ok) return; // not_connected / token_expired — stay quiet
      data = json;
    }

    const existing = new Set(getLifeGraph()
      .map((n) => n.attributes['externalId'] as string)
      .filter(Boolean));

    (data.drives || []).forEach((d) => {
      const id = `tesla-drive-${d.vehicleId}-${d.at}`;
      if (existing.has(id)) return;
      createSignal(normalizeTeslaDriveToSignal(d));
    });
    (data.charges || []).forEach((c) => {
      const id = `tesla-charge-${c.vehicleId}-${c.at}`;
      if (existing.has(id)) return;
      createSignal(normalizeTeslaChargeToSignal(c));
    });
    window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
  } catch { /* offline */ }
}

// ── Run all connectors ───────────────────────────────────────────────────────

// Adaptive-polling nod (TezLab/TeslaMate lesson): don't ping Tesla on every
// mount. Poll at most every 15 min — the source changes slowly and each call
// costs API quota. Full sleep-aware backoff (tighten when moving, back off when
// parked) is a later refinement; this fixed floor already avoids the worst waste.
function shouldPollTesla(minMs = 15 * 60_000): boolean {
  try {
    const key = 'nesio-tesla-last-poll';
    const last = Number(localStorage.getItem(key) || '0');
    if (Date.now() - last < minMs) return false;
    localStorage.setItem(key, String(Date.now()));
    return true;
  } catch { return true; }
}

export async function runConnectors(): Promise<void> {
  await Promise.allSettled([
    refreshWeather(),
    refreshCalendar(),
    shouldPollTesla() ? refreshTesla() : Promise.resolve(),
  ]);
  window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
}
