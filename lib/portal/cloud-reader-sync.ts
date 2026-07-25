/**
 * 导入书籍逐本记录级同步(修「换端导入的书全没了」)—— 与邮件全文同构。
 *
 * 书籍存在独立、自管的 IndexedDB(lib/portal/reader-store-idb.ts,DB=nesio-reader),体积大
 * (一本上百 KB~数 MB),从不进备份枚举 → 换端全丢(而阅读进度 nesio-reader-progress-v1 是普通
 * durable key、已随 module-sync 跨端 → 进度指向了空书,成孤儿)。做成**每本书一行**:
 * module_key = `reader-book:<id>` 进现成 user_module_data 表(gz-b64 压缩),复用路由 + 前缀分流。
 * 归属登记在 sync-ownership(READER_BOOK_MODULE_PREFIX),通用 module-sync 自动让路、不下载这些行。
 *
 * 合并极简:书按 id 基本不可变 → **并集补缺**,只补本机没有的书,不覆盖/不删除,无 LWW 复杂度。
 * 仅本人账号内(RLS 只本人可读)、不进 AI。
 */
import { gzip, gunzip, strToU8, strFromU8 } from 'fflate';
import { loadReaderBooks, saveReaderBook } from './reader-store-idb';
import { READER_BOOK_MODULE_PREFIX } from './sync-ownership';
import type { ReaderBook } from './adhd-reader';
import { logDropped } from './storage-health';
import { yieldToMain } from './yield-main';

const SYNC_STATE_KEY = 'nesio-reader-sync-state-v1';
const MAX_BOOK_PACKED_BYTES = 4 * 1024 * 1024; // 单本压缩块上限(< Vercel 4.5MB);超限的书跳过(留日志)
const MIN_INTERVAL_MS = 30_000;
const POST_BATCH = 10;
const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;
/** 拉到新书后广播,阅读器已开着也能刷新书架(未监听则下次打开自然显示)。 */
export const READER_BOOKS_SYNCED_EVENT = 'nesio-reader-books-synced';

let lastSyncAt = 0;
let inFlight = false;

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// gzip/gunzip 走 fflate 异步(Web Worker)版本:书籍全文可达数 MB,同步 gzipSync 单次调用会卡住主线程。
// 异步版在 worker 压缩,主线程永不阻塞;btoa/atob 作用在压缩后的小字节上,毫秒级,留主线程无妨。
function gzipAsync(u8: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gzip(u8, (err, out) => (err ? reject(err) : resolve(out))));
}
function gunzipAsync(u8: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gunzip(u8, (err, out) => (err ? reject(err) : resolve(out))));
}
async function packValue(json: string): Promise<string | null> {
  try { return bytesToB64(await gzipAsync(strToU8(json))); } catch { return null; }
}
async function unpackValue(b64gz: string): Promise<string | null> {
  try { return strFromU8(await gunzipAsync(b64ToBytes(b64gz))); } catch { return null; }
}
function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + s.length.toString(36);
}

