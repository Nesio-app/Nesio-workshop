/**
 * 邮件全文逐封记录级同步(workshop:一切数据跨端一致)—— 让 nesio-email-bodies 里的邮件正文
 * 换端也在。
 *
 * 为什么单独一套(不并进 cloud-module-sync):邮件全文是**独立、自管的 IndexedDB**
 * (lib/portal/local-email-body.ts,DB=nesio-email-bodies),从不进备份枚举(buildCombinedBackup),
 * 而且量级大(单封 ≤20KB、可上千封 → 数十 MB),远超单模块 4MB 压缩上限。所以做成**每封邮件一行**:
 * 复用现成的 user_module_data 表 + /api/cloud/module-data 路由,module_key = `email-body:<emailId>`,
 * data = gz-b64 压缩正文。路由的 keyPrefix/excludePrefix 分流保证:普通模块同步的 20s 轮询用
 * excludePrefix=email-body: 绝不下载这些海量行;这里用 keyPrefix=email-body: 只取邮件行。
 *
 * 冲突极简:一封邮件的正文按 emailId 基本不可变(同一封不会改内容)→ 纯**并集合并**,只补缺、
 * 从不覆盖/删除,没有 LWW 复杂度,也不会丢。落地后即刻喂全文检索索引(indexEmailBodies),
 * 换端拉回的邮件立即可搜,无需 reload。
 *
 * 隐私:与其它 durable 数据同权 —— 仅本人账号内(RLS 只本人可读)、不进 AI、不训练。
 */
import { gzip, gunzip, strToU8, strFromU8 } from 'fflate';
import { getAllEmailBodies, putEmailBodies } from './local-email-body';
import { indexEmailBodies } from './email-fulltext-index';
import { logDropped } from './storage-health';
import { yieldToMain } from './yield-main';
import { createBlobStore } from './idb-blob-store';

/** 邮件全文行的 module_key 前缀。cloud-module-sync 靠它把邮件行排除在普通模块同步之外。 */
export const EMAIL_BODY_MODULE_PREFIX = 'email-body:';
/** 每封上次同步的内容哈希(判是否已推,增量省流量)。 */
const SYNC_STATE_KEY = 'nesio-email-sync-state-v1';
/** 单封压缩块上限(与路由 MAX_DATA_BYTES 对齐;正文早已 ≤20KB,几乎不会触)。 */
const MAX_BODY_PACKED_BYTES = 4 * 1024 * 1024;
const MIN_INTERVAL_MS = 30_000;
const POST_BATCH = 20;
/** Gmail message id 字符集守卫(与路由 sanitizeModuleKey 一致,越界的跳过不同步)。 */
const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

let lastSyncAt = 0;
let inFlight = false;

// ── base64 / gzip 收口(fflate,全浏览器兼容)─────────────────────────────────
function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// gzip/gunzip 走 fflate 异步(Web Worker)版本:邮件成千上万封,批量同步压缩不占主线程 → 永不卡 UI。
// btoa/atob 作用在压缩后的小字节上,毫秒级,留主线程无妨。
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

/** 非加密内容哈希(FNV-1a）—— 仅判「本机是否已推该封」。 */
function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + s.length.toString(36);
}

interface EmailSyncState { [emailId: string]: string } // emailId → 上次同步哈希
const stateStore = typeof createBlobStore === 'function'
  ? createBlobStore<EmailSyncState>({
      key: SYNC_STATE_KEY,
      updateEvent: 'nesio-email-sync-state-updated',
      validate: (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v)),
    })
  : null;
