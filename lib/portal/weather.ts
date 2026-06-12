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
  temperature: number;
  unit: string;
  condition: string;
  placeName: string;
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

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('localityLanguage', 'en');
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) throw new Error('geo');
    const data = await res.json();
    const place = data.city || data.locality || '';
    return simplifyPlaceName(place);
  } catch {
    return '';
  }
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
  const temp = data.current?.temperature_2m ?? 0;
  const unit = data.current_units?.temperature_2m || '°C';

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

  return {
    temperature: temp,
    unit,
    condition: wmoLabel(currentCode),
    placeName: fallbackPlace,
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
      enableHighAccuracy: false,
      timeout: timeoutMs,
      maximumAge: 300_000,
    });
  });
}
