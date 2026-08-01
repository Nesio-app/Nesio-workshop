/**
 * Signal Store (IndexedDB) — Signal 主事实表的本地库(M2 建库,M3 接读)。
 *
 * 事实库建在 IndexedDB 上(GB 级配额,结构化克隆,不占 localStorage
 * 的 5MB 预算)。写入:createSignal / ingestLifeNode 双写至此;
 * 读取:signal-read-cache.ts 水合(backfill + reconcile)后,
 * getSignals() 优先从缓存读(M3 读切换),LifeGraph 投影兜底。
 */

import type { Signal } from './signal';
import { openSimpleDb } from '@/lib/idb/open-simple-db';
import { ensureEpistemicStamp } from './signal-epistemic';

const DB_NAME = 'nesio-signals';
const STORE = 'signals';

function openDb(): Promise<IDBDatabase | null> {
  return openSimpleDb(DB_NAME, 1, [
    { name: STORE, keyPath: 'id', indexes: [{ name: 'occurredAt', keyPath: 'occurredAt' }, { name: 'source', keyPath: 'source' }] },
  ]);
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
      if (cursor && out.length < limit) { out.push(ensureEpistemicStamp(cursor.value as Signal)); cursor.continue(); }
      else resolve(out);
    };
    req.onerror = () => resolve(out);
  });
}

/** 全量读取(水合用)。事实库为 localStorage 量级(≤5MB 投影镜像),一次读入可接受。
 *  兜底 epistemic/generator(2026-08-01 收紧为必填前写入的旧记录可能缺这两列)。 */
export async function getAllSignalsIdb(): Promise<Signal[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(((req.result as Signal[]) || []).map(ensureEpistemicStamp));
    req.onerror = () => resolve([]);
  });
}

/** 批量写入(幂等覆盖)。回填与内容漂移修复共用。 */
export async function bulkPutSignalsIdb(signals: Signal[]): Promise<number> {
  if (!signals.length) return 0;
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const s of signals) store.put(s);
    tx.oncomplete = () => resolve(signals.length);
    tx.onerror = () => resolve(0);
  });
}

/** 删除一条(用户删除/剪枝传导到本地事实缓存;云镜像不受影响)。 */
export async function deleteSignalIdb(id: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
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
