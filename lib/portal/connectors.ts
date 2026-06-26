/**
 * Connectors — fetch live signals and write them to the shared cache.
 * Called once on TodayFeed mount. Results are read by the Reasoning Engine.
 */

import {
  fetchWeatherAt,
  readGeo,
  reverseGeocode,
} from './weather';
import { PORTAL_CACHE_KEYS, writePortalCache, readPortalCache } from './prefetch-cache';

const WEATHER_REFRESH_MS = 10 * 60_000; // 10 min

/** Fetch weather if cache is stale, write to PORTAL_CACHE_KEYS.weather */
export async function refreshWeather(): Promise<void> {
  // Check if cache is fresh enough (prefetch-cache TTL is 5min, but we want 10min for weather)
  const cached = readPortalCache<unknown>(PORTAL_CACHE_KEYS.weather);
  if (cached) return; // still fresh within 5min session TTL

  try {
    const pos = await readGeo(5_000);
    const { latitude: lat, longitude: lon } = pos.coords;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto';

    let placeName = '';
    try {
      const geo = await reverseGeocode(lat, lon);
      placeName = geo.label || geo.city || '';
    } catch {
      placeName = '';
    }

    const snapshot = await fetchWeatherAt(lat, lon, timezone, placeName);
    writePortalCache(PORTAL_CACHE_KEYS.weather, snapshot);

    // Dispatch so TodayFeed can re-render
    window.dispatchEvent(new CustomEvent('nesio-weather-updated', { detail: snapshot }));
  } catch {
    /* no geolocation permission or offline — silent */
  }
}

/** Fetch calendar events and write to cache */
export async function refreshCalendar(): Promise<void> {
  try {
    const res = await fetch('/api/portal/calendar', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json() as { events?: unknown[]; feeds?: unknown };
    if (data?.events || data?.feeds) {
      writePortalCache(PORTAL_CACHE_KEYS.calendar, data);
      window.dispatchEvent(new CustomEvent('nesio-calendar-updated', { detail: data }));
    }
  } catch {
    /* offline */
  }
}

/** Run all connectors in parallel — call once on app mount */
export async function runConnectors(): Promise<void> {
  await Promise.allSettled([
    refreshWeather(),
    refreshCalendar(),
  ]);
  // Notify reasoning engine to regenerate
  window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
}
