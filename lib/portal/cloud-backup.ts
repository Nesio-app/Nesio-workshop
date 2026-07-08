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
/** 付费权益桩开关(真权益层落地前的临时门)。 */
const CLOUD_ENTITLEMENT_FLAG = 'nesio-cloud-entitlement-v1';
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
}

/**
 * 付费权益桩:云备份是否已解锁。
 * 真权益强制层落地前,读本地 flag(默认关);解锁只影响能否**发起**推送,
 * 云端仍独立校验登录/配置(纵深防御)。
 */
export function hasCloudEntitlement(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(CLOUD_ENTITLEMENT_FLAG) === 'on';
  } catch {
    return false;
  }
}

/**
 * 组装完整备份 payload:localStorage durable(manifest 归类)+ IDB blob(已迁走的大数据)。
 * 与设置页「导出完整备份」用同一份枚举,避免两处漂移。
 */
export async function buildCombinedBackup(opts: { includeImages?: boolean } = {}): Promise<FullBackup> {
  const backup = buildFullBackup(localStorage);
  // 收口:健康/临床/地点/银行已迁 IDB —— 合并 IDB blob,否则云备份漏这些大数据。
  backup.entries = { ...backup.entries, ...(await collectIdbBlobs()) };
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

/**
 * 一键推送:组装 → 上传到用户云账户。成功后记 last-backup(供 UI 显示"上次同步")。
 * 每个失败分支都返回明确 error code —— UI 必须据此渲染可见失败态(设计红线)。
 */
export async function pushBackupToCloud(): Promise<CloudBackupResult> {
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

  // 本地预检:超 8MB 直接给明确态,不白跑一趟网络(路由也会 413 兜底)。
  if (bytes > CLOUD_UPLOAD_LIMIT_BYTES) return { ok: false, error: 'too_large', bytes, entryCount };

  try {
    const file = new File([payload], 'nesio-backup.json', { type: 'text/plain' });
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
  for (const [k, v] of Object.entries(backup.entries)) {
    if (k.startsWith(LOCAL_IMAGE_PREFIX)) imageEntries[k.slice(LOCAL_IMAGE_PREFIX.length)] = v;
    else if (isIdbBlobKey(k)) idbEntries[k] = v; else lsEntries[k] = v;
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
}

/**
 * 从云拉回最近一次备份并恢复。GET assets 签名 URL → fetch blob → 校验 → restoreCombinedBackup。
 * 门禁/失败态与 push 对齐。成功后调用方应 reload。
 */
export async function pullBackupFromCloud(mode: RestoreMode = 'merge'): Promise<CloudRestoreResult> {
  if (!hasCloudEntitlement()) return { ok: false, error: 'entitlement_required' };
  if (typeof window === 'undefined') return { ok: false, error: 'network' };
  const last = lastCloudBackup();
  if (!last?.storagePath) return { ok: false, error: 'no_backup' };

  try {
    // 1. 取签名读 URL(assets GET 校验身份 + 归属)
    const metaRes = await fetch(`/api/cloud/assets?storagePath=${encodeURIComponent(last.storagePath)}`, { cache: 'no-store' });
    const meta = (await metaRes.json().catch(() => ({}))) as { ok?: boolean; signedUrl?: string };
    if (!metaRes.ok || !meta.ok || !meta.signedUrl) return { ok: false, error: mapHttpError(metaRes.status) };

    // 2. 拉 blob
    const blobRes = await fetch(meta.signedUrl, { cache: 'no-store' });
    if (!blobRes.ok) return { ok: false, error: 'network' };
    let parsed: unknown;
    try { parsed = JSON.parse(await blobRes.text()); } catch { return { ok: false, error: 'invalid_backup' }; }
    if (!isValidBackup(parsed)) return { ok: false, error: 'invalid_backup' };

    // 3. 恢复(IDB/localStorage 分流)
    const res = await restoreCombinedBackup(parsed, mode);
    return { ok: true, restoredKeys: res.restoredKeys, idbRestored: res.idbRestored };
  } catch {
    return { ok: false, error: 'network' };
  }
}
