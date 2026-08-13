/**
 * /api/portal/drive — 免费云备份到用户自己的 Google Drive「应用数据」文件夹(appDataFolder)。
 *
 * POST body:
 *   { backup: <FullBackup JSON> } 或 { gzipBase64: "<gzip of JSON string>" }
 *   → 上传/覆盖单个备份文件(nesio-backup.json)。gzip 在服务端解压后再存明文 JSON,
 *     便于 GET 直接返回;客户端压缩是为了过 Vercel ~4.5MB 请求体上限。
 * GET → 下载最近一次备份(无则 { ok:true, backup:null })。
 * 鉴权复用 resolveGmailAccessToken(Gmail/Calendar 同一次 Google 授权,drive.appdata 已并入 scope)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';
import { resolveGmailAccessToken } from '@/lib/portal/providers/gmail-access';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const BACKUP_NAME = 'nesio-backup.json';
/** Drive 侧明文 JSON 上限(解压后);再大说明本机数据异常,应走「导出」。 */
const MAX_PAYLOAD_CHARS = 12 * 1024 * 1024;

const notConnected = () =>
  NextResponse.json({ ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' }, { status: 401 });

const insufficientScope = () =>
  NextResponse.json({ ok: false, error: 'insufficient_scope', connectUrl: '/api/portal/gmail/connect' }, { status: 403 });

function isScopeError(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true;
  return /insufficient|ACCESS_TOKEN_SCOPE|PERMISSION_DENIED|authError/i.test(bodyText);
}

/** 找 appDataFolder 里的备份文件 id(没有返回 null)。 */
async function findBackupId(accessToken: string): Promise<string | null | 'insufficient_scope'> {
  const url = `${DRIVE}/files?spaces=appDataFolder&fields=files(id,name)&q=${encodeURIComponent(`name='${BACKUP_NAME}'`)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (isScopeError(res.status, text)) return 'insufficient_scope';
    throw new Error(`drive_list_${res.status}`);
  }
  const data = await res.json() as { files?: Array<{ id?: string; name?: string }> };
  return data.files?.find((f) => f.name === BACKUP_NAME)?.id || null;
}

function decodeBackupBody(body: { backup?: unknown; gzipBase64?: string } | null):
  | { ok: true; payload: string }
  | { ok: false; error: string; status: number } {
  if (!body) return { ok: false, error: 'no_backup', status: 400 };
  if (typeof body.gzipBase64 === 'string' && body.gzipBase64.length > 0) {
    try {
      const gz = Buffer.from(body.gzipBase64, 'base64');
      const payload = gunzipSync(gz).toString('utf8');
      JSON.parse(payload); // 校验是合法 JSON
      if (payload.length > MAX_PAYLOAD_CHARS) return { ok: false, error: 'too_large', status: 413 };
      return { ok: true, payload };
    } catch {
      return { ok: false, error: 'invalid_gzip', status: 400 };
    }
  }
  if (body.backup === undefined) return { ok: false, error: 'no_backup', status: 400 };
  const payload = JSON.stringify(body.backup);
  if (payload.length > MAX_PAYLOAD_CHARS) return { ok: false, error: 'too_large', status: 413 };
  return { ok: true, payload };
}

export async function POST(req: NextRequest) {
  // 红线:读写私密数据(Drive 备份)必须过 guardAiRoute(验真会话 + 限流)。
  const guard = await guardAiRoute(req, 'drive', { limit: 20 });
  if (guard) return guard;
  const accessToken = await resolveGmailAccessToken(req);
  if (!accessToken) return notConnected();

  const body = await req.json().catch(() => null) as { backup?: unknown; gzipBase64?: string } | null;
  const decoded = decodeBackupBody(body);
  if (!decoded.ok) {
    return NextResponse.json({ ok: false, error: decoded.error }, { status: decoded.status });
  }
  const payload = decoded.payload;

  try {
    const existingId = await findBackupId(accessToken);
    if (existingId === 'insufficient_scope') return insufficientScope();
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
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (isScopeError(res.status, text)) return insufficientScope();
      return NextResponse.json({ ok: false, error: `drive_upload_${res.status}` }, { status: 502 });
    }
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
    if (id === 'insufficient_scope') return insufficientScope();
    if (!id) return NextResponse.json({ ok: true, backup: null }, { headers: { 'Cache-Control': 'no-store' } });
    const res = await fetch(`${DRIVE}/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (isScopeError(res.status, text)) return insufficientScope();
      return NextResponse.json({ ok: false, error: `drive_download_${res.status}` }, { status: 502 });
    }
    const backup = await res.json().catch(() => null);
    return NextResponse.json({ ok: true, backup }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'drive_unreachable' }, { status: 502 });
  }
}
