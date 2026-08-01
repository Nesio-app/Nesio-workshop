'use client';

/**
 * WeatherChip — 首页顶栏天气符号(2026-08-01 用户点名)。
 *
 * 之前天气只作为日报/穿搭建议的输入数据,首页从没画出来过。这里只读现成缓存
 * (providers/weather.ts 的 fetchWeatherAt 结果,connectors.ts 的 refreshWeather
 * 写入 PORTAL_CACHE_KEYS.weather),不新起数据源;Portal.tsx 已加每小时 +
 * 回前台的定时刷新,这里只负责渲染 + 监听 'nesio-weather-updated' 活取新值。
 *
 * 温度符号是小圆点(常驻,点开看详情);极端天气预警是单独一行文字条,
 * 用 --status-risk(CLAUDE.md:仅真实安全/到期风险才用红色)。
 */
import { useEffect, useState } from 'react';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { WeatherSnapshot } from '@/lib/portal/providers/weather';
import { WeatherIcon } from '../icons';
import { L } from '@/lib/portal/i18n';
import { usePortalLocale } from '../use-portal-locale';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';

function readWeather(): WeatherSnapshot | null {
  return readPortalCache<WeatherSnapshot>(PORTAL_CACHE_KEYS.weather);
}

/** 顶栏小圆点:温度 + 图标。没有数据(未授权定位/还没拉到)不渲染,不占位。
 *  纯展示(暂无天气详情页可跳),用 span 不用 button —— 没有可点的地方就不该是个按钮壳。 */
export function WeatherChip() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);

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
    <span
      className="nesio-today-weather"
      role="img"
      aria-label={L(dict, `${weather.placeLabel || ''} ${weather.temperatureC}度 ${weather.condition}`, `${weather.placeLabel || ''} ${weather.temperatureF}°F ${weather.condition}`)}
      title={weather.forecastNote || ''}
    >
      <WeatherIcon condition={weather.condition} size={14} />
      <span>{weather.temperatureC}°</span>
    </span>
  );
}

/** 极端天气预警条(NWS 实时预警,Severe/Extreme 优先) —— 有才渲染,提前提醒不是提醒 */
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
