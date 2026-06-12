const WMO: Record<number, string> = {
  0: '晴',
  1: '大部晴朗',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  80: '阵雨',
  95: '雷雨',
};

export function wmoLabel(code: number): string {
  return WMO[code] || '未知';
}

export interface WeatherSnapshot {
  temperatureC: number;
  temperatureF: number;
  condition: string;
  placeName: string;
  placeState?: string;
  placeLabel: string;
  forecastNote?: string;
  alert?: string;
}

const FETCH_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function simplifyPlaceName(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const first = t.split(',')[0].split('，')[0].trim();
  return first;
}

async function fetchNWSAlert(lat: number, lon: number): Promise<string | undefined> {
  try {
    const url = `https://api.weather.gov/alerts/active?point=${lat},${lon}`;
    const res = await fetchWithTimeout(url, {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': 'PersonalWeb/1.0 (treasurebox portal)',
      },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    const features = data?.features;
    if (!Array.isArray(features) || features.length === 0) return undefined;

    const severe = features.find(
      (f: { properties?: { severity?: string } }) =>
        f.properties?.severity === 'Extreme' || f.properties?.severity === 'Severe',
    );
    const pick = severe || features[0];
    const props = pick?.properties;
    if (!props) return undefined;

    const event = props.event || props.headline;
    if (!event) return undefined;
    const headline = String(event).trim();
    return headline.length > 80 ? `${headline.slice(0, 77)}…` : headline;
  } catch {
    return undefined;
  }
}

function formatStateCode(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^US-[A-Z]{2}$/i.test(t)) return t.slice(3).toUpperCase();
  if (/^[A-Z]{2}$/.test(t)) return t;
  return t;
}

async function reverseGeocodeOpenMeteo(
  lat: number,
  lon: number,
): Promise<{ city: string; state: string; label: string } | null> {
  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/reverse');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const row = data?.results?.[0];
    if (!row) return null;
    const city = simplifyPlaceName(String(row.name || ''));
    const state = formatStateCode(String(row.admin1 || ''));
    const label = city && state ? `${city}, ${state}` : city || state;
    return city ? { city, state, label } : null;
  } catch {
    return null;
  }
}

export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<{ city: string; state: string; label: string }> {
  const openMeteo = await reverseGeocodeOpenMeteo(lat, lon);
  if (openMeteo) return openMeteo;

  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('localityLanguage', 'en');
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) throw new Error('geo');
    const data = await res.json();
    // Prefer suburb/town (locality) over metro name (city) — e.g. Cary not Raleigh.
    const city = simplifyPlaceName(
      String(data.locality || data.city || ''),
    );
    const state = formatStateCode(
      String(data.principalSubdivisionCode || data.principalSubdivision || ''),
    );
    const label = city && state ? `${city}, ${state}` : city || state;
    return { city, state, label };
  } catch {
    return { city: '', state: '', label: '' };
  }
}

function celsiusToFahrenheit(c: number): number {
  return c * (9 / 5) + 32;
}

export async function fetchWeatherAt(
  lat: number,
  lon: number,
  timezone: string,
  fallbackPlace: string,
): Promise<WeatherSnapshot> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,weather_code');
  url.searchParams.set('hourly', 'weather_code,temperature_2m');
  url.searchParams.set('forecast_hours', '24');
  url.searchParams.set('timezone', timezone);

  const [res, alert] = await Promise.all([
    fetchWithTimeout(url.toString()),
    fetchNWSAlert(lat, lon),
  ]);
  if (!res.ok) throw new Error('weather');
  const data = await res.json();

  const currentCode = Number(data.current?.weather_code) || 0;
  const tempC = Math.round(Number(data.current?.temperature_2m) || 0);
  const tempF = Math.round(celsiusToFahrenheit(tempC));

  let forecastNote: string | undefined;
  const codes: number[] = data.hourly?.weather_code || [];
  const times: string[] = data.hourly?.time || [];

  for (let i = 1; i < Math.min(codes.length, 24); i++) {
    if (codes[i] !== currentCode) {
      const then = new Date(times[i]);
      const diffH = Math.max(1, Math.round((then.getTime() - Date.now()) / 3_600_000));
      forecastNote = `约 ${diffH} 小时后转${wmoLabel(codes[i])}`;
      break;
    }
  }

  const placeParts = fallbackPlace.split(',').map((s) => s.trim()).filter(Boolean);
  const placeName = placeParts[0] || fallbackPlace;
  const placeState = placeParts[1] || '';

  return {
    temperatureC: tempC,
    temperatureF: tempF,
    condition: wmoLabel(currentCode),
    placeName,
    placeState,
    placeLabel: placeState ? `${placeName}, ${placeState}` : placeName,
    forecastNote,
    alert,
  };
}

export function readGeo(timeoutMs = 4_000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('no geo'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 60_000,
    });
  });
}
