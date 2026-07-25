/**
 * Cloud backup — 把「本机全部 durable 数据」一键推到用户自己的云账户。
 *
 * 这是"输出侧统一"在存储上的落点:本地导出(full-backup.ts)和云推送用**同一份枚举**
 * —— localStorage 的 durable key(storage-manifest 归类)+ 已迁 IndexedDB 的 blob
 * (健康/临床/地点/银行)。二者只是目的地不同:一个下载成文件,一个 POST 到云。
 *
 * 复用现成管道:走 /api/cloud/assets(purpose=backup),它已支持 text/plain ≤8MB、
 * 按用户身份隔离、签名 URL 回读 —— 不用新建云端点/表。整体仍 gate 在
 * CLOUD_DB_ENABLED + 已登录之后(路由层判断,前端拿 401/503 如实呈现)。
 *
 * 付费:云备份是规划中的付费能力。hasCloudEntitlement() 是**桩**——真支付/权益强制层
 * 尚未落地(见 docs 权益契约 report-only),默认关;内测/开发翻本地 flag 打开。
 * 支付基建接上后,把这个桩换成真权益读取即可,推送机制本身不用动。
 */

import { buildFullBackup, restoreFullBackup, isValidBackup, type FullBackup } from './full-backup';
import { collectIdbBlobs, isIdbBlobKey, idbBackend, registerIdbBlobKey } from './idb-blob-store';
import { keyKind, isLocalOnly } from './storage-manifest';
// 批次 54(足迹丢失根因加固):isIdbBlobKey 的登记随各模块**懒加载**发生 ——
// 恢复流程若先于这些模块运行,place-trail(可达数 MB)等大 key 会被误路由进
// localStorage,当场撞爆 5MB 配额被静默丢弃。恢复入口静态引入全部登记型 store,
// 保证路由表在分流前是完整的。(import 即执行各自的 createBlobStore 登记。)
import './place-trail';
import './health-store';
import './clinical-store';
import './providers/bank-tx';
import './ai-cache';
import './providers/calendar-local-store';
import './chat-store';
import { collectLocalImages, restoreLocalImages } from './local-image-store';

/** 备份里照片条目的键前缀(隐私审计:让导出/恢复覆盖记忆照片)。 */
const LOCAL_IMAGE_PREFIX = 'local-image:';

/** 记忆图谱现主存 IDB(localStorage 5MB 太小)。登记后备份/恢复/清理把它当 IDB blob。 */
const LIFE_GRAPH_KEY = 'nesio-life-graph-v1';
registerIdbBlobKey(LIFE_GRAPH_KEY);

interface GraphNodeLite { id?: string; createdAt?: string; attributes?: { updatedAt?: string } }

/**
 * 图谱 merge-恢复:两份 JSON 数组按节点 id union(新者胜)。备份侧(incoming)解析失败/
 * 非数组 → 返回 null(不可用,调用方记 corrupt 并保留本机)。本机(current)损坏当空并入。
 */
function mergeGraphJson(currentRaw: string | null, incomingRaw: string): string | null {
  const parse = (s: string | null): GraphNodeLite[] | null => {
    try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : null; }
    catch { return null; }
  };
  const incoming = parse(incomingRaw);
  if (incoming === null) return null;
  const current = parse(currentRaw) ?? [];
  const stamp = (n: GraphNodeLite) => String(n.attributes?.updatedAt || n.createdAt || '');
  const byId = new Map<string, GraphNodeLite>();
  for (const n of [...current, ...incoming]) {
    if (!n?.id) continue;
    const prev = byId.get(n.id);
    if (!prev || stamp(n) >= stamp(prev)) byId.set(n.id, n);
  }
  return JSON.stringify(Array.from(byId.values()));
}

/** 上次云备份记录(小,留 localStorage)。 */
const LAST_CLOUD_BACKUP_KEY = 'nesio-cloud-backup-last-v1';
/** assets 路由的硬上限(与 app/api/cloud/assets/route.ts MAX_UPLOAD_BYTES 对齐)。 */
const CLOUD_UPLOAD_LIMIT_BYTES = 8 * 1024 * 1024;

