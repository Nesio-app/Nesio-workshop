/**
 * 免费云备份客户端(Google Drive appDataFolder)——免费最大化·Google 扩展授权。
 *
 * 复用现有 buildCombinedBackup / restoreCombinedBackup 的备份载荷机器,后端换成
 * 用户自己的 Google Drive(免费),不走付费 entitlement。设计红线:失败必可见
 * (调用方据返回的 error 展示,不静默)。
 */
import { buildCombinedBackup, restoreCombinedBackup, type RestoreMode, type CombinedRestoreResult } from './cloud-backup';

const DRIVE_BACKUP_AT_KEY = 'nesio-drive-backup-at';

export type DriveBackupError = 'not_connected' | 'network' | 'drive' | 'no_backup';
export interface DriveBackupResult { ok: boolean; at?: string; error?: DriveBackupError }

/** 把本机全部 durable 数据打包推到用户 Google Drive 的 appDataFolder。 */
export async function pushBackupToDrive(): Promise<DriveBackupResult> {
  let backup;
  // Drive 是全量离机备份,带上照片(Drive 容量大;隐私:备份要完整)。
  try { backup = await buildCombinedBackup({ includeImages: true }); } catch { return { ok: false, error: 'network' }; }
  try {
    const res = await fetch('/api/portal/drive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backup }),
    });
    if (res.status === 401) return { ok: false, error: 'not_connected' };
    const data = await res.json().catch(() => null) as { ok?: boolean; at?: string } | null;
    if (!res.ok || !data?.ok) return { ok: false, error: 'drive' };
    try { localStorage.setItem(DRIVE_BACKUP_AT_KEY, data.at || new Date().toISOString()); } catch { /* quota */ }
    return { ok: true, at: data.at };
  } catch { return { ok: false, error: 'network' }; }
}

/** 从 Drive 拉回备份并合并/覆盖回本机(默认 merge:仅补缺不覆盖)。 */
export async function pullBackupFromDrive(mode: RestoreMode = 'merge'): Promise<DriveBackupResult & { restore?: CombinedRestoreResult }> {
  try {
    const res = await fetch('/api/portal/drive', { method: 'GET' });
    if (res.status === 401) return { ok: false, error: 'not_connected' };
    const data = await res.json().catch(() => null) as { ok?: boolean; backup?: unknown } | null;
    if (!res.ok || !data?.ok) return { ok: false, error: 'drive' };
    if (!data.backup) return { ok: false, error: 'no_backup' };
    const restore = await restoreCombinedBackup(data.backup as Parameters<typeof restoreCombinedBackup>[0], mode);
    return { ok: true, restore };
  } catch { return { ok: false, error: 'network' }; }
}

export function lastDriveBackupAt(): string | null {
  try { return localStorage.getItem(DRIVE_BACKUP_AT_KEY); } catch { return null; }
}
