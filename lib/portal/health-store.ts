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
    import('./storage-health').then(({ checkStorageWarning }) => checkStorageWarning());
  } catch {
    // 配额超限 → 写入被丢弃。健康导入体量最大、最容易撞;必须让用户可见,不静默吞(设计红线)。
    import('./storage-health').then(({ STORAGE_FULL_EVENT, getStorageHealth }) => {
      window.dispatchEvent(new CustomEvent(STORAGE_FULL_EVENT, { detail: getStorageHealth() }));
    });
  }
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
