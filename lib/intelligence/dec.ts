/**
 * DEC — Decision Engine (PRD Ch.36).
 *
 * The cross-domain reasoning center. Belongs to no single domain. Reads all
 * Signals + the current Life State and outputs Recommendations with traceable
 * Evidence and Confidence. Today, Mirror and Future Guidance all depend on DEC.
 *
 * v1 is hybrid: rules + Life State. Every emitted card carries evidence that
 * points back to a Signal id where possible (PRD gate: no evidence → not Today).
 * Cross-signal rules (e.g. load reduction) are what single-signal triggers
 * cannot produce — this is the DEC's reason to exist.
 */

import {
  type RecommendationCard,
  type EvidenceRef,
  scoreCard,
  readCardFeedbackAll,
} from '../portal/reasoning-engine';
import { PORTAL_CACHE_KEYS, readPortalCache } from '../portal/prefetch-cache';
import type { WeatherSnapshot } from '../portal/weather';
import {
  getRecentSignals,
  type Signal,
} from '../life-domain/signal';
import {
  computeLifeState,
  type LifeState,
} from '../life-domain/life-state';
import {
  cardToRecommendation,
  hasEvidence,
  type Recommendation,
} from '../life-domain/recommendation';
import { checkPlatformHealth, type PlatformHealth } from './platform-health';

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

// ── Governance guardrails (PRD v3.0 Stage 1) ────────────────────────────────

/** Confidence Threshold (§2.2). Below this, the pipeline physically degrades —
 *  the card never reaches Today. Silence beats a confident-sounding guess. */
const CONFIDENCE_FLOOR = 0.6;

/** Attention Budget (§2.1). Today shows at most 3 cards; the rest sink to the
 *  console and never crowd the home surface. */
const TODAY_CARD_BUDGET = 3;

/** Two-Domain Constraint Sandbox (§4.2). DEC v1 only allows these cross-domain
 *  pairs. Single-domain rules are unconstrained. This caps GIGO from unbounded
 *  full-graph reasoning. Declared here as the contract each cross-domain rule
 *  must fit; widening the sandbox is a deliberate, reviewable change. */
export const DEC_SANDBOX_PAIRS = [
  ['health', 'calendar'],
  ['health', 'weather'],
  ['task', 'calendar'],
] as const;

/** Build an evidence ref that traces back to a real Signal. */
function signalEvidence(sig: Signal, label: string): EvidenceRef {
  return {
    source: sig.source,
    label,
    value: sig.title,
    signalId: sig.id,
  };
}

// ── Rules (signal-backed, traceable evidence) ───────────────────────────────

/** Weather drop + optional health signal → coat reminder. Weather is a cache
 *  snapshot (not a Life Graph Signal), so its evidence is a source ref. */
function ruleWeatherCoat(weather: WeatherSnapshot | null, healthSignals: Signal[]): RecommendationCard | null {
  if (!weather) return null;
  const note = (weather.forecastNote || '').toLowerCase();
  const cold = note.includes('降温') || note.includes('cold') || note.includes('rain') ||
    note.includes('雨') || weather.temperatureC < 15;
  if (!cold) return null;

  const activeHealth = healthSignals[0];
  return {
    id: 'weather-coat',
    domain: 'weather',
    domainLabel: '未来引导',
    confidence: activeHealth ? 0.93 : 0.78,
    urgency: 3,
    icon: '🌧',
    iconBg: '#f59e0b',
    title: '把外套放到门口',
    body: activeHealth
      ? `${weather.forecastNote || '明天降温'}，你最近${activeHealth.title}还在恢复，提前备好外套。`
      : `${weather.forecastNote ? `预计${weather.forecastNote}` : '明天气温较低'}，出门前备好外套。`,
    tags: [`天气 · ${weather.condition}`, ...(activeHealth ? ['健康 · 恢复中'] : [])],
    evidence: [
      { source: 'weather', label: '天气', value: `${weather.temperatureC}°C, ${weather.condition}` },
      ...(weather.forecastNote ? [{ source: 'weather', label: '预报', value: weather.forecastNote }] : []),
      ...(activeHealth ? [signalEvidence(activeHealth, '健康记录')] : []),
    ],
    primaryAction: '好的，放门口',
    secondaryAction: '稍后',
    type: 'standard',
    expiresAt: todayEndISO(),
  };
}