export interface LastCloudBackup {
  at: string;
  storagePath: string;
  bytes: number;
  entryCount: number;
}

export type CloudBackupError =
  | 'entitlement_required'   // 未解锁(付费桩关)
  | 'not_signed_in'          // 未登录(路由 401)
  | 'cloud_not_configured'   // 云未开(路由 503)
  | 'too_large'              // 超 8MB(路由 413,或本地预检)
  | 'upload_failed'          // 路由 5xx
  | 'network';               // fetch 抛错

export interface CloudBackupResult {
  ok: boolean;
  error?: CloudBackupError;
  storagePath?: string;
  at?: string;
  bytes?: number;
  entryCount?: number;
  /** 本机备份比云端最新那份还少 → 跳过上传,不遮盖云端更全的真备份(防遮盖闸)。 */
  skippedRegression?: boolean;
}

/**
 * 云备份/同步是否可发起。**durability = 免费护城河**(交接清单 ③):跨端不丢是基本盘,
 * 不锁付费墙 —— 登录即自动、免费(与 cloud-memory-sync「登录即同步」同口径)。
 * 真正的门是「已登录」,由路由层校验(未登录→401,前端呈现可见失败态);这里只做
 * 「浏览器环境可用」判断,常开。历史上是付费桩(读本地 flag,默认关),现改常开;
 * 保留函数名与 entitlement_required 错误枚举仅为兼容既有调用点/类型,推送机制不变。
 */
export function hasCloudEntitlement(): boolean {
  return typeof window !== 'undefined';
}

/**
 * 组装完整备份 payload:localStorage durable(manifest 归类)+ IDB blob(已迁走的大数据)。
 * 与设置页「导出完整备份」用同一份枚举,避免两处漂移。
 */
export async function buildCombinedBackup(opts: { includeImages?: boolean } = {}): Promise<FullBackup> {
  const backup = buildFullBackup(localStorage);
  // 收口:健康/临床/地点/银行/聊天已迁 IDB —— 合并 IDB blob,否则云备份漏这些大数据。
  // 批次 52:可再生缓存(ai-cache/日历缓存,manifest 归 cache 类)迁 IDB 后不进备份
  // (与 localStorage 时代的 durable-only 口径一致);本机敏感 local-only 键同样不出门。
  for (const [k, v] of Object.entries(await collectIdbBlobs())) {
    if (keyKind(k) === 'cache' || isLocalOnly(k)) continue;
    backup.entries[k] = v;
  }
  // 隐私审计:记忆照片在独立 IDB(nesio-images),默认不入(云推送已单独同步为 cloud asset、控体积);
  // 本机导出 / Drive 全量备份传 includeImages 带上,否则「导出你的全部数据」漏图片。
  if (opts.includeImages) {
    const images = await collectLocalImages();
    for (const [id, url] of Object.entries(images)) backup.entries[`${LOCAL_IMAGE_PREFIX}${id}`] = url;
  }
  return backup;
}

export function lastCloudBackup(): LastCloudBackup | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_CLOUD_BACKUP_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as LastCloudBackup;
    return v && typeof v.at === 'string' && typeof v.storagePath === 'string' ? v : null;
  } catch {
    return null;
  }
}

function mapHttpError(status: number): CloudBackupError {
  if (status === 401) return 'not_signed_in';
  if (status === 503) return 'cloud_not_configured';
  if (status === 413) return 'too_large';
  return 'upload_failed';
}

