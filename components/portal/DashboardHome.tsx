'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { getLifeGraph } from '@/lib/portal/life-graph';
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
import { looksLikeMeetingEvent } from '@/lib/portal/calendar-event-classifier.mjs';
import type { CalendarEvent, PortalConfig, PortalTool } from '@/lib/portal/types';
import { greetingForHour } from '@/lib/portal/greeting';
import {
  fetchWeatherAt,
  readGeo,
  reverseGeocode,
  simplifyPlaceName,
} from '@/lib/platform/runtime/integration-runtime';
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
import MeetingRecorder from './MeetingRecorder';

// ── Proactive guidance ─────────────────────────────────────────────────────────
interface ProactiveCard {
  id: string;
  title: string;
  body: string;
  confidence: number;
  sourceTags: string[];
  icon: string;
  priority?: number;
}

interface ProactiveTrigger {
  type: string;
  data: Record<string, string | number | boolean | null>;
  fallback: Omit<ProactiveCard, 'id'> & { priority: number };
}

// ── Today focus ────────────────────────────────────────────────────────────────
interface FocusItem {
  id: string;
  type: 'meeting' | 'task' | 'reminder' | 'event';
  icon: string;
  title: string;
  body?: string;
  timeLabel?: string;
  countdown?: string;
  urgency: number;
  url?: string;
  sourceTags?: string[];
  calEvent?: CalendarEvent;
}

