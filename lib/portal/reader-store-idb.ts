/**
 * Reader Book Store — 导入书籍的本机存储(批次 26)。
 *
 * ADHD 阅读器导入的书(文件/粘贴脱水后的 ReaderBook)体积可能上百 KB,
 * localStorage 装不下,存 IndexedDB。key = book.id。
 * 阅读进度另存 localStorage(见 reader-progress),这里只管书本身。
 */

import type { ReaderBook } from './adhd-reader';
import { logDropped, reportStorageDropped } from './storage-health';
import { openSimpleDb } from '@/lib/idb/open-simple-db';

const DB_NAME = 'nesio-reader';
const STORE = 'books';

function openDB(): Promise<IDBDatabase | null> {
  return openSimpleDb(DB_NAME, 1, [{ name: STORE, keyPath: 'id' }]);
}

export async function saveReaderBook(book: ReaderBook): Promise<void> {
  const db = await openDB();
  // 红线:storage 写失败必须可见(否则导入的书配额满/隐私模式下静默丢失,连日志都没)。
  if (!db) { logDropped('reader_book.save', new Error('indexeddb_unavailable')); reportStorageDropped(); return; }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(book);
    tx.oncomplete = () => resolve();
    tx.onerror = () => { logDropped('reader_book.save', tx.error); reportStorageDropped(); resolve(); };
  });
}

export async function loadReaderBooks(): Promise<ReaderBook[]> {
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const list = (req.result as ReaderBook[]) || [];
      list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export async function getReaderBook(id: string): Promise<ReaderBook | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as ReaderBook) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function deleteReaderBook(id: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/* ---------- 阅读进度(轻量,存 localStorage)---------- */

export interface ReaderProgress {
  line: number;
  percent: number;
  updatedAt: number;
}

const PROGRESS_KEY = 'nesio-reader-progress-v1';

export function loadReaderProgress(): Record<string, ReaderProgress> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') as Record<string, ReaderProgress>;
  } catch {
    return {};
  }
}

export function getReaderProgress(id: string): ReaderProgress {
  return loadReaderProgress()[id] || { line: 0, percent: 0, updatedAt: 0 };
}

export function setReaderProgress(id: string, patch: Partial<ReaderProgress>): void {
  if (typeof window === 'undefined') return;
  const all = loadReaderProgress();
  all[id] = { ...getReaderProgress(id), ...patch, updatedAt: Date.now() };
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* quota */
  }
}
