'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatLunarLine, nextHolidayLine, nextUSHolidayLine } from '@/lib/portal/almanac';
import { t } from '@/lib/portal/i18n';
import { pickFreshQuote } from '@/lib/portal/quotes';
import {
  loadProfileSettings,
  PROFILE_UPDATED_EVENT,
  type PortalLocale,
} from '@/lib/portal/profile';
import {
  filterTodayAndTomorrowEvents,
  formatEventDayLabel,
} from '@/lib/portal/calendar-filters';
import type { CalendarEvent, PortalConfig, PortalTool } from '@/lib/portal/types';
import { greetingForHour } from '@/lib/portal/greeting';
import {
  fetchWeatherAt,
  readGeo,
  reverseGeocode,
  simplifyPlaceName,
} from '@/lib/portal/weather';
import {
  PORTAL_CACHE_KEYS,
  readPortalCache,
  writePortalCache,
} from '@/lib/portal/prefetch-cache';
import ToolsTreasurePopup from './ToolsTreasureSheet';
import { DashboardNoteIcon, DashboardTreasureIcon } from './DashboardHeaderIcons';

interface DashboardHomeProps {
  config: PortalConfig;
  noteOpen?: boolean;
  treasureOpen: boolean;
  onTreasureOpenChange: (open: boolean) => void;
  onOpenNote: () => void;
  onOpenTool: (tool: PortalTool) => void;
}


interface WeatherState {
  temperatureC?: number;
  temperatureF?: number;
  condition?: string;
  placeLabel?: string;
  forecastNote?: string;
  alert?: string;
  loading: boolean;
  error?: boolean;
  geoResolved?: boolean;
}

