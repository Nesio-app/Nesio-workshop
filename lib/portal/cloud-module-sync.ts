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
import { gzip, gunzip, strToU8, strFromU8 } from 'fflate';
import { buildCombinedBackup, restoreCombinedBackup } from './cloud-backup';
import type { FullBackup } from './full-backup';
import { logDropped } from './storage-health';
import { isDedicatedSyncKey, DEDICATED_SYNC_PREFIXES } from './sync-ownership';
import { recordCloudRestore } from './cloud-restore-receipt';
import { isBackupKey } from './storage-manifest';
import { yieldToMain } from './yield-main';

// 归属:记忆图/头像身份/学习态/邮件全文 各有专属引擎(见 sync-ownership.ts),通用模块同步一律让路,
// 避免两套合并语义抢同一份数据(换端横跳的根因)。判断统一走 isDedicatedSyncKey,不再各写一份。
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
// gzip/gunzip 走 fflate **异步(Web Worker)** 版本 —— 压缩这台设备最大的隐患:健康/财务/GPS 足迹是
// 多 MB blob,同步 gzipSync 单次调用就把主线程卡住数秒(真机「跟练卡死」的真凶,yield 切不开单个大调用)。
// 异步版在 worker 线程压缩,主线程永不阻塞。btoa/atob 作用在**压缩后**的小字节上,毫秒级,留主线程无妨。
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

// 增量拉取水位(仅本机 bookkeeping,不上云):记「上次拉到的最大 updated_at」。下次 GET 传 since=它,
// 服务端只回变过的行 → 登录不再每次重下全量(修「上云后登录特别慢」)。空/清缓存 → 全量(新设备该拿全)。
const SINCE_KEY = 'nesio-module-sync-since-v1';
function readSince(): string | null {
  try { return localStorage.getItem(SINCE_KEY) || null; } catch { return null; }
}
function writeSince(iso: string): void {
  try { localStorage.setItem(SINCE_KEY, iso); } catch { /* quota */ }
}

/** 本机应同步的模块条目(= 备份枚举去掉记忆图)。 */
async function localModuleEntries(): Promise<Record<string, string>> {
  const backup = await buildCombinedBackup();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(backup.entries)) {
    if (isDedicatedSyncKey(k)) continue; // 专属引擎负责的 key(记忆图/头像/学习态/邮件)让路
    out[k] = v;
  }
  return out;
}

/**
 * 推送本机**已变**的模块(逐行 upsert)。未变的不推(增量、省流量),失败不写 state(下次重推)。
 */
