/**
 * 跨域相关引擎(批次190)—— 把「难过那几天外卖多 40%」从 LLM 叙事变成真统计。
 *
 * 数据底座 = fact-journal 的每日行(JournalRow.m,跨域列已对齐:
 * spend / steps / placeVisits / moodValence / sleepMin / weatherTempC / calendarEvents …)。
 *
 * 设计取舍(照抄 health-correlations 的护栏):**不做盲目全配对**(会满屏虚假相关),
 * 只算一小组「假设驱动」、有生活意义的跨域对;每条按皮尔逊相关 + 样本量过滤,
 * 产出人话洞察 + 明确「统计相关,非因果」。纯函数、可单测、零 API 零成本。
 */
import type { JournalRow } from '@/lib/platform/fact-journal';

export interface CrossDomainInsight {
  key: string;
  r: number;                 // 皮尔逊相关系数 [-1,1]
  n: number;                 // 有效配对样本数(= 覆盖天数)
  lag: 0 | 1;                // 0=同日;1=A 在前一天、B 在当天
  strength: 'moderate' | 'strong';
  insight: [string, string]; // [zh, en] 人话描述,含 r
}

type Getter = (m: Record<string, number>) => number | undefined;

interface Hypothesis {
  key: string;
  a: Getter; b: Getter;
  lag: 0 | 1;
  labelA: [string, string];
  labelB: [string, string];
}

const col = (name: string): Getter => (m) => m[name];

// 首批 8 对假设(批次190):每条都有清楚的生活动机,避免虚假相关。
// (trainingSessions→mood、spend→sleep 等下一批再加。)
const HYPOTHESES: Hypothesis[] = [
  { key: 'mood→spend:lag1', a: col('moodValence'), b: col('spend'), lag: 1, labelA: ['情绪', 'mood'], labelB: ['花费', 'spending'] },
  { key: 'mood→spend:lag0', a: col('moodValence'), b: col('spend'), lag: 0, labelA: ['情绪', 'mood'], labelB: ['花费', 'spending'] },
  { key: 'steps→mood', a: col('steps'), b: col('moodValence'), lag: 0, labelA: ['步数', 'steps'], labelB: ['情绪', 'mood'] },
  { key: 'sleep→mood', a: col('sleepMin'), b: col('moodValence'), lag: 1, labelA: ['睡眠时长', 'sleep'], labelB: ['情绪', 'mood'] },
  { key: 'outings→mood', a: col('placeVisits'), b: col('moodValence'), lag: 0, labelA: ['外出次数', 'outings'], labelB: ['情绪', 'mood'] },
  { key: 'calendar→mood', a: col('calendarEvents'), b: col('moodValence'), lag: 0, labelA: ['日程密度', 'schedule load'], labelB: ['情绪', 'mood'] },
  { key: 'weather→mood', a: col('weatherTempC'), b: col('moodValence'), lag: 0, labelA: ['气温', 'temperature'], labelB: ['情绪', 'mood'] },
  { key: 'calendar→spend', a: col('calendarEvents'), b: col('spend'), lag: 0, labelA: ['日程密度', 'schedule load'], labelB: ['花费', 'spending'] },
  // 批次191:第二批假设对(用户点名 trainingSessions→mood、spend→sleep)。
  { key: 'training→mood', a: col('trainingSessions'), b: col('moodValence'), lag: 0, labelA: ['训练次数', 'workouts'], labelB: ['情绪', 'mood'] },
  { key: 'spend→sleep', a: col('spend'), b: col('sleepMin'), lag: 0, labelA: ['花费', 'spending'], labelB: ['睡眠时长', 'sleep'] },
  { key: 'weather→outings', a: col('weatherTempC'), b: col('placeVisits'), lag: 0, labelA: ['气温', 'temperature'], labelB: ['外出次数', 'outings'] },
  { key: 'calendar→sleep', a: col('calendarEvents'), b: col('sleepMin'), lag: 0, labelA: ['日程密度', 'schedule load'], labelB: ['睡眠时长', 'sleep'] },
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
  const enWhen = h.lag === 1 ? "the previous day’s" : 'same-day';
  const rTxt = `r=${r > 0 ? '+' : ''}${Math.round(r * 100) / 100}`;
  return [
    `${zhWhen}${h.labelA[0]}越高,${h.lag === 1 ? '次日' : '当天'}${h.labelB[0]}${zhDir}(${rTxt})`,
    `When ${enWhen} ${h.labelA[1]} is higher, ${h.lag === 1 ? 'next-day' : 'same-day'} ${h.labelB[1]} tends to be ${enDir} (${rTxt})`,
  ];
}

/**
 * 从每日事实表挖出显著的跨域关系,按 |r|·√n 排序取前 topN。
 * 只用固定假设对(反 p-hacking);n<14 或 |r|<0.3 一律不出(不编数字)。
 */
export function mineCrossDomain(rows: JournalRow[], topN = 4): CrossDomainInsight[] {
  const byDate = new Map<string, Record<string, number>>();
  for (const r of rows) byDate.set(r.dateKey, r.m);
  const out: CrossDomainInsight[] = [];
  for (const h of HYPOTHESES) {
    const pairs: Array<[number, number]> = [];
    for (const r of rows) {
      const bv = h.b(r.m);
      if (bv == null || !Number.isFinite(bv)) continue;
      const am = byDate.get(shiftDate(r.dateKey, h.lag));
      if (!am) continue;
      const av = h.a(am);
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
