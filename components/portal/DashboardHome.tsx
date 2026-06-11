'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatLunarLine, nextHolidayLine } from '@/lib/portal/almanac';
import { pickFreshQuote } from '@/lib/portal/quotes';
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

export default function DashboardHome({
  config,
  onOpenNote,
  onOpenTool,
}: DashboardHomeProps) {
  const profile = config.profile ?? { displayName: '婧' };
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
  const [calendarNote, setCalendarNote] = useState<string | null>(null);
  const quotePicked = useRef(false);
  const [dailyQuote, setDailyQuote] = useState('今天也要好好照顾自己。');
  const [quoteSaved, setQuoteSaved] = useState(false);

  const lunarLine = useMemo(() => formatLunarLine(now), [now]);
  const holidayLine = useMemo(() => nextHolidayLine(now), [now]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('treasurebox-profile-avatar');
      if (saved) setAvatarUrl(saved);
      else if (profile.avatarUrl) setAvatarUrl(profile.avatarUrl);
    } catch { /* ignore */ }
  }, [profile.avatarUrl]);

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
    let cancelled = false;
    const tz = fallbackLocation.timezone || 'Asia/Shanghai';

    async function loadWeather() {
      setWeather((w) => ({ ...w, loading: true, error: false }));
      try {
        let lat = fallbackLocation.latitude;
        let lon = fallbackLocation.longitude;
        let place = simplifyPlaceName(fallbackLocation.city);

        try {
          const pos = await readGeo();
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          const name = await reverseGeocode(lat, lon);
          if (name) place = simplifyPlaceName(name);
        } catch {
          /* use fallback coords */
        }

        const snap = await fetchWeatherAt(lat, lon, tz, place);
        if (!cancelled) {
          setWeather({
            loading: false,
            temperature: snap.temperature,
            unit: snap.unit,
            condition: snap.condition,
            placeName: snap.placeName,
            forecastNote: snap.forecastNote,
          });
        }
      } catch {
        if (!cancelled) setWeather({ loading: false, error: true });
      }
    }

    loadWeather();
    const refresh = window.setInterval(loadWeather, 15 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
    };
  }, [
    fallbackLocation.latitude,
    fallbackLocation.longitude,
    fallbackLocation.city,
    fallbackLocation.timezone,
  ]);

  useEffect(() => {
    fetch('/api/portal/calendar')
      .then((r) => r.json())
      .then((data) => {
        if (data.events?.length) setEvents(data.events);
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

  return (
    <div className="portal-dash">
      <header className="portal-dash-hero">
        <Link className="portal-avatar-link" href="/portfolio" aria-label="关于我">
          {displayAvatar ? (
            <img className="portal-dash-avatar" src={displayAvatar} alt="" width={48} height={48} />
          ) : (
            <div className="portal-dash-avatar portal-dash-avatar--initials" aria-hidden>
              {initials(profile.displayName)}
            </div>
          )}
        </Link>

        <p className="portal-dash-greeting">
          {greeting}，{profile.displayName}
        </p>

        <div className="portal-dash-hero-end">
          <Link className="portal-dash-toplink-inline" href="/portfolio">
            关于我
          </Link>
          <button
            type="button"
            className="portal-search-btn portal-search-btn--inline"
            onClick={onOpenNote}
            aria-label="打开 Note"
          >
            <span className="portal-search-icon" aria-hidden>
              ✎
            </span>
            <span>Note</span>
          </button>
        </div>
      </header>

      <section className="portal-quote" aria-label="今日话语">
        <p className="portal-quote-text">{quoteLine}</p>
        <button
          type="button"
          className={'portal-quote-save' + (quoteSaved ? ' portal-quote-save--on' : '')}
          onClick={toggleSaveQuote}
          aria-label={quoteSaved ? '已收藏' : '收藏这句话'}
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
            <p className="portal-widget-muted">加载中…</p>
          ) : weather.error ? (
            <p className="portal-widget-muted">暂无数据</p>
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
        <h2 className="portal-calendar-head">日历</h2>

        {events.length === 0 ? (
          <p className="portal-calendar-empty">
            {calendarNote || '暂无即将到来的日程'}
          </p>
        ) : (
          <ul className="portal-calendar-list">
            {events.map((ev) => (
              <li key={ev.id} className="portal-calendar-event">
                <span className="portal-calendar-dot" aria-hidden />
                <p className="portal-calendar-line">
                  <span className="portal-calendar-title">{ev.title}</span>
                  <span className="portal-calendar-time">{formatEventTime(ev)}</span>
                </p>
                {ev.source ? (
                  <span className="portal-calendar-source">{ev.source}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
