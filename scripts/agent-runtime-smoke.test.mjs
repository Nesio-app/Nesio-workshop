import assert from 'node:assert/strict';
import { runEnergyCalendarAgentCore } from '../lib/intelligence/energy-calendar-agent-core.mjs';

const baseNow = Date.now();

function signal(overrides) {
  return {
    id: overrides.id,
    source: overrides.source || 'manual',
    type: overrides.type || 'observation',
    occurredAt: overrides.occurredAt || new Date(baseNow).toISOString(),
    capturedAt: overrides.capturedAt || new Date(baseNow).toISOString(),
    title: overrides.title || 'signal',
    content: overrides.content || {},
    entities: [],
    confidence: 0.9,
    sensitivity: overrides.sensitivity || 'normal',
    retentionPolicy: 'Normal',
    evidence: { source: overrides.source || 'manual' },
    tags: overrides.tags || [],
  };
}

function event(id, hoursFromNow, title) {
  return signal({
    id,
    source: 'calendar',
    type: 'event',
    sensitivity: 'work',
    title,
    occurredAt: new Date(baseNow + hoursFromNow * 3_600_000).toISOString(),
    tags: ['work', 'calendar'],
  });
}

function ctx(signals) {
  return {
    signals,
    lifeState: {
      stateId: 'state_smoke',
      timeWindow: 'today',
      generatedAt: new Date(baseNow).toISOString(),
      dimensions: [],
      keyDrivers: [],
      keyDriverSignalIds: [],
      risks: [],
      opportunities: [],
      recommendedGuidanceIds: [],
      explanation: 'smoke fixture',
    },
    weather: null,
    degraded: false,
  };
}

const health = signal({
  id: 'sig_health_sleep',
  source: 'health',
  type: 'metric',
  sensitivity: 'health',
  title: '睡眠记录',
  content: { type: 'sleep', hours: 5.8, energy: 0.42 },
  tags: ['睡眠', '精力'],
});
const calendar = [
  event('sig_calendar_1', 1, '产品会'),
  event('sig_calendar_2', 3, '工程同步'),
  event('sig_calendar_3', 5, '用户访谈'),
  event('sig_calendar_4', 7, '复盘'),
];

const dualDomain = runEnergyCalendarAgentCore(ctx([health, ...calendar]));
assert.equal(dualDomain.status, 'success');
assert.equal(dualDomain.cards.length, 1);
assert.equal(dualDomain.cards[0].id, 'agent-energy-calendar-allocation');
assert.deepEqual(dualDomain.audit.sandboxPair, ['health', 'calendar']);
assert.ok(dualDomain.audit.evidenceSignalIds.includes('sig_health_sleep'));
assert.ok(dualDomain.audit.evidenceSignalIds.includes('sig_calendar_1'));

const missingHealth = runEnergyCalendarAgentCore(ctx(calendar));
assert.equal(missingHealth.status, 'silent');
assert.equal(missingHealth.audit.reason, 'missing_dual_domain_evidence');
assert.equal(missingHealth.cards.length, 0);

const missingCalendar = runEnergyCalendarAgentCore(ctx([health]));
assert.equal(missingCalendar.status, 'silent');
assert.equal(missingCalendar.audit.reason, 'missing_dual_domain_evidence');
assert.equal(missingCalendar.cards.length, 0);

const thinSignal = runEnergyCalendarAgentCore(ctx([
  signal({
    id: 'sig_health_good',
    source: 'health',
    type: 'metric',
    sensitivity: 'health',
    title: '睡眠充足',
    content: { type: 'sleep', hours: 7.5, energy: 0.8 },
    tags: ['sleep'],
  }),
  event('sig_calendar_easy_1', 2, '轻会议'),
  event('sig_calendar_easy_2', 4, '跟进'),
]));
assert.equal(thinSignal.status, 'silent');
assert.equal(thinSignal.audit.reason, 'insufficient_guidance_signal');

console.log('Agent Runtime smoke checks passed');
