/**
 * 一键腾空间(批次 38)—— 存储报警不能只让用户"惦记备份",要能当场自救。
 *
 * 只清**可再生/冗余**的数据,绝不动记忆本体(life-graph / Signal 节点留下):
 *  1. 重复导入的联系人(并发导入的历史遗留,dedupeImportedContacts 保最早删其余)
 *  2. 问一问聊天历史(留最近 60 条 —— 记忆才是事实源,聊天记录是缓存态)
 *  3. AI 回复缓存(LRU,砍到每 scope 最近 12 条)
 *  4. 临时图片 / 附件 IDB 缓存(nesio-images / nesio-files —— 照片与文件可再生或从云回拉)
 *  5. 云同步 outbox 压实(life-graph 内部已有,借道触发)
 */

import { getStorageHealth, logDropped } from './storage-health';
import { dedupeImportedContacts } from './providers/connector-sync';
import { trimChatStores } from './chat-store';
import { trimAiCache as trimAiCacheStore } from './ai-cache';
import { purgeLocalImages } from './local-image-store';
import { purgeLocalFiles } from './local-file-store';
import { idbBackend, registerIdbBlobKey } from './idb-blob-store';

/** 图 4 横幅里那几个「占空间的文件」:同步簿记 + 退款否决,该在 IDB 不该占 LS。 */
const BOOKKEEPING_LS_KEYS = [
  'nesio-email-sync-state-v1',
  'nesio-module-sync-state-v1',
  'nesio-refund-rejected-v1',
  'nesio-refund-link-v1',
];

/** 把簿记从 localStorage 搬进 IDB 并删掉 LS 副本。幂等。 */
export async function migrateBookkeepingOffLs(): Promise<void> {
  if (typeof window === 'undefined') return;
  for (const key of BOOKKEEPING_LS_KEYS) {
    try {
      registerIdbBlobKey(key);
      const ls = localStorage.getItem(key);
      if (ls == null) continue;
      const existing = await idbBackend.get(key);
      if (existing == null) await idbBackend.set(key, ls);
      localStorage.removeItem(key);
    } catch { /* 迁失败留 LS,下次再试 */ }
  }
}

// 批次 52:聊天/AI 缓存已迁 IndexedDB,修剪改走各自 store(不再直摸 localStorage)
const CHAT_KEEP = 60;
const SESSIONS_KEEP = 8;
const AI_CACHE_KEEP_PER_SCOPE = 12;

function trimChatHistory(): void {
  try { trimChatStores(CHAT_KEEP, SESSIONS_KEEP); } catch (err) { logDropped('storage_relief.chat', err); }
}

function trimAiCache(): void {
  try { trimAiCacheStore(AI_CACHE_KEEP_PER_SCOPE); } catch (err) { logDropped('storage_relief.ai_cache', err); }
}

export interface ReliefResult {
  freedBytes: number;
  percentBefore: number;
  percentAfter: number;
  dedupedContacts: number;
  purgedImages: number;
  purgedFiles: number;
}

export async function runStorageRelief(): Promise<ReliefResult> {
  try { await migrateBookkeepingOffLs(); } catch { /* 迁簿记失败不挡其余清理 */ }
  const before = getStorageHealth();
  let deduped = 0;
  let purgedImages = 0;
  let purgedFiles = 0;
  try { deduped = await dedupeImportedContacts(); } catch (err) { logDropped('storage_relief.dedupe', err); }
  trimChatHistory();
  trimAiCache();
  // 临时图/附件缓存:清 IDB 副本,不删记忆节点本身
  try { purgedImages = await purgeLocalImages(); } catch (err) { logDropped('storage_relief.images', err); }
  try { purgedFiles = await purgeLocalFiles(); } catch (err) { logDropped('storage_relief.files', err); }
  const after = getStorageHealth();
  return {
    freedBytes: Math.max(0, before.usedBytes - after.usedBytes),
    percentBefore: before.percent,
    percentAfter: after.percent,
    dedupedContacts: deduped,
    purgedImages,
    purgedFiles,
  };
}
