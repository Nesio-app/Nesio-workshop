/**
 * 免费云备份客户端(Google Drive「我的云端硬盘 / 宝盒备份」)。
 *
 * 设计红线:失败必可见;按钮不得永久停在「正在备份…」。
 * 含照片/附件:默认全量打包,经 Google 可续传直传(不经 Vercel 请求体,避开 ~4.5MB 硬限)。
 * 旧版曾写入隐藏 appDataFolder —— 补缺仍可由服务端回退读出。
 */
import { gzip, gunzip, strToU8, strFromU8 } from 'fflate';
import { buildCombinedBackup, restoreCombinedBackup, type RestoreMode, type CombinedRestoreResult } from './cloud-backup';

const DRIVE_BACKUP_AT_KEY = 'nesio-drive-backup-at';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
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
    return { ok: false, error: 'drive' };
  }
  return null;
}

/** 可续传上传 gzip 到「宝盒备份」;覆盖同名 .gz,若只有旧明文 json 则新建 .gz。 */
async function resumablePutGz(
  accessToken: string,
  folderId: string,
  fileName: string,
  existing: { id: string; name: string } | null | undefined,
  gz: Uint8Array,
): Promise<{ ok: true; fileId: string } | { ok: false; error: DriveBackupError }> {
  const meta = existing?.name === fileName
    ? { name: fileName }
    : { name: fileName, parents: [folderId] };
  const initUrl = existing?.name === fileName
    ? `${UPLOAD}/files/${existing.id}?uploadType=resumable`
    : `${UPLOAD}/files?uploadType=resumable`;
  const initRes = await fetch(initUrl, {
    method: existing?.name === fileName ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/gzip',
      'X-Upload-Content-Length': String(gz.byteLength),
    },
    body: JSON.stringify(meta),
  });
  if (initRes.status === 401 || initRes.status === 403) return { ok: false, error: 'insufficient_scope' };
  if (!initRes.ok) return { ok: false, error: 'drive' };
  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) return { ok: false, error: 'drive' };

  let offset = 0;
  while (offset < gz.byteLength) {
    const end = Math.min(offset + CHUNK, gz.byteLength);
    const chunk = gz.subarray(offset, end);
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Length': String(chunk.byteLength),
        'Content-Range': `bytes ${offset}-${end - 1}/${gz.byteLength}`,
      },
      body: new Blob([chunk]),
    });
    if (put.status === 308) {
      // 未完成:Google 用 Range 指示已收字节
      const range = put.headers.get('Range');
      if (range) {
        const m = /bytes=0-(\d+)/.exec(range);
        offset = m ? Number(m[1]) + 1 : end;
      } else {
        offset = end;
      }
      continue;
    }
    if (put.status === 401 || put.status === 403) return { ok: false, error: 'insufficient_scope' };
    if (!put.ok) return { ok: false, error: 'drive' };
    const done = await put.json().catch(() => null) as { id?: string } | null;
    return { ok: true, fileId: done?.id || existing?.id || '' };
  }
  return { ok: false, error: 'drive' };
}

/** 把本机 durable 数据(默认含照片/附件)打包推到 Google Drive「宝盒备份」。 */
export async function pushBackupToDrive(opts: { includeImages?: boolean } = {}): Promise<DriveBackupResult> {
  const withMedia = opts.includeImages !== false;
  let backup;
  try {
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
    const session = await requestSession();
    const authErr = mapAuth(session);
    if (authErr) return authErr;
    if (!session.folderId) {
      return { ok: false, error: 'insufficient_scope', connectUrl: '/api/portal/gmail/connect', bytes: gz.byteLength };
    }

    const fileName = session.backupNameGz || 'nesio-backup.json.gz';
    const existing = session.file?.name === fileName || session.file?.name?.endsWith('.gz')
      ? session.file
      : null;

    const uploaded = await resumablePutGz(
      session.accessToken!,
      session.folderId,
      fileName,
      existing,
      gz,
    );
    if (!uploaded.ok) {
      return {
        ok: false,
        error: uploaded.error,
        connectUrl: uploaded.error === 'insufficient_scope' ? '/api/portal/gmail/connect' : undefined,
        bytes: gz.byteLength,
      };
    }

    const at = new Date().toISOString();
    try { localStorage.setItem(DRIVE_BACKUP_AT_KEY, at); } catch { /* quota */ }
    return {
      ok: true,
      at,
      bytes: gz.byteLength,
      folderName: session.folderName || '宝盒备份',
      fileName,
      withMedia,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, error: 'timeout', bytes: gz.byteLength };
    return { ok: false, error: 'network', bytes: gz.byteLength };
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
      if (!raw) return { ok: false, error: 'drive' };
      let backup: unknown;
      const name = session.file.name || '';
      if (name.endsWith('.gz') || (raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b)) {
        try {
          backup = JSON.parse(strFromU8(await gunzipAsync(raw)));
        } catch {
          return { ok: false, error: 'drive' };
        }
      } else {
        try {
          backup = JSON.parse(strFromU8(raw));
        } catch {
          return { ok: false, error: 'drive' };
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
    if (!res.ok || !data?.ok) return { ok: false, error: 'drive' };
    if (!data.backup) return { ok: false, error: 'no_backup' };
    const restore = await restoreCombinedBackup(data.backup as Parameters<typeof restoreCombinedBackup>[0], mode);
    return { ok: true, restore, folderName: data.folderName || '宝盒备份' };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: 'network' };
  }
}

export function lastDriveBackupAt(): string | null {
  try { return localStorage.getItem(DRIVE_BACKUP_AT_KEY); } catch { return null; }
}