function readState(): EmailSyncState {
  const v = stateStore?.load();
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || '{}') as EmailSyncState; } catch { return {}; }
}
function writeState(state: EmailSyncState): void {
  if (stateStore) { stateStore.save(state); return; }
  try { localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

/**
 * 推送本机**未推过**的邮件全文(逐封 upsert)。已推的不重推(增量),失败不写 state(下次重推)。
 */
export async function pushEmailBodiesToCloud(): Promise<{ pushed: number }> {
  if (typeof window === 'undefined') return { pushed: 0 };
  let bodies: Record<string, string>;
  try { bodies = await getAllEmailBodies(); } catch { return { pushed: 0 }; }
  const state = readState();
  const now = new Date().toISOString();
  const rows: Array<{ moduleKey: string; data: { gz: string }; updatedAt: string }> = [];
  const staged: EmailSyncState = {};
  let packed = 0;
  for (const [emailId, body] of Object.entries(bodies)) {
    if (!emailId || !SAFE_ID_RE.test(emailId) || !body) continue;
    const h = contentHash(body);
    if (state[emailId] === h) continue; // 已推
    // 上千封邮件全文同步 gzip 在主线程 —— 每压一条让出一拍,避免开机首次同步冻住 UI。
    if (packed++ > 0) await yieldToMain();
    const gz = await packValue(body);
    if (!gz || gz.length > MAX_BODY_PACKED_BYTES) continue;
    rows.push({ moduleKey: EMAIL_BODY_MODULE_PREFIX + emailId, data: { gz }, updatedAt: now });
    staged[emailId] = h;
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
      if (!res.ok) break; // 失败不推进 state,下次重推这批
      for (const r of batch) { const emailId = r.moduleKey.slice(EMAIL_BODY_MODULE_PREFIX.length); if (staged[emailId]) state[emailId] = staged[emailId]; }
      pushed += batch.length;
    } catch { break; }
  }
  if (pushed) writeState(state);
  return { pushed };
}

/**
 * 拉取云端全部邮件全文行,并集合并落地(只补本机没有的封;不覆盖、不删除)。落地即喂全文索引。
 */
export async function pullEmailBodiesFromCloud(): Promise<{ applied: number }> {
  if (typeof window === 'undefined') return { applied: 0 };
  let rows: Array<{ moduleKey?: string; data?: unknown }>;
  try {
    const res = await fetch(`/api/cloud/module-data?keyPrefix=${encodeURIComponent(EMAIL_BODY_MODULE_PREFIX)}`, { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; modules?: unknown };
    if (!res.ok || !data.ok || !Array.isArray(data.modules)) return { applied: 0 };
    rows = data.modules as typeof rows;
  } catch { return { applied: 0 }; }

  let local: Record<string, string>;
  try { local = await getAllEmailBodies(); } catch { return { applied: 0 }; }
  const state = readState();
  const toPut: Record<string, string> = {};
  for (const row of rows) {
    const key = row.moduleKey;
    if (!key || typeof key !== 'string' || !key.startsWith(EMAIL_BODY_MODULE_PREFIX)) continue;
    const emailId = key.slice(EMAIL_BODY_MODULE_PREFIX.length);
    if (!emailId) continue;
    // 已在本机(内容不可变)→ 只登记 state,不解压、不重复落地。
    if (local[emailId]) { state[emailId] = contentHash(local[emailId]); continue; }
    const gz = (row.data as { gz?: string } | null)?.gz;
    if (typeof gz !== 'string') continue;
    await yieldToMain(); // 每条解压前让出主线程(上千封别一次解压冻住 UI)
    const body = await unpackValue(gz);
    if (body == null || !body) continue;
    toPut[emailId] = body;
    state[emailId] = contentHash(body);
  }

  const ids = Object.keys(toPut);
  if (ids.length) {
    try {
      await putEmailBodies(toPut);        // 落本机 IndexedDB(换端补齐)
      indexEmailBodies(toPut);            // 即刻并入全文检索索引,拉回的邮件立即可搜(无需 reload)
    } catch (err) { logDropped('cloud.email_sync_apply', err); }
  }
  writeState(state);
  return { applied: ids.length };
}

/**
 * 登录后 / 回前台调一次:先拉(补齐本机缺的邮件全文,喂索引),再推本机未推的。best-effort,30s 节流。
 * 无 reload —— 索引已直接喂入,搜索即刻生效。
 */
export async function autoSyncEmailBodiesWithCloud(opts: { force?: boolean } = {}): Promise<void> {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (!opts.force && (inFlight || now - lastSyncAt < MIN_INTERVAL_MS)) return;
  inFlight = true;
  lastSyncAt = now;
  try {
    await pullEmailBodiesFromCloud();
    await pushEmailBodiesToCloud();
  } catch (err) {
    logDropped('cloud.email_sync', err);
  } finally {
    inFlight = false;
  }
}
