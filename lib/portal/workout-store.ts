/**
 * workout-store — 自定义训练(批次 46)。
 * 从动作库自由组合出的训练存本机 `nesio-workouts-v1`。跟练播放器和健康页读它。
 */

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
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota */ }
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
