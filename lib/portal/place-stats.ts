/**
 * 足迹统计层 —— 分析页升级(参照 Google Timeline Insights / Arc 的形态):
 * 月度概览(地点数/到访/移动里程/新地点,环比上月)+ 星期×时段生活节奏。
 * 全部从 buildPlaceTimeline 的段推导(时区已按事发地还原),纯本机。
 */

import { buildPlaceTimeline, haversineKm, placeKey, type PlaceVisit } from './place-trail';
import { dateKeyToLocalDate, wallHour } from './place-time.mjs';

export interface MonthPlaceStats {
  /** 'YYYY-MM' */
  monthKey: string;
  /** 去过的不同地点数(无名占位按坐标桶区分) */
  places: number;
  /** 到访段数 */
  visits: number;
  /** 段间可算的移动公里数(两端都有坐标才计) */
  moveKm: number;
  /** 本月首次出现的地点数(相对全部历史) */
  newPlaces: number;
  /** 非「家」停留分钟 */
  awayMin: number;
}

export interface MonthlyComparison {
  current: MonthPlaceStats;
  /** 日历上的上一个月(无数据则各项为 0) */
  prev: MonthPlaceStats;
  /** 上月有没有任何数据(决定环比要不要显示) */
  prevHasData: boolean;
}

const monthOf = (dateKey: string) => dateKey.slice(0, 7);

function emptyMonth(monthKey: string): MonthPlaceStats {
  return { monthKey, places: 0, visits: 0, moveKm: 0, newPlaces: 0, awayMin: 0 };
}

function prevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 月度足迹概览 + 环比。
 * 「本月」取**最近一个有数据的月份**(导入历史停在过去时也能看),不是空的当前日历月。
 */
export function monthlyPlaceComparison(visits: PlaceVisit[]): MonthlyComparison | null {
  const days = buildPlaceTimeline(visits, 3650);
  if (!days.length) return null;

  // 天序从新到旧;首次出现要按时间正序扫
  const asc = [...days].reverse();
  const firstSeenMonth = new Map<string, string>();
  for (const day of asc) {
    const mk = monthOf(day.dateKey);
    for (const s of day.segments) {
      const k = placeKey(s.label, s.lat, s.lon);
      if (!firstSeenMonth.has(k)) firstSeenMonth.set(k, mk);
    }
  }

  const currentKey = monthOf(days[0].dateKey);
  const prevKey = prevMonthKey(currentKey);

  const collect = (mk: string): MonthPlaceStats => {
    const out = emptyMonth(mk);
    const distinct = new Set<string>();
    const newSeen = new Set<string>();
    for (const day of days) {
      if (monthOf(day.dateKey) !== mk) continue;
      const segs = day.segments;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const k = placeKey(s.label, s.lat, s.lon);
        distinct.add(k);
        out.visits += 1;
        if (s.category !== 'home') out.awayMin += s.durationMin;
        // 该地点全历史首见于本月 —— 按地点计一次
        if (firstSeenMonth.get(k) === mk) newSeen.add(k);
        const n = segs[i + 1];
        if (n && s.lat != null && s.lon != null && n.lat != null && n.lon != null) {
          const km = haversineKm(s.lat, s.lon, n.lat, n.lon);
          if (km >= 0.05 && km < 2000) out.moveKm += km;
        }
      }
    }
    out.places = distinct.size;
    out.newPlaces = newSeen.size;
    out.moveKm = Math.round(out.moveKm * 10) / 10;
    return out;
  };

  const current = collect(currentKey);
  const prev = collect(prevKey);
  return { current, prev, prevHasData: prev.visits > 0 };
}

export interface WeekRhythm {
  /** [周一..周日][清晨/上午/下午/傍晚/夜] 外出停留分钟 */
  grid: number[][];
  max: number;
}

const bucketIdx = (h: number): number => (h < 5 ? 4 : h < 8 ? 0 : h < 12 ? 1 : h < 17 ? 2 : h < 21 ? 3 : 4);

/** 生活节奏:星期 × 时段的外出(非家)停留热力 —— 一眼看出你的周节奏。 */
export function weekRhythm(visits: PlaceVisit[]): WeekRhythm {
  const grid: number[][] = Array.from({ length: 7 }, () => [0, 0, 0, 0, 0]);
  const days = buildPlaceTimeline(visits, 3650);
  for (const day of days) {
    const wd = (dateKeyToLocalDate(day.dateKey).getDay() + 6) % 7; // 周一=0
    for (const s of day.segments) {
      if (s.category === 'home') continue;
      grid[wd][bucketIdx(wallHour(s.start))] += s.durationMin;
    }
  }
  const max = Math.max(1, ...grid.flat());
  return { grid, max };
}