interface ReaderSyncState { [bookId: string]: string }
function readState(): ReaderSyncState {
  try { return JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || '{}') as ReaderSyncState; } catch { return {}; }
}
function writeState(state: ReaderSyncState): void {
  try { localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

/** 推送本机未推过的书(逐本 upsert,增量;失败不写 state 下次重推)。 */
export async function pushReaderBooksToCloud(): Promise<{ pushed: number }> {
  if (typeof window === 'undefined') return { pushed: 0 };
  let books: ReaderBook[];
  try { books = await loadReaderBooks(); } catch { return { pushed: 0 }; }
  const state = readState();
  const now = new Date().toISOString();
  const rows: Array<{ moduleKey: string; data: { gz: string }; updatedAt: string }> = [];
  const staged: ReaderSyncState = {};
  let packed = 0;
  for (const book of books) {
    const id = book?.id;
    if (!id || typeof id !== 'string' || !SAFE_ID_RE.test(id)) continue;
    let json: string;
    try { json = JSON.stringify(book); } catch { continue; }
    const h = contentHash(json);
    if (state[id] === h) continue; // 已推
    if (packed++ > 0) await yieldToMain(); // 书体积大,每压一本让出主线程
    const gz = await packValue(json);
    if (!gz) continue;
    if (gz.length > MAX_BOOK_PACKED_BYTES) { logDropped('cloud.reader_book_too_large', new Error(id)); continue; }
    rows.push({ moduleKey: READER_BOOK_MODULE_PREFIX + id, data: { gz }, updatedAt: now });
    staged[id] = h;
  }
  if (!rows.length) return { pushed: 0 };

  let pushed = 0;
  for (let i = 0; i < rows.length; i += POST_BATCH) {
    const batch = rows.slice(i, i + POST_BATCH);
    try {
      const res = await fetch('/api/cloud/module-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modules: batch }),
        cache: 'no-store',
      });
      if (!res.ok) break;
      for (const r of batch) { const id = r.moduleKey.slice(READER_BOOK_MODULE_PREFIX.length); if (staged[id]) state[id] = staged[id]; }
      pushed += batch.length;
    } catch { break; }
  }
  if (pushed) writeState(state);
  return { pushed };
}

/** 拉云端全部书行,并集补缺落地(只补本机没有的书,不覆盖不删除)。 */
export async function pullReaderBooksFromCloud(): Promise<{ applied: number }> {
  if (typeof window === 'undefined') return { applied: 0 };
  let rows: Array<{ moduleKey?: string; data?: unknown }>;
  try {
    const res = await fetch(`/api/cloud/module-data?keyPrefix=${encodeURIComponent(READER_BOOK_MODULE_PREFIX)}`, { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; modules?: unknown };
    if (!res.ok || !data.ok || !Array.isArray(data.modules)) return { applied: 0 };
    rows = data.modules as typeof rows;
  } catch { return { applied: 0 }; }

  let localIds: Set<string>;
  try { localIds = new Set((await loadReaderBooks()).map((b) => b.id)); } catch { return { applied: 0 }; }
  const state = readState();
  let applied = 0;
  for (const row of rows) {
    const key = row.moduleKey;
    if (!key || typeof key !== 'string' || !key.startsWith(READER_BOOK_MODULE_PREFIX)) continue;
    const id = key.slice(READER_BOOK_MODULE_PREFIX.length);
    if (!id || localIds.has(id)) { if (id) state[id] = state[id] || 'have'; continue; } // 本机已有 → 不覆盖
    const gz = (row.data as { gz?: string } | null)?.gz;
    if (typeof gz !== 'string') continue;
    await yieldToMain(); // 每本解压前让出主线程
    const json = await unpackValue(gz);
    if (json == null) continue;
    let book: ReaderBook;
    try { book = JSON.parse(json) as ReaderBook; } catch { continue; }
    if (!book || book.id !== id) continue;
    try { await saveReaderBook(book); state[id] = contentHash(json); applied++; } catch (err) { logDropped('cloud.reader_book_apply', err); }
  }
  writeState(state);
  if (applied > 0 && typeof window.dispatchEvent === 'function') {
    try { window.dispatchEvent(new CustomEvent(READER_BOOKS_SYNCED_EVENT, { detail: { added: applied } })); } catch { /* ignore */ }
  }
  return { applied };
}

/** 登录后 / 回前台调一次:先拉(补齐本机缺的书)再推(本机新导入的)。best-effort,30s 节流。 */
export async function autoSyncReaderBooksWithCloud(opts: { force?: boolean } = {}): Promise<void> {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (!opts.force && (inFlight || now - lastSyncAt < MIN_INTERVAL_MS)) return;
  inFlight = true;
  lastSyncAt = now;
  try {
    await pullReaderBooksFromCloud();
    await pushReaderBooksToCloud();
  } catch (err) {
    logDropped('cloud.reader_sync', err);
  } finally {
    inFlight = false;
  }
}
