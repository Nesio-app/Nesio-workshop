/**
 * Life State — the platform's structured understanding of the user's current
 * life situation (PRD Ch.4.3). Not a record; a snapshot.
 *
 * Today, Mirror and Future Guidance all read from Life State rather than
 * touching raw signals. This is the layer that enables cross-signal reasoning:
 * "sleep is low + work is dense + travel next week → reduce load today",
 * which single-signal triggers can never produce.
 *
 * v1 is rule-based (PRD 28.4: "hybrid rules + AI summary, not pure LLM").
 * An optional AI explanation can be layered on via /api/portal/life-state.
 */

import { getRecentSignals, type Signal } from './signal';

export type LifeDimension =
  | 'energy'
  | 'stress'
  | 'focus'
  | 'recovery'
  | 'health'
  | 'work'
  | 'family'
  | 'social'
  | 'travel'
  | 'finance'
  | 'learning';

export type DimensionLevel = 'low' | 'mild_risk' | 'stable' | 'high_load' | 'good' | 'unknown';

export interface LifeStateDimension {
  dimension: LifeDimension;
  level: DimensionLevel;
  score: number; // 0-1, higher = better state on that dimension
  note?: string;
  driverSignalIds: string[];
}

export interface LifeState {
  stateId: string;
  timeWindow: string;
  generatedAt: string;
  dimensions: LifeStateDimension[];
  keyDrivers: string[];
  keyDriverSignalIds: string[];
  risks: string[];
  opportunities: string[];
  recommendedGuidanceIds: string[];
  explanation: string;
}

const DIMENSION_LABELS: Record<LifeDimension, string> = {
  energy: '精力', stress: '压力', focus: '专注', recovery: '恢复',
  health: '健康', work: '工作', family: '家庭', social: '社交',
  travel: '出行', finance: '财务', learning: '学习',
};

export function dimensionLabel(d: LifeDimension): string {
  return DIMENSION_LABELS[d] || d;
}

// ── Dimension evaluators (rule-based) ────────────────────────────────────────

function evalHealth(signals: Signal[]): LifeStateDimension {
  const symptoms = signals.filter((s) => s.type === 'symptom' && s.sensitivity === 'health');
  const active = symptoms.filter((s) => {
    const c = s.content;
    return typeof c === 'object' && (c as Record<string, unknown>)['status'] === 'active';
  });
  if (!symptoms.length) {
    return { dimension: 'health', level: 'unknown', score: 0.6, note: '暂无健康记录', driverSignalIds: [] };
  }
  if (active.length >= 1) {
    return { dimension: 'health', level: 'mild_risk', score: 0.4, note: `${active.length} 项需关注`, driverSignalIds: active.map((s) => s.id) };
  }
  return { dimension: 'health', level: 'good', score: 0.8, note: '状态平稳', driverSignalIds: symptoms.slice(0, 2).map((s) => s.id) };
}

function evalWork(signals: Signal[]): LifeStateDimension {
  const now = Date.now();
  const todayEvents = signals.filter((s) => {
    if (s.type !== 'event' || s.sensitivity !== 'work') return false;
    const t = new Date(s.occurredAt).getTime();
    return t > now - 6 * 3_600_000 && t < now + 18 * 3_600_000;
  });
  if (todayEvents.length >= 4) {
    return { dimension: 'work', level: 'high_load', score: 0.35, note: `今天 ${todayEvents.length} 个安排`, driverSignalIds: todayEvents.map((s) => s.id) };
  }
  if (todayEvents.length >= 1) {
    return { dimension: 'work', level: 'stable', score: 0.65, note: `${todayEvents.length} 个安排`, driverSignalIds: todayEvents.map((s) => s.id) };
  }
  return { dimension: 'work', level: 'good', score: 0.85, note: '日程宽松', driverSignalIds: [] };
}