// ── Decompose ──────────────────────────────────────────────────────────────────
interface DecomposeStep {
  name: string;
  emoji: string;
  durationMin: number;
  subSteps?: DecomposeStep[];
  drillLoading?: boolean;
}

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
  // ── Proactive cards ──
  const [proactiveCards, setProactiveCards] = useState<ProactiveCard[]>([]);
  const [proactiveDismissed, setProactiveDismissed] = useState<Set<string>>(new Set());
  const proactiveLoadedRef = useRef(false);
  // ── Today focus ──
  const [focusItems, setFocusItems] = useState<FocusItem[]>([]);
  const [focusExpanded, setFocusExpanded] = useState(false);
  const [focusDetailItem, setFocusDetailItem] = useState<FocusItem | null>(null);
  // ── Decompose ──
  const [decomposeTarget, setDecomposeTarget] = useState<{ title: string; body?: string } | null>(null);
  const [decomposeSteps, setDecomposeSteps] = useState<DecomposeStep[]>([]);
  const [decomposeLoading, setDecomposeLoading] = useState(false);
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
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
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
    fetch('/api/portal/calendar', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        writePortalCache(PORTAL_CACHE_KEYS.calendar, data);
        setEvents(Array.isArray(data.events) ? data.events : []);
        setCalendarFeeds(Array.isArray(data.feeds) ? data.feeds : []);
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
  const calendarActionLabel = calendarLinkUrl
    ? t(locale, 'providerActionOpen')
    : calendarServerFeedReady
      ? t(locale, 'googleCalendarConnectedAction')
      : calendarProviderConnectUrl
        ? t(locale, 'googleCalendarConnectAction')
        : t(locale, 'googleCalendarConnectAction');
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
    () => upcomingEvents.find((event) => looksLikeMeetingEvent(event)) ?? upcomingEvents.find((event) => Boolean(event.url)),
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

  // ── Build today focus items from calendar + LifeGraph ─────────────────────
  const buildFocusItems = useCallback((evs: CalendarEvent[], at: Date, tz: string): FocusItem[] => {
    const items: FocusItem[] = [];

    for (const ev of evs) {
      const start = new Date(ev.start);
      const diffMs = start.getTime() - at.getTime();
      if (diffMs < -2 * 3600_000 || diffMs > 36 * 3600_000) continue;
      const isMeeting = looksLikeMeetingEvent(ev);
      const urgency = diffMs < 0 ? 92 : diffMs < 3600_000 ? 85 : diffMs < 8 * 3600_000 ? 70 : 55;
      items.push({
        id: `ev-${ev.id}`,
        type: isMeeting ? 'meeting' : 'event',
        icon: isMeeting ? '📹' : '📅',
        title: ev.title,
        body: ev.description || (ev.location ? `📍 ${ev.location}` : undefined),
        timeLabel: formatEventTime(ev, locale),
        countdown: formatEventCountdown(ev, at, locale),
        url: ev.url,
        urgency,
        sourceTags: [isMeeting ? '会议' : '日历', formatEventDayLabel(ev, at, tz)],
        calEvent: ev,
      });
    }

    try {
      const nodes = getLifeGraph();
      for (const node of nodes) {
        if (node.type !== 'commitment') continue;
        const dueRaw = node.attributes.dueDate ?? node.attributes.date ?? node.attributes.due;
        if (!dueRaw || typeof dueRaw !== 'string') continue;
        const due = new Date(dueRaw);
        if (isNaN(due.getTime())) continue;
        const diffDays = Math.floor((due.getTime() - at.getTime()) / 86_400_000);
        if (diffDays < -1 || diffDays > 7) continue;
        const urgency = diffDays < 0 ? 95 : diffDays === 0 ? 80 : Math.max(40, 70 - diffDays * 8);
        items.push({
          id: `lg-${node.id}`,
          type: 'task',
          icon: '✅',
          title: node.name,
          body: typeof node.attributes.description === 'string' ? node.attributes.description : node.rawInput,
          countdown: diffDays < 0 ? '已逾期' : diffDays === 0 ? '今天截止' : `${diffDays} 天后截止`,
          urgency,
          sourceTags: ['记忆', '待办'],
        });
      }
      const todoNodes = nodes.filter((n) =>
        (n.tags ?? []).some((tg) => ['待办', 'todo', '任务'].includes(tg.toLowerCase())),
      );
      for (const node of todoNodes.slice(0, 3)) {
        if (items.some((i) => i.id === `lg-${node.id}`)) continue;
        items.push({
          id: `lg-${node.id}`,
          type: 'task',
          icon: '📋',
          title: node.name,
          body: typeof node.attributes.description === 'string' ? node.attributes.description : node.rawInput,
          urgency: 40,
          sourceTags: ['记忆', '待办'],
        });
      }
    } catch {
      // LifeGraph unavailable in SSR
    }

    items.sort((a, b) => b.urgency - a.urgency);
    return items;
  }, [locale]);

  // ── Load proactive cards (rule engine → Claude polish) ────────────────────
  const loadProactiveCards = useCallback(async (
    weatherState: WeatherState,
    evs: CalendarEvent[],
    at: Date,
    name: string,
  ) => {
    if (proactiveLoadedRef.current) return;
    proactiveLoadedRef.current = true;

    const triggers: ProactiveTrigger[] = [];

    // Rule: cold weather
    if (!weatherState.loading && !weatherState.error && (weatherState.temperatureC ?? 99) < 15) {
      const tc = weatherState.temperatureC ?? 0;
      triggers.push({
        type: 'weather_cold',
        data: { tempC: tc, place: weatherState.placeLabel ?? '' },
        fallback: {
          title: '天气转凉了',
          body: `现在 ${tc}°C，出门记得多带件外套。`,
          confidence: 88,
          sourceTags: ['天气·温度'],
          icon: '🧥',
          priority: 2,
        },
      });
    }

    // Rule: rain condition
    if (!weatherState.loading && weatherState.condition) {
      const cond = weatherState.condition.toLowerCase();
      if (cond.includes('rain') || cond.includes('雨') || cond.includes('storm')) {
        triggers.push({
          type: 'weather_rain',
          data: { condition: weatherState.condition },
          fallback: {
            title: '今天有雨',
            body: '别忘了带伞，出行时留点余量。',
            confidence: 82,
            sourceTags: ['天气·降雨'],
            icon: '☂️',
            priority: 2,
          },
        });
      }
    }

    // Rule: meeting within 2 hours
    const meetingSoon = evs.find((ev) => {
      const start = new Date(ev.start);
      const diff = start.getTime() - at.getTime();
      return diff > 0 && diff < 2 * 3600_000 && looksLikeMeetingEvent(ev);
    });
    if (meetingSoon) {
      const mins = Math.ceil((new Date(meetingSoon.start).getTime() - at.getTime()) / 60_000);
      triggers.push({
        type: 'event_soon',
        data: { title: meetingSoon.title, minsLeft: mins, hasUrl: Boolean(meetingSoon.url) },
        fallback: {
          title: '会议快开始了',
          body: `"${meetingSoon.title}" 还有 ${mins} 分钟，${meetingSoon.url ? '点进去加入' : '提前做好准备'}。`,
          confidence: 98,
          sourceTags: ['日历·今日'],
          icon: '📹',
          priority: 3,
        },
      });
    }

    // Rule: LifeGraph health note in past 5 days
    try {
      const nodes = getLifeGraph();
      const recentHealth = nodes.find((n) => {
        if (n.type !== 'health_state') return false;
        return at.getTime() - new Date(n.createdAt).getTime() < 5 * 86_400_000;
      });
      if (recentHealth) {
        triggers.push({
          type: 'health_followup',
          data: { name: recentHealth.name },
          fallback: {
            title: '关注一下身体',
            body: `你之前记了"${recentHealth.name}"，注意休息，好好照顾自己。`,
            confidence: 72,
            sourceTags: ['记忆·健康'],
            icon: '💙',
            priority: 1,
          },
        });
      }

      // Rule: birthday within 7 days
      const birthdayNode = nodes.find((n) => {
        if (n.type !== 'person') return false;
        const bd = n.attributes.birthday ?? n.attributes.birthdate;
        if (!bd || typeof bd !== 'string') return false;
        const bdMMDD = bd.slice(5, 10);
        for (let d = 0; d <= 7; d++) {
          const check = new Date(at.getTime() + d * 86_400_000).toISOString().slice(5, 10);
          if (bdMMDD === check) return true;
        }
        return false;
      });
      if (birthdayNode) {
        triggers.push({
          type: 'birthday',
          data: { name: birthdayNode.name },
          fallback: {
            title: `${birthdayNode.name}的生日快到了`,
            body: `还有时间提前准备，一个小惊喜就够了。`,
            confidence: 96,
            sourceTags: ['记忆·家人/朋友'],
            icon: '🎂',
            priority: 3,
          },
        });
      }
    } catch { /* LifeGraph unavailable */ }

    if (triggers.length === 0) return;

    try {
      const res = await fetch('/api/portal/proactive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggers, userName: name }),
      });
      const data = await res.json() as { ok: boolean; cards?: ProactiveCard[] };
      if (data.ok && Array.isArray(data.cards) && data.cards.length > 0) {
        setProactiveCards(data.cards);
        return;
      }
    } catch { /* use fallback */ }

    // Fallback: use rule-generated cards sorted by priority desc
    const fallbackCards = triggers
      .slice()
      .sort((a, b) => (b.fallback.priority ?? 0) - (a.fallback.priority ?? 0))
      .slice(0, 2)
      .map((tr, i) => ({ id: `p${i}`, ...tr.fallback }));
    setProactiveCards(fallbackCards);
  }, []);

  // ── Decompose handlers ─────────────────────────────────────────────────────
  const openDecompose = useCallback((item: FocusItem | { title: string; body?: string }) => {
    setDecomposeTarget({ title: 'title' in item ? item.title : (item as FocusItem).title, body: (item as FocusItem).body });
    setDecomposeSteps([]);
    setDecomposeLoading(true);
    void fetch('/api/portal/decompose-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskName: (item as FocusItem).title ?? item, context: (item as FocusItem).body }),
    })
      .then((r) => r.json())
      .then((data: { ok: boolean; steps?: DecomposeStep[] }) => {
        if (data.ok && data.steps?.length) setDecomposeSteps(data.steps);
      })
      .catch(() => undefined)
      .finally(() => setDecomposeLoading(false));
  }, []);

  const drillStep = useCallback((stepIdx: number, step: DecomposeStep) => {
    setDecomposeSteps((prev) => prev.map((s, i) => i === stepIdx ? { ...s, drillLoading: true } : s));
    void fetch('/api/portal/decompose-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskName: step.name, context: decomposeTarget?.title, drill: true }),
    })
      .then((r) => r.json())
      .then((data: { ok: boolean; steps?: DecomposeStep[] }) => {
        if (data.ok && data.steps?.length) {
          setDecomposeSteps((prev) => prev.map((s, i) =>
            i === stepIdx ? { ...s, subSteps: data.steps, drillLoading: false } : s,
          ));
        }
      })
      .catch(() => setDecomposeSteps((prev) => prev.map((s, i) =>
        i === stepIdx ? { ...s, drillLoading: false } : s,
      )));
  }, [decomposeTarget]);

  // Build focus items whenever events or time changes (after buildFocusItems is defined)
  useEffect(() => {
    const tz = fallbackLocation.timezone || 'Asia/Shanghai';
    setFocusItems(buildFocusItems(events, now, tz));
  }, [events, now, buildFocusItems, fallbackLocation.timezone]);

  // Load proactive cards once after weather + events are ready
  useEffect(() => {
    if (weather.loading || proactiveLoadedRef.current) return;
    void loadProactiveCards(weather, events, now, displayName);
  }, [weather, events, now, displayName, loadProactiveCards]);

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

        {/* ── 未来引导 (Proactive AI Guidance) ── */}
        {proactiveCards.filter((c) => !proactiveDismissed.has(c.id)).length > 0 ? (
          <div className="portal-proactive-section" aria-label="未来引导">
            {proactiveCards.filter((c) => !proactiveDismissed.has(c.id)).map((card) => (
              <div key={card.id} className="portal-proactive-card">
                <div className="portal-proactive-card-top">
                  <span className="portal-proactive-card-icon">{card.icon}</span>
                  <div className="portal-proactive-card-content">
                    <div className="portal-proactive-card-head">
                      <b className="portal-proactive-card-title">{card.title}</b>
                      <span className="portal-proactive-card-conf">{card.confidence}% 把握</span>
                    </div>
                    <p className="portal-proactive-card-body">{card.body}</p>
                    <div className="portal-proactive-card-tags">
                      {card.sourceTags.map((tag) => (
                        <span key={tag} className="portal-proactive-tag">{tag}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="portal-proactive-dismiss"
                    aria-label="忽略"
                    onClick={() => setProactiveDismissed((prev) => new Set(Array.from(prev).concat(card.id)))}
                  >×</button>
                </div>
                <div className="portal-proactive-card-actions">
                  <button
                    type="button"
                    className="portal-proactive-btn--primary"
                    onClick={() => { setProactiveDismissed((prev) => new Set(Array.from(prev).concat(card.id))); onOpenAiFriends?.(); }}
                  >✦ 在智友里处理</button>
                  <button
                    type="button"
                    className="portal-proactive-btn--secondary"
                    onClick={() => setProactiveDismissed((prev) => new Set(Array.from(prev).concat(card.id)))}
                  >稍后</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

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

        {/* ── 今日聚焦 (merged focus section, max 2 visible) ── */}
        {focusItems.length > 0 ? (
          <section className="portal-focus-section" aria-label="今日聚焦">
            <div className="portal-focus-header">
              <h3 className="portal-focus-title">陪你看见 · 今天可以做的事</h3>
              {focusItems.length > 2 ? (
                <button
                  type="button"
                  className="portal-focus-count"
                  onClick={() => setFocusExpanded((v) => !v)}
                >
                  {focusExpanded ? '收起' : `共 ${focusItems.length} 件`}
                </button>
              ) : null}
            </div>
            {(focusExpanded ? focusItems : focusItems.slice(0, 2)).map((item) => (
              <div key={item.id} className="portal-focus-item" onClick={() => setFocusDetailItem(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setFocusDetailItem(item); }}>
                <div className="portal-focus-item-row">
                  <span className="portal-focus-item-type-badge portal-focus-item-type-badge--{item.type}">
                    {item.type === 'meeting' ? '今日安排' : item.type === 'task' ? '待完成' : item.type === 'reminder' ? '提醒' : '日程'}
                  </span>
                </div>
                <p className="portal-focus-item-title">{item.title}</p>
                {item.countdown ? (
                  <p className="portal-focus-item-countdown">{item.countdown}</p>
                ) : null}
                <div className="portal-focus-item-actions" onClick={(e) => e.stopPropagation()}>
                  {item.url ? (
                    <button
                      type="button"
                      className="portal-focus-btn--join"
                      onClick={() => { window.location.href = item.url!; }}
                    >
                      直达 ›
                    </button>
                  ) : null}
                  {item.type !== 'meeting' ? (
                    <button
                      type="button"
                      className="portal-focus-btn--decompose"
                      onClick={() => openDecompose(item)}
                    >
                      拆解任务
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="portal-focus-btn--record"
                      onClick={() => { setFocusDetailItem(item); }}
                    >
                      🎙 会议记录
                    </button>
                  )}
                  <button
                    type="button"
                    className="portal-focus-btn--ai"
                    onClick={() => onOpenAiFriends?.()}
                  >
                    ✦
                  </button>
                </div>
              </div>
            ))}
            {!focusExpanded && focusItems.length > 2 ? (
              <button
                type="button"
                className="portal-focus-expand-btn"
                onClick={() => setFocusExpanded(true)}
              >
                不急，有空再看 · 还有 {focusItems.length - 2} 件 ›
              </button>
            ) : null}
          </section>
        ) : null}

        <button
          type="button"
          className="portal-quote portal-quote--button"
          aria-label={`${t(locale, 'dashboardQuoteLabel')}，${t(locale, 'dashboardQuoteOpenSettingsLabel')}`}
          onClick={() => setQuoteSettingsOpen(true)}
          onPointerUp={() => setQuoteSettingsOpen(true)}
        >
          <p className="portal-quote-text">{quoteLine}</p>
        </button>
      </section>

      {/* ── Focus item detail sheet ── */}
      {focusDetailItem ? (
        <div className="portal-reminder-sheet" role="presentation">
          <button type="button" className="portal-reminder-backdrop" onClick={() => setFocusDetailItem(null)} aria-label="关闭" />
          <section className="portal-reminder-card portal-reminder-card--detail" role="dialog" aria-modal="true">
            <span className="portal-crush-sheet-handle" aria-hidden />
            <p className="portal-v13-kicker">
              {focusDetailItem.type === 'meeting' ? '会议提醒' : focusDetailItem.type === 'task' ? '待办' : '日程'}
            </p>
            <h2>{focusDetailItem.title}</h2>
            {focusDetailItem.body ? <p>{focusDetailItem.body}</p> : null}
            {focusDetailItem.timeLabel || focusDetailItem.countdown ? (
              <p>
                <b style={{ color: 'var(--portal-cool-accent)' }}>
                  {[focusDetailItem.timeLabel, focusDetailItem.countdown].filter(Boolean).join(' · ')}
                </b>
              </p>
            ) : null}
            {focusDetailItem.type === 'meeting' ? (
              <>
                {focusDetailItem.url ? (
                  <button
                    type="button"
                    className="portal-reminder-primary"
                    onClick={() => window.location.href = focusDetailItem.url!}
                  >
                    📹 加入会议
                  </button>
                ) : null}
                <div className="portal-focus-record-row">
                  <span>✦ AI 会议记录</span>
                  <small>实时整理要点，生成摘要与待办</small>
                  <button
                    type="button"
                    className="portal-reminder-record"
                    onClick={() => { setFocusDetailItem(null); setMeetingRecording(true); }}
                  >
                    开始录音
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="portal-reminder-primary"
                  onClick={() => { openDecompose(focusDetailItem); setFocusDetailItem(null); }}
                >
                  拆解任务
                </button>
                <button
                  type="button"
                  className="portal-reminder-record"
                  onClick={() => { setFocusDetailItem(null); onOpenAiFriends?.(); }}
                >
                  ✦ 在智友里处理
                </button>
              </>
            )}
            <button type="button" className="portal-reminder-close" onClick={() => setFocusDetailItem(null)}>关闭</button>
          </section>
        </div>
      ) : null}

      {/* ── 2-level task decompose sheet ── */}
      {decomposeTarget ? (
        <div className="portal-crush-sheet" role="presentation">
          <button type="button" className="portal-crush-sheet-backdrop" onClick={() => setDecomposeTarget(null)} aria-label="关闭" />
          <section className="portal-crush-sheet-card" role="dialog" aria-modal="true">
            <div className="portal-crush-sheet-handle" aria-hidden />
            <div className="portal-crush-sheet-head">
              <div>
                <p className="portal-v13-kicker">粉碎任务</p>
                <h2>{decomposeTarget.title}</h2>
              </div>
              <button type="button" className="portal-crush-sheet-close" onClick={() => setDecomposeTarget(null)}>
                <span aria-hidden>×</span>
              </button>
            </div>
            <p className="portal-crush-sheet-copy">把这件事拆成几步，先做最小的一个。</p>

            {decomposeLoading ? (
              <p className="portal-decompose-loading">AI 正在拆解…</p>
            ) : (
              <ol className="portal-decompose-steps">
                {decomposeSteps.map((step, idx) => (
                  <li key={idx} className="portal-decompose-step">
                    <div className="portal-decompose-step-row">
                      <span className="portal-decompose-step-icon">{step.emoji}</span>
                      <div className="portal-decompose-step-body">
                        <strong>{step.name}</strong>
                        <small>{step.durationMin} 分钟</small>
                      </div>
                      {!step.subSteps ? (
                        <button
                          type="button"
                          className="portal-decompose-drill-btn"
                          onClick={() => drillStep(idx, step)}
                          disabled={step.drillLoading}
                        >
                          {step.drillLoading ? '…' : '再拆'}
                        </button>
                      ) : null}
                    </div>
                    {step.subSteps ? (
                      <ul className="portal-decompose-substeps">
                        {step.subSteps.map((sub, si) => (
                          <li key={si}>
                            <span>{sub.emoji}</span>
                            <span>{sub.name}</span>
                            <small>{sub.durationMin}min</small>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            <div className="portal-crush-sheet-actions">
              <button
                type="button"
                className="portal-crush-sheet-primary"
                onClick={() => { setDecomposeTarget(null); onOpenAiFriends?.(); }}
              >
                ✦ 在智友里处理
              </button>
              <button type="button" className="portal-crush-sheet-secondary" onClick={() => setDecomposeTarget(null)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {moodPickerOpen ? (
        <div className="portal-mood-sheet" role="presentation">
          <button
            type="button"
            className="portal-mood-backdrop"
            aria-label={t(locale, 'dashboardMoodClose')}
            onClick={() => setMoodPickerOpen(false)}
          />
          <section className="portal-mood-card" role="dialog" aria-modal="true" aria-label={t(locale, 'dashboardMoodTitle')}>
            <h2>{t(locale, 'dashboardMoodTitle')}</h2>
            <p style={{ color: hoveredMood.color }}>{t(locale, hoveredMood.labelKey)}</p>
            <div
              ref={moodWheelRef}
              className="portal-mood-wheel"
              aria-label={t(locale, 'dashboardMoodWheelLabel')}
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
            <small>{t(locale, 'dashboardMoodInstruction')}</small>
            <button type="button" className="portal-mood-done" onClick={() => setMoodPickerOpen(false)}>
              {t(locale, 'dashboardMoodDone')}
            </button>
          </section>
        </div>
      ) : null}

      {scheduleSheetOpen ? (
        <div className="portal-reminder-sheet" role="presentation">
          <button
            type="button"
            className="portal-reminder-backdrop"
            aria-label={t(locale, 'dashboardScheduleClose')}
            onClick={() => setScheduleSheetOpen(false)}
          />
          <section className="portal-reminder-card" role="dialog" aria-modal="true" aria-label={t(locale, 'dashboardScheduleTodayLabel')}>
            <span className="portal-crush-sheet-handle" aria-hidden />
            <h2>{t(locale, 'dashboardScheduleTitle')}</h2>
            <button type="button" onClick={() => setReminderDetail('task')}>
              <span>{t(locale, 'dashboardScheduleFirstLabel')}</span>
              <b>{t(locale, 'dashboardScheduleTaskEmail')}</b>
              <small><em>{t(locale, 'dashboardScheduleStart1430')}</em><em>{t(locale, 'dashboardScheduleSuggestedToday')}</em></small>
            </button>
            <button type="button" onClick={() => setReminderDetail('meeting')}>
              <span>{t(locale, 'dashboardScheduleTodayLabel')}</span>
              <b>{t(locale, 'dashboardScheduleMeetingTitle')}</b>
              <small><em>{t(locale, 'dashboardScheduleStart1500')}</em><em>{t(locale, 'dashboardScheduleRemaining4Hours')}</em></small>
            </button>
            <button type="button" onClick={() => setReminderDetail('task')}>
              <span>{t(locale, 'dashboardScheduleLaterLabel')}</span>
              <b>{t(locale, 'dashboardScheduleQuarterlyReport')}</b>
              <small><em>{t(locale, 'dashboardScheduleStartFriday')}</em><em>{t(locale, 'dashboardScheduleThisWeek')}</em></small>
            </button>
          </section>
        </div>
      ) : null}

      {reminderDetail ? (
        <div className="portal-reminder-sheet" role="presentation">
          <button
            type="button"
            className="portal-reminder-backdrop"
            aria-label={t(locale, 'dashboardReminderDetailClose')}
            onClick={() => setReminderDetail(null)}
          />
          <section className="portal-reminder-card portal-reminder-card--detail" role="dialog" aria-modal="true" aria-label={reminderDetail === 'meeting' ? t(locale, 'dashboardReminderMeetingLabel') : t(locale, 'dashboardReminderDetailLabel')}>
            <span className="portal-crush-sheet-handle" aria-hidden />
            {reminderDetail === 'meeting' ? (
              <>
                <p className="portal-v13-kicker">{t(locale, 'dashboardReminderMeetingLabel')}</p>
                <h2>{t(locale, 'dashboardScheduleMeetingTitle')}</h2>
                <p>{t(locale, 'dashboardMeetingDescription')}</p>
                <p><b>{t(locale, 'dashboardMeetingTimeRemaining')}</b></p>
                <button
                  type="button"
                  className="portal-reminder-primary"
                  data-runtime-action="dashboard-open-meeting-link"
                  onClick={openMeetingJoinUrl}
                >
                  📹 {meetingEvent?.url ? t(locale, 'dashboardMeetingJoin') : t(locale, 'dashboardMeetingConnectCalendar')}
                </button>
                <button
                  type="button"
                  className="portal-reminder-record"
                  onClick={() => setMeetingRecording(true)}
                >
                  ▶ {meetingRecording ? t(locale, 'dashboardMeetingRecordingStarted') : t(locale, 'dashboardMeetingRecordingStart')}
                </button>
              </>
            ) : (
              <>
                <p className="portal-v13-kicker">{t(locale, 'dashboardReminderDetailLabel')}</p>
                <h2>{t(locale, 'dashboardScheduleTaskEmail')}</h2>
                <p>{t(locale, 'dashboardTaskDetailBody')}</p>
                <p><b>{t(locale, 'dashboardTaskTimeSuggested')}</b></p>
                <button type="button" className="portal-reminder-primary" onClick={onOpenAiFriends}>✦ {t(locale, 'dashboardTaskHandleInAiFriends')}</button>
              </>
            )}
            <button type="button" className="portal-reminder-close" onClick={() => setReminderDetail(null)}>{t(locale, 'dashboardReminderClose')}</button>
          </section>
        </div>
      ) : null}

      {healthGateOpen ? (
        <div className="portal-reminder-sheet" role="presentation">
          <button
            type="button"
            className="portal-reminder-backdrop"
            aria-label={t(locale, 'dashboardHealthGateClose')}
            onClick={() => setHealthGateOpen(false)}
          />
          <section className="portal-reminder-card portal-reminder-card--detail" role="dialog" aria-modal="true" aria-label={t(locale, 'dashboardHealthGateHeading')}>
            <span className="portal-crush-sheet-handle" aria-hidden />
            <p className="portal-v13-kicker">{t(locale, 'dashboardHealthGateTitle')}</p>
            <h2>{t(locale, 'dashboardHealthGateHeading')}</h2>
            <p>{t(locale, 'dashboardHealthGateBody')}</p>
            <button
              type="button"
              className="portal-reminder-primary"
              onClick={() => {
                setHealthGateOpen(false);
                onTreasureOpenChange(true);
              }}
            >
              {t(locale, 'dashboardHealthGateBuy')}
            </button>
            <button type="button" className="portal-reminder-close" onClick={() => setHealthGateOpen(false)}>{t(locale, 'dashboardHealthGateLater')}</button>
          </section>
        </div>
      ) : null}

      {/* Meeting recorder (from focus detail or calendar event) */}
      <MeetingRecorder open={meetingRecording} onClose={() => setMeetingRecording(false)} />

      {/* Selected calendar event detail */}
      {selectedEvent ? (
        <div className="portal-reminder-sheet" role="presentation">
          <button type="button" className="portal-reminder-backdrop" onClick={() => setSelectedEvent(null)} aria-label="关闭" />
          <section className="portal-reminder-card portal-reminder-card--detail" role="dialog" aria-modal="true">
            <span className="portal-crush-sheet-handle" aria-hidden />
            <p className="portal-v13-kicker">
              {looksLikeMeetingEvent(selectedEvent) ? '会议提醒' : formatEventDayLabel(selectedEvent, now, calendarTz)}
            </p>
            <h2>{selectedEvent.title}</h2>
            {selectedEvent.description ? <p>{selectedEvent.description}</p> : null}
            {selectedEvent.location ? <p>📍 {selectedEvent.location}</p> : null}
            <p><b style={{ color: 'var(--portal-cool-accent)' }}>
              {formatEventTime(selectedEvent, locale)} · {formatEventCountdown(selectedEvent, now, locale)}
            </b></p>
            {looksLikeMeetingEvent(selectedEvent) ? (
              <>
                {selectedEvent.url ? (
                  <button type="button" className="portal-reminder-primary" onClick={() => window.location.href = selectedEvent.url!}>
                    📹 加入会议
                  </button>
                ) : null}
                <div className="portal-focus-record-row">
                  <span>✦ AI 会议记录</span>
                  <small>Granola 风格 · 由智友后台整理</small>
                  <button type="button" className="portal-reminder-record" onClick={() => { setSelectedEvent(null); setMeetingRecording(true); }}>
                    开始录音
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="portal-reminder-primary" onClick={() => { setSelectedEvent(null); onOpenAiFriends?.(); }}>
                ✦ 在智友里处理
              </button>
            )}
            <button type="button" className="portal-reminder-close" onClick={() => setSelectedEvent(null)}>关闭</button>
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
              <li
                key={ev.id}
                className="portal-calendar-event portal-calendar-event--tap"
                onClick={() => setSelectedEvent(ev)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedEvent(ev); }}
                aria-label={`查看详情：${ev.title}`}
              >
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
                    {looksLikeMeetingEvent(ev) ? (
                      <span className="portal-calendar-meeting-badge" aria-hidden>🎙</span>
                    ) : null}
                    <span className="portal-calendar-chevron" aria-hidden>›</span>
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
