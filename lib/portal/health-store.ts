/**
 * Health metrics store — Apple Health 导入的指标存本机(nesio-health-v1),供健康 Dashboard 读。
 * 批次 39:健康数据不再只塞一条记忆节点,单独存一份结构化的最新指标 + 导入时间。
 */
import type { HealthMetrics } from './apple-health';

export const HEALTH_KEY = 'nesio-health-v1';

export function saveHealthMetrics(m: HealthMetrics): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HEALTH_KEY, JSON.stringify(m));
    window.dispatchEvent(new CustomEvent('nesio-health-updated'));
  } catch { /* quota — ignore */ }
}

export function loadHealthMetrics(): HealthMetrics | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(HEALTH_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as HealthMetrics;
    return Array.isArray(m.metrics) ? m : null;
  } catch { return null; }
}
