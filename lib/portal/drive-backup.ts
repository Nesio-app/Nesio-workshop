/**
 * 免费云备份客户端(Google Drive「我的云端硬盘 / 宝盒备份」)。
 *
 * 设计红线:失败必可见;按钮不得永久停在「正在备份…」。
 * 上传一律经本服务代传到 Google —— iOS WKWebView 直连 googleapis 常被 CORS 挡死
 * (表现成「备份到 Drive 没成功」且无细节)。小包 uploadGzip(内容为 zip);大包 beginResumable+putChunk。
 */
import { buildCombinedBackup, restoreCombinedBackup, type RestoreMode, type CombinedRestoreResult } from './cloud-backup';
import { packBackupZip } from './backup-pack';

const DRIVE_BACKUP_AT_KEY = 'nesio-drive-backup-at';
/** 单次分片(base64 后仍远低于 Vercel ~4.5MB 请求体)。 */
const CHUNK = 512 * 1024;
/** 整包经 uploadGzip 的上限(留余量给 JSON 外壳)。 */
const DIRECT_ZIP_LIMIT = 3.2 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 180_000;
const DEFAULT_FILE = 'nesio-backup.zip';

export type DriveBackupError =
  | 'not_connected'
  | 'insufficient_scope'
  | 'network'
  | 'drive'
  | 'no_backup'
  | 'too_large'
  | 'build_failed'
  | 'timeout'
  | 'rate_limited'
  | 'auth_required';

export interface DriveBackupResult {
  ok: boolean;
  at?: string;
  error?: DriveBackupError;
  connectUrl?: string;
  bytes?: number;
  folderName?: string;
  fileName?: string;
  withMedia?: boolean;
  photoCount?: number;
  detail?: string;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
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

function mapHttpError(status: number, data: { error?: string; detail?: string; connectUrl?: string } | null): DriveBackupResult | null {
  if (status === 401 || data?.error === 'not_connected' || data?.error === 'auth_required') {
    return {
      ok: false,
      error: data?.error === 'auth_required' ? 'auth_required' : 'not_connected',
      connectUrl: data?.connectUrl || '/api/portal/gmail/connect',
      detail: data?.error,
    };
  }
  if (status === 403 || data?.error === 'insufficient_scope') {
    return { ok: false, error: 'insufficient_scope', connectUrl: data?.connectUrl || '/api/portal/gmail/connect', detail: data?.detail };
  }
  if (status === 429 || data?.error === 'rate_limited') {
    return { ok: false, error: 'rate_limited', detail: data?.error || 'rate_limited' };
  }
  if (status === 413 || data?.error === 'too_large') {
    return { ok: false, error: 'too_large', detail: data?.detail };
  }
  return null;
}

async function uploadZipDirect(zip: Uint8Array): Promise<DriveBackupResult> {
  const signal = timeoutSignal(UPLOAD_TIMEOUT_MS);
  const res = await fetch('/api/portal/drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'uploadGzip', gzipBase64: bytesToB64(zip) }),
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  const data = await res.json().catch(() => null) as {
    ok?: boolean; at?: string; folderName?: string; fileName?: string;
    error?: string; detail?: string; connectUrl?: string;
  } | null;
  const mapped = mapHttpError(res.status, data);
  if (mapped) return { ...mapped, bytes: zip.byteLength };
  if (!res.ok || !data?.ok) {
    return { ok: false, error: 'drive', bytes: zip.byteLength, detail: data?.error || data?.detail || `uploadGzip_${res.status}` };
  }
  return {
    ok: true,
    at: data.at || new Date().toISOString(),
    bytes: zip.byteLength,
    folderName: data.folderName || '宝盒备份',
    fileName: data.fileName || DEFAULT_FILE,
  };
}

async function beginResumable(byteSize: number): Promise<
  | { ok: true; uploadUrl: string; folderName: string; fileName: string }
  | { ok: false; result: DriveBackupResult }
> {
  const signal = timeoutSignal(30_000);
  const res = await fetch('/api/portal/drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'beginResumable', byteSize }),
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  const data = await res.json().catch(() => null) as {
    ok?: boolean; uploadUrl?: string; folderName?: string; fileName?: string;
    error?: string; detail?: string; connectUrl?: string;
  } | null;
  const mapped = mapHttpError(res.status, data);
  if (mapped) return { ok: false, result: { ...mapped, bytes: byteSize } };
  if (!res.ok || !data?.ok || !data.uploadUrl) {
    return {
      ok: false,
      result: { ok: false, error: 'drive', bytes: byteSize, detail: data?.error || data?.detail || `begin_${res.status}` },
    };
  }
  return {
    ok: true,
    uploadUrl: data.uploadUrl,
    folderName: data.folderName || '宝盒备份',
    fileName: data.fileName || DEFAULT_FILE,
  };
}

/** 分片经本服务代 PUT —— 手机绝不直连 googleapis。 */
async function putChunksViaServer(
  uploadUrl: string,
  zip: Uint8Array,
): Promise<{ ok: true; fileId: string } | { ok: false; result: DriveBackupResult }> {
  let offset = 0;
  while (offset < zip.byteLength) {
    const end = Math.min(offset + CHUNK, zip.byteLength);
    const chunk = zip.subarray(offset, end);
    const signal = timeoutSignal(60_000);
    let res: Response;
    try {
      res = await fetch('/api/portal/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'putChunk',
          uploadUrl,
          offset,
          total: zip.byteLength,
          chunkBase64: bytesToB64(chunk),
        }),
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'fetch_failed';
      return { ok: false, result: { ok: false, error: 'network', bytes: zip.byteLength, detail: msg.slice(0, 80) } };
    }
    const data = await res.json().catch(() => null) as {
      ok?: boolean; incomplete?: boolean; done?: boolean; fileId?: string;
      range?: string | null; error?: string; detail?: string; connectUrl?: string;
    } | null;
    const mapped = mapHttpError(res.status, data);
    if (mapped) return { ok: false, result: { ...mapped, bytes: zip.byteLength } };
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        result: { ok: false, error: 'drive', bytes: zip.byteLength, detail: data?.error || data?.detail || `chunk_${res.status}` },
      };
    }
    if (data.done) return { ok: true, fileId: data.fileId || '' };
    if (data.incomplete) {
      const range = data.range;
      if (range) {
        const m = /bytes=0-(\d+)/.exec(range);
        offset = m ? Number(m[1]) + 1 : end;
      } else {
        offset = end;
      }
      continue;
    }
    offset = end;
  }
  return { ok: false, result: { ok: false, error: 'drive', bytes: zip.byteLength, detail: 'put_incomplete' } };
}

