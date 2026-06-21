'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  portalLocaleToHtmlLang,
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
import {
  createAppApiClient,
  type ProductionRuntimeProviderAction,
} from '@/lib/portal/app-api-client';
import {
  getBaohePersonalizationProfile,
  readBaohePersonalizationStage,
  rememberBaoheInsightFeedback,
  rememberBaoheInsightShown,
  shouldShowBaoheInsight,
} from '@/lib/portal/personalization-insights';
import ToolsTreasurePopup from './ToolsTreasureSheet';

interface DashboardHomeProps {
  config: PortalConfig;
  shellTools?: PortalTool[];
  toolboxTools?: PortalTool[];
  noteOpen?: boolean;
  treasureOpen: boolean;
  onTreasureOpenChange: (open: boolean) => void;
  onOpenNote: () => void;
  onOpenTool: (tool: PortalTool) => void;
  onOpenAiFriends?: () => void;
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

const MOOD_OPTIONS = [
  { key: 'calm', labelKey: 'dashboardMoodCalm', color: 'var(--status-calm)' },
  { key: 'safe', labelKey: 'dashboardMoodSafe', color: 'var(--status-go)' },
  { key: 'restored', labelKey: 'dashboardMoodRestored', color: 'var(--status-go)' },
  { key: 'focused', labelKey: 'dashboardMoodFocused', color: 'var(--portal-cool-accent)' },
  { key: 'hopeful', labelKey: 'dashboardMoodHopeful', color: 'var(--portal-neutral-accent)' },
  { key: 'creative', labelKey: 'dashboardMoodCreative', color: 'var(--portal-warm-accent)' },
  { key: 'tender', labelKey: 'dashboardMoodTender', color: 'var(--status-calm)' },
  { key: 'anxious', labelKey: 'dashboardMoodAnxious', color: 'var(--status-gentle)' },
  { key: 'alert', labelKey: 'dashboardMoodAlert', color: 'var(--status-gentle)' },
  { key: 'bright', labelKey: 'dashboardMoodBright', color: 'var(--portal-blue-deep)' },
  { key: 'grounded', labelKey: 'dashboardMoodGrounded', color: 'var(--portal-muted)' },
  { key: 'low', labelKey: 'dashboardMoodLow', color: 'var(--portal-neutral-accent)' },
] as const;

type MoodOption = (typeof MOOD_OPTIONS)[number];

const INSIGHT_FEEDBACK_KEYS = [
  'dashboardInsightPositiveFeedback',
  'dashboardInsightNegativeFeedback',
  'dashboardInsightNeutralFeedback',
] as const;

type InsightFeedbackKey = (typeof INSIGHT_FEEDBACK_KEYS)[number];

export default function DashboardHome({
  config,
  shellTools,
  toolboxTools,
  noteOpen = false,
  treasureOpen,
  onTreasureOpenChange,
  onOpenNote,
  onOpenTool,
  onOpenAiFriends,
}: DashboardHomeProps) {
  const treasureAnchorRef = useRef<HTMLButtonElement>(null);
  const moodWheelRef = useRef<HTMLDivElement>(null);
  const moodPointerMovedRef = useRef(false);
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
  const [calendarProviderAction, setCalendarProviderAction] =
    useState<ProductionRuntimeProviderAction | null>(null);
  const [calendarServerFeedAction, setCalendarServerFeedAction] =
    useState<ProductionRuntimeProviderAction | null>(null);
  const [fidelityHintDismissed, setFidelityHintDismissed] = useState(false);
  const [reminderDeferred, setReminderDeferred] = useState(false);
  const [crushTaskOpen, setCrushTaskOpen] = useState(false);
  const [crushTaskSplitLevel, setCrushTaskSplitLevel] = useState(0);
  const [crushTaskDone, setCrushTaskDone] = useState(false);
  const [personalization, setPersonalization] = useState(() => getBaohePersonalizationProfile());
  const [showPersonalizationInsight, setShowPersonalizationInsight] = useState(false);
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [insightFeedback, setInsightFeedback] = useState<'positive' | 'negative' | null>(null);
  const [insightFeedbackKey, setInsightFeedbackKey] = useState<InsightFeedbackKey>(INSIGHT_FEEDBACK_KEYS[0]);
  const [selectedMood, setSelectedMood] = useState<MoodOption>(MOOD_OPTIONS[0]);
  const [hoveredMood, setHoveredMood] = useState<MoodOption>(MOOD_OPTIONS[0]);
  const [moodPickerOpen, setMoodPickerOpen] = useState(false);
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false);
  const [reminderDetail, setReminderDetail] = useState<'task' | 'meeting' | null>(null);
  const [meetingRecording, setMeetingRecording] = useState(false);
  const [healthGateOpen, setHealthGateOpen] = useState(false);
  const popupTools = toolboxTools ?? shellTools ?? config.tools;
  const quotePicked = useRef(false);
  const [quotePreferences, setQuotePreferences] = useState<QuotePreferences>(DEFAULT_QUOTE_PREFERENCES);
  const [quoteSettingsOpen, setQuoteSettingsOpen] = useState(false);
  const [dailyQuote, setDailyQuote] = useState(() => pickFreshQuote(config, DEFAULT_QUOTE_PREFERENCES));
  const [calendarLinkUrl, setCalendarLinkUrl] = useState('');
  const lunarLine = useMemo(() => formatLunarLine(now), [now]);
  const holidayLine = useMemo(() => nextHolidayLine(now), [now]);
  const usHolidayLine = useMemo(() => nextUSHolidayLine(now), [now]);
  const crushSteps = useMemo(() => {
    if (crushTaskSplitLevel <= 0) {
      return [
        t(locale, 'dashboardCrushStepRememberGiftHints'),
        t(locale, 'dashboardCrushStepAskAiOptions'),
        t(locale, 'dashboardCrushStepConfirmDelivery'),
      ];
    }
    const scale = crushTaskSplitLevel + 1;
    return [
      t(locale, 'dashboardCrushStepKeywordTemplate', { level: scale }),
      t(locale, 'dashboardCrushStepNarrowOptionsTemplate', { count: Math.max(1, 4 - crushTaskSplitLevel) }),
      crushTaskSplitLevel > 2
        ? t(locale, 'dashboardCrushStepOneMinuteAction')
        : t(locale, 'dashboardCrushStepDecideTomorrow'),
    ];
  }, [crushTaskSplitLevel, locale]);

