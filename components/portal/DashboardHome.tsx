'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, PortalConfig } from '@/lib/portal/types';
import { greetingForHour } from '@/lib/portal/greeting';

interface DashboardHomeProps {
  config: PortalConfig;
}

interface WeatherState {
  temperature?: number;
  unit?: string;
  condition?: string;
  loading: boolean;
  error?: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2) || '我';
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

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (same(d, today)) {
    return `今天 ${d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}`;
  }
  if (same(d, tomorrow)) {
    return `明天 ${d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}`;
  }
  return d.toLocaleDateString('zh-CN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function DashboardHome({ config }: DashboardHomeProps) {
  const profile = config.profile ?? { displayName: 'Jing' };
  const location = config.location ?? {
    city: '上海',
    latitude: 31.2304,
    longitude: 121.4737,
    timezone: 'Asia/Shanghai',
  };

  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<WeatherState>({ loading: true });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarNote, setCalendarNote] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const WMO: Record<number, string> = {
      0: '晴', 1: '大部晴朗', 2: '多云', 3: '阴', 45: '雾', 61: '小雨', 63: '中雨', 65: '大雨', 80: '阵雨', 95: '雷雨',
    };
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('current', 'temperature_2m,weather_code');
    url.searchParams.set('timezone', location.timezone || 'Asia/Shanghai');

    fetch(url.toString())
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.current) {
          setWeather({ loading: false, error: true });
          return;
        }
        const code = Number(data.current.weather_code) || 0;
        setWeather({
          loading: false,
          temperature: data.current.temperature_2m,
          unit: data.current_units?.temperature_2m || '°C',
          condition: WMO[code] || '未知',
        });
      })
      .catch(() => setWeather({ loading: false, error: true }));
  }, [location.latitude, location.longitude, location.timezone]);

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
  const groupedEvents = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = dayLabel(ev.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return Array.from(map.entries());
  }, [events]);

  return (
    <div className="portal-dash">
      <header className="portal-dash-hero">
        <div className="portal-dash-identity">
          {profile.avatarUrl ? (
            <img
              className="portal-dash-avatar"
              src={profile.avatarUrl}
              alt=""
              width={56}
              height={56}
            />
          ) : (
            <div className="portal-dash-avatar portal-dash-avatar--initials" aria-hidden>
              {initials(profile.displayName)}
            </div>
          )}
          <div>
            <p className="portal-dash-greeting">
              {greeting}，{profile.displayName}
            </p>
            <p className="portal-dash-sub">{config.meta.subtitle}</p>
          </div>
        </div>
      </header>

      <section className="portal-widgets" aria-label="概览">
        <article className="portal-widget portal-widget--clock">
          <p className="portal-widget-label">时间</p>
          <p className="portal-widget-clock">{formatClock(now)}</p>
          <p className="portal-widget-date">{formatDateLine(now)}</p>
        </article>

        <article className="portal-widget portal-widget--weather">
          <p className="portal-widget-label">天气 · {location.city}</p>
          {weather.loading ? (
            <p className="portal-widget-muted">加载中…</p>
          ) : weather.error ? (
            <p className="portal-widget-muted">暂无数据</p>
          ) : (
            <>
              <p className="portal-widget-temp">
                {Math.round(weather.temperature ?? 0)}
                <span>{weather.unit || '°C'}</span>
              </p>
              <p className="portal-widget-muted">{weather.condition}</p>
            </>
          )}
        </article>
      </section>

      <section className="portal-calendar" aria-label="重要日历">
        <header className="portal-calendar-head">
          <h2>重要日历</h2>
          <span className="portal-calendar-src">Google</span>
        </header>

        {groupedEvents.length === 0 ? (
          <p className="portal-calendar-empty">
            {calendarNote || '未来两周暂无日程'}
          </p>
        ) : (
          <ul className="portal-calendar-list">
            {groupedEvents.map(([day, dayEvents]) => (
              <li key={day} className="portal-calendar-day">
                <p className="portal-calendar-day-label">{day}</p>
                <ul>
                  {dayEvents.map((ev) => (
                    <li key={ev.id} className="portal-calendar-event">
                      <span className="portal-calendar-dot" aria-hidden />
                      <div>
                        <p className="portal-calendar-title">{ev.title}</p>
                        <p className="portal-calendar-time">{formatEventTime(ev)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
