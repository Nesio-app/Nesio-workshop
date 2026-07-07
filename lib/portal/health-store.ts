/**
 * Health metrics store — Apple Health 导入的指标存本机,供健康 Dashboard 读。
 * 批次 57:从 localStorage 挪到 IndexedDB(体量最大,腾出 5MB localStorage 配额;
 * 老用户数据水合时透明迁移)。读取仍同步(内存缓存),写落 IDB。
 */
import type { HealthMetrics } from './apple-health';
import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

export const HEALTH_KEY = 'nesio-health-v1';

const store = createBlobStore<HealthMetrics>({
  key: HEALTH_KEY,
  updateEvent: 'nesio-health-updated',
  validate: (v) => !!v && Array.isArray((v as HealthMetrics).metrics),
  onWriteError: reportStorageDropped,
});

export function saveHealthMetrics(m: HealthMetrics): void {
  store.save(m);
}

export function loadHealthMetrics(): HealthMetrics | null {
  return store.load();
}

/** 是否已有健康数据(供 personalization 的 has-data 门,避免直读已迁走的 localStorage key)。 */
export function hasHealthData(): boolean {
  return store.load() != null;
}
