/**
 * Location store — last known device location, reverse-geocoded to a city label.
 * Client-side only. Refreshed opportunistically (chat open, weather fetch);
 * consumers read the cached value synchronously.
 *
 * 批次 P2-geo:从 localStorage 迁到 IDB blob-store,减少 5MB 配额压力。
 */

import { readGeo, reverseGeocode } from './weather';
import { relativePastLabel } from './time-labels';
import { createBlobStore } from './idb-blob-store';

// Re-geocode at most every 10 minutes — city-level context doesn't move faster.
const REFRESH_INTERVAL = 10 * 60 * 1000;

export interface StoredLocation {
  label: string; // "Cary, NC"
  city: string;
  lat: number;
  lon: number;
  ts: number;
}

const locStore = createBlobStore<StoredLocation>({
  key: 'nesio-last-location-v1',
  updateEvent: 'nesio-last-location-updated',
  validate: (v) => v != null && typeof (v as StoredLocation).label === 'string',
});

export function loadLastLocation(): StoredLocation | null {
  if (typeof window === 'undefined') return null;
  return locStore.load();
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
    locStore.save(next);
    return next;
  } catch {
    return cached;
  }
}

export function formatLocationAge(ts: number): string {
  return `${relativePastLabel(ts)}定位`;
}