/** 把本机 durable 数据(默认含照片/附件)打包推到 Google Drive「宝盒备份」。 */
export async function pushBackupToDrive(opts: { includeImages?: boolean } = {}): Promise<DriveBackupResult> {
  const withMedia = opts.includeImages !== false;
  let backup;
  try {
    try {
      const { whenGraphHydrated } = await import('./life-graph');
      await whenGraphHydrated();
    } catch { /* ignore */ }
    backup = await buildCombinedBackup({ includeImages: withMedia });
  } catch {
    return { ok: false, error: 'build_failed' };
  }

  let zip: Uint8Array;
  let photoCount = 0;
  try {
    const packed = await packBackupZip(backup);
    photoCount = packed.photoCount;
    zip = new Uint8Array(await packed.blob.arrayBuffer());
  } catch {
    return { ok: false, error: 'build_failed' };
  }

  try {
    if (zip.byteLength <= DIRECT_ZIP_LIMIT) {
      const direct = await uploadZipDirect(zip);
      if (direct.ok) {
        try { localStorage.setItem(DRIVE_BACKUP_AT_KEY, direct.at || new Date().toISOString()); } catch { /* quota */ }
        return { ...direct, withMedia, photoCount };
      }
    }

    const started = await beginResumable(zip.byteLength);
    if (!started.ok) return { ...started.result, withMedia, photoCount };

    const uploaded = await putChunksViaServer(started.uploadUrl, zip);
    if (!uploaded.ok) return { ...uploaded.result, withMedia, photoCount };

    const at = new Date().toISOString();
    try { localStorage.setItem(DRIVE_BACKUP_AT_KEY, at); } catch { /* quota */ }
    return {
      ok: true,
      at,
      bytes: zip.byteLength,
      folderName: started.folderName,
      fileName: started.fileName,
      withMedia,
      photoCount,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, error: 'timeout', bytes: zip.byteLength };
    }
    return { ok: false, error: 'network', bytes: zip.byteLength, detail: name || 'catch' };
  }
}

/** 从 Drive 拉回备份并合并回本机(默认 merge)。走服务端 GET,避免 WKWebView 直连 Google。 */
export async function pullBackupFromDrive(mode: RestoreMode = 'merge'): Promise<DriveBackupResult & { restore?: CombinedRestoreResult }> {
  try {
    const signal = timeoutSignal(UPLOAD_TIMEOUT_MS);
    const res = await fetch('/api/portal/drive', {
      method: 'GET',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    const data = await res.json().catch(() => null) as {
      ok?: boolean; backup?: unknown; error?: string; connectUrl?: string; folderName?: string; detail?: string;
    } | null;
    const mapped = mapHttpError(res.status, data);
    if (mapped) return mapped;
    if (!res.ok || !data?.ok) {
      return { ok: false, error: 'drive', detail: data?.error || data?.detail || `get_${res.status}` };
    }
    if (!data.backup) return { ok: false, error: 'no_backup' };

    let backup = data.backup;
    if (typeof backup === 'string') {
      try { backup = JSON.parse(backup); } catch { /* keep */ }
    }
    const restore = await restoreCombinedBackup(backup as Parameters<typeof restoreCombinedBackup>[0], mode);
    return { ok: true, restore, folderName: data.folderName || '宝盒备份' };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: 'network', detail: name || 'catch' };
  }
}

export function lastDriveBackupAt(): string | null {
  try { return localStorage.getItem(DRIVE_BACKUP_AT_KEY); } catch { return null; }
}
