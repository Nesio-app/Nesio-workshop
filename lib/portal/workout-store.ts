/**
 * workout-store — 自定义训练(批次 46)。
 * 从动作库自由组合出的训练 + 跟练完成历史。
 * 2026-08-10:迁出 localStorage → IDB blob(腾 5MB 配额);durable → module-sync 换端不丢。
 *
 * 历史流水原先被 workout-store(moves)与 workout-generate(focus)各写一份同 key,
 * 结构打架。这里收成一份:{ date, name, moves?, focus? }。
 */

import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

export interface WorkoutItem {
  exerciseId: string;
  sets: number;
  reps: number;
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

const workoutsStore = createBlobStore<Workout[]>({
  key: KEY,
  updateEvent: WORKOUTS_UPDATED,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function loadWorkouts(): Workout[] {
  return workoutsStore.load() ?? [];
}

function persist(list: Workout[]): void {
  workoutsStore.save(list);
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

export type WorkoutFocusBucket = 'push' | 'pull' | 'legs' | 'core';

export interface WorkoutSessionLog {
  date: string;
  name: string;
  moves?: number;
  focus?: WorkoutFocusBucket | null;
}

const HISTORY_KEY = 'nesio-workout-history-v1';

const historyStore = createBlobStore<WorkoutSessionLog[]>({
  key: HISTORY_KEY,
  updateEvent: WORKOUTS_UPDATED,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function loadWorkoutHistory(): WorkoutSessionLog[] {
  const list = historyStore.load() ?? [];
  return list.filter((r) => r && typeof r.date === 'string' && typeof r.name === 'string');
}

export function appendWorkoutHistory(entry: WorkoutSessionLog, cap = 500): void {
  if (typeof window === 'undefined') return;
  const list = [entry, ...loadWorkoutHistory()].slice(0, cap);
  historyStore.save(list);
}

export function logWorkoutSession(name: string, moves: number, now: Date = new Date()): void {
  appendWorkoutHistory({ date: localDay(now), name, moves }, 500);
}

/** 本周(周一为周初,本地日键)完成的跟练次数 —— 含自定义/生成/计划全部来源。 */
export function workoutSessionsThisWeek(now: Date = new Date()): number {
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const from = localDay(monday);
  return loadWorkoutHistory().filter((e) => e.date >= from && e.date <= localDay(now)).length;
}
