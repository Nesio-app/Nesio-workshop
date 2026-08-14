/**
 * 免费云备份客户端(Google Drive「我的云端硬盘 / 宝盒备份」)。
 *
 * 设计红线:失败必可见;按钮不得永久停在「正在备份…」。
 * 含照片/附件:默认全量打包。可续传会话由**服务端**向 Google 发起(浏览器读不到
 * Location 头),客户端再 PUT 分片到 uploadUrl —— 避开 CORS + Vercel 4.5MB 双坑。
 */
import { gzip, gunzip, strToU8, strFromU8 } from 'fflate';
import { buildCombinedBackup, restoreCombinedBackup, type RestoreMode, type CombinedRestoreResult } from './cloud-backup';

const DRIVE_BACKUP_AT_KEY = 'nesio-drive-backup-at';
const DRIVE = 'https://www.googleapis.com/drive/v3';
/** 单次可续传分片(手机弱网友好)。 */
const CHUNK = 256 * 1024;
const UPLOAD_TIMEOUT_MS = 180_000;

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
  folderName?: string;
  fileName?: string;
  /** 是否含照片/附件。 */
  withMedia?: boolean;
  /** 便于排障的短说明(可选)。 */
  detail?: string;
}

type DriveSession = {
  ok?: boolean;
  error?: string;
  connectUrl?: string;
  accessToken?: string;
  folderId?: string;
  folderName?: string;
  backupNameGz?: string;
  backupNameJson?: string;
  file?: { id: string; name: string; size?: string } | null;
  location?: string;
};

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function gzipAsync(u8: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gzip(u8, (err, out) => (err ? reject(err) : resolve(out))));
}

function gunzipAsync(u8: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gunzip(u8, (err, out) => (err ? reject(err) : resolve(out))));
}

async function requestSession(): Promise<DriveSession & { httpStatus: number }> {
  const signal = timeoutSignal(30_000);
  const res = await fetch('/api/portal/drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'session' }),
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  const data = (await res.json().catch(() => null)) as DriveSession | null;
  return { ...(data || {}), httpStatus: res.status };
}

function mapAuth(session: DriveSession & { httpStatus: number }): DriveBackupResult | null {
  if (session.httpStatus === 401 || session.error === 'not_connected') {
    return { ok: false, error: 'not_connected', connectUrl: session.connectUrl || '/api/portal/gmail/connect' };
  }
  if (session.httpStatus === 403 || session.error === 'insufficient_scope') {
    return { ok: false, error: 'insufficient_scope', connectUrl: session.connectUrl || '/api/portal/gmail/connect' };
  }
  if (!session.ok || !session.accessToken) {
    return { ok: false, error: 'drive', detail: `session_${session.httpStatus || 'bad'}` };
  }
  return null;
}

async function beginResumable(byteSize: number): Promise<
  | { ok: true; uploadUrl: string; folderName: string; fileName: string }
  | { ok: false; error: DriveBackupError; detail?: string; connectUrl?: string }
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
    error?: string; connectUrl?: string;
  } | null;
  if (res.status === 401 || data?.error === 'not_connected') {
    return { ok: false, error: 'not_connected', connectUrl: data?.connectUrl || '/api/portal/gmail/connect' };
  }
  if (res.status === 403 || data?.error === 'insufficient_scope') {
    return { ok: false, error: 'insufficient_scope', connectUrl: data?.connectUrl || '/api/portal/gmail/connect' };
  }
  if (!res.ok || !data?.ok || !data.uploadUrl) {
    return { ok: false, error: 'drive', detail: data?.error || `begin_${res.status}` };
  }
  return {
    ok: true,
    uploadUrl: data.uploadUrl,
    folderName: data.folderName || '宝盒备份',
    fileName: data.fileName || 'nesio-backup.json.gz',
  };
}

/** 把 gzip 分片 PUT 到服务端开好的可续传 URL。 */
async function putResumableChunks(
  uploadUrl: string,
  gz: Uint8Array,
): Promise<{ ok: true; fileId: string } | { ok: false; error: DriveBackupError; detail?: string }> {
  let offset = 0;
  while (offset < gz.byteLength) {
    const end = Math.min(offset + CHUNK, gz.byteLength);
    const chunk = gz.subarray(offset, end);
    let put: Response;
    try {
      put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Length': String(chunk.byteLength),
          'Content-Range': `bytes ${offset}-${end - 1}/${gz.byteLength}`,
        },
        body: new Blob([chunk as BlobPart]),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'fetch_failed';
      return { ok: false, error: 'network', detail: msg.slice(0, 80) };
    }
    if (put.status === 308) {
      const range = put.headers.get('Range');
      if (range) {
        const m = /bytes=0-(\d+)/.exec(range);
        offset = m ? Number(m[1]) + 1 : end;
      } else {
        offset = end;
      }
      continue;
    }
    if (put.status === 401 || put.status === 403) {
      return { ok: false, error: 'insufficient_scope', detail: `put_${put.status}` };
    }
    if (!put.ok) {
      return { ok: false, error: 'drive', detail: `put_${put.status}` };
    }
    const done = await put.json().catch(() => null) as { id?: string } | null;
    return { ok: true, fileId: done?.id || '' };
  }
  return { ok: false, error: 'drive', detail: 'put_incomplete' };
}

