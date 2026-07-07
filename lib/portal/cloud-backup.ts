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

import { buildFullBackup, type FullBackup } from './full-backup';
import { collectIdbBlobs } from './idb-blob-store';

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
export async function buildCombinedBackup(): Promise<FullBackup> {
  const backup = buildFullBackup(localStorage);
  // 收口:健康/临床/地点/银行已迁 IDB —— 合并 IDB blob,否则云备份漏这些大数据。
  backup.entries = { ...backup.entries, ...(await collectIdbBlobs()) };
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
