/**
 * Reasoning Engine — generates RecommendationCards from live signals.
 *
 * Pipeline:
 *   Connectors (weather, calendar, life-graph) → normalize → score → rank → emit cards
 *
 * MVP: rule-based. Each rule checks signal conditions and emits a typed card.
 * Future: LLM reasoning layer can be added on top of this same interface.
 */

import { getRecentNodes } from './life-graph';
import { PORTAL_CACHE_KEYS, readPortalCache } from './prefetch-cache';
import type { CalendarEvent } from './types';

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

interface WeatherSignal {
  temperatureC?: number;
  condition?: string;
  forecastNote?: string;
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

/** Score = urgency * confidence * 0.5 + timing bonus */
function score(card: RecommendationCard): number {
  const timingBonus = new Date(card.expiresAt).getTime() - Date.now() < 3_600_000 ? 0.2 : 0;
  return card.urgency * card.confidence * 0.5 + timingBonus;
}

/** Rule: weather drop + health signal → coat reminder */
function ruleWeatherCoat(weather: WeatherSignal, healthNodes: ReturnType<typeof getRecentNodes>): RecommendationCard | null {
  const note = weather.forecastNote?.toLowerCase() || '';
  const cold = note.includes('降温') || note.includes('cold') || (weather.temperatureC !== undefined && weather.temperatureC < 15);
  if (!cold) return null;

  const sick = healthNodes.some((n) => n.type === 'health_state' && n.attributes['status'] === 'recovering');
  return {
    id: 'weather-coat',
    domain: 'weather',
    domainLabel: '未来引导',
    confidence: sick ? 0.93 : 0.78,
    urgency: 3,
    icon: '🌧',
    iconBg: '#f59e0b',
    title: '把外套放到门口',
    body: sick
      ? `明天${weather.forecastNote}，你最近身体还在恢复，提前备好外套。`
      : `明天${weather.forecastNote}，出门前别忘了外套。`,
    tags: ['天气 · 降温', ...(sick ? ['健康 · 恢复中'] : [])],
    evidence: [
      { source: 'weather', label: '天气预报', value: weather.forecastNote || '降温' },
      ...(sick ? [{ source: 'life-graph', label: '健康状态', value: '恢复中' }] : []),
    ],
    primaryAction: '好的，放门口',
    secondaryAction: '稍后',
    type: 'standard',
    expiresAt: todayEndISO(),
  };
}

/** Rule: upcoming meeting → audio brief card */
function ruleMeetingBrief(events: CalendarEvent[]): RecommendationCard | null {
  const now = Date.now();
  const next = events.find((e) => {
    const start = new Date(e.start).getTime();
    return start > now && start - now < 14 * 3_600_000; // within 14h
  });
  if (!next) return null;

  const startTime = new Date(next.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return {
    id: `meeting-${next.id || next.start}`,
    domain: 'work',
    domainLabel: '语音简报',
    confidence: 0.88,
    urgency: 4,
    icon: '🎙',
    iconBg: '#6366f1',
    title: `${next.title || '会议'}，不用翻笔记`,
    body: `今天 ${startTime} 的会，Nesio 整理了关键提醒。`,
    evidence: [{ source: 'calendar', label: '日历', value: next.title || '会议' }],
    primaryAction: '查看',
    secondaryAction: '改时间',
    type: 'audio',
    expiresAt: next.start,
  };
}

/** Rule: life graph object with upcoming deadline → family card */
function ruleFamilyCommitment(): RecommendationCard | null {
  const nodes = getRecentNodes(20);
  const commitments = nodes.filter((n) => n.type === 'commitment' || n.type === 'object');
  if (!commitments.length) return null;
  const top = commitments[0];
  return {
    id: `family-${top.id}`,
    domain: 'family',
    domainLabel: '家庭提醒',
    confidence: 0.88,
    urgency: 3,
    icon: '🎁',
    iconBg: '#10b981',
    title: top.name,
    body: top.rawInput || `来自你的 Memory 记录。`,
    evidence: [{ source: 'life-graph', label: '记忆', value: top.name }],
    primaryAction: '好的',
    secondaryAction: '在 Memory 里看',
    type: 'standard',
    expiresAt: tomorrowISO(),
  };
}

/** Main entry point: generate ranked cards from available signals */
export function generateTodayCards(): RecommendationCard[] {
  const weatherRaw = readPortalCache<Record<string, unknown>>('nesio-weather-v1') as WeatherSignal | null;
  const calendarRaw = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
  const events = calendarRaw?.events ?? [];
  const lifeNodes = getRecentNodes(20);
  const healthNodes = lifeNodes.filter((n) => n.type === 'health_state');

  const candidates: RecommendationCard[] = [
    ruleWeatherCoat(weatherRaw ?? {}, healthNodes),
    ruleMeetingBrief(events),
    ruleFamilyCommitment(),
  ].filter((c): c is RecommendationCard => c !== null);

  return candidates
    .sort((a, b) => score(b) - score(a))
    .slice(0, 5);
}

/** Feedback — stores user reaction to a card, used for future ranking tuning */
const FEEDBACK_KEY = 'nesio-card-feedback-v1';

export function recordCardFeedback(cardId: string, feedback: RecommendationCard['feedback']): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}');
    existing[cardId] = { feedback, at: new Date().toISOString() };
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(existing));
  } catch {
    /* ignore */
  }
}