/** Upcoming meeting within 14h → audio brief card. */
function ruleMeetingBrief(eventSignals: Signal[]): RecommendationCard | null {
  const now = Date.now();
  const next = eventSignals
    .filter((s) => {
      const t = new Date(s.occurredAt).getTime();
      return t > now && t - now < 14 * 3_600_000;
    })
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())[0];
  if (!next) return null;

  const startTime = new Date(next.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const isSoon = new Date(next.occurredAt).getTime() - now < 3_600_000;
  const location = typeof next.content === 'object' ? String((next.content as Record<string, unknown>)['location'] || '') : '';

  return {
    id: `meeting-${next.id}`,
    domain: 'work',
    domainLabel: '语音简报',
    confidence: 0.88,
    urgency: isSoon ? 5 : 4,
    icon: '🎙',
    iconBg: '#6366f1',
    title: `${next.title || '即将开始的会'}，不用翻笔记`,
    body: `${isSoon ? '马上' : `今天 ${startTime}`}的会，Nesio 整理了关键提醒。${location ? ` 地点：${location}` : ''}`,
    evidence: [signalEvidence(next, '日历'), { source: 'calendar', label: '时间', value: startTime, signalId: next.id }],
    primaryAction: '查看',
    secondaryAction: '改时间',
    type: 'audio',
    expiresAt: next.occurredAt,
  };
}

/** Commitment / object from Life Graph → family card. */
function ruleFamilyCommitment(signals: Signal[]): RecommendationCard | null {
  const top = signals.find((s) => s.type === 'commitment' || s.type === 'observation' || s.type === 'event');
  if (!top) return null;

  return {
    id: `family-${top.id}`,
    domain: 'family',
    domainLabel: '家庭提醒',
    confidence: top.confidence,
    urgency: 3,
    icon: top.type === 'commitment' ? '🤝' : top.type === 'event' ? '📅' : '📦',
    iconBg: '#d1fae5',
    title: top.title,
    body: typeof top.content === 'string'
      ? top.content
      : `来自你的 Memory 记录 · ${new Date(top.capturedAt).toLocaleDateString('zh-CN')}`,
    evidence: [signalEvidence(top, '记忆')],
    primaryAction: '好的',
    secondaryAction: '在 Memory 看',
    type: 'standard',
    expiresAt: tomorrowISO(),
  };
}

/** Health signal → gentle health reminder, cross-referenced with weather. */
function ruleHealthState(weather: WeatherSnapshot | null, healthSignals: Signal[]): RecommendationCard | null {
  const health = healthSignals[0];
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
    title: `注意${health.title}`,
    body: cold
      ? `气温下降，注意保暖，配合${health.title}的恢复。`
      : `记录显示你最近${health.title}，注意休息。`,
    evidence: [
      signalEvidence(health, '健康记录'),
      ...(cold ? [{ source: 'weather', label: '气温', value: `${weather!.temperatureC}°C` }] : []),
    ],
    primaryAction: '记录今天状态',
    secondaryAction: '稍后',
    type: 'standard',
    expiresAt: tomorrowISO(),
  };
}

/** CROSS-SIGNAL rule — only the DEC can produce this. When the Life State shows
 *  high work load and/or low energy, suggest reducing load. Evidence traces to
 *  the driver signals behind those dimensions. */
