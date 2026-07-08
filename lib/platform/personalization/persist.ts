/**
 * 私有持久化助手 —— 三原语内部用的同步存取(learner 态都小,读取点要同步)。
 * 刻意不导出成"通用 store 抽象"(那正是 #48 踩的坑:把泛型 store 当门面而非三原语)。仅模块内用。
 *
 * 存储完整性批(2026-07-08):物理层从裸 localStorage 换成 IDB blob store ——
 * localStorage 被清/被逐出时学习成果全蒸发,违反数据完整性。blob store 提供
 * 同步缓存读 + 旧 localStorage 值自动迁移 + 自动进云备份/恢复路由/彻底删除收口。
 * 读取语义:冷启动水合完成前 loadJson 返回 fallback(毫秒级窗口,learner 均能自愈)。
 */

import { createBlobStore, type BlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';

const stores = new Map<string, BlobStore<unknown>>();

function storeFor(key: string): BlobStore<unknown> {
  let s = stores.get(key);
  if (!s) {
    s = createBlobStore<unknown>({
      key,
      updateEvent: `${key}-updated`,
      validate: (v) => v !== undefined,
      onWriteError: reportStorageDropped,
    });
    stores.set(key, s);
  }
  return s;
}

export function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const v = storeFor(key).load();
  return v == null ? fallback : (v as T);
}

export function saveJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  storeFor(key).save(value);
}
