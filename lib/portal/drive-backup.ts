/**
 * 免费云备份客户端(Google Drive appDataFolder)。
 *
 * 设计红线:失败必可见;按钮不得永久停在「正在备份…」。
 * 体积:Vercel 请求体硬上限 ~4.5MB —— 默认**不带照片/附件**(与 Nesio 云 push 同口径),
 * 否则本机打包或上传会挂死。照片请用「导出完整备份」带走。
 */
import { gzip, strToU8 } from 'fflate';
import { buildCombinedBackup, restoreCombinedBackup, type RestoreMode, type CombinedRestoreResult } from './cloud-backup';

const DRIVE_BACKUP_AT_KEY = 'nesio-drive-backup-at';
/** Vercel 函数体约 4.5MB;gzip 后预检留余量。 */
const DRIVE_UPLOAD_LIMIT = 3.8 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 90_000;

export type DriveBackupError =
  | 'not_connected'
  | 'insufficient_scope'
  | 'network'
  | 'drive'
  | 'no_backup'
  | 'too_large'
  | 'build_failed'
  | 'timeout';

export interface DriveBackupResult {
  ok: boolean;
  at?: string;
  error?: DriveBackupError;
  connectUrl?: string;
  bytes?: number;
}

function timeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
  }
  return undefined;
}

function bytesToB64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function gzipAsync(u8: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gzip(u8, (err, out) => (err ? reject(err) : resolve(out))));
}

async function gzipJson(obj: unknown): Promise<Uint8Array | null> {
  try {
    return await gzipAsync(strToU8(JSON.stringify(obj)));
  } catch {
    return null;
  }
}

/** 把本机 durable 数据打包推到用户 Google Drive appDataFolder。 */
export async function pushBackupToDrive(opts: { includeImages?: boolean } = {}): Promise<DriveBackupResult> {
  let backup;
  try {
    // 默认不带图:带图极易超 4.5MB / 在手机上 stringify 卡死 → 按钮永远「正在备份…」。
    backup = await buildCombinedBackup({ includeImages: Boolean(opts.includeImages) });
  } catch {
    return { ok: false, error: 'build_failed' };
  }

  const gz = await gzipJson(backup);
  const bodyObj = gz
    ? { gzipBase64: bytesToB64(gz) }
    : { backup };
  const body = JSON.stringify(bodyObj);
  const bytes = new Blob([body]).size;
  if (bytes > DRIVE_UPLOAD_LIMIT) {
    return { ok: false, error: 'too_large', bytes };
  }

  try {
    const signal = timeoutSignal();
    const res = await fetch('/api/portal/drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    const data = await res.json().catch(() => null) as {
      ok?: boolean; at?: string; error?: string; connectUrl?: string;
    } | null;
    if (res.status === 401 || data?.error === 'not_connected') {
      return { ok: false, error: 'not_connected', connectUrl: data?.connectUrl || '/api/portal/gmail/connect' };
    }
    if (res.status === 403 || data?.error === 'insufficient_scope') {
      return { ok: false, error: 'insufficient_scope', connectUrl: data?.connectUrl || '/api/portal/gmail/connect' };
    }
    if (res.status === 413 || data?.error === 'too_large') {
      return { ok: false, error: 'too_large', bytes };
    }
    if (!res.ok || !data?.ok) return { ok: false, error: 'drive', bytes };
    const at = data.at || new Date().toISOString();
    try { localStorage.setItem(DRIVE_BACKUP_AT_KEY, at); } catch { /* quota */ }
    return { ok: true, at, bytes };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, error: 'timeout', bytes };
    return { ok: false, error: 'network', bytes };
  }
}

/** 从 Drive 拉回备份并合并回本机(默认 merge)。 */
export async function pullBackupFromDrive(mode: RestoreMode = 'merge'): Promise<DriveBackupResult & { restore?: CombinedRestoreResult }> {
  try {
    const signal = timeoutSignal();
    const res = await fetch('/api/portal/drive', {
      method: 'GET',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    const data = await res.json().catch(() => null) as {
      ok?: boolean; backup?: unknown; error?: string; connectUrl?: string;
    } | null;
    if (res.status === 401 || data?.error === 'not_connected') {
      return { ok: false, error: 'not_connected', connectUrl: data?.connectUrl || '/api/portal/gmail/connect' };
    }
    if (res.status === 403 || data?.error === 'insufficient_scope') {
      return { ok: false, error: 'insufficient_scope', connectUrl: data?.connectUrl || '/api/portal/gmail/connect' };
    }
    if (!res.ok || !data?.ok) return { ok: false, error: 'drive' };
    if (!data.backup) return { ok: false, error: 'no_backup' };
    const restore = await restoreCombinedBackup(data.backup as Parameters<typeof restoreCombinedBackup>[0], mode);
    return { ok: true, restore };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: 'network' };
  }
}

export function lastDriveBackupAt(): string | null {
  try { return localStorage.getItem(DRIVE_BACKUP_AT_KEY); } catch { return null; }
}