export async function pushModulesToCloud(
  /** 同一轮同步里已读过的快照。**仅当 pull 没有落地任何改动时才可复用** ——
   *  否则会拿 pull 前的旧值把刚拉下来的新值顶回去。 */
  reuseEntries?: Record<string, string>,
): Promise<{ pushed: number }> {
  if (typeof window === 'undefined') return { pushed: 0 };
  let entries: Record<string, string>;
  if (reuseEntries) entries = reuseEntries;
  else { try { entries = await localModuleEntries(); } catch { return { pushed: 0 }; } }
  const state = readState();
  const now = new Date().toISOString();
  const modules: Array<{ moduleKey: string; data: { gz: string }; updatedAt: string }> = [];
  const staged: ModuleSyncState = {};
  let packed = 0;
  for (const [key, value] of Object.entries(entries)) {
    const h = contentHash(value);
    if (state[key]?.hash === h) continue; // 未变
    // 大 blob(健康/财务/足迹)同步 gzip 在主线程 —— 每压一条让出一拍,避免整段循环冻住 UI。
    if (packed++ > 0) await yieldToMain();
    const gz = await packValue(value);
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
export async function pullModulesFromCloud(): Promise<{ applied: number; newlyAdded: number; localEntries?: Record<string, string> }> {
  if (typeof window === 'undefined') return { applied: 0, newlyAdded: 0 };
  let rows: Array<{ moduleKey?: string; data?: unknown; updatedAt?: string | null }>;
  try {
    // 排除所有 per-record 专属引擎的行(邮件全文 email-body:* / 书籍 reader-book:* …):它们量级大、
    // 各由自己的引擎同步,绝不卷进这里(否则 20s 轮询每次下载数十 MB)。服务端过滤,不只客户端跳过。
    // 前缀集来自 sync-ownership 单一真源 —— 以后新增 per-record 引擎自动被排除,无需改这里。
    const since = readSince();
    let qs = `excludePrefix=${encodeURIComponent(DEDICATED_SYNC_PREFIXES.join(','))}`;
    if (since) qs += `&since=${encodeURIComponent(since)}`; // 增量:只拉自上次以来变过的模块行
    const res = await fetch(`/api/cloud/module-data?${qs}`, { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; modules?: unknown };
    if (!res.ok || !data.ok || !Array.isArray(data.modules)) return { applied: 0, newlyAdded: 0 };
    rows = data.modules as typeof rows;
  } catch { return { applied: 0, newlyAdded: 0 }; }

  let localEntries: Record<string, string>;
  try { localEntries = await localModuleEntries(); } catch { return { applied: 0, newlyAdded: 0 }; }
  const state = readState();
  const applyEntries: Record<string, string> = {};
  let newlyAdded = 0;
  // 本机原本没有、由云端填进来的 key —— 用户看到的数会因此变化,得留个回执说清来源
  const filledKeys: string[] = [];

  for (const row of rows) {
    const key = row.moduleKey;
    if (!key || typeof key !== 'string') continue;
    if (isDedicatedSyncKey(key)) continue; // 专属引擎负责的 key(记忆图/头像/学习态/邮件)不由通用同步落地
    // 关键(修刷屏死循环):只落地「本引擎自己也会同步」的 key(durable、非 cache/auth/local-only)。
    // 否则**历史遗留的云端行**(如曾是 durable、现已归 cache 的 nesio-module-sync-state-v1)会被当成
    // 「本机缺失」→ 每次 pull 都 newlyAdded>0 → reload → 无限刷屏。localModuleEntries 已排除这些 key,
    // 落地侧必须对齐同一判据,否则永远「缺失」。
    if (!isBackupKey(key)) continue;
    const gz = (row.data as { gz?: string } | null)?.gz;
    if (typeof gz !== 'string') continue;
    await yieldToMain(); // 每条解压前让出主线程,避免大数据集一次解压把 UI 冻住
    const json = await unpackValue(gz);
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
      if (localMissing) { newlyAdded++; filledKeys.push(key); }
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
    try {
      await restoreCombinedBackup(backup, 'replace');
      // 数据被悄悄改变而用户不知道,本身就是问题(QA:积分 0→150)。留一条一次性回执。
      recordCloudRestore(filledKeys);
    } catch (err) { logDropped('cloud.module_sync_apply', err); }
  }
  writeState(state);
  // 推进增量水位到本次拉到的最大 updated_at(含被跳过的行——它们也已「见过」)。下次只拉更新的。
  let maxSeen: string | null = null;
  for (const row of rows) {
    const u = row.updatedAt;
    if (typeof u === 'string' && u && (maxSeen === null || Date.parse(u) > Date.parse(maxSeen))) maxSeen = u;
  }
  if (maxSeen) writeSince(maxSeen);
  // 把已读快照回传给同一轮的 push 复用(调用方只在 applied === 0 时才可用它)
  return { applied: appliedKeys.length, newlyAdded, localEntries };
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
    const { newlyAdded, applied, localEntries } = await pullModulesFromCloud();
    // 水合刷新每个页面加载最多一次(sessionStorage 闸)—— 防「某 key 永远判缺失」时 reload 无限刷屏
    // (真机踩过:历史遗留云端行被误判缺失导致一闪一闪)。正常冷启动首拉只会触发一次,足够水合。
    if (newlyAdded > 0 && typeof window.location?.reload === 'function') {
      const FLAG = 'nesio-module-hydrate-reloaded';
      let alreadyReloaded = false;
      let flagPersisted = false;
      try {
        alreadyReloaded = sessionStorage.getItem(FLAG) === '1';
        if (!alreadyReloaded) {
          sessionStorage.setItem(FLAG, '1');
          // 关键:回读校验标志真的持久化了才 reload。隐私模式/分区存储写不进 → 不 reload
          // (否则每次 reload 都以为「首次」→ 无限刷屏,与 cloud-backup 的硬化同款)。
          flagPersisted = sessionStorage.getItem(FLAG) === '1';
        }
      } catch { /* sessionStorage 不可用:不 reload,避免死循环 */ }
      if (!alreadyReloaded && flagPersisted) {
        window.location.reload(); // 新设备首次拉到数据 → 刷新水合(每次加载至多一次)
        return;
      }
    }
    // 一轮同步里 buildCombinedBackup 此前被读两遍(整个 localStorage + 全部 IDB blob 各读两次)。
    // pull 没落地任何改动时,本机状态与刚才读的快照一致 → 直接复用,省掉一次全量读。
    await pushModulesToCloud(applied === 0 ? localEntries : undefined);
  } catch (err) {
    logDropped('cloud.module_sync', err);
  } finally {
    inFlight = false;
  }
}
