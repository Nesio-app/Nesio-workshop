/**
 * chat-store — 问一问的对话持久化,迁 IndexedDB(批次 52「全迁出」)。
 *
 * 为什么:归档会话(nesio-chat-sessions-v1)最多 20 场 × 60 条全文消息,是
 * localStorage 5MB 配额里最大的剩余占用者之一;每开一次「新对话」就归档一场,
 * 用户越活跃越快撑爆。走 createBlobStore:同步内存缓存读、IDB 持久化、
 * 首次水合自动把旧 localStorage 数据搬进 IDB 并删原 key(老用户透明腾配额)。
 *
 * 消息结构由 NesioChatSheet 拥有(UiMessage 是组件私有类型),这里只当不透明
 * JSON 数组存取;storage-relief 的修剪也从这里走,不再直摸 localStorage。
 */

import { createBlobStore } from './idb-blob-store';

export const CHAT_STORE_UPDATED_EVENT = 'nesio-chat-store-updated';

const historyStore = createBlobStore<unknown[]>({
  key: 'nesio-chat-history-v1',
  updateEvent: CHAT_STORE_UPDATED_EVENT,
  validate: Array.isArray,
});

const sessionsStore = createBlobStore<unknown[]>({
  key: 'nesio-chat-sessions-v1',
  updateEvent: CHAT_STORE_UPDATED_EVENT,
  validate: Array.isArray,
});

export function loadChatHistoryRaw(): unknown[] {
  return historyStore.load() ?? [];
}

export function saveChatHistoryRaw(msgs: unknown[]): void {
  historyStore.save(msgs);
}

export function loadChatSessionsRaw(): unknown[] {
  return sessionsStore.load() ?? [];
}

export function saveChatSessionsRaw(sessions: unknown[]): void {
  sessionsStore.save(sessions);
}

/** 一键腾空间:当前对话留 keepHistory 条、归档会话留 keepSessions 场。 */
export function trimChatStores(keepHistory = 60, keepSessions = 8): void {
  const h = historyStore.load();
  if (Array.isArray(h) && h.length > keepHistory) historyStore.save(h.slice(-keepHistory));
  const s = sessionsStore.load();
  if (Array.isArray(s) && s.length > keepSessions) sessionsStore.save(s.slice(0, keepSessions));
}