function ruleLoadReduction(lifeState: LifeState): RecommendationCard | null {
  const work = lifeState.dimensions.find((d) => d.dimension === 'work');
  const energy = lifeState.dimensions.find((d) => d.dimension === 'energy');
  const overloaded = work?.level === 'high_load';
  const tired = energy?.level === 'low';
  if (!overloaded && !tired) return null;

  const driverIds = [...(work?.driverSignalIds || []), ...(energy?.driverSignalIds || [])];
  const allSignals = getRecentSignals();
  const driverSignals = driverIds.map((id) => allSignals.find((s) => s.id === id)).filter((s): s is Signal => Boolean(s));

  return {
    id: 'dec-load-reduction',
    domain: 'work',
    domainLabel: '状态引导',
    confidence: 0.8,
    urgency: 4,
    icon: '🧘',
    iconBg: '#a78bfa',
    title: tired && overloaded ? '今天给自己留点余地' : overloaded ? '安排偏满，挑重点做' : '精力偏低，别硬撑',
    body: lifeState.explanation,
    tags: ['跨信号', ...(overloaded ? ['工作密集'] : []), ...(tired ? ['精力偏低'] : [])],
    evidence: driverSignals.length
      ? driverSignals.map((s) => signalEvidence(s, '状态信号'))
      : [{ source: 'life-state', label: '当前状态', value: lifeState.explanation }],
    primaryAction: '好的',
    secondaryAction: '查看状态',
    type: 'standard',
    expiresAt: todayEndISO(),
  };
}

// ── DEC entry point ──────────────────────────────────────

export interface DECOutput {
  lifeState: LifeState;
  cards: RecommendationCard[];
  recommendations: Recommendation[];
  health: PlatformHealth;
}

export function runDEC(): DECOutput {
  const weather = readPortalCache<WeatherSnapshot>(PORTAL_CACHE_KEYS.weather);
  const signals = getRecentSignals();
  const lifeState = computeLifeState();

  // Platform self-awareness: check data health before reasoning (§2.2).
  const health = checkPlatformHealth();

  const eventSignals = signals.filter((s) => s.type === 'event' && s.source === 'calendar');
  const healthSignals = signals.filter((s) => s.type === 'symptom');

  // When degraded (stale / thin / low-confidence data), retreat to the
  // single-domain rule engine — skip cross-signal inference (ruleLoadReduction).
  const candidates: (RecommendationCard | null)[] = [
    ruleMeetingBrief(eventSignals),
    ...(health.degraded ? [] : [ruleLoadReduction(lifeState)]), // cross-signal — DEC-only, gated on health
    ruleWeatherCoat(weather, healthSignals),
    ruleHealthState(weather, healthSignals),
    ruleFamilyCommitment(signals),
  ];

  const feedback = readCardFeedbackAll();
  const cards = candidates
    .filter((c): c is RecommendationCard => c !== null)
    // Confidence Threshold: physically degrade low-confidence guesses.
    .filter((c) => c.confidence >= CONFIDENCE_FLOOR)
    .filter((c) => {
      const fb = feedback[c.id];
      if (!fb) return true;
      if (fb.feedback === 'too_much' || fb.feedback === 'useful') return false;
      if (fb.feedback === 'not_now') return Date.now() - new Date(fb.at).getTime() > 4 * 3_600_000;
      return true;
    })
    .sort((a, b) => scoreCard(b) - scoreCard(a))
    // Attention Budget:末位淘汰，首页最多 3 张。
    .slice(0, TODAY_CARD_BUDGET);

  // Canonical recommendations, gated on evidence (PRD: no evidence → not Today)
  const recommendations = cards
    .map(cardToRecommendation)
    .filter(hasEvidence);

  // Back-link recommended guidance into the Life State
  lifeState.recommendedGuidanceIds = recommendations.map((r) => r.id);

  return { lifeState, cards, recommendations, health };
}

/** Backward-compatible: existing Today UI consumes view-model cards. */
export function generateTodayCards(): RecommendationCard[] {
  return runDEC().cards;
}
