/**
 * 记录级模块同步(根治「换端数据不显示」)—— 对齐「Google Contacts 式」跨端。
 *
 * 背景:健康/足迹/财务/物品等本机大数据此前只能靠**整包备份**(一个大文件、全有或全无、
 * 受 8MB/4.5MB 上限、压缩兼容/遮盖/刷新一堆坑)。改为**每个模块一行**同步到 user_module_data
 * (identity_key+module_key 主键、updated_at 定胜负),换端逐模块自动拉回,不需要备份/恢复按钮。
 *
 * 复用而非重造:枚举用备份同款 buildCombinedBackup(durable localStorage + 已迁 IDB 的 blob,
 * cache/local-only 已排除),落地用同款 restoreCombinedBackup(IDB/localStorage 分流),只是**按
 * key 逐行传输**。记忆图(life-graph)另有 signals 记录级同步,这里排除,避免双写 + replace 冲掉
 * 其 union 合并语义。
 *
 * 冲突:模块 blob 无逐条时间戳,做**模块级 last-write-wins** —— 本机缺该模块 → 填充;本机自上次
 * 同步以来未改(内容哈希 == 上次同步哈希)→ 云端更新则云端胜;本机改过 → 本机胜(等 push 覆盖云端)。
 * 对这些「多为导入/单端编辑」的模块足够安全,远好过整包全有或全无。
 */
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import { buildCombinedBackup, restoreCombinedBackup } from './cloud-backup';
import type { FullBackup } from './full-backup';
import { logDropped } from './storage-health';

/** 记忆图另有 signals 记录级同步,模块同步排除它。 */
const LIFE_GRAPH_KEY = 'nesio-life-graph-v1';
/** 每 key 上次同步的内容哈希 + 时间(判本机是否改过、云端是否更新)。 */
const SYNC_STATE_KEY = 'nesio-module-sync-state-v1';
/** 单模块压缩块上限(与路由 MAX_DATA_BYTES 对齐,< Vercel 4.5MB 请求体上限)。 */
const MAX_MODULE_PACKED_BYTES = 4 * 1024 * 1024;
const MIN_INTERVAL_MS = 20_000;
const POST_BATCH = 20;

let lastSyncAt = 0;
let inFlight = false;

// ── base64 / gzip 收口(fflate,全浏览器兼容)─────────────────────────────────
function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000; // 分块避免 String.fromCharCode 爆栈
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function packValue(json: string): string | null {
  try { return bytesToB64(gzipSync(strToU8(json))); } catch { return null; }
}
function unpackValue(b64gz: string): string | null {
  try { return strFromU8(gunzipSync(b64ToBytes(b64gz))); } catch { return null; }
}

/** 非加密内容哈希(FNV-1a)—— 仅用于判「本机是否改过 / 与云端是否一致」,不作安全用途。 */
function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + s.length.toString(36);
}

interface ModuleSyncState { [key: string]: { hash: string; syncedAt: string } }
function readState(): ModuleSyncState {
  try { return JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || '{}') as ModuleSyncState; } catch { return {}; }
}
function writeState(state: ModuleSyncState): void {
  try { localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

/** 本机应同步的模块条目(= 备份枚举去掉记忆图)。 */
async function localModuleEntries(): Promise<Record<string, string>> {
  const backup = await buildCombinedBackup();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(backup.entries)) {
    if (k === LIFE_GRAPH_KEY) continue;
    out[k] = v;
  }
  return out;
}

/**
 * 推送本机**已变**的模块(逐行 upsert)。未变的不推(增量、省流量),失败不写 state(下次重推)。
 */
export async function pushModulesToCloud(): Promise<{ pushed: number }> {
  if (typeof window === 'undefined') return { pushed: 0 };
  let entries: Record<string, string>;
  try { entries = await localModuleEntries(); } catch { return { pushed: 0 }; }
  const state = readState();
  const now = new Date().toISOString();
  const modules: Array<{ moduleKey: string; data: { gz: string }; updatedAt: string }> = [];
  const staged: ModuleSyncState = {};
  for (const [key, value] of Object.entries(entries)) {
    const h = contentHash(value);
    if (state[key]?.hash === h) continue; // 未变
    const gz = packValue(value);
    if (!gz || gz.length > MAX_MODULE_PACKED_BYTES) continue; // 压缩失败/极端超限:跳过
    modules.push({ moduleKey: key, data: { gz }, updatedAt: now });
    staged[key] = { hash: h, syncedAt: now };
  }
  if (!modules.length) return { pushed: 0 };

  let pushed = 0;
  for (let i = 0; i < modules.length; i += POST_BATCH) {
    const batch = modules.slice(i, i + POST_BATCH);
    try {
      const res = await fetch('/api/cloud/module-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modules: batch }),
        cache: 'no-store',
      });
      if (!res.ok) break; // 失败不推进 state,下次重推这批
      // 成功:登记这批的 state
      for (const m of batch) if (staged[m.moduleKey]) state[m.moduleKey] = staged[m.moduleKey];
      pushed += batch.length;
    } catch { break; }
  }
  if (pushed) writeState(state);
  return { pushed };
}