/** gzip 压缩(浏览器原生 CompressionStream)。不可用/失败返回 null → 调用方回退明文。 */
async function gzipString(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

/** gzip 解压(DecompressionStream)。不可用/失败返回 null。 */
async function gunzipToString(bytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch { return null; }
}

/**
 * 一键推送:组装 → 上传到用户云账户。成功后记 last-backup(供 UI 显示"上次同步")。
 * 每个失败分支都返回明确 error code —— UI 必须据此渲染可见失败态(设计红线)。
 */
export async function pushBackupToCloud(opts: { skipIfFewerThan?: number } = {}): Promise<CloudBackupResult> {
  if (!hasCloudEntitlement()) return { ok: false, error: 'entitlement_required' };
  if (typeof window === 'undefined') return { ok: false, error: 'network' };

  let payload: string;
  let entryCount: number;
  let bytes: number;
  try {
    const backup = await buildCombinedBackup();
    payload = JSON.stringify(backup);
    entryCount = Object.keys(backup.entries).length;
    bytes = new Blob([payload]).size;
  } catch {
    return { ok: false, error: 'network' };
  }

  // 交接清单红线「空浏览器绝不用空数据盖云端」的保险丝:0 条目备份绝不上云 —— 一份空的
  // 「最新」会遮住云端真备份,换机 pull 只会拿回这份空的(数据丢失陷阱)。没东西可备份就
  // 静默成功、不发网络(纵深防御:自动同步侧已「pull 失败不推」,这里再兜一层任何调用点)。
  if (entryCount === 0) return { ok: true, entryCount: 0, bytes };

  // 防遮盖:若本机这份比云端「最新」那份**还少**条目,说明拉取没把云端数据全并进本机
  // (place-geo 曾被误剔、IDB 写失败、reload 打断等),此时上云会用更少的数据遮住云端更全
  // 的真备份。宁可不推,等本机补齐再说。仅自动同步传此参数;手动「备份」不传,尊重用户意图。
  if (opts.skipIfFewerThan != null && entryCount < opts.skipIfFewerThan) {
    return { ok: true, entryCount, bytes, skippedRegression: true };
  }

  // 压缩:健康/足迹(GPS 点)这类 JSON 冗余度极高,gzip 常压到 1/5~1/10,把「超 8MB 单次
  // 上限」挡回来 —— 这是「原浏览器一次都没推成功、换机永远空」的真凶。上传 gzip 字节、文件名
  // 带 .gz(声明 text/plain 过路由 MIME 白名单;内容是二进制,pull 按 gzip magic 字节自动识别)。
  // 浏览器不支持 CompressionStream(旧 Safari)则回退明文,行为同旧版。
  const gz = await gzipString(payload);
  const uploadBody: Uint8Array | string = gz ?? payload;
  bytes = gz ? gz.byteLength : new Blob([payload]).size;

  // 本地预检:压缩后仍超 8MB 才给明确态,不白跑一趟网络(路由也会 413 兜底)。
  if (bytes > CLOUD_UPLOAD_LIMIT_BYTES) return { ok: false, error: 'too_large', bytes, entryCount };

  try {
    const file = new File([uploadBody as BlobPart], gz ? 'nesio-backup.json.gz' : 'nesio-backup.json', { type: 'text/plain' });
    const form = new FormData();
    form.append('file', file);
    form.append('purpose', 'backup');
    const res = await fetch('/api/cloud/assets', { method: 'POST', body: form, cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; storagePath?: string; error?: string };
    if (!res.ok || !data.ok || !data.storagePath) {
      return { ok: false, error: mapHttpError(res.status), bytes, entryCount };
    }
    const at = new Date().toISOString();
    const record: LastCloudBackup = { at, storagePath: data.storagePath, bytes, entryCount };
    try { localStorage.setItem(LAST_CLOUD_BACKUP_KEY, JSON.stringify(record)); } catch { /* quota */ }
    return { ok: true, storagePath: data.storagePath, at, bytes, entryCount };
  } catch {
    return { ok: false, error: 'network', bytes, entryCount };
  }
}

// ── 恢复(pull)────────────────────────────────────────────────────────────────

export type RestoreMode = 'merge' | 'replace';

export interface CombinedRestoreResult {
  restoredKeys: number;   // localStorage 侧恢复条数
  idbRestored: number;    // IDB 侧恢复条数
  imagesRestored?: number; // 恢复的记忆照片数(nesio-images IDB)
  mergedNodes?: number;   // 生命图合并后节点数(merge 模式)
  skippedKeys: string[];
  /** 未能恢复的键:备份数据损坏(LS 侧)或 IDB 写入失败 —— 恢复不谎称成功。 */
  corruptKeys: string[];
}

/**
 * 恢复合并备份:按 IDB key 登记把条目分流 —— IDB blob 直接落 idbBackend(replace 覆盖 /
 * merge 缺才补),其余走 restoreFullBackup 落 localStorage。
 *
 * 修复 #43 迁 IDB 留下的隐患:此前 restore 全写 localStorage,而 blob store 仅在「IDB 为空」时
 * 才迁移 localStorage→IDB,于是 replace 模式下、设备已有 IDB 数据时,恢复的值被静默忽略。
 * 现在 IDB key 直接落 IDB,replace 真覆盖。调用方成功后应 reload 让各 store 重新水合
 * (缓存是加载时读的,不会自更新)。
 */
export async function restoreCombinedBackup(backup: FullBackup, mode: RestoreMode): Promise<CombinedRestoreResult> {
  const lsEntries: Record<string, string> = {};
  const idbEntries: Record<string, string> = {};
  const imageEntries: Record<string, string> = {};
  // 批次 54 保险丝:登记表理论上已完整(顶部静态引入),但任何 >200KB 的条目
  // 都绝不许进 localStorage —— 一条就能占掉配额的 4%,几条就复刻「存储满」惨案;
  // IDB 对超额 key 是无害的(多存一份也能被各 store 的水合正常读走)。
  const IDB_SIZE_FUSE = 200 * 1024;
  for (const [k, v] of Object.entries(backup.entries)) {
    if (k.startsWith(LOCAL_IMAGE_PREFIX)) imageEntries[k.slice(LOCAL_IMAGE_PREFIX.length)] = v;
    else if (isIdbBlobKey(k) || (typeof v === 'string' && v.length > IDB_SIZE_FUSE)) idbEntries[k] = v;
    else lsEntries[k] = v;
  }
  // 照片写回独立 IDB(nesio-images);替换/合并都直接写(图不可合并,按 assetId 覆盖)
  let imagesRestored = 0;
  if (Object.keys(imageEntries).length > 0) {
    try { imagesRestored = await restoreLocalImages(imageEntries); } catch { /* 图恢复失败不阻塞其余 */ }
  }

  const ls = restoreFullBackup(localStorage, { ...backup, entries: lsEntries }, mode);

  let idbRestored = 0;
  const idbFailedKeys: string[] = [];
  const idbCorruptKeys: string[] = [];
  for (const [k, v] of Object.entries(idbEntries)) {
    try {
      if (k === LIFE_GRAPH_KEY && mode === 'merge') {
        // 图谱 merge = 按节点 id union(新者胜),不是「已有就跳过」——否则换机合并
        // 拿不到备份里的记忆。备份该条损坏则记 corrupt、保留本机(不空覆盖)。
        const merged = mergeGraphJson(await idbBackend.get(k), v);
        if (merged == null) { idbCorruptKeys.push(k); continue; }
        await idbBackend.set(k, merged);
        idbRestored++;
        continue;
      }
      if (mode === 'merge' && (await idbBackend.get(k)) != null) continue; // merge:已有不覆盖
      await idbBackend.set(k, v);
      idbRestored++;
    } catch {
      // 单 key 落库失败:不影响其余,但记账 —— 恢复不能对这条谎称成功
      idbFailedKeys.push(k);
    }
  }

  return {
    restoredKeys: ls.restoredKeys,
    idbRestored,
    imagesRestored,
    mergedNodes: ls.mergedNodes,
    skippedKeys: ls.skippedKeys,
    corruptKeys: [...ls.corruptKeys, ...idbFailedKeys, ...idbCorruptKeys],
  };
}

export type CloudRestoreError = CloudBackupError | 'no_backup' | 'invalid_backup';

export interface CloudRestoreResult {
  ok: boolean;
  error?: CloudRestoreError;
  restoredKeys?: number;
  idbRestored?: number;
  /** 云端最新那份备份的条目数(供自动同步做防遮盖判断:本机别推得比它还少)。 */
  cloudEntryCount?: number;
}

/**
 * 从云拉回**最新**一份备份并恢复。命门修复(交接清单 ①②):不再依赖本地 last-backup 记录
 * (换浏览器后 localStorage 为空 → 永远 no_backup、拉不回,这正是跨浏览器同步的死穴)。
 * 改问服务端「我账号 backup/ 前缀里最新那份」(GET ?list=backup),直接拿签名读 URL →
 * fetch blob → 校验 → restoreCombinedBackup。默认 merge:节点 id union、已有不覆盖,
 * 空浏览器只会被填充、绝不反向覆盖。门禁/失败态与 push 对齐。成功后调用方应 reload。
 */
export async function pullBackupFromCloud(mode: RestoreMode = 'merge'): Promise<CloudRestoreResult> {
  if (!hasCloudEntitlement()) return { ok: false, error: 'entitlement_required' };
  if (typeof window === 'undefined') return { ok: false, error: 'network' };

  try {
    // 1. 问服务端要「账号下最新那份备份」的签名读 URL(身份由路由校验,前缀服务端拼)
    const listRes = await fetch('/api/cloud/assets?list=backup', { cache: 'no-store' });
    const list = (await listRes.json().catch(() => ({}))) as {
      ok?: boolean; found?: boolean; signedUrl?: string; storagePath?: string;
    };
    if (!listRes.ok || !list.ok) return { ok: false, error: mapHttpError(listRes.status) };
    if (!list.found || !list.signedUrl) return { ok: false, error: 'no_backup' };

    // 2. 拉 blob(坏数据绝不动本机:校验不过就原样返回)。按 gzip magic 字节(1f 8b)自动识别
    //    压缩备份并解压;明文旧备份(以 '{' 0x7b 开头)照旧解码 —— 新旧格式兼容。
    const blobRes = await fetch(list.signedUrl, { cache: 'no-store' });
    if (!blobRes.ok) return { ok: false, error: 'network' };
    let text: string;
    try {
      const buf = new Uint8Array(await blobRes.arrayBuffer());
      if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
        const un = await gunzipToString(buf);
        if (un == null) return { ok: false, error: 'invalid_backup' };
        text = un;
      } else {
        text = new TextDecoder().decode(buf);
      }
    } catch { return { ok: false, error: 'network' }; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { ok: false, error: 'invalid_backup' }; }
    if (!isValidBackup(parsed)) return { ok: false, error: 'invalid_backup' };
    const cloudEntryCount = Object.keys(parsed.entries).length;

    // 3. 恢复(IDB/localStorage 分流,merge = 只补缺/新者胜)
    const res = await restoreCombinedBackup(parsed, mode);
    // 记下这份路径,供 UI 显示「上次同步」(best-effort,失败不影响恢复结果)
    if (list.storagePath) {
      try {
        const record: LastCloudBackup = {
          at: new Date().toISOString(),
          storagePath: list.storagePath,
          bytes: 0,
          entryCount: res.restoredKeys + res.idbRestored,
        };
        localStorage.setItem(LAST_CLOUD_BACKUP_KEY, JSON.stringify(record));
      } catch { /* quota */ }
    }
    return { ok: true, restoredKeys: res.restoredKeys, idbRestored: res.idbRestored, cloudEntryCount };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// ── 自动同步(先拉后推 · 登录/回前台触发,交接清单 ②)────────────────────────────
//
// 仿 cloud-memory-sync:登录或标签页回前台时先 pull(merge)再防抖 push。数据安全不变式:
//  · 先拉后推 —— push 永远发生在 pull 之后;空浏览器先被云端填充再上云,不会用空盖云。
//  · pull 失败(网络/未登录/坏备份)则**跳过 push** —— 避免把本地空/旧数据推成新「最新」,
//    遮住云端真备份(换机数据丢失陷阱)。仅 pull 成功、或云端确实无备份(no_backup)时才推。
//  · push 侧 entryCount===0 保险丝再兜一层:任何情况下空数据都不上云(纵深防御)。
// best-effort:未登录/离线/未配置全静默,不阻塞渲染;20s 节流避免 mount+visibility 连触发。

const AUTO_SYNC_MIN_INTERVAL_MS = 20_000;
const AUTO_PUSH_DEBOUNCE_MS = 8_000;
/**
 * 「本浏览器已完成首次云同步」标志(localStorage)。用途:冷浏览器(换个网页/新设备)首次把
 * 云端数据 merge 回本机后**需要 reload**,否则各 store 的内存缓存仍是空的(health/place-trail/
 * inventory 等只在加载时读一次 IDB,restore 直写 IDB 不触发它们的 *-updated 事件)—— 数据在库里
 * 但界面空,正是「换个网页记录不显示」的根因。用此标志把 reload 限制为「每个浏览器仅首次一次」,
 * 避免每次回前台都刷新造成 reload 循环。
 */
const FIRST_SYNC_DONE_FLAG = 'nesio-backup-first-sync-done-v1';
let autoSyncLastAt = 0;
let autoSyncInFlight = false;
let autoPushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoPush(skipIfFewerThan = 0): void {
  if (typeof window === 'undefined') return;
  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(() => {
    autoPushTimer = null;
    // 防遮盖:自动推绝不上传比云端最新那份还少条目的备份(见 pushBackupToCloud)。
    void pushBackupToCloud({ skipIfFewerThan });
  }, AUTO_PUSH_DEBOUNCE_MS);
}

/**
 * 登录后 / 回前台调一次:先把云端最新备份 merge 回本机(补缺、不覆盖),拉完再防抖上云。
 * @param opts.force 跳过 20s 节流(手动「立即同步」用)。
 */
export async function autoSyncBackupWithCloud(opts: { force?: boolean } = {}): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!hasCloudEntitlement()) return;
  const now = Date.now();
  if (!opts.force && (autoSyncInFlight || now - autoSyncLastAt < AUTO_SYNC_MIN_INTERVAL_MS)) return;
  autoSyncInFlight = true;
  autoSyncLastAt = now;
  try {
    const pull = await pullBackupFromCloud('merge');
    if (pull.ok) {
      const restoredSomething = (pull.restoredKeys ?? 0) + (pull.idbRestored ?? 0) > 0;
      let firstSync = false;
      let flagPersisted = false;
      try {
        firstSync = !localStorage.getItem(FIRST_SYNC_DONE_FLAG);
        localStorage.setItem(FIRST_SYNC_DONE_FLAG, '1');
        // 只有真写进去了才算数 —— 隐私模式 setItem 可能静默失败,若此时仍 reload 会因标志
        // 每次都缺而**死循环刷新**。写不进 → 不 reload(数据已落 IDB,退化为需手动刷新一次)。
        flagPersisted = localStorage.getItem(FIRST_SYNC_DONE_FLAG) === '1';
      } catch { firstSync = false; flagPersisted = false; }
      // 冷浏览器首次拉回且确有数据:reload 让各 store 从 IDB/localStorage 重新水合
      // (健康/足迹/物品等缓存态不会自更新)。仅首次一次(标志已持久化),不进 reload 循环。
      if (firstSync && flagPersisted && restoredSomething && typeof window.location?.reload === 'function') {
        window.location.reload();
        return;
      }
      // 推时带上「云端最新那份的条目数」做防遮盖闸:本机若比它还少就不推(见 pushBackupToCloud)。
      scheduleAutoPush(pull.cloudEntryCount ?? 0);
    } else if (pull.error === 'no_backup') {
      // 云端确实无备份:也推(把本机数据首次带上云;空账号由 push 的 entryCount===0 保险丝拦)。
      // 不置 first-sync 标志 —— 等原浏览器把数据推上云后,本浏览器下次拉到真数据仍会首刷一次。
      scheduleAutoPush(0);
    }
    // 其余失败态(网络/未登录/坏备份)一律不推(防本地空/旧数据遮盖云端真备份)。
  } catch {
    /* best-effort:静默(pull 内部已 fail-safe) */
  } finally {
    autoSyncInFlight = false;
  }
}
