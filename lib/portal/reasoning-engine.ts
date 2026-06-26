/**
 * Reasoning Engine — generates RecommendationCards from live signals.
 *
 * Pipeline:
 *   Connectors (weather, calendar, life-graph) → normalize → score → rank → emit cards
 *
 * Rule-based MVP. Each rule checks signal conditions and emits a typed card.
 */

import { getRecentNodes } from './life-graph';
import { PORTAL_CACHE_KEYS, readPortalCache } from './prefetch-cache';
import type { CalendarEvent } from './types';
import type { WeatherSnapshot } from './weather';

export type CardDomain = 'weather' | 'work' | 'family' | 'home' | 'health' | 'vehicle' | 'learning' | 'finance';

export interface EvidenceRef {
  source: string;
  label: string;
  value: string;
}

export interface RecommendationCard {
  id: string;
  domain: CardDomain;
  domainLabel: string;
  confidence: number;
  urgency: 1 | 2 | 3 | 4 | 5;
  icon: string;
  iconBg: string;
  title: string;
  body: string;
  tags?: string[];
  evidence: EvidenceRef[];
  primaryAction: string;
  secondaryAction?: string;
  type: 'standard' | 'audio' | 'compact';
  expiresAt: string;
  feedback?: 'useful' | 'wrong' | 'not_now' | 'too_much';
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function todayEndISO(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/** score = urgency * confidence * 0.5 + timing bonus */
function score(card: RecommendationCard): number {
  const timingBonus = new Date(card.expiresAt).getTime() - Date.now() < 3_600_000 ? 0.2 : 0;
  return card.urgency * card.confidence * 0.5 + timingBonus;
}

// ── Rules ──────────────────────────────────────────────

/** Weather drop + optional health signal → coat reminder */
function ruleWeatherCoat(weather: WeatherSnapshot | null, hasHealthIssue: boolean): RecommendationCard | null {
  if (!weather) return null;
  const note = (weather.forecastNote || '').toLowerCase();
  const cold = note.includes('降温') || note.includes('cold') || note.includes('rain') ||
    note.includes('雨') || weather.temperatureC < 15;
  if (!cold) return null;

  return {
    id: 'weather-coat',
    domain: 'weather',
    domainLabel: '未来引导',
    confidence: hasHealthIssue ? 0.93 : 0.78,
    urgency: 3,
    icon: '🌧',
    iconBg: '#f59e0b',
    title: '把外套放到门口',
    body: hasHealthIssue
      ? `明天${weather.forecastNote || '降温'}，你最近身体还在恢复，提前备好外套。`
      : `${weather.forecastNote ? `预计${weather.forecastNote}` : '明天气温较低'}，出门前备好外套。`,
    tags: [`天气 · ${weather.condition}`, ...(hasHealthIssue ? ['健康 · 恢复中'] : [])],
    evidence: [
      { source: 'weather', label: '天气', value: `${weather.temperatureC}°C, ${weather.condition}` },
      ...(weather.forecastNote ? [{ source: 'weather', label: '预报', value: weather.forecastNote }] : []),
    ],
    primaryAction: '好的，放门口',
    secondaryAction: '稍后',
    type: 'standard',
    expiresAt: todayEndISO(),
  };
}

/** Upcoming meeting within 14h → audio brief card */
function ruleMeetingBrief(events: CalendarEvent[]): RecommendationCard | null {
  const now = Date.now();
  const next = events.find((e) => {
    const start = new Date(e.start).getTime();
    return start > now && start - now < 14 * 3_600_000;
  });
  if (!next) return null;

  const startTime = new Date(next.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const isSoon = new Date(next.start).getTime() - now < 3_600_000;

  return {
    id: `meeting-${next.id || next.start}`,
    domain: 'work',
    domainLabel: '语音简报',
    confidence: 0.88,
    urgency: isSoon ? 5 : 4,
    icon: '🎙',
    iconBg: '#6366f1',
    title: `${next.title || '即将开始的会'}，不用翻笔记`,
    body: `${isSoon ? '马上' : `今天 ${startTime}`}的会，Nesio 整理了关键提醒。${next.location ? ` 地点：${next.location}` : ''}`,
    evidence: [
      { source: 'calendar', label: '日历', value: next.title || '会议' },
      { source: 'calendar', label: '时间', value: startTime },
    ],
    primaryAction: '查看',
    secondaryAction: '改时间',
    type: 'audio',
    expiresAt: next.start,
  };
}

/** Life graph commitment / object with no recent action → family card */
function ruleFamilyCommitment(): RecommendationCard | null {
  const nodes = getRecentNodes(20);
  const top = nodes.find((n) => n.type === 'commitment' || n.type === 'object' || n.type === 'event');
  if (!top) return null;

  return {
    id: `family-${top.id}`,
    domain: 'family',
    domainLabel: '家庭提醒',
    confidence: top.confidence,
    urgency: 3,
    icon: top.type === 'object' ? '📦' : top.type === 'event' ? '📅' : '🤝',
    iconBg: '#d1fae5',
    title: top.name,
    body: top.rawInput || `来自你的 Memory 记录 · ${new Date(top.createdAt).toLocaleDateString('zh-CN')}`,
    evidence: [{ source: 'life-graph', label: '记忆', value: top.name }],
    primaryAction: '好的',
    secondaryAction: '在 Memory 看',
    type: 'standard',
    expiresAt: tomorrowISO(),
  };
}

/** Health signal from life graph → gentle health reminder */
function ruleHealthState(weather: WeatherSnapshot | null): RecommendationCard | null {
  const nodes = getRecentNodes(30);
  const health = nodes.find((n) => n.type === 'health_state');
  if (!health) return null;

  const cold = weather && weather.temperatureC < 15;
  return {
    id: `health-${health.id}`,
    domain: 'health',
    domainLabel: '健康关注',
    confidence: 0.82,
    urgency: cold ? 4 : 2,
    icon: '🩷',
    iconBg: '#fce7f3',
    title: `注意${health.name}`,
    body: cold
      ? `气温下降，注意保暖，配合${health.name}的恢复。`
      : `记录显示你最近${health.name}，注意休息。`,
    evidence: [
      { source: 'life-graph', label: '健康记录', value: health.name },
      ...(cold ? [{ source: 'weather', label: '气温', value: `${weather!.temperatureC}°C` }] : []),
    ],
    primaryAction: '记录今天状态',
    secondaryAction: '稍后',
    type: 'standard',
    expiresAt: tomorrowISO(),
  };
}

// ── Main entry ──────────────────────────────────────────

export function generateTodayCards(): RecommendationCard[] {
  // Read from the same cache key that Portal.tsx writes
  const weatherRaw = readPortalCache<WeatherSnapshot>(PORTAL_CACHE_KEYS.weather);
  const calendarRaw = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
  const events = calendarRaw?.events ?? [];
  const lifeNodes = getRecentNodes(30);
  const hasHealthIssue = lifeNodes.some((n) => n.type === 'health_state');

  const candidates: (RecommendationCard | null)[] = [
    ruleMeetingBrief(events),           // urgency 4-5, show first if meeting soon
    ruleWeatherCoat(weatherRaw, hasHealthIssue),
    ruleHealthState(weatherRaw),
    ruleFamilyCommitment(),
  ];

  // Filter dismissed/snoozed cards from feedback store
  const feedback = readCardFeedbackAll();
  return candidates
    .filter((c): c is RecommendationCard => c !== null)
    .filter((c) => {
      const fb = feedback[c.id];
      if (!fb) return true;
      if (fb.feedback === 'too_much') return false;
      if (fb.feedback === 'useful') return false;
      if (fb.feedback === 'not_now') {
        // snooze 4h
        return Date.now() - new Date(fb.at).getTime() > 4 * 3_600_000;
      }
      return true;
    })
    .sort((a, b) => score(b) - score(a))
    .slice(0, 5);
}

// ── Feedback ────────────────────────────────────────────

const FEEDBACK_KEY = 'nesio-card-feedback-v1';

type FeedbackRecord = { feedback: RecommendationCard['feedback']; at: string };

function readCardFeedbackAll(): Record<string, FeedbackRecord> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}') as Record<string, FeedbackRecord>;
  } catch {
    return {};
  }
}

export function recordCardFeedback(cardId: string, feedback: RecommendationCard['feedback']): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readCardFeedbackAll();
    existing[cardId] = { feedback, at: new Date().toISOString() };
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(existing));
    // Notify mirror profile
    window.dispatchEvent(new CustomEvent('nesio-feedback-recorded', { detail: { cardId, feedback } }));
  } catch {
    /* ignore */
  }
}
