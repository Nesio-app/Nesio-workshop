/**
 * 私有持久化助手 —— 三原语内部用的同步 localStorage 存取(learner 态都小,读取点要同步)。
 * 刻意不导出成"通用 store 抽象"(那正是 #48 踩的坑:把泛型 store 当门面而非三原语)。仅模块内用。
 */

export function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v == null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}
