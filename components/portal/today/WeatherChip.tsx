'use client';

/**
 * WeatherChip — 首页顶栏天气符号(2026-08-01 用户点名;2026-08-11 改成可点详情)。
 *
 * 只读现成缓存(providers/weather.ts 的 fetchWeatherAt 结果,connectors.ts 的
 * refreshWeather 写入 PORTAL_CACHE_KEYS.weather)。点开看小时/未来几天/别的城市。
 */
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { WeatherSnapshot } from '@/lib/portal/providers/weather';
import '@/lib/portal/weather-places';
import { WeatherIcon } from '../icons';
import { L } from '@/lib/portal/i18n';
import { usePortalLocale } from '../use-portal-locale';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';

const WeatherSheet = dynamic(() => import('./WeatherSheet'), { ssr: false });

function readWeather(): WeatherSnapshot | null {
  return readPortalCache<WeatherSnapshot>(PORTAL_CACHE_KEYS.weather);
}

/** 顶栏小圆点:温度 + 图标。没有数据不渲染。点开详情。 */
export function WeatherChip() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setWeather(readWeather());
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<WeatherSnapshot>).detail;
      setWeather(detail || readWeather());
    };
    window.addEventListener('nesio-weather-updated', onUpdated);
    return () => window.removeEventListener('nesio-weather-updated', onUpdated);
  }, []);

  if (!weather) return null;

  return (
    <>
      <button
        type="button"
        className="nesio-today-weather"
        aria-label={L(dict, `${weather.placeLabel || ''} ${weather.temperatureC}度 ${weather.condition}`, `${weather.placeLabel || ''} ${weather.temperatureF}°F ${weather.condition}`)}
        onClick={() => setOpen(true)}
      >
        <WeatherIcon condition={weather.condition} size={14} />
        <span>{weather.temperatureC}°</span>
      </button>
      {open && <WeatherSheet here={weather} onClose={() => setOpen(false)} />}
    </>
  );
}

/** 极端天气预警条(NWS 实时预警,Severe/Extreme 优先) —— 有才渲染 */
export function WeatherAlertBanner() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [alert, setAlert] = useState<string | undefined>(() => readWeather()?.alert);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<WeatherSnapshot>).detail;
      setAlert(detail?.alert ?? readWeather()?.alert);
    };
    window.addEventListener('nesio-weather-updated', onUpdated);
    return () => window.removeEventListener('nesio-weather-updated', onUpdated);
  }, []);

  if (!alert) return null;

  return (
    <p className="nesio-today-weather-alert">
      {L(dict, `天气预警：${alert}`, `Weather alert: ${alert}`)}
    </p>
  );
}
