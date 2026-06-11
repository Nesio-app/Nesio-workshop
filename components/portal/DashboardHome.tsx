'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatLunarLine, nextHolidayLine } from '@/lib/portal/almanac';
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
import ToolGrid from './ToolGrid';

interface DashboardHomeProps {
  config: PortalConfig;
  noteOpen?: boolean;
  onOpenNote: () => void;
  onOpenTool: (tool: PortalTool) => void;
}

const FAV_QUOTES_KEY = 'treasurebox-favorite-quotes';

interface WeatherState {
  temperature?: number;
  unit?: string;
  condition?: string;
  placeName?: string;
  forecastNote?: string;
  loading: boolean;
  error?: boolean;
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
  const [weather, setWeather] = useState<WeatherState>({ loading: true });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [calendarNote, setCalendarNote] = useState<string | null>(null);
  const [calendarFeeds, setCalendarFeeds] = useState<CalendarFeedStatus[]>([]);
  const [fidelityHintDismissed, setFidelityHintDismissed] = useState(false);
  const quotePicked = useRef(false);
  const [dailyQuote, setDailyQuote] = useState('今天也要好好照顾自己。');
  const [quoteSaved, setQuoteSaved] = useState(false);

  const lunarLine = useMemo(() => formatLunarLine(now), [now]);
  const holidayLine = useMemo(() => nextHolidayLine(now), [now]);

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
    try {
      const favs: string[] = JSON.parse(localStorage.getItem(FAV_QUOTES_KEY) || '[]');
      setQuoteSaved(Array.isArray(favs) && favs.includes(dailyQuote));
    } catch {
      setQuoteSaved(false);
    }
  }, [dailyQuote]);

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
    const pinToConfigCity =
      fallbackLocation.useConfigCity !== false && Boolean(configCity);

    async function applySnapshot(snap: Awaited<ReturnType<typeof fetchWeatherAt>>) {
      if (cancelled) return;
      setWeather({
        loading: false,
        temperature: snap.temperature,
        unit: snap.unit,
        condition: snap.condition,
        placeName: snap.placeName,
        forecastNote: snap.forecastNote,
      });
    }

    async function loadWeather(refineGeo: boolean) {
      if (!refineGeo) {
        setWeather((w) => ({ ...w, loading: true, error: false }));
      }
      try {
        let lat = fallbackLocation.latitude;
        let lon = fallbackLocation.longitude;
        let place = configCity;

        if (refineGeo && !pinToConfigCity) {
          try {
            const pos = await readGeo(3_500);
            lat = pos.coords.latitude;
            lon = pos.coords.longitude;
            const name = await reverseGeocode(lat, lon);
            if (name) place = simplifyPlaceName(name);
          } catch {
            /* keep config coords */
          }
        }

        const snap = await fetchWeatherAt(lat, lon, tz, place || configCity);
        await applySnapshot(snap);
      } catch {
        if (!cancelled && !refineGeo) {
          setWeather({ loading: false, error: true });
        }
      }
    }

    loadWeather(false);
    if (!pinToConfigCity) {
      window.setTimeout(() => loadWeather(true), 0);
    }
    const refresh = window.setInterval(() => loadWeather(false), 15 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
    };
  }, [
    fallbackLocation.latitude,
    fallbackLocation.longitude,
    fallbackLocation.city,
    fallbackLocation.timezone,
    fallbackLocation.useConfigCity,
  ]);

  useEffect(() => {
    fetch('/api/portal/calendar')
      .then((r) => r.json())
      .then((data) => {
        if (data.events?.length) setEvents(data.events);
        if (Array.isArray(data.feeds)) setCalendarFeeds(data.feeds);
        if (!data.configured && data.message) setCalendarNote(data.message);
        else if (data.error) setCalendarNote('日历暂时无法加载');
      })
      .catch(() => setCalendarNote('日历暂时无法加载'));
  }, []);

  const greeting = greetingForHour(now.getHours());
  const displayAvatar = avatarUrl || profile.avatarUrl;

  const toggleSaveQuote = () => {
    try {
      const raw = localStorage.getItem(FAV_QUOTES_KEY);
      const favs: string[] = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(favs) ? favs : [];
      if (list.includes(dailyQuote)) {
        localStorage.setItem(
          FAV_QUOTES_KEY,
          JSON.stringify(list.filter((q) => q !== dailyQuote)),
        );
        setQuoteSaved(false);
      } else {
        localStorage.setItem(FAV_QUOTES_KEY, JSON.stringify([dailyQuote, ...list].slice(0, 40)));
        setQuoteSaved(true);
      }
    } catch { /* ignore */ }
  };

  const quoteLine = useMemo(() => dailyQuote, [dailyQuote]);
  const cityName = weather.placeName || simplifyPlaceName(fallbackLocation.city);
  const upcomingEvents = useMemo(
    () => filterTodayAndTomorrowEvents(events, now),
    [events, now],
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
            <span className="portal-search-icon portal-icon-blue" aria-hidden>
              📝
            </span>
            <span className="portal-note-btn-label">{t(locale, 'noteLabel')}</span>
          </button>
        </div>
      </header>

      <section className="portal-quote" aria-label="今日话语">
        <p className="portal-quote-text">{quoteLine}</p>
        <button
          type="button"
          className={'portal-quote-save' + (quoteSaved ? ' portal-quote-save--on' : '')}
          onClick={toggleSaveQuote}
          aria-label={quoteSaved ? t(locale, 'quoteSaved') : t(locale, 'saveQuote')}
        >
          {quoteSaved ? '★' : '☆'}
        </button>
      </section>

      <section className="portal-widgets" aria-label="概览">
        <article className="portal-widget portal-widget--clock">
          <p className="portal-widget-clock">{formatClock(now)}</p>
          <p className="portal-widget-date">{formatDateLine(now)}</p>
          {lunarLine ? <p className="portal-widget-extra">{lunarLine}</p> : null}
          {holidayLine ? <p className="portal-widget-extra portal-widget-extra--holiday">{holidayLine}</p> : null}
        </article>

        <article className="portal-widget portal-widget--weather">
          {weather.loading ? (
            <p className="portal-widget-muted">{t(locale, 'weatherLoading')}</p>
          ) : weather.error ? (
            <p className="portal-widget-muted">{t(locale, 'weatherError')}</p>
          ) : (
            <>
              <p className="portal-widget-city">{cityName}</p>
              <p className="portal-widget-temp">
                {Math.round(weather.temperature ?? 0)}
                <span>{weather.unit || '°C'}</span>
              </p>
              <p className="portal-widget-muted">{weather.condition}</p>
              {weather.forecastNote ? (
                <p className="portal-widget-forecast">{weather.forecastNote}</p>
              ) : null}
            </>
          )}
        </article>
      </section>

      <ToolGrid tools={config.tools} onOpenTool={onOpenTool} />

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
                        {formatEventDayLabel(ev, now)}
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
    </div>
  );
}
