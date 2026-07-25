/**
 * /api/portal/drive — 免费云备份到用户自己的 Google Drive「应用数据」文件夹(appDataFolder)。
 *
 * 免费最大化·Google 扩展授权:此前设置里「云备份」是付费占位(hasCloudEntitlement 门控),
 * 这里用 drive.appdata scope(非敏感,只碰 App 私有隐藏文件夹,用户看不到、别的 App 看不到)
 * 提供**免费**后端——备份存进用户自己的 Drive 配额,换机不丢,零服务器成本。
 *
 * POST body { backup: <FullBackup JSON> } → 上传/覆盖单个备份文件(nesio-backup.json)。
 * GET → 下载最近一次备份(无则 { ok:true, backup:null })。
 * 鉴权复用 resolveGmailAccessToken(Gmail/Calendar 同一次 Google 授权,drive.appdata 已并入 scope)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveGmailAccessToken } from '@/lib/portal/providers/gmail-access';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const BACKUP_NAME = 'nesio-backup.json';

const notConnected = () =>
  NextResponse.json({ ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' }, { status: 401 });

/** 找 appDataFolder 里的备份文件 id(没有返回 null)。 */
async function findBackupId(accessToken: string): Promise<string | null> {
  const url = `${DRIVE}/files?spaces=appDataFolder&fields=files(id,name)&q=${encodeURIComponent(`name='${BACKUP_NAME}'`)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`drive_list_${res.status}`);
  const data = await res.json() as { files?: Array<{ id?: string; name?: string }> };
  return data.files?.find((f) => f.name === BACKUP_NAME)?.id || null;
}

export async function POST(req: NextRequest) {
  // 红线:读写私密数据(Drive 备份)必须过 guardAiRoute(验真会话 + 限流)。
  const guard = await guardAiRoute(req, 'drive', { limit: 20 });
  if (guard) return guard;
  const accessToken = await resolveGmailAccessToken(req);
  if (!accessToken) return notConnected();

  const body = await req.json().catch(() => null) as { backup?: unknown } | null;
  if (!body || body.backup === undefined) {
    return NextResponse.json({ ok: false, error: 'no_backup' }, { status: 400 });
  }
  const payload = JSON.stringify(body.backup);

  try {
    const existingId = await findBackupId(accessToken);
    // multipart/related:一段 metadata + 一段文件内容。已存在则 PATCH 覆盖,否则 POST 新建到 appDataFolder。
    const boundary = 'nesio_drive_boundary';
    const metadata = existingId
      ? { name: BACKUP_NAME }
      : { name: BACKUP_NAME, parents: ['appDataFolder'] };
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`;
    const url = existingId
      ? `${UPLOAD}/files/${existingId}?uploadType=multipart&fields=id`
      : `${UPLOAD}/files?uploadType=multipart&fields=id`;
    const res = await fetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: `drive_upload_${res.status}` }, { status: 502 });
    return NextResponse.json({ ok: true, at: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'drive_unreachable' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  // 红线:读私密数据(Drive 备份)必须过 guardAiRoute(验真会话 + 限流)。
  const guard = await guardAiRoute(req, 'drive', { limit: 20 });
  if (guard) return guard;
  const accessToken = await resolveGmailAccessToken(req);
  if (!accessToken) return notConnected();
  try {
    const id = await findBackupId(accessToken);
    if (!id) return NextResponse.json({ ok: true, backup: null }, { headers: { 'Cache-Control': 'no-store' } });
    const res = await fetch(`${DRIVE}/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return NextResponse.json({ ok: false, error: `drive_download_${res.status}` }, { status: 502 });
    const backup = await res.json().catch(() => null);
    return NextResponse.json({ ok: true, backup }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'drive_unreachable' }, { status: 502 });
  }
}
