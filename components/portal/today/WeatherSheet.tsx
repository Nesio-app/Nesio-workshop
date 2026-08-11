'use client';

/**
 * 首页天气详情:当前城市的小时 + 未来几天,以及用户添加的别的城市。
 * 数据走 Open-Meteo(fetchWeatherAt),不新起付费源。
 */

import { useCallback, useEffect, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { WeatherIcon } from '../icons';
import { L } from '@/lib/portal/i18n';
import { usePortalLocale } from '../use-portal-locale';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import {
  fetchWeatherAt, searchWeatherPlaces,
  type WeatherSnapshot, type WeatherPlaceHit,
} from '@/lib/portal/providers/weather';
import { readPortalCache, writePortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import {
  addWeatherCity, loadWeatherCities, removeWeatherCity, WEATHER_CITIES_UPDATED,
  type SavedWeatherCity,
} from '@/lib/portal/weather-places';

function cityCacheKey(id: string): string {
  return `${PORTAL_CACHE_KEYS.weather}:${id}`;
}

function hourLabel(iso: string, en: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  return en ? `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}` : `${h}时`;
}

function dayLabel(ymd: string, en: boolean): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  if (en) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${'日一二三四五六'[d.getDay()]} · ${d.getMonth() + 1}月${d.getDate()}日`;
}

function WeatherBody({
  snap, dict, onRetry, err,
}: {
  snap: WeatherSnapshot | null;
  dict: 'zh' | 'en';
  onRetry?: () => void;
  err?: string;
}) {
  if (err) {
    return (
      <div className="nesio-weather-fail">
        <p>{err}</p>
        {onRetry ? (
          <button type="button" className="nesio-weather-retry" onClick={onRetry}>
            {L(dict, '再试一次', 'Try again')}
          </button>
        ) : null}
      </div>
    );
  }
  if (!snap) {
    return <p className="nesio-weather-muted">{L(dict, '正在取天气…', 'Loading weather…')}</p>;
  }
  return (
    <>
      <p className="nesio-weather-now">
        <WeatherIcon condition={snap.condition} size={22} />
        <span className="nesio-weather-now-temp">{snap.temperatureC}°</span>
        <span>
          {snap.condition}
          {typeof snap.tempMinC === 'number' && typeof snap.tempMaxC === 'number'
            ? ` · ${snap.tempMinC}~${snap.tempMaxC}°`
            : ''}
        </span>
      </p>
      {snap.forecastNote ? <p className="nesio-weather-note">{snap.forecastNote}</p> : null}
      {snap.hourly?.length ? (
        <div className="nesio-weather-hours" role="list">
          {snap.hourly.map((h) => (
            <div key={h.at} className="nesio-weather-hour" role="listitem">
              <span>{hourLabel(h.at, dict === 'en')}</span>
              <WeatherIcon condition={h.condition} size={16} />
              <strong>{h.tempC}°</strong>
              {typeof h.precipProb === 'number' && h.precipProb >= 30 ? <em>{h.precipProb}%</em> : null}
            </div>
          ))}
        </div>
      ) : null}
      {snap.days?.length ? (
        <ul className="nesio-weather-days">
          {snap.days.map((d) => (
            <li key={d.date}>
              <span>{dayLabel(d.date, dict === 'en')}</span>
              <WeatherIcon condition={d.condition} size={14} />
              <span>{d.minC}~{d.maxC}°</span>
              {typeof d.precipProb === 'number' ? <em>{d.precipProb}%</em> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export default function WeatherSheet({
  here, onClose,
}: {
  here: WeatherSnapshot | null;
  onClose: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [cities, setCities] = useState<SavedWeatherCity[]>(() => loadWeatherCities());
  const [active, setActive] = useState<'here' | string>('here');
  const [snaps, setSnaps] = useState<Record<string, WeatherSnapshot>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<WeatherPlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [hereSnap, setHereSnap] = useState<WeatherSnapshot | null>(here);
  const [hereErr, setHereErr] = useState('');

  useEffect(() => {
    const onUpd = () => setCities(loadWeatherCities());
    window.addEventListener(WEATHER_CITIES_UPDATED, onUpd);
    return () => window.removeEventListener(WEATHER_CITIES_UPDATED, onUpd);
  }, []);

  const loadHere = useCallback(async (force = false) => {
    const base = here;
    if (!base) return;
    if (!force && base.hourly?.length && base.days?.length) {
      setHereSnap(base);
      setHereErr('');
      return;
    }
    if (typeof base.lat !== 'number' || typeof base.lon !== 'number') {
      setHereSnap(base);
      return;
    }
    try {
      const snap = await fetchWeatherAt(base.lat, base.lon, 'auto', base.placeLabel || base.placeName);
      writePortalCache(PORTAL_CACHE_KEYS.weather, snap);
      window.dispatchEvent(new CustomEvent('nesio-weather-updated', { detail: snap }));
      setHereSnap(snap);
      setHereErr('');
    } catch {
      setHereSnap(base);
      if (!base.hourly?.length) {
        setHereErr(L(dict, '没取到小时预报,稍后再试。', 'Could not load the hourly forecast. Try again.'));
      }
    }
  }, [here, dict]);

  const loadCity = useCallback(async (city: SavedWeatherCity) => {
    const cached = readPortalCache<WeatherSnapshot>(cityCacheKey(city.id));
    if (cached?.hourly?.length && cached?.days?.length) {
      setSnaps((p) => ({ ...p, [city.id]: cached }));
      setErrs((p) => { const n = { ...p }; delete n[city.id]; return n; });
      return;
    }
    try {
      const snap = await fetchWeatherAt(city.lat, city.lon, 'auto', city.label);
      writePortalCache(cityCacheKey(city.id), snap);
      setSnaps((p) => ({ ...p, [city.id]: snap }));
      setErrs((p) => { const n = { ...p }; delete n[city.id]; return n; });
    } catch {
      setErrs((p) => ({ ...p, [city.id]: L(dict, '没取到天气,稍后再试。', 'Could not load weather. Try again.') }));
    }
  }, [dict]);

  useEffect(() => { void loadHere(); }, [loadHere]);

  useEffect(() => {
    for (const c of cities) void loadCity(c);
  }, [cities, loadCity]);

  async function runSearch() {
    const query = q.trim();
    if (query.length < 2) return;
    setSearching(true);
    setSearchErr('');
    try {
      const found = await searchWeatherPlaces(query, dict);
      setHits(found);
      if (!found.length) setSearchErr(L(dict, '没找到这个地方。', 'No matching place.'));
    } catch {
      setSearchErr(L(dict, '搜索没成功,再试一次。', 'Search failed. Try again.'));
    } finally {
      setSearching(false);
    }
  }

  function onAdd(hit: WeatherPlaceHit) {
    const r = addWeatherCity(hit);
    if (!r.ok) {
      setSearchErr(r.reason === 'full'
        ? L(dict, '最多再看 4 个城市。', 'Up to 4 extra cities.')
        : L(dict, '已经加过了。', 'Already added.'));
      return;
    }
    setQ('');
    setHits([]);
    setActive(hit.id);
  }

  const snap = active === 'here' ? hereSnap : snaps[active] || null;
  const err = active === 'here' ? (hereErr || undefined) : errs[active];
  const city = cities.find((c) => c.id === active);

  return (
    <NesioSheet
      variant="bottom"
      open
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-settings-sheet-card"
      ariaLabel={L(dict, '天气', 'Weather')}
    >
      <div className="nesio-brief-head">
        <div>
          <p className="nesio-brief-greeting">{L(dict, '天气', 'Weather')}</p>
          <p className="nesio-brief-date">
            {active === 'here'
              ? (here?.placeLabel || L(dict, '这里', 'Here'))
              : (city?.label || '')}
          </p>
        </div>
        <button type="button" className="nesio-voice-sheet-close" onClick={onClose}
          aria-label={L(dict, '关闭', 'Close')}>✕</button>
      </div>
      <div className="nesio-settings-sheet-body nesio-weather-sheet">
        <div className="nesio-weather-tabs">
          <button
            type="button"
            className={`nesio-weather-tab${active === 'here' ? ' is-on' : ''}`}
            onClick={() => setActive('here')}
          >
            {here?.placeName || L(dict, '这里', 'Here')}
          </button>
          {cities.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`nesio-weather-tab${active === c.id ? ' is-on' : ''}`}
              onClick={() => setActive(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <WeatherBody
          snap={snap}
          dict={dict}
          err={err}
          onRetry={active === 'here'
            ? () => void loadHere(true)
            : (city ? () => void loadCity(city) : undefined)}
        />

        {active !== 'here' && city ? (
          <button type="button" className="nesio-weather-remove" onClick={() => {
            removeWeatherCity(city.id);
            setActive('here');
          }}>
            {L(dict, '去掉这个城市', 'Remove this city')}
          </button>
        ) : null}

        <div className="nesio-weather-add">
          <p className="nesio-weather-add-label">{L(dict, '再看一个城市', 'Add another city')}</p>
          <form
            className="nesio-weather-search"
            onSubmit={(e) => { e.preventDefault(); void runSearch(); }}
          >
            <input
              className="nesio-ob-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L(dict, '城市名', 'City name')}
              aria-label={L(dict, '城市名', 'City name')}
            />
            <button type="submit" className="nesio-weather-retry" disabled={searching || q.trim().length < 2}>
              {searching ? L(dict, '在找…', 'Searching…') : L(dict, '找', 'Search')}
            </button>
          </form>
          {searchErr ? <p className="nesio-weather-muted">{searchErr}</p> : null}
          {hits.length ? (
            <ul className="nesio-weather-hits">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => onAdd(h)}>{h.label}</button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </NesioSheet>
  );
}
