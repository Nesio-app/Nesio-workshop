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
  // 免费最大化·天气:Open-Meteo daily(此前只请求 current+hourly weather_code)
  tempMaxC?: number;     // 今日最高温
  tempMinC?: number;     // 今日最低温
  precipProb?: number;   // 今日降水概率 %(带伞判断)
  uvMax?: number;        // 今日 UV 峰值
  /** 写入缓存时的坐标 —— refreshWeather 用来判断要不要因位置变化重拉 */
  lat?: number;
  lon?: number;
  /** 接下来十几小时(从现在起)。点开天气详情用。 */
  hourly?: WeatherHour[];
  /** 未来几天(含今天)。 */
  days?: WeatherDay[];
}

export interface WeatherHour {
  at: string;
  tempC: number;
  condition: string;
  precipProb?: number;
}

export interface WeatherDay {
  date: string;
  minC: number;
  maxC: number;
  condition: string;
  precipProb?: number;
}

export interface WeatherPlaceHit {
  id: string;
  name: string;
  label: string;
  lat: number;
  lon: number;
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

function normalizeLocalPlaceName(raw: string): string {
  const t = simplifyPlaceName(raw)
    .replace(/^Town(ship)? of\s+/i, '')
    .replace(/\s+Township$/i, '')
    .trim();
  if (/^Cedar Fork$/i.test(t)) return 'Cary';
  return t;
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
): Promise<{ city: string; state: string; label: string; country: string } | null> {
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
    const city = normalizeLocalPlaceName(String(row.name || ''));
    const state = formatStateCode(String(row.admin1 || ''));
    const country = String(row.country_code || '').toUpperCase();
    const label = city && state ? `${city}, ${state}` : city || state;
    return city ? { city, state, label, country } : null;
  } catch {
    return null;
  }
}

export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<{ city: string; state: string; label: string; country: string }> {
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
    const city = normalizeLocalPlaceName(
      String(data.locality || data.city || ''),
    );
    const state = formatStateCode(
      String(data.principalSubdivisionCode || data.principalSubdivision || ''),
    );
    const country = String(data.countryCode || '').toUpperCase();
    const label = city && state ? `${city}, ${state}` : city || state;
    return { city, state, label, country };
  } catch {
    return { city: '', state: '', label: '', country: '' };
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
  url.searchParams.set('hourly', 'weather_code,temperature_2m,precipitation_probability');
  // 免费最大化·天气:今日区间 + 降水概率 + UV(免费),进简报「今天X~Y度,降水Z%」
  // 详情页要小时 + 未来几天,所以 daily 拉 7 天、hourly 带降水概率。
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,weather_code');
  url.searchParams.set('forecast_days', '7');
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

  // 免费最大化·天气:daily 是数组(forecast_days=1 → 取 [0])
  const num = (v: unknown): number | undefined => {
    const n = Number(Array.isArray(v) ? v[0] : v);
    return Number.isFinite(n) ? Math.round(n) : undefined;
  };
  const tempMaxC = num(data.daily?.temperature_2m_max);
  const tempMinC = num(data.daily?.temperature_2m_min);
  const precipProb = num(data.daily?.precipitation_probability_max);
  const uvMax = num(data.daily?.uv_index_max);

  const hourlyTimes: string[] = data.hourly?.time || [];
  const hourlyTemps: unknown[] = data.hourly?.temperature_2m || [];
  const hourlyPrecip: unknown[] = data.hourly?.precipitation_probability || [];
  const nowMs = Date.now();
  const hourly: WeatherHour[] = [];
  for (let i = 0; i < hourlyTimes.length; i++) {
    const t = new Date(hourlyTimes[i]).getTime();
    if (!Number.isFinite(t) || t < nowMs - 45 * 60_000) continue;
    const temp = Number(hourlyTemps[i]);
    hourly.push({
      at: hourlyTimes[i],
      tempC: Number.isFinite(temp) ? Math.round(temp) : tempC,
      condition: wmoLabel(Number(codes[i]) || currentCode),
      precipProb: Number.isFinite(Number(hourlyPrecip[i])) ? Math.round(Number(hourlyPrecip[i])) : undefined,
    });
    if (hourly.length >= 12) break;
  }

  const dayDates: string[] = data.daily?.time || [];
  const dayMax: unknown[] = data.daily?.temperature_2m_max || [];
  const dayMin: unknown[] = data.daily?.temperature_2m_min || [];
  const dayPrecip: unknown[] = data.daily?.precipitation_probability_max || [];
  const dayCode: unknown[] = data.daily?.weather_code || [];
  const days: WeatherDay[] = dayDates.map((date, i) => {
    const max = Number(dayMax[i]);
    const min = Number(dayMin[i]);
    return {
      date,
      minC: Number.isFinite(min) ? Math.round(min) : tempC,
      maxC: Number.isFinite(max) ? Math.round(max) : tempC,
      condition: wmoLabel(Number(dayCode[i]) || currentCode),
      precipProb: Number.isFinite(Number(dayPrecip[i])) ? Math.round(Number(dayPrecip[i])) : undefined,
    };
  }).filter((d) => d.date);

  // 降水概率高时,forecastNote 若无更具体转变提示,给「记得带伞」
  if (!forecastNote && typeof precipProb === 'number' && precipProb >= 50) {
    forecastNote = `今天有 ${precipProb}% 概率下雨,记得带伞`;
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
    tempMaxC,
    tempMinC,
    precipProb,
    uvMax,
    lat,
    lon,
    hourly,
    days,
  };
}

/** 按城市名搜可添加的天气地点(Open-Meteo 地理编码,零 key)。 */
export async function searchWeatherPlaces(q: string, language: 'zh' | 'en' = 'zh'): Promise<WeatherPlaceHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query);
  url.searchParams.set('count', '6');
  url.searchParams.set('language', language === 'en' ? 'en' : 'zh');
  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) return [];
  const data = await res.json() as { results?: Array<{ id?: number; name?: string; latitude?: number; longitude?: number; admin1?: string; country_code?: string }> };
  const rows = Array.isArray(data?.results) ? data.results : [];
  const out: WeatherPlaceHit[] = [];
  for (const row of rows) {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = normalizeLocalPlaceName(String(row.name || ''));
    if (!name) continue;
    const state = formatStateCode(String(row.admin1 || ''));
    const country = String(row.country_code || '').toUpperCase();
    const label = [name, state || country].filter(Boolean).join(', ');
    out.push({ id: `${lat.toFixed(3)},${lon.toFixed(3)}`, name, label, lat, lon });
  }
  return out;
}

export async function readGeo(timeoutMs = 4_000): Promise<GeolocationPosition> {
  const { getDevicePosition } = await import('../native-geolocation');
  const pos = await getDevicePosition({
    timeoutMs,
    maximumAgeMs: 60_000,
    enableHighAccuracy: true,
  });
  if (!pos) throw new Error('no geo');
  // 兼容旧调用方:拼一个近似 GeolocationPosition
  return {
    coords: {
      latitude: pos.lat,
      longitude: pos.lon,
      accuracy: pos.accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON() { return this; },
    },
    timestamp: pos.timestamp,
    toJSON() { return this; },
  } as GeolocationPosition;
}
