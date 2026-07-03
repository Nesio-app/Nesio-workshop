/**
 * Location store — last known device location, reverse-geocoded to a city label.
 * Client-side only. Refreshed opportunistically (chat open, weather fetch);
 * consumers read the cached value synchronously.
 */

import { readGeo, reverseGeocode } from './weather';

const KEY = 'nesio-last-location-v1';
// Re-geocode at most every 10 minutes — city-level context doesn't move faster.
const REFRESH_INTERVAL = 10 * 60 * 1000;

export interface StoredLocation {
  label: string; // "Cary, NC"
  city: string;
  lat: number;
  lon: number;
  ts: number;
}

export function loadLastLocation(): StoredLocation | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as StoredLocation | null;
    return raw?.label ? raw : null;
  } catch { return null; }
}

/**
 * Refresh the stored location if stale. Safe to fire-and-forget;
 * silently keeps the old value when permission is denied or geocoding fails.
 */
export async function refreshLocation(): Promise<StoredLocation | null> {
  if (typeof window === 'undefined') return null;
  const cached = loadLastLocation();
  if (cached && Date.now() - cached.ts < REFRESH_INTERVAL) return cached;

  try {
    const pos = await readGeo();
    const { latitude: lat, longitude: lon } = pos.coords;
    const geo = await reverseGeocode(lat, lon);
    if (!geo.label) return cached;
    const next: StoredLocation = { label: geo.label, city: geo.city, lat, lon, ts: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  } catch {
    return cached;
  }
}

export function formatLocationAge(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 2) return '刚刚定位';
  if (mins < 60) return `${mins}分钟前定位`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}小时前定位`;
  return `${Math.round(hours / 24)}天前定位`;
}
