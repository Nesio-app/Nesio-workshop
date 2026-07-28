/**
 * fitness-home-core — 健身首页的确定性核心(2026-07-28,按用户给的参考稿重做健身页)。
 *
 * 参考稿上有「今天的训练 · 约 45 分钟 · 5 个动作 · 中等强度」「本周 1/3」「一句今日建议」这些东西。
 * 这里把它们全部算出来 —— **一条都不靠 LLM、一条都不编**:
 *   · 时长/强度 = 从处方(组数×次数×组间休息)推,规则写死;
 *   · 本周进度 = 打卡记录数;
 *   · 今天练哪个 = 按本阶段训练日顺序轮换(本周练过的往后跳);
 * 参考稿里的「恢复度 92%」没做 —— 我们没有可信的恢复度数据源,宁可不显示也不编一个数。
 *
 * 纯函数、无 DOM、无存储 —— 可以直接跑单测(scripts/fitness-home-core.test.mjs)。
 */

export interface CoreItem {
  sets: number;
  reps: number;
  unit?: 'reps' | 'min';
  restSec?: number;
  intensity?: string;
}

/** 一次动作的秒数:力量按每次 ~3.5 秒估;有氧按分钟直接算。 */
const SEC_PER_REP = 3.5;
const DEFAULT_REST = 60;

/**
 * 估这次训练要多久(分钟)。组内做 + 组间歇,再加 3 分钟热身。
 * 只是量级估计,给「约 45 分钟」这种话用 —— 所以向最近的 5 分钟取整。
 */
export function estimateSessionMinutes(items: CoreItem[]): number {
  let sec = 0;
  for (const it of items) {
    const work = it.unit === 'min' ? it.reps * 60 : it.reps * SEC_PER_REP;
    const rest = it.restSec ?? DEFAULT_REST;
    sec += it.sets * work + Math.max(0, it.sets - 1) * rest;
  }
  const min = sec / 60 + 3;
  return Math.max(5, Math.round(min / 5) * 5);
}

export type Intensity = 'light' | 'moderate' | 'hard';

/**
 * 强度:优先读处方里写的 RPE(如 'RPE 7');没写就按总组数粗分。
 * RPE ≤6 轻 / 7-8 中等 / ≥9 较重;总组数 ≤8 轻 / 9-14 中等 / ≥15 较重。
 */
export function sessionIntensity(items: CoreItem[]): Intensity {
  const rpes: number[] = [];
  for (const it of items) {
    const m = /rpe\s*([\d.]+)/i.exec(it.intensity || '');
    if (m) rpes.push(Number(m[1]));
  }
  if (rpes.length) {
    const avg = rpes.reduce((a, b) => a + b, 0) / rpes.length;
    return avg >= 9 ? 'hard' : avg >= 7 ? 'moderate' : 'light';
  }
  const sets = items.reduce((s, it) => s + it.sets, 0);
  return sets >= 15 ? 'hard' : sets >= 9 ? 'moderate' : 'light';
}

export interface LogEntry { date: string; sessionId: string }

/** 'YYYY-MM-DD' */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 本周(周一起)的 7 天:哪几天打过卡、哪天是今天。 */
export function weekDots(log: LogEntry[], today: Date): Array<{ key: string; done: boolean; isToday: boolean }> {
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - mondayOffset);
  const done = new Set(log.map((e) => e.date.slice(0, 10)));
  const tk = dayKey(today);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const k = dayKey(d);
    return { key: k, done: done.has(k), isToday: k === tk };
  });
}

/** 本周已完成几次(按天去重 —— 一天练两回也只算一次进度)。 */
export function doneThisWeek(log: LogEntry[], today: Date): number {
  return weekDots(log, today).filter((d) => d.done).length;
}

/**
 * 今天该做本阶段的哪一个训练日:本周已经做过的往后跳,都做过就回到第一个。
 * 确定性 —— 同样的记录永远给同一个答案,不随机。
 */
export function pickTodaySessionIndex(sessionIds: string[], log: LogEntry[], today: Date): number {
  if (!sessionIds.length) return 0;
  const dots = weekDots(log, today);
  const weekKeys = new Set(dots.map((d) => d.key));
  const doneIds = new Set(log.filter((e) => weekKeys.has(e.date.slice(0, 10))).map((e) => e.sessionId));
  const next = sessionIds.findIndex((id) => !doneIds.has(id));
  return next >= 0 ? next : 0;
}

/** 计划走到第几周(从 startedAt 起算,1-based);没开始返回 1。 */
export function weekIndex(startedAt: string | null, today: Date): number {
  if (!startedAt) return 1;
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return 1;
  return Math.max(1, Math.floor((today.getTime() - t) / (7 * 86_400_000)) + 1);
}