/**
 * 拉取云端全部模块行,按模块级 last-write-wins 落地。返回应用/新增计数(新增>0 → 调用方 reload)。
 */
export async function pullModulesFromCloud(): Promise<{ applied: number; newlyAdded: number }> {
  if (typeof window === 'undefined') return { applied: 0, newlyAdded: 0 };
  let rows: Array<{ moduleKey?: string; data?: unknown; updatedAt?: string | null }>;
  try {
    const res = await fetch('/api/cloud/module-data', { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; modules?: unknown };
    if (!res.ok || !data.ok || !Array.isArray(data.modules)) return { applied: 0, newlyAdded: 0 };
    rows = data.modules as typeof rows;
  } catch { return { applied: 0, newlyAdded: 0 }; }

  let localEntries: Record<string, string>;
  try { localEntries = await localModuleEntries(); } catch { return { applied: 0, newlyAdded: 0 }; }
  const state = readState();
  const applyEntries: Record<string, string> = {};
  let newlyAdded = 0;

  for (const row of rows) {
    const key = row.moduleKey;
    if (!key || typeof key !== 'string' || key === LIFE_GRAPH_KEY) continue;
    const gz = (row.data as { gz?: string } | null)?.gz;
    if (typeof gz !== 'string') continue;
    const json = unpackValue(gz);
    if (json == null) continue;
    const stamp = row.updatedAt || new Date().toISOString();
    const localVal = localEntries[key];
    if (localVal === json) { state[key] = { hash: contentHash(json), syncedAt: stamp }; continue; } // 已一致
    const localMissing = localVal === undefined;
    const localUnchangedSinceSync = !localMissing && state[key]?.hash === contentHash(localVal);
    // 反遮盖闸(通用防丢):**绝不用明显更小/更空的云端值覆盖本机非空值**。真机踩过——积分/
    // 跟练等「每设备进度」被一台空浏览器的空状态盖掉。云端这份不到本机一半大 → 疑似空/被清,
    // 不覆盖;保留本机、让它下次 push 覆盖云端(与「durability=取更全」同一原则)。
    const cloudWouldShrink = !localMissing && localVal.length > 0 && json.length * 2 < localVal.length;
    if ((localMissing || localUnchangedSinceSync) && !cloudWouldShrink) {
      // 本机没有 → 填充(换端关键路径);或本机自上次同步未改 → 云端更新胜。
      applyEntries[key] = json;
      if (localMissing) newlyAdded++;
      state[key] = { hash: contentHash(json), syncedAt: stamp };
    }
    // 否则(本机改过、或云端疑似空):本机胜,保留(等 push 覆盖云端),**不动 state** 以便下次重推。
  }

  const appliedKeys = Object.keys(applyEntries);
  if (appliedKeys.length) {
    // 只覆盖选中的这些 key(replace:overwrite 选中项;未选的不动)。已排除 life-graph,故无 union 语义损失。
    const backup: FullBackup = {
      format: 'nesio-full-backup', version: 1, exportedAt: new Date().toISOString(), entries: applyEntries,
    };
    try { await restoreCombinedBackup(backup, 'replace'); } catch (err) { logDropped('cloud.module_sync_apply', err); }
  }
  writeState(state);
  return { applied: appliedKeys.length, newlyAdded };
}

/**
 * 登录后 / 回前台调一次:先拉(模块级 LWW 落地),新设备首拉到本机没有的模块 → reload 让各 store
 * 重新水合(健康/足迹/物品缓存态不会自更新);再推本机已变模块。best-effort,20s 节流。
 */
export async function autoSyncModulesWithCloud(opts: { force?: boolean } = {}): Promise<void> {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (!opts.force && (inFlight || now - lastSyncAt < MIN_INTERVAL_MS)) return;
  inFlight = true;
  lastSyncAt = now;
  try {
    const { newlyAdded } = await pullModulesFromCloud();
    if (newlyAdded > 0 && typeof window.location?.reload === 'function') {
      window.location.reload(); // 新设备首次拉到数据 → 刷新水合;newlyAdded 只在「本机原本没有」时>0,不进循环
      return;
    }
    await pushModulesToCloud();
  } catch (err) {
    logDropped('cloud.module_sync', err);
  } finally {
    inFlight = false;
  }
}
