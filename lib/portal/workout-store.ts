/**
 * workout-store — 自定义训练(批次 46)。
 * 从动作库自由组合出的训练存本机 `nesio-workouts-v1`。跟练播放器和健康页读它。
 */

import { reportStorageDropped } from './storage-health';

export interface WorkoutItem {
  exerciseId: string;
  sets: number;
  reps: number;        // 次数(reps)或秒数(sec)
  unit: 'reps' | 'sec';
}

export interface Workout {
  id: string;
  name: string;
  items: WorkoutItem[];
  createdAt: string;
}

const KEY = 'nesio-workouts-v1';
export const WORKOUTS_UPDATED = 'nesio-workouts-updated';

export function loadWorkouts(): Workout[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? (v as Workout[]) : [];
  } catch { return []; }
}

function persist(list: Workout[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { reportStorageDropped(); }
  window.dispatchEvent(new CustomEvent(WORKOUTS_UPDATED));
}

export function saveWorkout(input: { name: string; items: WorkoutItem[] }): Workout {
  const w: Workout = {
    id: `wk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim() || '自定义训练',
    items: input.items,
    createdAt: new Date().toISOString(),
  };
  persist([w, ...loadWorkouts()]);
  return w;
}

export function deleteWorkout(id: string): void {
  persist(loadWorkouts().filter((w) => w.id !== id));
}

// ── 完成历史(修「自定义训练练完哪儿都不记」):任何来源的跟练完成都记一笔。
// 健康页负荷判断、健身 tab「最近」、回溯建议都以此为准 —— 不再只认训练计划的打卡。

export interface WorkoutSessionLog {
  date: string;   // 本地日键 YYYY-MM-DD
  name: string;
  moves: number;
}

const HISTORY_KEY = 'nesio-workout-history-v1';

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function loadWorkoutHistory(): WorkoutSessionLog[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(v) ? (v as WorkoutSessionLog[]) : [];
  } catch { return []; }
}

export function logWorkoutSession(name: string, moves: number, now: Date = new Date()): void {
  if (typeof window === 'undefined') return;
  const list = [{ date: localDay(now), name, moves }, ...loadWorkoutHistory()].slice(0, 500);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { reportStorageDropped(); }
  window.dispatchEvent(new CustomEvent(WORKOUTS_UPDATED));
}

/** 本周(周一为周初,本地日键)完成的跟练次数 —— 含自定义/生成/计划全部来源。 */
export function workoutSessionsThisWeek(now: Date = new Date()): number {
  const day = (now.getDay() + 6) % 7; // Mon=0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const from = localDay(monday);
  return loadWorkoutHistory().filter((e) => e.date >= from && e.date <= localDay(now)).length;
}
