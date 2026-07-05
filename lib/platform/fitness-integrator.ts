/**
 * fitness-integrator — 跨域整合(批次 40)。把 health 指标 × 训练日志 综合成几条可读结论:
 *   训练负荷(train log × 目标)、恢复度(HRV + 睡眠)、体能趋势(静息心率 + VO₂max)。
 * 纯规则(非 LLM、非黑盒),每条结论都能说清是从哪几个数推出来的。诚实版「运动状态」。
 */
import type { HealthMetric } from '@/lib/portal/apple-health';

export type Level3 = 'low' | 'moderate' | 'high';
export type Recovery = 'good' | 'ok' | 'poor' | 'unknown';
export type Trend = 'up' | 'flat' | 'down' | 'unknown';

export interface FitnessSignal { key: string; label: [string, string]; value: string; note: [string, string]; tone: 'good' | 'warn' | 'neutral' }
export interface FitnessInsight {
  load: Level3;
  recovery: Recovery;
  trend: Trend;
  signals: FitnessSignal[];
  suggestion: [string, string];
}

function byKey(metrics: HealthMetric[], key: string): HealthMetric | undefined {
  return metrics.find((m) => m.key === key);
}
/** 序列基线:近 N 月均值(排除最新点),用于判断「相对自己的基线」高低。 */
function baseline(m?: HealthMetric): number | null {
  if (!m?.series?.length) return null;
  const s = m.series.slice(0, -1);
  const arr = s.length ? s : m.series;
  return arr.reduce((a, b) => a + b.v, 0) / arr.length;
}

export function computeFitnessInsight(
  metrics: HealthMetric[],
  sessionsThisWeek: number,
  sessionsPerWeek: number | null,
): FitnessInsight {
  const signals: FitnessSignal[] = [];

  // ── 训练负荷 ──
  let load: Level3;
  if (sessionsPerWeek && sessionsPerWeek > 0) {
    const ratio = sessionsThisWeek / sessionsPerWeek;
    load = ratio < 0.5 ? 'low' : ratio > 1.15 ? 'high' : 'moderate';
  } else {
    load = sessionsThisWeek <= 1 ? 'low' : sessionsThisWeek >= 5 ? 'high' : 'moderate';
  }
  signals.push({
    key: 'load', label: ['训练负荷', 'Training load'],
    value: sessionsPerWeek ? `${sessionsThisWeek}/${sessionsPerWeek}` : `${sessionsThisWeek}`,
    note: load === 'low' ? ['本周偏少', 'light this week'] : load === 'high' ? ['本周偏多', 'heavy this week'] : ['本周适量', 'balanced'],
    tone: load === 'high' ? 'warn' : load === 'low' ? 'neutral' : 'good',
  });

  // ── 恢复度:HRV(相对基线)+ 睡眠 ──
  const hrv = byKey(metrics, 'hrv');
  const sleep = byKey(metrics, 'sleep');
  let recovery: Recovery = 'unknown';
  const recFactors: number[] = []; // +1 好 / -1 差
  if (hrv) {
    const base = baseline(hrv);
    if (base != null) { recFactors.push(hrv.latest >= base ? 1 : hrv.latest < base * 0.85 ? -1 : 0); }
    signals.push({ key: 'hrv', label: ['心率变异 HRV', 'HRV'], value: `${hrv.latest} ms`, note: base != null && hrv.latest < base * 0.85 ? ['低于你的基线', 'below your baseline'] : ['接近基线', 'near baseline'], tone: base != null && hrv.latest < base * 0.85 ? 'warn' : 'good' });
  }
  if (sleep) {
    recFactors.push(sleep.latest >= 7 ? 1 : sleep.latest < 6 ? -1 : 0);
    signals.push({ key: 'sleep', label: ['最近睡眠', 'Sleep'], value: `${sleep.latest} h`, note: sleep.latest < 6 ? ['睡得偏少', 'short'] : ['充足', 'enough'], tone: sleep.latest < 6 ? 'warn' : 'good' });
  }
  if (recFactors.length) {
    const sum = recFactors.reduce((a, b) => a + b, 0);
    recovery = sum >= 1 ? 'good' : sum <= -1 ? 'poor' : 'ok';
  }

  // ── 体能趋势:静息心率(↓好)+ VO₂max(↑好)──
  const rhr = byKey(metrics, 'restingHR');
  const vo2 = byKey(metrics, 'vo2max');
  let trend: Trend = 'unknown';
  const trendFactors: number[] = [];
  if (rhr?.prev != null) { trendFactors.push(rhr.latest < rhr.prev ? 1 : rhr.latest > rhr.prev ? -1 : 0); signals.push({ key: 'rhr', label: ['静息心率', 'Resting HR'], value: `${rhr.latest} bpm`, note: rhr.prev != null && rhr.latest < rhr.prev ? ['较上次下降(好)', 'down (good)'] : ['较上次上升', 'up'], tone: rhr.prev != null && rhr.latest < rhr.prev ? 'good' : 'warn' }); }
  if (vo2?.prev != null) { trendFactors.push(vo2.latest > vo2.prev ? 1 : vo2.latest < vo2.prev ? -1 : 0); signals.push({ key: 'vo2', label: ['最大摄氧量', 'VO₂ max'], value: `${vo2.latest}`, note: vo2.prev != null && vo2.latest > vo2.prev ? ['较上次上升(好)', 'up (good)'] : ['较上次下降', 'down'], tone: vo2.prev != null && vo2.latest > vo2.prev ? 'good' : 'warn' }); }
  if (trendFactors.length) {
    const sum = trendFactors.reduce((a, b) => a + b, 0);
    trend = sum >= 1 ? 'up' : sum <= -1 ? 'down' : 'flat';
  }

  // ── 建议(规则拼)──
  let suggestion: [string, string];
  if (load === 'low' && trend === 'down') suggestion = ['训练量偏少、体能有下降迹象 —— 这周补一两次训练。', 'Low volume and fitness dipping — add a session or two this week.'];
  else if (load === 'high' && recovery === 'poor') suggestion = ['训练量偏大而恢复不足(HRV/睡眠偏低)—— 安排一天轻松或休息。', 'High load but low recovery — take an easy or rest day.'];
  else if (recovery === 'poor') suggestion = ['恢复偏低(HRV/睡眠)—— 今天别上大强度,优先睡好。', 'Recovery is low — go easy today and prioritize sleep.'];
  else if (trend === 'up') suggestion = ['体能在往上走,保持当前节奏。', 'Fitness trending up — keep the current rhythm.'];
  else suggestion = ['状态平稳,按计划来就好。', 'Steady — stick to your plan.'];

  return { load, recovery, trend, signals, suggestion };
}