/** 把本机 durable 数据(默认含照片/附件)打包推到 Google Drive「宝盒备份」。 */
export async function pushBackupToDrive(opts: { includeImages?: boolean } = {}): Promise<DriveBackupResult> {
  const withMedia = opts.includeImages !== false;
  let backup;
  try {
    // 等图谱水合完再打包,避免导出/备份打到空图。
    try {
      const { whenGraphHydrated } = await import('./life-graph');
      await whenGraphHydrated();
    } catch { /* 无图模块时跳过 */ }
    backup = await buildCombinedBackup({ includeImages: withMedia });
  } catch {
    return { ok: false, error: 'build_failed' };
  }

  let gz: Uint8Array;
  try {
    gz = await gzipAsync(strToU8(JSON.stringify(backup)));
  } catch {
    return { ok: false, error: 'build_failed' };
  }

  try {
    const started = await beginResumable(gz.byteLength);
    if (!started.ok) {
      return {
        ok: false,
        error: started.error,
        connectUrl: started.connectUrl,
        bytes: gz.byteLength,
        detail: started.detail,
      };
    }

    const uploaded = await putResumableChunks(started.uploadUrl, gz);
    if (!uploaded.ok) {
      return {
        ok: false,
        error: uploaded.error,
        connectUrl: uploaded.error === 'insufficient_scope' ? '/api/portal/gmail/connect' : undefined,
        bytes: gz.byteLength,
        detail: uploaded.detail,
      };
    }

    const at = new Date().toISOString();
    try { localStorage.setItem(DRIVE_BACKUP_AT_KEY, at); } catch { /* quota */ }
    return {
      ok: true,
      at,
      bytes: gz.byteLength,
      folderName: started.folderName,
      fileName: started.fileName,
      withMedia,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, error: 'timeout', bytes: gz.byteLength };
    return { ok: false, error: 'network', bytes: gz.byteLength, detail: name || 'catch' };
  }
}

async function downloadDriveFile(accessToken: string, fileId: string): Promise<Uint8Array | null> {
  const res = await fetch(`${DRIVE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/** 从 Drive 拉回备份并合并回本机(默认 merge)。优先客户端直下(含大包)。 */
export async function pullBackupFromDrive(mode: RestoreMode = 'merge'): Promise<DriveBackupResult & { restore?: CombinedRestoreResult }> {
  try {
    const session = await requestSession();
    const authErr = mapAuth(session);
    if (authErr) return authErr;

    if (session.file?.id) {
      const raw = await downloadDriveFile(session.accessToken!, session.file.id);
      if (!raw) return { ok: false, error: 'drive', detail: 'download_failed' };
      let backup: unknown;
      const name = session.file.name || '';
      if (name.endsWith('.gz') || (raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b)) {
        try {
          backup = JSON.parse(strFromU8(await gunzipAsync(raw)));
        } catch {
          return { ok: false, error: 'drive', detail: 'gunzip_failed' };
        }
      } else {
        try {
          backup = JSON.parse(strFromU8(raw));
        } catch {
          return { ok: false, error: 'drive', detail: 'json_failed' };
        }
      }
      const restore = await restoreCombinedBackup(backup as Parameters<typeof restoreCombinedBackup>[0], mode);
      return {
        ok: true,
        restore,
        folderName: session.folderName || '宝盒备份',
        fileName: session.file.name,
      };
    }

    // 无可见文件:走服务端(含旧 appDataFolder)
    const signal = timeoutSignal(UPLOAD_TIMEOUT_MS);
    const res = await fetch('/api/portal/drive', {
      method: 'GET',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    const data = await res.json().catch(() => null) as {
      ok?: boolean; backup?: unknown; error?: string; connectUrl?: string; folderName?: string;
    } | null;
    if (res.status === 401 || data?.error === 'not_connected') {
      return { ok: false, error: 'not_connected', connectUrl: data?.connectUrl || '/api/portal/gmail/connect' };
    }
    if (res.status === 403 || data?.error === 'insufficient_scope') {
      return { ok: false, error: 'insufficient_scope', connectUrl: data?.connectUrl || '/api/portal/gmail/connect' };
    }
    if (!res.ok || !data?.ok) return { ok: false, error: 'drive', detail: data?.error || `get_${res.status}` };
    if (!data.backup) return { ok: false, error: 'no_backup' };
    const restore = await restoreCombinedBackup(data.backup as Parameters<typeof restoreCombinedBackup>[0], mode);
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
