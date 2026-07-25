/**
 * 通用「逐记录」云同步工厂(单一真源,治「每个功能自己一套」)。
 *
 * 独立、量级大的本机 store(邮件全文 / 导入书籍 / 地点封面照 …)不进整包/模块同步,而是**每条一行**
 * 存 user_module_data(module_key = `<prefix><id>`,gz-b64 压缩)。这些引擎逻辑几乎一样(增量 push +
 * 并集补缺 pull),此前各写一份。这里抽成工厂:新增一个 per-record 同步 = 给一份 config(前缀 + 枚举 +
 * 落地),**零重复**。前缀须在 sync-ownership 登记,通用 module-sync 会自动排除(服务端不下载)。
 *
 * 合并语义:记录按 id 基本不可变 → **并集补缺**(只补本机没有的,不覆盖、不删除),无 LWW 复杂度。
 * 仅本人账号内(RLS 只本人可读)、不进 AI。best-effort。
 */
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import { logDropped } from './storage-health';
import { yieldToMain } from './yield-main';

export interface RecordSyncConfig {
  /** module_key 前缀(须已在 sync-ownership 的 DEDICATED_SYNC_PREFIXES 登记)。 */
  prefix: string;
  /** localStorage 同步状态 key(每 id 上次同步内容哈希)。 */
  stateKey: string;
  /** 枚举本机记录:id → 序列化内容字符串。也用于 pull 判「本机是否已有该 id」。 */
  load: () => Promise<Record<string, string>>;
  /** 落地拉回的记录(id → 内容)。 */
  apply: (records: Record<string, string>) => Promise<void>;
  /** 落地后回调(如广播刷新事件)。 */
  onApplied?: (count: number) => void;
  /** 名字(日志用)。 */
  name?: string;
  maxPackedBytes?: number;
  postBatch?: number;
  minIntervalMs?: number;
}

const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

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
function packValue(s: string): string | null {
  try { return bytesToB64(gzipSync(strToU8(s))); } catch { return null; }
}
function unpackValue(b64gz: string): string | null {
  try { return strFromU8(gunzipSync(b64ToBytes(b64gz))); } catch { return null; }
}
function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + s.length.toString(36);
}

export interface RecordSync {
  push: () => Promise<{ pushed: number }>;
  pull: () => Promise<{ applied: number }>;
  autoSync: (opts?: { force?: boolean }) => Promise<void>;
}

export function createRecordSync(cfg: RecordSyncConfig): RecordSync {
  const prefix = cfg.prefix;
  const stateKey = cfg.stateKey;
  const maxPacked = cfg.maxPackedBytes ?? 4 * 1024 * 1024;
  const batch = cfg.postBatch ?? 10;
  const minInterval = cfg.minIntervalMs ?? 30_000;
  const label = cfg.name || prefix;
  let lastSyncAt = 0;
  let inFlight = false;

  function readState(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(stateKey) || '{}') as Record<string, string>; } catch { return {}; }
  }
  function writeState(state: Record<string, string>): void {
    try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch { /* quota */ }
  }

  async function push(): Promise<{ pushed: number }> {
    if (typeof window === 'undefined') return { pushed: 0 };
    let local: Record<string, string>;
    try { local = await cfg.load(); } catch { return { pushed: 0 }; }
    const state = readState();
    const now = new Date().toISOString();
    const rows: Array<{ moduleKey: string; data: { gz: string }; updatedAt: string }> = [];
    const staged: Record<string, string> = {};
    let packed = 0;
    for (const [id, value] of Object.entries(local)) {
      if (!id || !SAFE_ID_RE.test(id) || !value) continue;
      const h = contentHash(value);
      if (state[id] === h) continue;
      // 大量记录(邮件/书籍/照片)同步 gzip 在主线程 —— 每压一条让出一拍,避免整段循环冻住 UI。
      if (packed++ > 0) await yieldToMain();
      const gz = packValue(value);
      if (!gz) continue;
      if (gz.length > maxPacked) { logDropped(`cloud.${label}_too_large`, new Error(id)); continue; }
      rows.push({ moduleKey: prefix + id, data: { gz }, updatedAt: now });
      staged[id] = h;
    }
    if (!rows.length) return { pushed: 0 };
    let pushed = 0;
    for (let i = 0; i < rows.length; i += batch) {
      const chunk = rows.slice(i, i + batch);
      try {
        const res = await fetch('/api/cloud/module-data', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ modules: chunk }), cache: 'no-store',
        });
        if (!res.ok) break;
        for (const r of chunk) { const id = r.moduleKey.slice(prefix.length); if (staged[id]) state[id] = staged[id]; }
        pushed += chunk.length;
      } catch { break; }
    }
    if (pushed) writeState(state);
    return { pushed };
  }

  async function pull(): Promise<{ applied: number }> {
    if (typeof window === 'undefined') return { applied: 0 };
    let rows: Array<{ moduleKey?: string; data?: unknown }>;
    try {
      const res = await fetch(`/api/cloud/module-data?keyPrefix=${encodeURIComponent(prefix)}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; modules?: unknown };
      if (!res.ok || !data.ok || !Array.isArray(data.modules)) return { applied: 0 };
      rows = data.modules as typeof rows;
    } catch { return { applied: 0 }; }
    let local: Record<string, string>;
    try { local = await cfg.load(); } catch { return { applied: 0 }; }
    const state = readState();
    const toApply: Record<string, string> = {};
    for (const row of rows) {
      const key = row.moduleKey;
      if (!key || typeof key !== 'string' || !key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (!id) continue;
      if (local[id] !== undefined) { state[id] = state[id] || 'have'; continue; } // 本机已有 → 并集不覆盖
      const gz = (row.data as { gz?: string } | null)?.gz;
      if (typeof gz !== 'string') continue;
      await yieldToMain(); // 每条解压前让出主线程
      const val = unpackValue(gz);
      if (val == null || !val) continue;
      toApply[id] = val;
      state[id] = contentHash(val);
    }
    const ids = Object.keys(toApply);
    if (ids.length) {
      try { await cfg.apply(toApply); cfg.onApplied?.(ids.length); } catch (err) { logDropped(`cloud.${label}_apply`, err); }
    }
    writeState(state);
    return { applied: ids.length };
  }

  async function autoSync(opts: { force?: boolean } = {}): Promise<void> {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    if (!opts.force && (inFlight || now - lastSyncAt < minInterval)) return;
    inFlight = true;
    lastSyncAt = now;
    try { await pull(); await push(); } catch (err) { logDropped(`cloud.${label}_sync`, err); } finally { inFlight = false; }
  }

  return { push, pull, autoSync };
}
