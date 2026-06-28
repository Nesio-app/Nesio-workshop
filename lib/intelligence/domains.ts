/**
 * Domain Engines (PRD v3.0 §3.2 / §31).
 *
 * Each life domain reasons about its own facts and emits Today recommendation
 * candidates via the InsightContract. The DEC discovers these through the
 * registry — it no longer hard-codes the rule list. Adding a domain = implement
 * DomainEngine + register; DEC and Today are untouched (§28.7).
 *
 * The rule logic here is the same that previously lived inline in dec.ts, now
 * owned by its domain. Cross-domain engines declare their sandbox pair and are
 * gated on platform health by the DEC.
 */

import type { DomainEngine, DECContext } from './contracts';
import { registerDomain } from './registry';
import type { RecommendationCard, EvidenceRef } from '../portal/reasoning-engine';
import type { Signal } from '../life-domain/signal';

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
function signalEvidence(sig: Signal, label: string): EvidenceRef {
  return { source: sig.source, label, value: sig.title, signalId: sig.id };
}
function one(card: RecommendationCard | null): RecommendationCard[] {
  return card ? [card] : [];
}
function contentNumber(sig: Signal, key: string): number {
  if (!sig.content || typeof sig.content !== 'object') return NaN;
  return Number((sig.content as Record<string, unknown>)[key]);
}
function contentString(sig: Signal, key: string): string {
  if (!sig.content || typeof sig.content !== 'object') return '';
  return String((sig.content as Record<string, unknown>)[key] || '');
}
function isSleepOrEnergySignal(sig: Signal): boolean {
  const type = contentString(sig, 'type').toLowerCase();
  const tags = (sig.tags || []).join(' ').toLowerCase();
  const title = sig.title.toLowerCase();
  const sourceLooksHealth = sig.source === 'health' || sig.sensitivity === 'health';
  const contentLooksEnergy = type.includes('sleep') || type.includes('energy') ||
    tags.includes('sleep') || tags.includes('energy') || tags.includes('睡眠') || tags.includes('精力') ||
    title.includes('sleep') || title.includes('睡眠') || title.includes('energy') || title.includes('精力');
  return sourceLooksHealth && contentLooksEnergy;
}
function isCalendarEventToday(sig: Signal, nowMs = Date.now()): boolean {
  if (sig.type !== 'event' || sig.source !== 'calendar') return false;
  const t = new Date(sig.occurredAt).getTime();
  return Number.isFinite(t) && t > nowMs - 3 * 3_600_000 && t < nowMs + 18 * 3_600_000;
}
function formatEventTime(sig: Signal): string {
  return new Date(sig.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// ── Weather domain (Health + Weather sandbox) ───────────────────────────────

const weatherDomain: DomainEngine = {
  domain: 'weather',
  version: 1,
  crossDomain: true,
  sandboxPair: ['health', 'weather'],
  provideInsights(ctx: DECContext): RecommendationCard[] {
    const { weather } = ctx;
    if (!weather) return [];
    const note = (weather.forecastNote || '').toLowerCase();
    const cold = note.includes('降温') || note.includes('cold') || note.includes('rain') ||
      note.includes('雨') || weather.temperatureC < 15;
    if (!cold) return [];

    const activeHealth = ctx.signals.find((s) => s.type === 'symptom');
    return one({
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
      primaryAction: '确认，放到门口',
      secondaryAction: '稍后',
      type: 'standard',
      expiresAt: todayEndISO(),
    });
  },
};

// ── Work domain (Task + Calendar sandbox) ───────────────────────────────────

const workDomain: DomainEngine = {
  domain: 'work',
  version: 1,
  crossDomain: true,
  sandboxPair: ['task', 'calendar'],
  provideInsights(ctx: DECContext): RecommendationCard[] {
    const now = Date.now();
    const next = ctx.signals
      .filter((s) => s.type === 'event' && s.source === 'calendar')
      .filter((s) => {
        const t = new Date(s.occurredAt).getTime();
        return t > now && t - now < 14 * 3_600_000;
      })
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())[0];
    if (!next) return [];

    const startTime = new Date(next.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const isSoon = new Date(next.occurredAt).getTime() - now < 3_600_000;
    const location = typeof next.content === 'object' ? String((next.content as Record<string, unknown>)['location'] || '') : '';

    return one({
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
    });
  },
};

// ── Health domain (Health + Weather sandbox) ────────────────────────────────

const healthDomain: DomainEngine = {
  domain: 'health',
  version: 1,
  crossDomain: true,
  sandboxPair: ['health', 'weather'],
  provideInsights(ctx: DECContext): RecommendationCard[] {
    const health = ctx.signals.find((s) => s.type === 'symptom');
    if (!health) return [];
    const cold = ctx.weather && ctx.weather.temperatureC < 15;
    return one({
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
        ...(cold ? [{ source: 'weather', label: '气温', value: `${ctx.weather!.temperatureC}°C` }] : []),
      ],
      primaryAction: '记录今天状态',
      secondaryAction: '稍后',
      type: 'standard',
      expiresAt: tomorrowISO(),
    });
  },
};

// ── Family / Memory domain (single-domain, unconstrained) ───────────────────

const familyDomain: DomainEngine = {
  domain: 'family',
  version: 1,
  provideInsights(ctx: DECContext): RecommendationCard[] {
    const top = ctx.signals.find((s) => s.type === 'commitment' || s.type === 'observation' || s.type === 'event');
    if (!top) return [];
    return one({
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
    });
  },
};

// ── Energy Allocation domain (true Health + Calendar sandbox) ───────────────

const energyCalendarDomain: DomainEngine = {
  domain: 'energy-calendar',
  version: 1,
  crossDomain: true,
  sandboxPair: ['health', 'calendar'],
  provideInsights(ctx: DECContext): RecommendationCard[] {
    const healthSignal = ctx.signals.find(isSleepOrEnergySignal);
    const calendarEvents = ctx.signals
      .filter((s) => isCalendarEventToday(s))
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    // Stage 3 rule: true two-domain reasoning only. If either domain is thin,
    // stand down instead of fabricating a weaker recommendation.
    if (!healthSignal || calendarEvents.length < 2) return [];

    const sleepHours = contentNumber(healthSignal, 'hours');
    const energyScore = contentNumber(healthSignal, 'energy');
    const lowSleep = Number.isFinite(sleepHours) && sleepHours < 6.5;
    const lowEnergy = Number.isFinite(energyScore) && energyScore <= 0.45;
    const denseCalendar = calendarEvents.length >= 4;
    if (!lowSleep && !lowEnergy && !denseCalendar) return [];

    const healthReason = lowSleep
      ? `睡眠 ${sleepHours}h 偏少`
      : lowEnergy
        ? '精力记录偏低'
        : '身体状态需要轻量安排';
    const firstEvents = calendarEvents.slice(0, 3);
    const eventSummary = firstEvents.map((s) => `${formatEventTime(s)} ${s.title}`).join(' / ');
    const confidence = denseCalendar && (lowSleep || lowEnergy) ? 0.9 : 0.76;

    return one({
      id: 'dec-energy-calendar-allocation',
      domain: 'work',
      domainLabel: '精力分配',
      confidence,
      urgency: denseCalendar ? 5 : 4,
      icon: '🧘',
      iconBg: '#a78bfa',
      title: '今天按精力分配会议间隙',
      body: `${healthReason}，同时今天有 ${calendarEvents.length} 个日程。建议把高耗能事项放在第一个空档，会议间只做轻任务。`,
      tags: ['Health × Calendar', denseCalendar ? '会议密集' : '日程可控', lowSleep || lowEnergy ? '精力需保护' : '轻量安排'],
      evidence: [
        signalEvidence(healthSignal, '健康/精力'),
        ...firstEvents.map((s) => signalEvidence(s, '日历')),
        { source: 'calendar', label: '会议密度', value: eventSummary || `${calendarEvents.length} 个日程` },
      ],
      primaryAction: '安排轻任务',
      secondaryAction: '查看状态',
      type: 'standard',
      expiresAt: todayEndISO(),
    });
  },
};

// ── Register all domains ────────────────────────────────────────────────────
// Adding a domain here is the ONLY change needed to extend Today (§28.7).
[weatherDomain, workDomain, healthDomain, familyDomain, energyCalendarDomain].forEach(registerDomain);
