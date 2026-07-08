/**
 * 生活报告 —— 回顾面(输出口定稿 §7):综合周报/月报/自定义时间段聚合。
 *
 * 数据底座 = fact-journal 的每日行(跨域列已对齐):任意 [start, end] 区间
 * 求和/均值,再补足迹 Top 地点。列是软 schema —— 某列该区间一天都没有就不出现,
 * 诚实缺席,不硬造 0。
 */

import { readFactJournal, ensureFactJournal, type JournalRow } from '@/lib/platform/fact-journal';
import { loadPlaceTrail, buildPlaceTimeline, displayLabel } from '@/lib/portal/place-trail';

export interface LifeReport {
  startKey: string;
  endKey: string;
  /** 区间日历天数 */
  days: number;
  /** 有 journal 行的天数(数据覆盖度,诚实展示) */
  daysWithData: number;
  /** 求和列(区间内出现过才有) */
  sums: Partial<Record<'spend' | 'placeAwayMin' | 'placeMoveKm' | 'placeVisits' | 'trainingSessions' | 'fbUseful' | 'fbNegative' | 'steps', number>>;
  /** 均值列(按有该列的天数平均) */
  avgs: Partial<Record<'moodValence' | 'sleepMin' | 'weatherTempC' | 'calendarEvents', number>>;
  /** 区间内停留最久的地点(≤5) */
  topPlaces: Array<{ label: string; totalMin: number; visits: number }>;
}

const SUM_COLS = ['spend', 'placeAwayMin', 'placeMoveKm', 'placeVisits', 'trainingSessions', 'fbUseful', 'fbNegative', 'steps'] as const;
const AVG_COLS = ['moodValence', 'sleepMin', 'weatherTempC', 'calendarEvents'] as const;

function inRange(dk: string, startKey: string, endKey: string): boolean {
  return dk >= startKey && dk <= endKey;
}

function calendarDays(startKey: string, endKey: string): number {
  const [ys, ms, ds] = startKey.split('-').map(Number);
  const [ye, me, de] = endKey.split('-').map(Number);
  const a = new Date(ys, ms - 1, ds).getTime();
  const b = new Date(ye, me - 1, de).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** 聚合 [startKey, endKey](含两端,'YYYY-MM-DD')。调用前确保 journal 已回填该区间。 */
export function buildLifeReport(startKey: string, endKey: string): LifeReport {
  ensureFactJournal(Math.min(370, calendarDays(startKey, new Date().toISOString().slice(0, 10)) + 1));
  const rows: JournalRow[] = readFactJournal(400).filter((r) => inRange(r.dateKey, startKey, endKey));

  const sums: LifeReport['sums'] = {};
  const avgAcc = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    for (const col of SUM_COLS) {
      const v = r.m[col];
      if (typeof v === 'number') sums[col] = Math.round(((sums[col] || 0) + v) * 100) / 100;
    }
    for (const col of AVG_COLS) {
      const v = r.m[col];
      if (typeof v !== 'number') continue;
      const cur = avgAcc.get(col) || { sum: 0, n: 0 };
      cur.sum += v; cur.n += 1;
      avgAcc.set(col, cur);
    }
  }
  const avgs: LifeReport['avgs'] = {};
  for (const [col, { sum, n }] of avgAcc) {
    if (n > 0) avgs[col as typeof AVG_COLS[number]] = Math.round((sum / n) * 100) / 100;
  }

  // 区间 Top 地点(非家,按停留)
  const placeAgg = new Map<string, { totalMin: number; visits: number }>();
  try {
    for (const day of buildPlaceTimeline(loadPlaceTrail(), 3650)) {
      if (!inRange(day.dateKey, startKey, endKey)) continue;
      for (const s of day.segments) {
        if (s.category === 'home') continue;
        const label = displayLabel(s.label);
        const cur = placeAgg.get(label) || { totalMin: 0, visits: 0 };
        cur.totalMin += s.durationMin; cur.visits += 1;
        placeAgg.set(label, cur);
      }
    }
  } catch { /* 无足迹 */ }
  const topPlaces = [...placeAgg.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.totalMin - a.totalMin)
    .slice(0, 5);

  return {
    startKey,
    endKey,
    days: calendarDays(startKey, endKey),
    daysWithData: rows.length,
    sums,
    avgs,
    topPlaces,
  };
}

/** 报告的纯文本摘要(存记忆用,可被问一问检索)。 */
export function lifeReportText(r: LifeReport, zh = true): string {
  const L: string[] = [];
  L.push(zh ? `生活报告 ${r.startKey} ~ ${r.endKey}(${r.daysWithData}/${r.days} 天有数据)` : `Life report ${r.startKey} ~ ${r.endKey} (${r.daysWithData}/${r.days} days with data)`);
  if (r.sums.placeVisits) L.push(zh ? `到访 ${r.sums.placeVisits} 次,外出 ${Math.round((r.sums.placeAwayMin || 0) / 60)} 小时,移动 ${Math.round(r.sums.placeMoveKm || 0)} km` : `${r.sums.placeVisits} visits, ${Math.round((r.sums.placeAwayMin || 0) / 60)}h out, ${Math.round(r.sums.placeMoveKm || 0)} km moved`);
  if (typeof r.sums.spend === 'number') L.push(zh ? `支出 $${Math.round(r.sums.spend)}` : `Spent $${Math.round(r.sums.spend)}`);
  if (typeof r.avgs.moodValence === 'number') L.push(zh ? `心情均值 ${r.avgs.moodValence}` : `Mood avg ${r.avgs.moodValence}`);
  if (r.sums.trainingSessions) L.push(zh ? `训练 ${r.sums.trainingSessions} 次` : `${r.sums.trainingSessions} workouts`);
  if (r.topPlaces.length) L.push((zh ? '常去:' : 'Top places: ') + r.topPlaces.map((p) => `${p.label}(${p.visits})`).join(' · '));
  return L.join('\n');
}