  const syncProfile = useCallback(() => {
    const s = loadProfileSettings(profile.displayName);
    setDisplayName(s.displayName);
    setAvatarUrl(s.avatarUrl || profile.avatarUrl || '');
    setLocale(s.locale);
    document.documentElement.lang = portalLocaleToHtmlLang(s.locale);
  }, [profile.avatarUrl, profile.displayName]);

  useEffect(() => {
    syncProfile();
    const onUpdate = () => syncProfile();
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdate);
  }, [syncProfile]);

  useEffect(() => {
    const profile = getBaohePersonalizationProfile(readBaohePersonalizationStage());
    setPersonalization(profile);
    const shouldShow = shouldShowBaoheInsight(profile);
    setShowPersonalizationInsight(shouldShow);
    if (shouldShow) rememberBaoheInsightShown();
  }, []);

  useEffect(() => {
    const prefs = loadQuotePreferences();
    setQuotePreferences(prefs);
    setDailyQuote(pickFreshQuote(config, prefs));
  }, [config]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('treasurebox-v14-mood');
      const match = MOOD_OPTIONS.find((mood) => mood.key === stored);
      if (match) {
        setSelectedMood(match);
        setHoveredMood(match);
      }
    } catch {
      // local mood is optional.
    }
  }, []);

  const chooseMood = (mood: MoodOption) => {
    setSelectedMood(mood);
    setHoveredMood(mood);
    try {
      window.localStorage.setItem('treasurebox-v14-mood', mood.key);
    } catch {
      // local mood is optional.
    }
  };

  const moodFromPointer = useCallback((clientX: number, clientY: number) => {
    const rect = moodWheelRef.current?.getBoundingClientRect();
    if (!rect) return selectedMood;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
    const normalized = (angle + 450) % 360;
    const index = Math.floor(normalized / (360 / MOOD_OPTIONS.length)) % MOOD_OPTIONS.length;
    return MOOD_OPTIONS[index] ?? selectedMood;
  }, [selectedMood]);

  const handleInsightFeedback = (positive: boolean) => {
    rememberBaoheInsightFeedback(personalization, positive);
    setInsightFeedback(positive ? 'positive' : 'negative');
    setInsightFeedbackKey(INSIGHT_FEEDBACK_KEYS[Math.floor(Math.random() * INSIGHT_FEEDBACK_KEYS.length)] ?? INSIGHT_FEEDBACK_KEYS[0]);
    setInsightDismissed(true);
  };

  useEffect(() => {
    const syncCalendarLink = () => {
      setCalendarLinkUrl(loadCalendarLinkSettings().googleCalendarUrl);
    };
    syncCalendarLink();
    window.addEventListener(CALENDAR_LINK_UPDATED_EVENT, syncCalendarLink);
    return () => window.removeEventListener(CALENDAR_LINK_UPDATED_EVENT, syncCalendarLink);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const client = createAppApiClient();
    client.fetchProductionRuntimeHealth()
      .then((runtime) => {
        if (cancelled) return;
        const provider = runtime.providerActionMatrix.find(
          (provider) => provider.id === 'google_calendar',
        );
        const serverFeedProvider = runtime.providerActionMatrix.find(
          (provider) => provider.id === 'google_calendar_ical_readonly',
        );
        setCalendarProviderAction(provider ?? null);
        setCalendarServerFeedAction(serverFeedProvider ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setCalendarProviderAction(null);
          setCalendarServerFeedAction(null);
        }
      });
    return () => {
      cancelled = true;
    };
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
    const quoteQuery = new URLSearchParams({ locale });
    fetch(`/api/portal/quote?${quoteQuery.toString()}`, { cache: 'no-store' })
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
  }, [locale, quotePreferences.externalEnabled, quotePreferences.frequency]);

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

  const refreshCalendar = useCallback(() => {
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

  useEffect(() => {
    refreshCalendar();
  }, [refreshCalendar]);

  const calendarProviderReady =
    calendarProviderAction?.actionStatus === 'ready' && !calendarProviderAction?.serverOnly;
  const calendarServerFeedReady =
    calendarServerFeedAction?.actionStatus === 'server_ready' && calendarServerFeedAction?.serverOnly;
  const calendarProviderConnectUrl = calendarProviderReady
    ? (calendarProviderAction?.startEndpoint || '/api/portal/calendar/connect')
    : '';
  const calendarActionLabel = calendarLinkUrl ? '打开' : calendarServerFeedReady ? '已接入' : calendarProviderConnectUrl ? '接入' : '接入';
  const calendarClickable = Boolean(calendarLinkUrl || calendarServerFeedReady || calendarProviderConnectUrl);

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
  const meetingEvent = useMemo(
    () => upcomingEvents.find((event) => {
      const eventText = [
        event.title,
        event.calendarName,
        event.source,
        event.description,
        event.location,
        event.url,
      ].filter(Boolean).join(' ');
      return /meeting|会议|zoom|meet|call|产品/i.test(eventText);
    }) ?? upcomingEvents.find((event) => Boolean(event.url)),
    [upcomingEvents],
  );
  const meetingJoinUrl = meetingEvent?.url || calendarProviderConnectUrl || calendarLinkUrl || '/settings';
  const openMeetingJoinUrl = useCallback(() => {
    window.location.href = meetingJoinUrl;
  }, [meetingJoinUrl]);
  const visibleEvents = calendarExpanded
    ? upcomingEvents
    : upcomingEvents.slice(0, CALENDAR_PREVIEW);
  const hasMoreEvents = upcomingEvents.length > CALENDAR_PREVIEW;
  const fidelityFeed = calendarFeeds.find((f) => f.label === 'Fidelity');
  const googleOk = calendarFeeds.some((f) => f.label === 'Google' && f.ok);
  const showFidelityHint =
    fidelityFeed && !fidelityFeed.ok && !fidelityHintDismissed;
  const inventoryTool = useMemo(
    () => popupTools.find((tool) => tool.id === 'inventory') ?? config.tools.find((tool) => tool.id === 'inventory'),
    [config.tools, popupTools],
  );
  const planTool = useMemo(
    () => popupTools.find((tool) => tool.id === 'plan') ?? config.tools.find((tool) => tool.id === 'plan'),
    [config.tools, popupTools],
  );
  const healthTool = useMemo(
    () => popupTools.find((tool) => tool.id === 'health') ?? config.tools.find((tool) => tool.id === 'health'),
    [config.tools, popupTools],
  );
  const openHealthRuntime = useCallback(() => {
    const healthIsAvailable = healthTool?.ready || healthTool?.status === 'ready';
    if (healthTool && healthIsAvailable) {
      onOpenTool(healthTool);
      return;
    }
    setHealthGateOpen(true);
  }, [healthTool, onOpenTool]);
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

  const handleCalendarAction = () => {
    if (calendarLinkUrl) {
      openCalendarLink();
      return;
    }
    if (calendarServerFeedReady) {
      refreshCalendar();
      return;
    }
    if (calendarProviderConnectUrl) {
      window.location.href = calendarProviderConnectUrl;
    }
  };

  const onCalendarKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!calendarClickable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleCalendarAction();
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

        <div className="portal-dash-hero-time" aria-label={t(locale, 'dashboardHeaderTimeWeatherAriaLabel')}>
          <span>{formatClock(now, locale)}</span>
          <em>{formatDateLine(now, locale)}</em>
          <small>
            {weather.loading || weather.error
              ? placeLabel
              : `${placeLabel} · ${weather.temperatureC ?? 0}°C`}
          </small>
          {weather.alert ? <i>⚠ {weather.alert}</i> : null}
        </div>
      </header>

      {quoteSettingsOpen ? (
        <div className="portal-quote-settings" role="dialog" aria-modal="true" aria-label={t(locale, 'dashboardQuoteSettingsTitle')}>
          <div className="portal-quote-settings-sheet">
            <div className="portal-quote-settings-head">
              <h2>{t(locale, 'dashboardQuoteSettingsTitle')}</h2>
              <button type="button" onClick={() => setQuoteSettingsOpen(false)} aria-label={t(locale, 'dashboardQuoteSettingsClose')}>×</button>
            </div>
            <p className="portal-quote-settings-hint">{t(locale, 'dashboardQuoteSettingsHint')}</p>
            <div className="portal-quote-settings-group">
              <span className="portal-quote-settings-label">{t(locale, 'dashboardQuoteSettingsCategories')}</span>
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
              <label className="portal-quote-settings-label" htmlFor="quote-frequency">{t(locale, 'dashboardQuoteSettingsFrequency')}</label>
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
              <span>{t(locale, 'dashboardQuoteSettingsExternal')}</span>
            </label>
          </div>
        </div>
      ) : null}

      <section className="portal-v13-coach" aria-label={t(locale, 'dashboardCoachActionAriaLabel')}>
        <button type="button" className="portal-v13-remind-bar" onClick={() => setScheduleSheetOpen(true)}>
          <span>{t(locale, 'dashboardCoachEventSummaryTemplate', { count: upcomingEvents.length || 3 })}</span>
          <small>›</small>
        </button>

        <div className="portal-v13-count-hero">
            <div className="portal-v13-count-left">
              <p>{t(locale, 'dashboardImportantDate')}</p>
              <div><strong>5</strong><span>天</span></div>
              <h2>{t(locale, 'dashboardMomBirthday')}</h2>
              <small>{usHolidayLine || holidayLine || t(locale, 'dashboardNextHolidayFallback')}</small>
            </div>
          <div className="portal-v13-count-right">
            <button
              type="button"
              className="portal-v13-energy-button"
              aria-label={t(locale, 'dashboardEnergyAriaLabel')}
              data-runtime-action="open-health-dashboard"
              onClick={openHealthRuntime}
            >
              <p>{t(locale, 'dashboardEnergyTitle')}</p>
              <div className="portal-v13-energy-bars" aria-hidden>
                <span />
                <span />
                <span />
                <span className="is-empty" />
              </div>
              <span>{t(locale, 'dashboardEnergyBody')}</span>
            </button>
            <button
              type="button"
              className="portal-v14-mood-trigger"
              onClick={() => setMoodPickerOpen(true)}
            >
              <i style={{ background: selectedMood.color }} aria-hidden />
              {t(locale, selectedMood.labelKey)}
              <em aria-hidden>›</em>
            </button>
          </div>
        </div>

        {insightFeedback ? (
          <p className="portal-v14-insight-feedback portal-v14-insight-feedback--standalone" role="status">
            {t(locale, insightFeedbackKey)}
          </p>
        ) : null}

        {showPersonalizationInsight && !insightDismissed ? (
          <section className="portal-v14-insight-card" aria-label={t(locale, 'dashboardInsightTitle')}>
            <div className="portal-v14-insight-head">
              <span aria-hidden>🔍</span>
              <b>{t(locale, 'dashboardInsightTitle')}</b>
              <button type="button" onClick={() => setInsightDismissed(true)} aria-label={t(locale, 'dashboardInsightClose')}>×</button>
            </div>
            <p>{personalization.insightBody}</p>
            <small>{personalization.insightSource}</small>
            <div className="portal-v14-insight-actions">
              <button type="button" onClick={() => handleInsightFeedback(true)}>👍 {t(locale, 'dashboardInsightAccurate')}</button>
              <button type="button" onClick={() => handleInsightFeedback(false)}>{t(locale, 'dashboardInsightNotQuite')}</button>
            </div>
          </section>
        ) : null}

        <div className="portal-v13-action-card portal-v13-action-card--html">
          <div className="portal-v13-action-content" onClick={() => setCrushTaskOpen(true)} role="presentation">
            <p className="portal-v13-kicker">温馨提醒</p>
            <p className="portal-v13-action-copy">
              {t(locale, 'dashboardGiftReminderPrefix')}
              <em>{t(locale, 'dashboardGiftReminderAlbum')}</em>
              {t(locale, 'dashboardGiftReminderMiddle')}
              <em>{t(locale, 'dashboardGiftReminderSkincare')}</em>
              {t(locale, 'dashboardGiftReminderSuffix')}
            </p>
            <button
              type="button"
              className="portal-v13-ai-tip"
              aria-label="问智友下一步"
              onClick={(event) => {
                event.stopPropagation();
                onOpenAiFriends?.();
              }}
            >
              ✦
            </button>
          </div>
          <div className="portal-v13-action-row">
            <button
              type="button"
              className="portal-v13-primary-action"
              onClick={() => setCrushTaskOpen(true)}
            >
              粉碎任务
            </button>
            <button
              type="button"
              className="portal-v13-secondary-action"
              onClick={() => setReminderDeferred(true)}
            >
              {reminderDeferred ? '已换一条' : '下一条'}
            </button>
          </div>
        </div>

        <article className="portal-v13-inventory-card" onClick={() => inventoryTool && onOpenTool(inventoryTool)}>
          <div className="portal-v13-inventory-head">
            <span aria-hidden>📦</span>
            <b>物品库</b>
            <small>本周清单</small>
          </div>
          <h2>可整理本周补货清单</h2>
          <div className="portal-v13-inventory-rows">
            <p><span>全脂牛奶 · 冰箱</span><b>补货</b></p>
            <p><span>维生素 C · 药柜</span><b>补货</b></p>
            <p><span>保湿护肤霜 · 梳妆台</span><b>关注</b></p>
          </div>
          <p className="portal-v13-inventory-ai">提前备好，生活从容 · 可让智友帮你处理</p>
          <div className="portal-v13-inventory-actions">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (inventoryTool) onOpenTool(inventoryTool);
              }}
            >
              ＋ 记录物品
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (inventoryTool) onOpenTool(inventoryTool);
              }}
            >
              查看全部
            </button>
          </div>
        </article>

        <button
          type="button"
          className="portal-quote portal-quote--button"
          aria-label={`${t(locale, 'dashboardQuoteLabel')}，点击设置`}
          onClick={() => setQuoteSettingsOpen(true)}
          onPointerUp={() => setQuoteSettingsOpen(true)}
        >
          <p className="portal-quote-text">{quoteLine}</p>
        </button>
      </section>

      {crushTaskOpen ? (
        <div className="portal-crush-sheet" role="presentation">
          <button
            type="button"
            className="portal-crush-sheet-backdrop"
            aria-label="关闭粉碎任务"
            onClick={() => setCrushTaskOpen(false)}
          />
          <section
            className="portal-crush-sheet-card"
            role="dialog"
            aria-modal="true"
            aria-label="粉碎任务"
          >
            <div className="portal-crush-sheet-handle" aria-hidden />
            <div className="portal-crush-sheet-head">
              <div>
                <p className="portal-v13-kicker">粉碎任务</p>
                <h2>给妈妈准备生日礼物</h2>
              </div>
              <button
                type="button"
                className="portal-crush-sheet-close"
                onClick={() => setCrushTaskOpen(false)}
              >
                <span aria-hidden>×</span>
                <span className="sr-only">关闭粉碎任务</span>
              </button>
            </div>
            <p className="portal-crush-sheet-copy">
              {crushTaskSplitLevel > 0
                ? t(locale, 'dashboardCrushSplitStatusTemplate', { level: crushTaskSplitLevel + 1 })
                : t(locale, 'dashboardCrushSplitIntro')}
            </p>
            <ol className="portal-crush-step-list" aria-label="粉碎步骤">
              <li className={crushTaskDone ? 'is-done' : ''}>
                <span>{crushTaskDone ? '✓ 已拆成更小的 3 步' : '第一步'}</span>
                <strong>{crushSteps[0]}</strong>
                <button type="button" onClick={() => setCrushTaskSplitLevel((level) => level + 1)}>↳ 还是太大？再拆细</button>
              </li>
              <li>
                <span>第二步</span>
                <strong>{crushSteps[1]}</strong>
                <button type="button" onClick={() => setCrushTaskSplitLevel((level) => level + 1)}>↳ 还是太大？再拆细</button>
              </li>
              <li>
                <span>第三步</span>
                <strong>{crushSteps[2]}</strong>
                <button type="button" onClick={() => setCrushTaskSplitLevel((level) => level + 1)}>↳ 还是太大？再拆细</button>
              </li>
            </ol>
            <div className="portal-crush-sheet-actions">
              <button
                type="button"
                className="portal-crush-sheet-primary"
                onClick={() => setCrushTaskDone(true)}
              >
              完成这一步
              </button>
              <button
                type="button"
                className="portal-crush-sheet-secondary"
                onClick={() => setCrushTaskOpen(false)}
              >
                稍后
              </button>
            </div>
            <button
              type="button"
              className="portal-crush-sheet-link"
              onClick={() => {
                if (planTool) {
                  onOpenTool(planTool);
                  return;
                }
                setReminderDetail('task');
              }}
            >
              打开待办
            </button>
          </section>
        </div>
      ) : null}

      {moodPickerOpen ? (
        <div className="portal-mood-sheet" role="presentation">
          <button
            type="button"
            className="portal-mood-backdrop"
            aria-label="关闭心情选择"
            onClick={() => setMoodPickerOpen(false)}
          />
          <section className="portal-mood-card" role="dialog" aria-modal="true" aria-label="此刻心情">
            <h2>此刻心情</h2>
            <p style={{ color: hoveredMood.color }}>{t(locale, hoveredMood.labelKey)}</p>
            <div
              ref={moodWheelRef}
              className="portal-mood-wheel"
              aria-label="心情轮"
              role="slider"
              aria-valuemin={0}
              aria-valuemax={MOOD_OPTIONS.length - 1}
              aria-valuenow={MOOD_OPTIONS.findIndex((mood) => mood.key === hoveredMood.key)}
              aria-valuetext={t(locale, hoveredMood.labelKey)}
              tabIndex={0}
              onPointerDown={(event) => {
                moodPointerMovedRef.current = false;
                setHoveredMood(moodFromPointer(event.clientX, event.clientY));
              }}
              onPointerMove={(event) => {
                moodPointerMovedRef.current = true;
                setHoveredMood(moodFromPointer(event.clientX, event.clientY));
              }}
              onPointerUp={(event) => {
                if (!moodPointerMovedRef.current) {
                  setMoodPickerOpen(false);
                  return;
                }
                chooseMood(moodFromPointer(event.clientX, event.clientY));
              }}
            >
              {MOOD_OPTIONS.map((mood, index) => (
                <span
                  key={mood.key}
                  style={{
                    '--mood-color': mood.color,
                    '--mood-index': index,
                    '--mood-count': MOOD_OPTIONS.length,
                  } as CSSProperties}
                  aria-hidden
                />
              ))}
            </div>
            <small>按住滑动选择，松手后保留在这里；点背景返回主页</small>
            <button type="button" className="portal-mood-done" onClick={() => setMoodPickerOpen(false)}>
              完成
            </button>
          </section>
        </div>
      ) : null}

      {scheduleSheetOpen ? (
        <div className="portal-reminder-sheet" role="presentation">
          <button
            type="button"
            className="portal-reminder-backdrop"
            aria-label="关闭今日安排"
            onClick={() => setScheduleSheetOpen(false)}
          />
          <section className="portal-reminder-card" role="dialog" aria-modal="true" aria-label="今日安排">
            <span className="portal-crush-sheet-handle" aria-hidden />
            <h2>陪你看见 · 今天可以做的事</h2>
            <button type="button" onClick={() => setReminderDetail('task')}>
              <span>先做这一件就好</span>
              <b>回复王总邮件</b>
              <small><em>开始 14:30</em><em>建议今天</em></small>
            </button>
            <button type="button" onClick={() => setReminderDetail('meeting')}>
              <span>今日安排</span>
              <b>产品会议</b>
              <small><em>开始 15:00</em><em>还剩 4 小时</em></small>
            </button>
            <button type="button" onClick={() => setReminderDetail('task')}>
              <span>不急，有空再看</span>
              <b>准备季度报告</b>
              <small><em>开始 周五</em><em>本周内</em></small>
            </button>
          </section>
        </div>
      ) : null}

      {reminderDetail ? (
        <div className="portal-reminder-sheet" role="presentation">
          <button
            type="button"
            className="portal-reminder-backdrop"
            aria-label="关闭提醒详情"
            onClick={() => setReminderDetail(null)}
          />
          <section className="portal-reminder-card portal-reminder-card--detail" role="dialog" aria-modal="true" aria-label={reminderDetail === 'meeting' ? '会议提醒' : '提醒详情'}>
            <span className="portal-crush-sheet-handle" aria-hidden />
            {reminderDetail === 'meeting' ? (
              <>
                <p className="portal-v13-kicker">会议提醒</p>
                <h2>产品会议</h2>
                <p>产品团队周会，15:00 @ 会议室 B</p>
                <p><b>时间 / 还剩 4 小时</b></p>
                <button
                  type="button"
                  className="portal-reminder-primary"
                  data-runtime-action="dashboard-open-meeting-link"
                  onClick={openMeetingJoinUrl}
                >
                  📹 {meetingEvent?.url ? '加入会议' : '连接日历查看会议'}
                </button>
                <button
                  type="button"
                  className="portal-reminder-record"
                  onClick={() => setMeetingRecording(true)}
                >
                  ▶ {meetingRecording ? '会议记录已开始，结束后生成纪要' : '开始 AI 会议记录'}
                </button>
              </>
            ) : (
              <>
                <p className="portal-v13-kicker">提醒详情</p>
                <h2>回复王总邮件</h2>
                <p>关于 Q3 预算调整方案，回一句也算往前走了一步。</p>
                <p><b>时间 / 建议今天</b></p>
                <button type="button" className="portal-reminder-primary" onClick={onOpenAiFriends}>✦ 在智友里处理</button>
              </>
            )}
            <button type="button" className="portal-reminder-close" onClick={() => setReminderDetail(null)}>关闭</button>
          </section>
        </div>
      ) : null}

      {healthGateOpen ? (
        <div className="portal-reminder-sheet" role="presentation">
          <button
            type="button"
            className="portal-reminder-backdrop"
            aria-label="关闭健康工具提示"
            onClick={() => setHealthGateOpen(false)}
          />
          <section className="portal-reminder-card portal-reminder-card--detail" role="dialog" aria-modal="true" aria-label="健康工具未购买">
            <span className="portal-crush-sheet-handle" aria-hidden />
            <p className="portal-v13-kicker">健康工具</p>
            <h2>健康 Dashboard 尚未加入工作台</h2>
            <p>{t(locale, 'dashboardHealthGateBody')}</p>
            <button
              type="button"
              className="portal-reminder-primary"
              onClick={() => {
                setHealthGateOpen(false);
                onTreasureOpenChange(true);
              }}
            >
              去工具箱购买
            </button>
            <button type="button" className="portal-reminder-close" onClick={() => setHealthGateOpen(false)}>稍后</button>
          </section>
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
        className={'portal-calendar' + (calendarClickable ? ' portal-calendar--clickable' : '')}
        aria-label={t(locale, 'dashboardCalendarLabel')}
        role={calendarClickable ? 'link' : undefined}
        tabIndex={calendarClickable ? 0 : undefined}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button,a')) return;
          if (calendarClickable) handleCalendarAction();
        }}
        onKeyDown={onCalendarKeyDown}
      >
        <div className="portal-calendar-head-row">
          <h2 className="portal-calendar-head">{t(locale, 'calendar')}</h2>
          {calendarLinkUrl ? (
            <a className="portal-calendar-open-link" href={calendarLinkUrl}>{calendarActionLabel}</a>
          ) : calendarProviderConnectUrl ? (
            <button
              type="button"
              className="portal-calendar-open-link"
              onClick={handleCalendarAction}
            >
              {calendarActionLabel}
            </button>
          ) : (
            <Link className="portal-calendar-open-link" href="/settings#calendar">{calendarActionLabel}</Link>
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
