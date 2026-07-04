/**
 * Signal Store (IndexedDB) — Signal 主事实表迁移的里程碑 2。
 *
 * 新事实库直接建在 IndexedDB 上(GB 级配额,结构化克隆,不占
 * localStorage 的 5MB 预算)。当前为**只写累积期**:createSignal /
 * ingestLifeNode 双写至此,读路径仍走 LifeGraph 投影。
 * 里程碑 3(读切换)开始前,这里已积累完整事实流水。
 *
 * 迁移不做:历史 LifeGraph 回填(lifeNodeToSignal 可随时批量回填,
 * 留给 M3 前置步骤,避免本期引入迁移窗口问题)。
 */

import type { Signal } from './signal';

const DB_NAME = 'nesio-signals';
const STORE = 'signals';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('occurredAt', 'occurredAt');
      store.createIndex('source', 'source');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** 追加一条 Signal(幂等:同 id 覆盖)。失败静默——事实库是增强不是依赖。 */
export async function appendSignalIdb(signal: Signal): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(signal);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/** 按 occurredAt 倒序取最近 N 条 — M3 读切换的入口(暂无消费者)。 */
export async function getRecentSignalsIdb(limit = 100): Promise<Signal[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const out: Signal[] = [];
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('occurredAt');
    const req = idx.openCursor(null, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && out.length < limit) { out.push(cursor.value as Signal); cursor.continue(); }
      else resolve(out);
    };
    req.onerror = () => resolve(out);
  });
}

/** 事实库计数 — 数据主权面板/诊断用。 */
export async function countSignalsIdb(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });
}
