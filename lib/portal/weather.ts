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
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('localityLanguage', 'zh');
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('geo');
    const data = await res.json();
    return (
      data.locality ||
      data.city ||
      data.principalSubdivision ||
      data.countryName ||
      ''
    );
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

  const res = await fetch(url.toString());
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
  };
}

export function readGeo(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('no geo'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 12_000,
      maximumAge: 300_000,
    });
  });
}
