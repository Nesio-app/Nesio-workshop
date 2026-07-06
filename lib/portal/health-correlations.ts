/**
 * 健康跨板块关系挖掘(批次 46 / E)—— 综合分析层的确定性内核。
 *
 * 在「每日事实表」(lib/portal/apple-health.ts 的 DailyFact)上算跨域相关:
 * 血糖 vs 睡眠/运动/情绪,含「滞后效应」(前一晚睡眠 → 次日血糖)。
 *
 * 设计取舍:不做盲目全配对(会满屏虚假相关),只算「假设驱动」的一小组有生理意义的
 * 关系对,每条按皮尔逊相关 + 样本量过滤,产出人话洞察 + 明确标注「统计相关,非因果」。
 * 纯函数、可单测;不引任何 DOM/AI 依赖。AI 叙事在此之上另接(走 guardAiRoute)。
 */
import type { DailyFact } from './apple-health';

export interface Relationship {
  key: string;
  r: number;                 // 皮尔逊相关系数 [-1,1]
  n: number;                 // 有效配对样本数
  lag: 0 | 1;                // 0=同日;1=A 在前一天、B 在当天
  strength: 'moderate' | 'strong';
  insight: [string, string]; // [zh, en] 人话描述
}

type Getter = (f: DailyFact) => number | undefined;

interface Hypothesis {
  key: string;
  a: Getter; b: Getter;
  lag: 0 | 1;
  labelA: [string, string];
  labelB: [string, string];
  // B 变高是「好」还是「坏」——只用于中性描述,不做价值判断
}

// 假设列表:每条都有清楚的生理动机,避免虚假相关。
const HYPOTHESES: Hypothesis[] = [
  { key: 'sleep→glucose', a: (f) => f.sleepH, b: (f) => f.glucoseAvg, lag: 1, labelA: ['睡眠时长', 'sleep'], labelB: ['血糖', 'glucose'] },
  { key: 'sleep→mood', a: (f) => f.sleepH, b: (f) => f.moodValence, lag: 0, labelA: ['睡眠时长', 'sleep'], labelB: ['情绪', 'mood'] },
  { key: 'sleep→hrv', a: (f) => f.sleepH, b: (f) => f.hrv, lag: 1, labelA: ['睡眠时长', 'sleep'], labelB: ['心率变异 HRV', 'HRV'] },
  { key: 'activity→restingHR', a: (f) => f.activeEnergy, b: (f) => f.restingHR, lag: 1, labelA: ['运动消耗', 'activity'], labelB: ['静息心率', 'resting HR'] },
  { key: 'activity→glucose', a: (f) => f.activeEnergy, b: (f) => f.glucoseAvg, lag: 0, labelA: ['运动消耗', 'activity'], labelB: ['血糖', 'glucose'] },
  { key: 'steps→sleep', a: (f) => f.steps, b: (f) => f.sleepH, lag: 0, labelA: ['步数', 'steps'], labelB: ['睡眠时长', 'sleep'] },
  { key: 'daylight→mood', a: (f) => f.daylight, b: (f) => f.moodValence, lag: 0, labelA: ['日照时长', 'daylight'], labelB: ['情绪', 'mood'] },
  { key: 'mood→restingHR', a: (f) => f.moodValence, b: (f) => f.restingHR, lag: 0, labelA: ['情绪', 'mood'], labelB: ['静息心率', 'resting HR'] },
  { key: 'restingHR→hrv', a: (f) => f.restingHR, b: (f) => f.hrv, lag: 0, labelA: ['静息心率', 'resting HR'], labelB: ['心率变异 HRV', 'HRV'] },
];

const MIN_N = 14;          // 少于两周有效配对不下结论
const R_MODERATE = 0.3;    // 中等相关门槛
const R_STRONG = 0.5;

function pearson(pairs: Array<[number, number]>): number {
  const n = pairs.length;
  if (n < 3) return NaN;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  const d = Math.sqrt(vx * vy);
  return d > 0 ? cov / d : NaN;
}

/** 前移 lag 天的日期字符串(YYYY-MM-DD)。 */
function shiftDate(date: string, lag: number): string {
  if (lag === 0) return date;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return date;
  return new Date(t - lag * 86_400_000).toISOString().slice(0, 10);
}

function describe(h: Hypothesis, r: number): [string, string] {
  const up = r > 0;
  const zhDir = up ? '越高' : '越低';
  const enDir = up ? 'higher' : 'lower';
  const zhWhen = h.lag === 1 ? '前一天' : '当天';
  const enWhen = h.lag === 1 ? 'the previous day’s' : 'same-day';
  const rTxt = `r=${r > 0 ? '+' : ''}${Math.round(r * 100) / 100}`;
  return [
    `${zhWhen}${h.labelA[0]}越高,${h.lag === 1 ? '次日' : '当天'}${h.labelB[0]}${zhDir}(${rTxt})`,
    `When ${enWhen} ${h.labelA[1]} is higher, ${h.lag === 1 ? 'next-day' : 'same-day'} ${h.labelB[1]} tends to be ${enDir} (${rTxt})`,
  ];
}

/** 从每日事实表挖出显著的跨板块关系,按 |r|·√n 排序取前 topN。 */
export function mineRelationships(daily: DailyFact[], topN = 6): Relationship[] {
  const byDate = new Map<string, DailyFact>();
  for (const f of daily) byDate.set(f.date, f);
  const out: Relationship[] = [];
  for (const h of HYPOTHESES) {
    const pairs: Array<[number, number]> = [];
    for (const f of daily) {
      const bv = h.b(f);
      if (bv == null || !Number.isFinite(bv)) continue;
      const af = byDate.get(shiftDate(f.date, h.lag));
      if (!af) continue;
      const av = h.a(af);
      if (av == null || !Number.isFinite(av)) continue;
      pairs.push([av, bv]);
    }
    const n = pairs.length;
    if (n < MIN_N) continue;
    const r = pearson(pairs);
    if (!Number.isFinite(r) || Math.abs(r) < R_MODERATE) continue;
    out.push({
      key: h.key,
      r: Math.round(r * 100) / 100,
      n,
      lag: h.lag,
      strength: Math.abs(r) >= R_STRONG ? 'strong' : 'moderate',
      insight: describe(h, r),
    });
  }
  return out
    .sort((x, y) => Math.abs(y.r) * Math.sqrt(y.n) - Math.abs(x.r) * Math.sqrt(x.n))
    .slice(0, topN);
}