function initials(name: string): string {
  const t = name.trim();
  return t.slice(0, 1) || '婧';
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDateLine(date: Date): string {
  return date.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

function formatEventTime(event: CalendarEvent): string {
  const start = new Date(event.start);
  if (event.allDay) return '全天';
  const end = event.end ? new Date(event.end) : null;
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
  const a = start.toLocaleTimeString('zh-CN', opts);
  if (!end) return a;
  return `${a} – ${end.toLocaleTimeString('zh-CN', opts)}`;
}

function formatEventCountdown(event: CalendarEvent, at: Date): string {
  const start = new Date(event.start);
  const endMs = event.end ? new Date(event.end).getTime() : start.getTime() + 3_600_000;

  if (event.allDay) {
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    const today = new Date(at);
    today.setHours(0, 0, 0, 0);
    const days = Math.round((startDay.getTime() - today.getTime()) / 86_400_000);
    if (days === 0) return '今天';
    if (days === 1) return '明天';
    if (days > 0) return `${days} 天后`;
    return '进行中';
  }

  const diff = start.getTime() - at.getTime();
  if (diff <= 0) {
    if (at.getTime() < endMs) return '进行中';
    return '已结束';
  }

  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `${mins} 分钟后`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem > 0 ? `${hours} 小时 ${rem} 分后` : `${hours} 小时后`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h > 0 ? `${days} 天 ${h} 小时后` : `${days} 天后`;
}

const CALENDAR_PREVIEW = 3;

interface CalendarFeedStatus {
  label: string;
  ok: boolean;
  count: number;
  error?: string;
}

const FIDELITY_HINT_KEY = 'treasurebox-fidelity-hint-dismissed';

export default function DashboardHome({
  config,
  noteOpen = false,
  treasureOpen,
  onTreasureOpenChange,
  onOpenNote,
  onOpenTool,
}: DashboardHomeProps) {
  const profile = config.profile ?? { displayName: '婧' };
  const [locale, setLocale] = useState<PortalLocale>('zh');
  const [displayName, setDisplayName] = useState(profile.displayName);
  const fallbackLocation = config.location ?? {
    city: '上海',
    latitude: 31.2304,
    longitude: 121.4737,
    timezone: 'Asia/Shanghai',
  };

  const [now, setNow] = useState(() => new Date());
  const [avatarUrl, setAvatarUrl] = useState('');
  const [weather, setWeather] = useState<WeatherState>(() => {
    const cached = readPortalCache<{
      temperatureC?: number;
      temperatureF?: number;
      condition?: string;
      placeLabel?: string;
      forecastNote?: string;
      alert?: string;
      geoResolved?: boolean;
    }>(PORTAL_CACHE_KEYS.weather);
    if (cached) {
      return { ...cached, loading: false };
    }
    return { loading: true };
  });
  const [events, setEvents] = useState<CalendarEvent[]>(() => {
    const cached = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
    return cached?.events?.length ? cached.events : [];
  });
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [calendarNote, setCalendarNote] = useState<string | null>(() => {
    const cached = readPortalCache<{ message?: string; configured?: boolean; error?: string }>(
      PORTAL_CACHE_KEYS.calendar,
    );
    if (cached && !cached.configured && cached.message) return cached.message;
    if (cached?.error) return '日历暂时无法加载';
    return null;
  });
  const [calendarFeeds, setCalendarFeeds] = useState<CalendarFeedStatus[]>(() => {
    const cached = readPortalCache<{ feeds?: CalendarFeedStatus[] }>(PORTAL_CACHE_KEYS.calendar);
    return cached?.feeds ?? [];
  });
  const [fidelityHintDismissed, setFidelityHintDismissed] = useState(false);
  const quotePicked = useRef(false);
  const [dailyQuote, setDailyQuote] = useState('今天也要好好照顾自己。');
  const lunarLine = useMemo(() => formatLunarLine(now), [now]);
  const holidayLine = useMemo(() => nextHolidayLine(now), [now]);
  const usHolidayLine = useMemo(() => nextUSHolidayLine(now), [now]);

  const syncProfile = () => {
    const s = loadProfileSettings(profile.displayName);
    setDisplayName(s.displayName);
    setAvatarUrl(s.avatarUrl || profile.avatarUrl || '');
    setLocale(s.locale);
    document.documentElement.lang = s.locale === 'en' ? 'en' : 'zh-CN';
  };

  useEffect(() => {
    syncProfile();
    const onUpdate = () => syncProfile();
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdate);
  }, [profile.avatarUrl, profile.displayName]);

  useEffect(() => {
    if (quotePicked.current) return;
    quotePicked.current = true;
    setDailyQuote(pickFreshQuote(config));
  }, [config]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      setFidelityHintDismissed(
        sessionStorage.getItem(FIDELITY_HINT_KEY) === '1',
      );
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tz = fallbackLocation.timezone || 'Asia/Shanghai';
    const configCity = simplifyPlaceName(fallbackLocation.city);
    const configState = fallbackLocation.state?.trim() || '';
    const configPlaceLabel = configState
      ? `${configCity}, ${configState}`
      : configCity;
    const pinToConfigCity = fallbackLocation.useConfigCity === true;

    async function applySnapshot(
      snap: Awaited<ReturnType<typeof fetchWeatherAt>>,
      geoResolved: boolean,
    ) {
      if (cancelled) return;
      const next: WeatherState = {
        loading: false,
        temperatureC: snap.temperatureC,
        temperatureF: snap.temperatureF,
        condition: snap.condition,
        placeLabel: snap.placeLabel,
        forecastNote: snap.forecastNote,
        alert: snap.alert,
        geoResolved,
      };
      setWeather(next);
      writePortalCache(PORTAL_CACHE_KEYS.weather, next);
    }

    async function loadWeather(useGeo: boolean) {
      if (!useGeo && !readPortalCache(PORTAL_CACHE_KEYS.weather)) {
        setWeather((w) => ({ ...w, loading: true, error: false }));
      }
      try {
        let lat = fallbackLocation.latitude;
        let lon = fallbackLocation.longitude;
        let placeLabel = configPlaceLabel;

        if (useGeo) {
          try {
            const pos = await readGeo(8_000);
            lat = pos.coords.latitude;
            lon = pos.coords.longitude;
            const geo = await reverseGeocode(lat, lon);
            if (geo.label) placeLabel = geo.label;
            const snap = await fetchWeatherAt(lat, lon, tz, placeLabel);
            await applySnapshot(snap, true);
            return;
          } catch {
            /* fall back to config coords */
          }
        }

        const snap = await fetchWeatherAt(lat, lon, tz, placeLabel);
        await applySnapshot(snap, false);
      } catch {
        if (!cancelled && !useGeo) {
          setWeather({ loading: false, error: true });
        }
      }
    }

    loadWeather(!pinToConfigCity);
    if (!pinToConfigCity) {
      void fetchWeatherAt(
        fallbackLocation.latitude,
        fallbackLocation.longitude,
        tz,
        configPlaceLabel,
      ).then((snap) => applySnapshot(snap, false));
    }
    const refresh = window.setInterval(
      () => loadWeather(!pinToConfigCity),
      15 * 60_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
    };
  }, [
    fallbackLocation.latitude,
    fallbackLocation.longitude,
    fallbackLocation.city,
    fallbackLocation.timezone,
    fallbackLocation.state,
    fallbackLocation.useConfigCity,
  ]);

  useEffect(() => {
    fetch('/api/portal/calendar')
      .then((r) => r.json())
      .then((data) => {
        writePortalCache(PORTAL_CACHE_KEYS.calendar, data);
        if (data.events?.length) setEvents(data.events);
        if (Array.isArray(data.feeds)) setCalendarFeeds(data.feeds);
        if (!data.configured && data.message) setCalendarNote(data.message);
        else if (data.error) setCalendarNote('日历暂时无法加载');
        else setCalendarNote(null);
      })
      .catch(() => setCalendarNote('日历暂时无法加载'));
  }, []);

  const greeting = greetingForHour(now.getHours());
  const displayAvatar = avatarUrl || profile.avatarUrl;

  const quoteLine = useMemo(() => dailyQuote, [dailyQuote]);
  const placeLabel =
    weather.placeLabel ||
    (fallbackLocation.state
      ? `${simplifyPlaceName(fallbackLocation.city)}, ${fallbackLocation.state}`
      : simplifyPlaceName(fallbackLocation.city));
  const calendarTz = fallbackLocation.timezone || 'Asia/Shanghai';
  const upcomingEvents = useMemo(
    () => filterTodayAndTomorrowEvents(events, now, calendarTz),
    [events, now, calendarTz],
  );
  const visibleEvents = calendarExpanded
    ? upcomingEvents
    : upcomingEvents.slice(0, CALENDAR_PREVIEW);
  const hasMoreEvents = upcomingEvents.length > CALENDAR_PREVIEW;
  const fidelityFeed = calendarFeeds.find((f) => f.label === 'Fidelity');
  const googleOk = calendarFeeds.some((f) => f.label === 'Google' && f.ok);
  const showFidelityHint =
    fidelityFeed && !fidelityFeed.ok && !fidelityHintDismissed;
  const dismissFidelityHint = () => {
    setFidelityHintDismissed(true);
    try {
      sessionStorage.setItem(FIDELITY_HINT_KEY, '1');
    } catch { /* ignore */ }
  };

  return (
    <div className="portal-dash">
      <header className="portal-dash-hero">
        <Link className="portal-avatar-link" href="/settings" aria-label={t(locale, 'openSettings')}>
          {displayAvatar ? (
            <img className="portal-dash-avatar" src={displayAvatar} alt="" width={48} height={48} />
          ) : (
            <div className="portal-dash-avatar portal-dash-avatar--initials" aria-hidden>
              {initials(displayName)}
            </div>
          )}
        </Link>

        <div className="portal-dash-greeting">
          <p className="portal-dash-greeting-line">{greeting}</p>
          <p className="portal-dash-greeting-name">{displayName}</p>
        </div>

        <div className="portal-dash-hero-end">
          <button
            type="button"
            className={
              'portal-search-btn portal-search-btn--note' +
              (noteOpen ? ' portal-search-btn--active' : '')
            }
            onClick={onOpenNote}
            aria-label={t(locale, 'openNote')}
            aria-expanded={noteOpen}
          >
            <DashboardNoteIcon />
          </button>
        </div>
      </header>

      <section className="portal-quote" aria-label="今日话语">
        <p className="portal-quote-text">{quoteLine}</p>
        <button
          type="button"
          className={'portal-quote-treasure' + (treasureOpen ? ' portal-quote-treasure--open' : '')}
          onClick={() => onTreasureOpenChange(!treasureOpen)}
          aria-label="打开宝盒工具"
          aria-expanded={treasureOpen}
        >
          <span className="portal-quote-treasure-box" aria-hidden>
            <DashboardTreasureIcon />
          </span>
        </button>
      </section>

      <section className="portal-widgets" aria-label="概览">
        <article className="portal-widget portal-widget--clock">
          <p className="portal-widget-clock">{formatClock(now)}</p>
          <p className="portal-widget-date">{formatDateLine(now)}</p>
          {lunarLine ? <p className="portal-widget-lunar">{lunarLine}</p> : null}
          {(holidayLine || usHolidayLine) ? (
            <div className="portal-widget-chips">
              {holidayLine ? (
                <span className="portal-widget-chip portal-widget-chip--cn">{holidayLine}</span>
              ) : null}
              {usHolidayLine ? (
                <span className="portal-widget-chip portal-widget-chip--us">{usHolidayLine}</span>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="portal-widget portal-widget--weather">
          {weather.loading ? (
            <div className="portal-widget-skeleton" aria-hidden>
              <span className="portal-widget-skeleton-line portal-widget-skeleton-line--lg" />
              <span className="portal-widget-skeleton-line portal-widget-skeleton-line--sm" />
              <span className="portal-widget-skeleton-line portal-widget-skeleton-line--xs" />
            </div>
          ) : weather.error ? (
            <p className="portal-widget-muted">{t(locale, 'weatherError')}</p>
          ) : (
            <>
              <p className="portal-widget-weather-line portal-widget-weather-line--primary">
                <span className="portal-widget-temp-val">{weather.temperatureC ?? 0}</span>
                <span className="portal-widget-temp-unit">°C</span>
                <span className="portal-widget-temp-sep">/</span>
                <span className="portal-widget-temp-val">{weather.temperatureF ?? 0}</span>
                <span className="portal-widget-temp-unit">°F</span>
                {weather.condition ? (
                  <span className="portal-widget-condition">{weather.condition}</span>
                ) : null}
              </p>
              <p className="portal-widget-place">{placeLabel}</p>
              {weather.forecastNote ? (
                <p className="portal-widget-forecast">{weather.forecastNote}</p>
              ) : null}
              {weather.alert ? (
                <p className="portal-widget-alert" role="status">
                  ⚠ {weather.alert}
                </p>
              ) : null}
            </>
          )}
        </article>
      </section>

      <section className="portal-calendar" aria-label="日历">
        <h2 className="portal-calendar-head">{t(locale, 'calendar')}</h2>
        {showFidelityHint ? (
          <div className="portal-calendar-feed-hint" role="status">
            <span>
              {googleOk
                ? 'Fidelity 日历未同步'
                : 'Fidelity 日历未同步，请检查 Vercel 环境变量 FIDELITY'}
              {fidelityFeed?.error ? `（${fidelityFeed.error}）` : ''}
            </span>
            <button
              type="button"
              className="portal-calendar-feed-dismiss"
              onClick={dismissFidelityHint}
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        ) : null}

        {upcomingEvents.length === 0 ? (
          <p className="portal-calendar-empty">
            {calendarNote || t(locale, 'calendarEmpty')}
          </p>
        ) : (
          <ul className="portal-calendar-list">
            {visibleEvents.map((ev) => (
              <li key={ev.id} className="portal-calendar-event">
                <span className="portal-calendar-dot" aria-hidden />
                <div className="portal-calendar-body">
                  <p className="portal-calendar-line">
                    <span className="portal-calendar-title">{ev.title}</span>
                    <span className="portal-calendar-schedule">
                      <span className="portal-calendar-date">
                        {formatEventDayLabel(ev, now, calendarTz)}
                      </span>
                      <span className="portal-calendar-time">{formatEventTime(ev)}</span>
                    </span>
                  </p>
                  <p className="portal-calendar-meta">
                    <span className="portal-calendar-countdown">
                      {formatEventCountdown(ev, now)}
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {hasMoreEvents ? (
          <button
            type="button"
            className="portal-calendar-more"
            onClick={() => setCalendarExpanded((v) => !v)}
          >
            {calendarExpanded
              ? t(locale, 'calendarCollapse')
              : `${t(locale, 'calendarMore')}（${upcomingEvents.length - CALENDAR_PREVIEW}）`}
          </button>
        ) : null}
      </section>

      <ToolsTreasurePopup
        tools={config.tools}
        open={treasureOpen}
        onClose={() => onTreasureOpenChange(false)}
        onOpenTool={onOpenTool}
      />
    </div>
  );
}
