/**
 * 一键腾空间(批次 38)—— 存储报警不能只让用户"惦记备份",要能当场自救。
 *
 * 只清**可再生/冗余**的数据,绝不动记忆本体:
 *  1. 重复导入的联系人(并发导入的历史遗留,dedupeImportedContacts 保最早删其余)
 *  2. 问一问聊天历史(留最近 60 条 —— 记忆才是事实源,聊天记录是缓存态)
 *  3. AI 回复缓存(LRU,砍到每 scope 最近 12 条)
 *  4. 云同步 outbox 压实(life-graph 内部已有,借道触发)
 */

import { getStorageHealth, logDropped } from './storage-health';
import { dedupeImportedContacts } from './providers/connector-sync';

const CHAT_HISTORY_KEY = 'nesio-chat-history-v1';
const AI_CACHE_KEY = 'nesio-ai-cache-v1';
const CHAT_KEEP = 60;
const AI_CACHE_KEEP_PER_SCOPE = 12;

function trimChatHistory(): void {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length > CHAT_KEEP) {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(parsed.slice(-CHAT_KEEP)));
    }
  } catch (err) { logDropped('storage_relief.chat', err); }
}

function trimAiCache(): void {
  try {
    const raw = localStorage.getItem(AI_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Record<string, { at?: number }>>;
    if (!parsed || typeof parsed !== 'object') return;
    for (const scope of Object.keys(parsed)) {
      const entries = Object.entries(parsed[scope] ?? {});
      if (entries.length <= AI_CACHE_KEEP_PER_SCOPE) continue;
      entries.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
      parsed[scope] = Object.fromEntries(entries.slice(0, AI_CACHE_KEEP_PER_SCOPE));
    }
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(parsed));
  } catch (err) { logDropped('storage_relief.ai_cache', err); }
}

export interface ReliefResult {
  freedBytes: number;
  percentBefore: number;
  percentAfter: number;
  dedupedContacts: number;
}

export async function runStorageRelief(): Promise<ReliefResult> {
  const before = getStorageHealth();
  let deduped = 0;
  try { deduped = await dedupeImportedContacts(); } catch (err) { logDropped('storage_relief.dedupe', err); }
  trimChatHistory();
  trimAiCache();
  const after = getStorageHealth();
  return {
    freedBytes: Math.max(0, before.usedBytes - after.usedBytes),
    percentBefore: before.percent,
    percentAfter: after.percent,
    dedupedContacts: deduped,
  };
}
