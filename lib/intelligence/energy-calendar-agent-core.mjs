function todayEndISO() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function contentNumber(sig, key) {
  if (!sig?.content || typeof sig.content !== 'object') return NaN;
  return Number(sig.content[key]);
}

function contentString(sig, key) {
  if (!sig?.content || typeof sig.content !== 'object') return '';
  return String(sig.content[key] || '');
}

function signalEvidence(sig, label) {
  return { source: sig.source, label, value: sig.title, signalId: sig.id };
}

export function isEnergyCalendarHealthSignal(sig) {
  const type = contentString(sig, 'type').toLowerCase();
  const tags = (sig.tags || []).join(' ').toLowerCase();
  const title = String(sig.title || '').toLowerCase();
  const sourceLooksHealth = sig.source === 'health' || sig.sensitivity === 'health';
  const contentLooksEnergy = type.includes('sleep') || type.includes('energy') ||
    tags.includes('sleep') || tags.includes('energy') || tags.includes('睡眠') || tags.includes('精力') ||
    title.includes('sleep') || title.includes('睡眠') || title.includes('energy') || title.includes('精力');
  return sourceLooksHealth && contentLooksEnergy;
}

export function isEnergyCalendarEventToday(sig, nowMs = Date.now()) {
  if (sig.type !== 'event' || sig.source !== 'calendar') return false;
  const t = new Date(sig.occurredAt).getTime();
  return Number.isFinite(t) && t > nowMs - 3 * 3_600_000 && t < nowMs + 18 * 3_600_000;
}

function formatEventTime(sig) {
  return new Date(sig.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function silent(reason) {
  return {
    agentId: 'energy-calendar-agent',
    status: 'silent',
    cards: [],
    audit: {
      sandboxPair: ['health', 'calendar'],
      usedTools: ['read_signals', 'read_life_state'],
      evidenceSignalIds: [],
      reason,
    },
  };
}

export function runEnergyCalendarAgentCore(ctx) {
  const healthSignal = ctx.signals.find(isEnergyCalendarHealthSignal);
  const calendarEvents = ctx.signals
    .filter((s) => isEnergyCalendarEventToday(s))
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  if (!healthSignal || calendarEvents.length < 2) return silent('missing_dual_domain_evidence');

  const sleepHours = contentNumber(healthSignal, 'hours');
  const energyScore = contentNumber(healthSignal, 'energy');
  const lowSleep = Number.isFinite(sleepHours) && sleepHours < 6.5;
  const lowEnergy = Number.isFinite(energyScore) && energyScore <= 0.45;
  const denseCalendar = calendarEvents.length >= 4;
  if (!lowSleep && !lowEnergy && !denseCalendar) return silent('insufficient_guidance_signal');

  const healthReason = lowSleep
    ? `睡眠 ${sleepHours}h 偏少`
    : lowEnergy
      ? '精力记录偏低'
      : '身体状态需要轻量安排';
  const firstEvents = calendarEvents.slice(0, 3);
  const eventSummary = firstEvents.map((s) => `${formatEventTime(s)} ${s.title}`).join(' / ');
  const evidenceSignalIds = [healthSignal.id, ...firstEvents.map((s) => s.id)];

  return {
    agentId: 'energy-calendar-agent',
    status: 'success',
    cards: [{
      id: 'agent-energy-calendar-allocation',
      domain: 'work',
      domainLabel: 'Agent 精力分配',
      confidence: denseCalendar && (lowSleep || lowEnergy) ? 0.9 : 0.76,
      urgency: denseCalendar ? 5 : 4,
      icon: '🧭',
      iconBg: '#a78bfa',
      title: '今天按精力分配会议间隙',
      body: `${healthReason}，同时今天有 ${calendarEvents.length} 个日程。建议把高耗能事项放在第一个空档，会议间只做轻任务。`,
      tags: ['Agent Native v0', 'Health × Calendar', denseCalendar ? '会议密集' : '日程可控'],
      evidence: [
        signalEvidence(healthSignal, '健康/精力'),
        ...firstEvents.map((s) => signalEvidence(s, '日历')),
        { source: 'calendar', label: '会议密度', value: eventSummary || `${calendarEvents.length} 个日程` },
      ],
      primaryAction: '安排轻任务',
      secondaryAction: '查看证据',
      type: 'standard',
      expiresAt: todayEndISO(),
    }],
    audit: {
      sandboxPair: ['health', 'calendar'],
      usedTools: ['read_signals', 'read_life_state', 'emit_recommendation_candidate'],
      evidenceSignalIds,
      reason: 'bounded_dual_domain_recommendation',
    },
  };
}
