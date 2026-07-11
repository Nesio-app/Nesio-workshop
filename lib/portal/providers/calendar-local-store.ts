/**
 * Calendar local persistence — fetched calendar events with a 24-hour TTL,
 * the source of truth for NesioChatSheet context building.
 *
 * 批次 52:迁 IndexedDB(80 条带描述的事件是 localStorage 配额的可观占用)。
 * createBlobStore:同步缓存读 + IDB 持久,首次水合自动把旧 localStorage 数据
 * 搬进 IDB 并删原 key;水合完成派发 nesio-calendar-updated —— Today 的日历行
 * 本就监听它,冷启动那一瞬后自动补齐。
 */

import { createBlobStore } from '../idb-blob-store';

const KEY = 'nesio-calendar-local-v1';
const TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface StoredCalendarEvent {
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  calendarName?: string;
  description?: string;
  location?: string;
  url?: string;
}

interface StoredPayload {
  events: StoredCalendarEvent[];
  savedAt: number;
}

const blobStore = createBlobStore<StoredPayload>({
  key: KEY,
  updateEvent: 'nesio-calendar-updated',
  validate: (v) => Boolean(v && typeof v === 'object' && Array.isArray((v as StoredPayload).events)),
});

export function saveCalendarToLocal(events: StoredCalendarEvent[]): void {
  if (typeof window === 'undefined') return;
  blobStore.save({ events, savedAt: Date.now() });
}

export function loadCalendarFromLocal(): StoredCalendarEvent[] {
  if (typeof window === 'undefined') return [];
  const payload = blobStore.load();
  if (!payload) return [];
  if (Date.now() - payload.savedAt > TTL) return [];
  return payload.events ?? [];
}
