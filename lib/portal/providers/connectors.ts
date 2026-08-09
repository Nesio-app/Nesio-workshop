/**
 * Connectors — fetch live signals and write to shared cache + Life Graph.
 * Called on TodayFeed mount. Results read by Reasoning Engine.
 */

import { fetchWeatherAt, reverseGeocode, type WeatherSnapshot } from './weather';
import { PORTAL_CACHE_KEYS, writePortalCache, readPortalCache } from '../prefetch-cache';
import { getLifeGraph } from '../life-graph';
import type { CalendarEvent } from '../types';
import { createSignal } from '../../life-domain/create-signal';
import { normalizeCalendarToSignal, normalizeWeatherToSignal, normalizeTeslaDriveToSignal, normalizeTeslaChargeToSignal } from '../../life-domain/normalizers';
import { recordLiveVisit, recordVisitAt } from '../place-trail';

// ── Weather ──────────────────────────────────────────────────────────────────

/** 两坐标相距超过 ~8km 视为换地方了,要重拉天气。 */
function weatherLocationStale(cached: WeatherSnapshot | null, lat: number, lon: number): boolean {
  if (!cached?.lat || !cached?.lon) return true;
  const dlat = (cached.lat - lat) * 111_000;
  const dlon = (cached.lon - lon) * 111_000 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dlat, dlon) > 8_000;
}

export async function refreshWeather(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const { getDevicePosition } = await import('../native-geolocation');
    const pos = await getDevicePosition({ timeoutMs: 8_000, maximumAgeMs: 60_000, enableHighAccuracy: true });
    if (!pos) return;
    const { lat, lon } = pos;
    let placeName = '';
    try {
      const geo = await reverseGeocode(lat, lon);
      placeName = geo.label || geo.city || '';
    } catch { /* ignore */ }

    // 地点足迹:每次拿到定位都记(2h 同地去重),不受天气缓存影响
    recordLiveVisit(placeName || `${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon);

    // 天气:缓存过期(>5min)或位置明显变化时才重拉 —— 仍用当前 GPS,不吃旧坐标。
    const cached = readPortalCache<WeatherSnapshot>(PORTAL_CACHE_KEYS.weather);
    if (!cached || weatherLocationStale(cached, lat, lon)) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto';
      const snapshot = await fetchWeatherAt(lat, lon, timezone, placeName);
      writePortalCache(PORTAL_CACHE_KEYS.weather, snapshot);
      createSignal(normalizeWeatherToSignal({ ...snapshot, placeName }));
      window.dispatchEvent(new CustomEvent('nesio-weather-updated', { detail: snapshot }));
    }
  } catch {
    /* permission denied / timeout / fetch failed */
  }
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

    // 足迹接线(用户定案:位置进足迹,不单开 tab)。车「停放」的位置记进地点流水
    // ——行驶中的瞬时点是路上噪声,不记;相邻停放点之间的驾驶腿由 buildDayJourney
    // 自动推断(已有 'drive' 模式)。充电会话按站点名 + 真实时间进流水(花费另走财务信号)。
    for (const d of (data.drives || [])) {
      const driving = d.shiftState === 'D' || d.shiftState === 'R';
      if (driving || d.latitude == null || d.longitude == null) continue;
      let label = `${d.latitude.toFixed(3)},${d.longitude.toFixed(3)}`;
      try { const g = await reverseGeocode(d.latitude, d.longitude); label = g.label || g.city || label; } catch { /* 坐标名兜底 */ }
      recordLiveVisit(label, d.latitude, d.longitude);
    }
    for (const c of (data.charges || [])) {
      if (c.location) recordVisitAt(c.location, c.at);
    }
    window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
  } catch { /* offline */ }
}

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

// ── Run all connectors ───────────────────────────────────────────────────────

export async function runConnectors(): Promise<void> {
  await Promise.allSettled([
    refreshWeather(),
    refreshCalendar(),
    shouldPollTesla() ? refreshTesla() : Promise.resolve(),
  ]);
  window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
}