function evalEnergy(signals: Signal[]): LifeStateDimension {
  // Look for sleep + mood signals
  const sleepSig = signals.find((s) => {
    const c = s.content;
    return typeof c === 'object' && String((c as Record<string, unknown>)['type'] || '').includes('sleep');
  });
  const sleepHours = sleepSig && typeof sleepSig.content === 'object'
    ? Number((sleepSig.content as Record<string, unknown>)['hours'])
    : NaN;

  if (Number.isFinite(sleepHours)) {
    if (sleepHours < 6) return { dimension: 'energy', level: 'low', score: 0.35, note: `睡眠 ${sleepHours}h 偏少`, driverSignalIds: sleepSig ? [sleepSig.id] : [] };
    if (sleepHours >= 7.5) return { dimension: 'energy', level: 'good', score: 0.85, note: `睡眠 ${sleepHours}h 充足`, driverSignalIds: sleepSig ? [sleepSig.id] : [] };
    return { dimension: 'energy', level: 'stable', score: 0.65, note: `睡眠 ${sleepHours}h`, driverSignalIds: sleepSig ? [sleepSig.id] : [] };
  }
  return { dimension: 'energy', level: 'unknown', score: 0.6, note: '暂无睡眠数据', driverSignalIds: [] };
}

function evalLearning(signals: Signal[]): LifeStateDimension | null {
  const learning = signals.filter((s) => (s.tags || []).some((t) => /读|学|book|read|notion|flomo/i.test(t)));
  if (!learning.length) return null;
  return { dimension: 'learning', level: 'good', score: 0.75, note: `近期 ${learning.length} 条学习记录`, driverSignalIds: learning.slice(0, 3).map((s) => s.id) };
}

function evalFinance(signals: Signal[]): LifeStateDimension | null {
  const fin = signals.filter((s) => s.sensitivity === 'financial');
  if (!fin.length) return null;
  return { dimension: 'finance', level: 'stable', score: 0.6, note: `${fin.length} 条财务记录`, driverSignalIds: fin.slice(0, 2).map((s) => s.id) };
}

// ── Main: compute Life State ─────────────────────────────────────────────────

export function computeLifeState(timeWindowHours = 168): LifeState {
  const signals = getRecentSignals(timeWindowHours);
  const now = new Date();

  const dims: LifeStateDimension[] = [
    evalEnergy(signals),
    evalWork(signals),
    evalHealth(signals),
  ];
  const learning = evalLearning(signals);
  if (learning) dims.push(learning);
  const finance = evalFinance(signals);
  if (finance) dims.push(finance);

  // Key drivers: lowest-scoring dimensions with signal backing
  const drivers = dims
    .filter((d) => d.level !== 'unknown' && d.note)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  const risks: string[] = [];
  const opportunities: string[] = [];
  for (const d of dims) {
    if (d.level === 'low' || d.level === 'mild_risk' || d.level === 'high_load') {
      risks.push(`${dimensionLabel(d.dimension)}：${d.note}`);
    } else if (d.level === 'good') {
      opportunities.push(`${dimensionLabel(d.dimension)}：${d.note}`);
    }
  }

  const explanation = buildExplanation(dims, risks);

  return {
    stateId: `state_${now.toISOString().slice(0, 13).replace(/[-:T]/g, '_')}`,
    timeWindow: `过去 ${Math.round(timeWindowHours / 24)} 天`,
    generatedAt: now.toISOString(),
    dimensions: dims,
    keyDrivers: drivers.map((d) => `${dimensionLabel(d.dimension)}：${d.note}`),
    keyDriverSignalIds: drivers.flatMap((d) => d.driverSignalIds),
    risks,
    opportunities,
    recommendedGuidanceIds: [],
    explanation,
  };
}

function buildExplanation(dims: LifeStateDimension[], risks: string[]): string {
  const known = dims.filter((d) => d.level !== 'unknown');
  if (!known.length) return '记录更多生活信号后，Nesio 才能理解你当前的状态。';
  if (!risks.length) return '你当前的整体状态平稳，可以按自己的节奏推进。';
  const top = risks.slice(0, 2).join('，');
  return `当前值得留意：${top}。建议适当减少非必要负担。`;
}

/** Overall wellbeing score 0-1 (average of known dimensions). */
export function overallScore(state: LifeState): number {
  const known = state.dimensions.filter((d) => d.level !== 'unknown');
  if (!known.length) return 0.6;
  return known.reduce((s, d) => s + d.score, 0) / known.length;
}
