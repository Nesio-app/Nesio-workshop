'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatLunarLine, nextHolidayLine, nextUSHolidayLine } from '@/lib/portal/almanac';
import { t } from '@/lib/portal/i18n';
import {
  DEFAULT_QUOTE_PREFERENCES,
  isQuoteCacheFresh,
  loadQuotePreferences,
  pickFreshQuote,
  QUOTE_CATEGORY_LABELS,
  QUOTE_FREQUENCY_LABELS,
  rememberCurrentQuote,
  saveQuotePreferences,
  type QuoteCategory,
  type QuoteFrequency,
  type QuotePreferences,
} from '@/lib/portal/quotes';
import {
  CALENDAR_LINK_UPDATED_EVENT,
  loadCalendarLinkSettings,
} from '@/lib/portal/calendar-links';
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
  shellTools?: PortalTool[];
  toolboxTools?: PortalTool[];
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
  return t.slice(0, 1);
}

function getLocaleCode(locale: PortalLocale): string {
  return locale === 'en' ? 'en-US' : 'zh-CN';
}

function formatClock(date: Date, locale: PortalLocale): string {
  return date.toLocaleTimeString(getLocaleCode(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDateLine(date: Date, locale: PortalLocale): string {
  return date.toLocaleDateString(getLocaleCode(locale), {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

function formatEventTime(event: CalendarEvent, locale: PortalLocale): string {
  const start = new Date(event.start);
  if (event.allDay) return t(locale, 'dashboardEventAllDay');
  const end = event.end ? new Date(event.end) : null;
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: locale === 'en' };
  const a = start.toLocaleTimeString(getLocaleCode(locale), opts);
  if (!end) return a;
  return `${a} – ${end.toLocaleTimeString(getLocaleCode(locale), opts)}`;
}

function formatEventCountdown(event: CalendarEvent, at: Date, locale: PortalLocale): string {
  const start = new Date(event.start);
  const endMs = event.end ? new Date(event.end).getTime() : start.getTime() + 3_600_000;

  if (event.allDay) {
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    const today = new Date(at);
    today.setHours(0, 0, 0, 0);
    const days = Math.round((startDay.getTime() - today.getTime()) / 86_400_000);
    if (days === 0) return t(locale, 'dashboardEventToday');
    if (days === 1) return t(locale, 'dashboardEventTomorrow');
    if (days > 0) return t(locale, 'dashboardEventInDays', { days });
    return t(locale, 'dashboardEventInProgress');
  }

  const diff = start.getTime() - at.getTime();
  if (diff <= 0) {
    if (at.getTime() < endMs) return t(locale, 'dashboardEventInProgress');
    return t(locale, 'dashboardEventEnded');
  }

  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return t(locale, 'dashboardEventMinutesLater', { mins });
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem > 0
    ? t(locale, 'dashboardEventHoursAndMinutesLater', { hours, minutes: rem })
    : t(locale, 'dashboardEventHoursLater', { hours });
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h > 0 ? t(locale, 'dashboardEventDaysAndHoursLater', { days, hours: h }) : t(locale, 'dashboardEventDaysLater', { days });
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
  shellTools,
  toolboxTools,
  noteOpen = false,
  treasureOpen,
  onTreasureOpenChange,
  onOpenNote,
  onOpenTool,
}: DashboardHomeProps) {
  const treasureAnchorRef = useRef<HTMLButtonElement>(null);
  const profile = config.profile ?? { displayName: t('zh', 'profileDefaultName') };
  const [locale, setLocale] = useState<PortalLocale>('zh');
  const [displayName, setDisplayName] = useState(profile.displayName);
  const fallbackLocation = config.location ?? {
    city: t(locale, 'dashboardDefaultCity'),
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
    if (cached?.error) return t(locale, 'dashboardFidelityUnavailable');
    return null;
  });
  const [calendarFeeds, setCalendarFeeds] = useState<CalendarFeedStatus[]>(() => {
    const cached = readPortalCache<{ feeds?: CalendarFeedStatus[] }>(PORTAL_CACHE_KEYS.calendar);
    return cached?.feeds ?? [];
  });
  const [fidelityHintDismissed, setFidelityHintDismissed] = useState(false);
  const popupTools = toolboxTools ?? shellTools ?? config.tools;
  const quotePicked = useRef(false);
  const [quotePreferences, setQuotePreferences] = useState<QuotePreferences>(DEFAULT_QUOTE_PREFERENCES);
  const [quoteSettingsOpen, setQuoteSettingsOpen] = useState(false);
  const [dailyQuote, setDailyQuote] = useState(() => pickFreshQuote(config, DEFAULT_QUOTE_PREFERENCES));
  const [calendarLinkUrl, setCalendarLinkUrl] = useState('');
  const lunarLine = useMemo(() => formatLunarLine(now), [now]);
  const holidayLine = useMemo(() => nextHolidayLine(now), [now]);
  const usHolidayLine = useMemo(() => nextUSHolidayLine(now), [now]);

  const syncProfile = useCallback(() => {
    const s = loadProfileSettings(profile.displayName);
    setDisplayName(s.displayName);
    setAvatarUrl(s.avatarUrl || profile.avatarUrl || '');
    setLocale(s.locale);
    document.documentElement.lang = s.locale === 'en' ? 'en' : 'zh-CN';
  }, [profile.avatarUrl, profile.displayName]);

  useEffect(() => {
    syncProfile();
    const onUpdate = () => syncProfile();
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdate);
  }, [syncProfile]);

  useEffect(() => {
    const prefs = loadQuotePreferences();
    setQuotePreferences(prefs);
    setDailyQuote(pickFreshQuote(config, prefs));
  }, [config]);

  useEffect(() => {
    const syncCalendarLink = () => {
      setCalendarLinkUrl(loadCalendarLinkSettings().googleCalendarUrl);
    };
    syncCalendarLink();
    window.addEventListener(CALENDAR_LINK_UPDATED_EVENT, syncCalendarLink);
    return () => window.removeEventListener(CALENDAR_LINK_UPDATED_EVENT, syncCalendarLink);
  }, []);

  useEffect(() => {
    if (quotePicked.current) return;
    quotePicked.current = true;
    setDailyQuote(pickFreshQuote(config, quotePreferences));
  }, [config, quotePreferences]);

  useEffect(() => {
    let cancelled = false;
    const shouldFetchExternal = quotePreferences.externalEnabled
      && !isQuoteCacheFresh(quotePreferences.frequency);
    if (!shouldFetchExternal) return () => {
      cancelled = true;
    };
    fetch('/api/portal/quote', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const quote = typeof payload?.quote === 'string' ? payload.quote.trim() : '';
        if (!cancelled && payload?.ok === true && quote.length >= 4 && quote.length <= 140) {
          setDailyQuote(quote);
          rememberCurrentQuote(quote, 'external');
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [quotePreferences.externalEnabled, quotePreferences.frequency]);

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
        else if (data.error) setCalendarNote(t(locale, 'dashboardFidelityUnavailable'));
        else setCalendarNote(null);
      })
      .catch(() => setCalendarNote(t(locale, 'dashboardFidelityUnavailable')));
  }, [locale]);

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
  const updateQuoteCategories = (category: QuoteCategory) => {
    const current = quotePreferences.categories;
    const nextCategories = current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category];
    const next = saveQuotePreferences({
      ...quotePreferences,
      categories: nextCategories.length ? nextCategories : [category],
    });
    setQuotePreferences(next);
    setDailyQuote(pickFreshQuote(config, next, { force: true }));
  };

  const updateQuoteFrequency = (frequency: QuoteFrequency) => {
    const next = saveQuotePreferences({ ...quotePreferences, frequency });
    setQuotePreferences(next);
    setDailyQuote(pickFreshQuote(config, next, { force: true }));
  };

  const updateExternalQuotes = (enabled: boolean) => {
    const next = saveQuotePreferences({ ...quotePreferences, externalEnabled: enabled });
    setQuotePreferences(next);
  };

  const openCalendarLink = () => {
    if (!calendarLinkUrl) return;
    window.location.href = calendarLinkUrl;
  };

  const onCalendarKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!calendarLinkUrl) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openCalendarLink();
    }
  };

  return (
    <div className="portal-dash">
      <header className="portal-dash-hero">
        <Link className="portal-avatar-link" href="/settings" aria-label={t(locale, 'openSettings')}>
          {displayAvatar ? (
            <img className="portal-dash-avatar" src={displayAvatar} alt="" width={48} height={48} />
          ) : (
            <div className="portal-dash-avatar portal-dash-avatar--initials" aria-hidden>
              {initials(displayName || t(locale, 'profileDefaultName'))}
            </div>
          )}
        </Link>

        <div className="portal-dash-greeting">
          <p className="portal-dash-greeting-line">{greeting}</p>
          <p className="portal-dash-greeting-name">{displayName || t(locale, 'profileDefaultName')}</p>
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
          <button
            ref={treasureAnchorRef}
            type="button"
            className={'portal-quote-treasure' + (treasureOpen ? ' portal-quote-treasure--open' : '')}
            onClick={() => onTreasureOpenChange(!treasureOpen)}
            aria-label={t(locale, 'openTreasure')}
            aria-expanded={treasureOpen}
          >
            <span className="portal-quote-treasure-box" aria-hidden>
              <DashboardTreasureIcon />
            </span>
          </button>
        </div>
      </header>

      <button
        type="button"
        className="portal-quote portal-quote--button"
        aria-label={`${t(locale, 'dashboardQuoteLabel')}，点击设置`}
        onClick={() => setQuoteSettingsOpen(true)}
      >
        <p className="portal-quote-text">{quoteLine}</p>
      </button>
      {quoteSettingsOpen ? (
        <div className="portal-quote-settings" role="dialog" aria-modal="true" aria-label="金句设置">
          <div className="portal-quote-settings-sheet">
            <div className="portal-quote-settings-head">
              <h2>金句设置</h2>
              <button type="button" onClick={() => setQuoteSettingsOpen(false)} aria-label="关闭金句设置">×</button>
            </div>
            <p className="portal-quote-settings-hint">选择想看到的金句类型和刷新频率。设置只保存在本机浏览器。</p>
            <div className="portal-quote-settings-group">
              <span className="portal-quote-settings-label">分类</span>
              <div className="portal-quote-settings-chips">
                {(Object.keys(QUOTE_CATEGORY_LABELS) as QuoteCategory[]).map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={'portal-quote-settings-chip' + (quotePreferences.categories.includes(category) ? ' portal-quote-settings-chip--on' : '')}
                    onClick={() => updateQuoteCategories(category)}
                    aria-pressed={quotePreferences.categories.includes(category)}
                  >
                    {QUOTE_CATEGORY_LABELS[category]}
                  </button>
                ))}
              </div>
            </div>
            <div className="portal-quote-settings-group">
              <label className="portal-quote-settings-label" htmlFor="quote-frequency">切换频率</label>
              <input
                id="quote-frequency"
                className="portal-quote-settings-range"
                type="range"
                min="0"
                max="2"
                step="1"
                value={(['each_open', 'hourly', 'daily'] as QuoteFrequency[]).indexOf(quotePreferences.frequency)}
                onChange={(event) => {
                  const next = (['each_open', 'hourly', 'daily'] as QuoteFrequency[])[Number(event.target.value)] ?? 'hourly';
                  updateQuoteFrequency(next);
                }}
              />
              <div className="portal-quote-settings-frequency">
                {(Object.keys(QUOTE_FREQUENCY_LABELS) as QuoteFrequency[]).map((frequency) => (
                  <button
                    key={frequency}
                    type="button"
                    className={quotePreferences.frequency === frequency ? 'is-on' : ''}
                    onClick={() => updateQuoteFrequency(frequency)}
                  >
                    {QUOTE_FREQUENCY_LABELS[frequency]}
                  </button>
                ))}
              </div>
            </div>
            <label className="portal-quote-settings-toggle">
              <input
                type="checkbox"
                checked={quotePreferences.externalEnabled}
                onChange={(event) => updateExternalQuotes(event.target.checked)}
              />
              <span>允许公共外部金句补充</span>
            </label>
          </div>
        </div>
      ) : null}

      <section className="portal-widgets" aria-label={t(locale, 'dashboardSummaryLabel')}>
        <article className="portal-widget portal-widget--clock">
          <p className="portal-widget-clock">{formatClock(now, locale)}</p>
          <p className="portal-widget-date">{formatDateLine(now, locale)}</p>
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

      <section
        className={'portal-calendar' + (calendarLinkUrl ? ' portal-calendar--clickable' : '')}
        aria-label={t(locale, 'dashboardCalendarLabel')}
        role={calendarLinkUrl ? 'link' : undefined}
        tabIndex={calendarLinkUrl ? 0 : undefined}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button,a')) return;
          openCalendarLink();
        }}
        onKeyDown={onCalendarKeyDown}
      >
        <div className="portal-calendar-head-row">
          <h2 className="portal-calendar-head">{t(locale, 'calendar')}</h2>
          {calendarLinkUrl ? (
            <a className="portal-calendar-open-link" href={calendarLinkUrl}>打开</a>
          ) : (
            <Link className="portal-calendar-open-link" href="/settings#calendar">接入</Link>
          )}
        </div>
        {showFidelityHint ? (
          <div className="portal-calendar-feed-hint" role="status">
            <span>
              {googleOk
                ? t(locale, 'dashboardFidelityUnavailable')
                : t(locale, 'dashboardFidelityEnvHint')}
              {fidelityFeed?.error ? `（${fidelityFeed.error}）` : ''}
            </span>
            <button
              type="button"
              className="portal-calendar-feed-dismiss"
              onClick={dismissFidelityHint}
              aria-label={t(locale, 'dashboardCalendarHintClose')}
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
                      <span className="portal-calendar-time">{formatEventTime(ev, locale)}</span>
                    </span>
                  </p>
                  <p className="portal-calendar-meta">
                    <span className="portal-calendar-countdown">
                      {formatEventCountdown(ev, now, locale)}
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
        tools={popupTools}
        open={treasureOpen}
        anchorRef={treasureAnchorRef}
        locale={locale}
        onClose={() => onTreasureOpenChange(false)}
        onOpenTool={onOpenTool}
      />
    </div>
  );
}
