/**
 * 天气详情里「别的城市」——用户自己加的地点,换设备还在。
 */
import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';
import type { WeatherPlaceHit } from './providers/weather';

export const WEATHER_CITIES_KEY = 'nesio-weather-cities-v1';
export const WEATHER_CITIES_UPDATED = 'nesio-weather-cities-updated';

export type SavedWeatherCity = WeatherPlaceHit;

const MAX_CITIES = 4;

const store = createBlobStore<SavedWeatherCity[]>({
  key: WEATHER_CITIES_KEY,
  updateEvent: WEATHER_CITIES_UPDATED,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function loadWeatherCities(): SavedWeatherCity[] {
  const raw = store.load();
  return Array.isArray(raw) ? raw.slice(0, MAX_CITIES) : [];
}

export function addWeatherCity(hit: WeatherPlaceHit): { ok: true } | { ok: false; reason: 'full' | 'dup' } {
  const cur = loadWeatherCities();
  if (cur.some((c) => c.id === hit.id)) return { ok: false, reason: 'dup' };
  if (cur.length >= MAX_CITIES) return { ok: false, reason: 'full' };
  store.save([...cur, hit]);
  return { ok: true };
}

export function removeWeatherCity(id: string): void {
  store.save(loadWeatherCities().filter((c) => c.id !== id));
}
