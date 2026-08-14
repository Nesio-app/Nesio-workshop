/**
 * /api/portal/drive — 免费云备份到用户自己的 Google Drive。
 *
 * 可见位置:「我的云端硬盘 / 宝盒备份 /」(需 drive.file)。旧版曾写入隐藏
 * appDataFolder,GET/补缺仍会回退查找。
 *
 * POST:
 *   { backup } | { gzipBase64 } — 小包经本服务上传(兼容;受 Vercel ~4.5MB 限制)
 *   { action:'uploadGzip', gzipBase64 } — 小包 ZIP 代传(action 名历史兼容)
 *   { action:'session' } — 返回短时 accessToken + 备份文件元信息
 *   { action:'beginResumable'|'putChunk' } — 大包可续传(内容为 .zip)
 * GET → 经本服务拉回 JSON 备份(自动解 zip/gz);大包请用 session 直下。
 */
import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';
import { unzipSync, strFromU8 } from 'fflate';
import { resolveGmailAccessToken } from '@/lib/portal/providers/gmail-access';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const BACKUP_NAME = 'nesio-backup.json';
const BACKUP_GZ_NAME = 'nesio-backup.json.gz';
const BACKUP_ZIP_NAME = 'nesio-backup.zip';
const FOLDER_NAME = '宝盒备份';
/** 经本服务中转的明文 JSON 上限;更大走客户端分片。 */
const MAX_PAYLOAD_CHARS = 12 * 1024 * 1024;

const notConnected = () =>
  NextResponse.json({ ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' }, { status: 401 });

const insufficientScope = () =>
  NextResponse.json({ ok: false, error: 'insufficient_scope', connectUrl: '/api/portal/gmail/connect' }, { status: 403 });

function isScopeError(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true;
  return /insufficient|ACCESS_TOKEN_SCOPE|PERMISSION_DENIED|authError/i.test(bodyText);
}

type DriveFile = { id: string; name: string; size?: string };

async function driveJson<T>(accessToken: string, url: string, init?: RequestInit): Promise<
  { ok: true; data: T } | { ok: false; scope: true } | { ok: false; scope: false; status: number }
> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (isScopeError(res.status, text)) return { ok: false, scope: true };
    return { ok: false, scope: false, status: res.status };
  }
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: true, data };
}

/** 找或创建「我的云端硬盘 / 宝盒备份」。 */
async function ensureBackupFolder(accessToken: string): Promise<string | 'insufficient_scope'> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
  );
  const listed = await driveJson<{ files?: Array<{ id?: string }> }>(
    accessToken,
    `${DRIVE}/files?pageSize=5&fields=files(id,name)&q=${q}`,
  );
  if (!listed.ok) return listed.scope ? 'insufficient_scope' : (() => { throw new Error(`drive_list_${listed.status}`); })();
  const existing = listed.data.files?.find((f) => f.id)?.id;
  if (existing) return existing;

  const created = await driveJson<{ id?: string }>(accessToken, `${DRIVE}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!created.ok) return created.scope ? 'insufficient_scope' : (() => { throw new Error(`drive_mkdir_${created.status}`); })();
  if (!created.data.id) throw new Error('drive_mkdir_no_id');
  return created.data.id;
}

async function findInFolder(
  accessToken: string,
  folderId: string,
  names: string[],
): Promise<DriveFile | null | 'insufficient_scope'> {
  const nameQ = names.map((n) => `name='${n}'`).join(' or ');
  const q = encodeURIComponent(`(${nameQ}) and '${folderId}' in parents and trashed=false`);
  const listed = await driveJson<{ files?: Array<{ id?: string; name?: string; size?: string }> }>(
    accessToken,
    `${DRIVE}/files?pageSize=10&fields=files(id,name,size)&q=${q}`,
  );
  if (!listed.ok) return listed.scope ? 'insufficient_scope' : null;
  const files = (listed.data.files || []).filter((f): f is DriveFile => Boolean(f.id && f.name));
  return files.find((f) => f.name === BACKUP_ZIP_NAME)
    || files.find((f) => f.name === BACKUP_GZ_NAME)
    || files.find((f) => f.name === BACKUP_NAME)
    || null;
}

/** 旧版隐藏 appDataFolder 里的明文备份。 */
async function findAppDataBackup(accessToken: string): Promise<DriveFile | null | 'insufficient_scope'> {
  const url = `${DRIVE}/files?spaces=appDataFolder&fields=files(id,name,size)&q=${encodeURIComponent(`name='${BACKUP_NAME}'`)}`;
  const listed = await driveJson<{ files?: Array<{ id?: string; name?: string; size?: string }> }>(accessToken, url);
  if (!listed.ok) return listed.scope ? 'insufficient_scope' : null;
  const f = listed.data.files?.find((x) => x.id && x.name === BACKUP_NAME);
  return f?.id ? { id: f.id, name: f.name || BACKUP_NAME, size: f.size } : null;
}

async function resolveBackupFile(accessToken: string): Promise<
  | { ok: true; file: DriveFile | null; folderId?: string; location: 'mydrive' | 'appdata' | 'none' }
  | { ok: false; error: 'insufficient_scope' }
> {
  // 可见文件夹需要 drive.file;老授权只有 appdata 时跳过建夹,仍可读隐藏备份。
  let folderId: string | undefined;
  try {
    const ensured = await ensureBackupFolder(accessToken);
    if (ensured === 'insufficient_scope') {
      folderId = undefined;
    } else {
      folderId = ensured;
      const visible = await findInFolder(accessToken, folderId, [BACKUP_ZIP_NAME, BACKUP_GZ_NAME, BACKUP_NAME]);
      if (visible === 'insufficient_scope') {
        /* fall through to appData */
      } else if (visible) {
        return { ok: true, file: visible, folderId, location: 'mydrive' };
      }
    }
  } catch {
    /* mkdir/list 网络错 → 再试 appData */
  }
  const legacy = await findAppDataBackup(accessToken);
  if (legacy === 'insufficient_scope') {
    // 连 appdata 都没有 → 真缺 scope
    if (!folderId) return { ok: false, error: 'insufficient_scope' };
    return { ok: true, file: null, folderId, location: 'none' };
  }
  if (legacy) return { ok: true, file: legacy, folderId, location: 'appdata' };
  return { ok: true, file: null, folderId, location: 'none' };
}

function decodeBackupBody(body: { backup?: unknown; gzipBase64?: string } | null):
  | { ok: true; payload: string }
  | { ok: false; error: string; status: number } {
  if (!body) return { ok: false, error: 'no_backup', status: 400 };
  if (typeof body.gzipBase64 === 'string' && body.gzipBase64.length > 0) {
    try {
      const gz = Buffer.from(body.gzipBase64, 'base64');
      const payload = gunzipSync(gz).toString('utf8');
      JSON.parse(payload);
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

async function parseMediaBackup(buf: ArrayBuffer, name: string): Promise<unknown | null> {
  const u8 = new Uint8Array(buf);
  // 必须看魔数:历史上曾把 gzip 内容以 .zip 文件名上传,按扩展名硬解 zip 会整份失败。
  const isZipMagic = u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4b;
  const isGzMagic = u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
  try {
    if (isZipMagic) {
      const files = unzipSync(u8);
      const jsonFile = files['nesio-backup.json']
        || files['backup.json']
        || Object.entries(files).find(([p]) => p.endsWith('.json') && !p.includes('/'))?.[1];
      if (!jsonFile) return null;
      const backup = JSON.parse(strFromU8(jsonFile)) as {
        entries?: Record<string, string>;
        format?: string;
        version?: number;
        exportedAt?: string;
      };
      const entries = { ...(backup.entries || {}) };
      for (const [path, bytes] of Object.entries(files)) {
        if (!path.startsWith('photos/') || !/\.jpe?g$/i.test(path)) continue;
        const base = path.slice('photos/'.length).replace(/\.jpe?g$/i, '');
        let assetId = base;
        for (const [k, v] of Object.entries(entries)) {
          if (k.startsWith('local-image:') && typeof v === 'string' && v.startsWith('zip-photo:') && v.includes(base)) {
            assetId = k.slice('local-image:'.length);
            break;
          }
        }
        const b64 = Buffer.from(bytes).toString('base64');
        entries[`local-image:${assetId}`] = `data:image/jpeg;base64,${b64}`;
      }
      for (const [k, v] of Object.entries(entries)) {
        if (k.startsWith('local-image:') && typeof v === 'string' && v.startsWith('zip-photo:')) delete entries[k];
      }
      return { ...backup, entries };
    }
    const text = (isGzMagic || name.endsWith('.gz'))
      ? gunzipSync(Buffer.from(u8)).toString('utf8')
      : Buffer.from(u8).toString('utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function trashFile(accessToken: string, fileId: string): Promise<void> {
  await fetch(`${DRIVE}/files/${fileId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  }).catch(() => null);
}

/** 新 zip 备份成功后,丢掉旧的明文 json / 嵌图 gz,避免用户打开错文件。 */
async function trashLegacyBackups(accessToken: string, folderId: string): Promise<void> {
  for (const name of [BACKUP_NAME, BACKUP_GZ_NAME]) {
    const existing = await findInFolder(accessToken, folderId, [name]);
    if (existing && existing !== 'insufficient_scope' && existing.name === name) {
      await trashFile(accessToken, existing.id);
    }
  }
}

async function ensureReadme(accessToken: string, folderId: string): Promise<void> {
  const name = '请读我-宝盒备份说明.txt';
  const existing = await findInFolder(accessToken, folderId, [name]);
  if (existing && existing !== 'insufficient_scope') return;
  const body =
    '宝盒 / Nesio 备份说明\n\n' +
    '请保留 nesio-backup.zip\n' +
    '  · 解压后可见 nesio-backup.json(文字数据)与 photos/*.jpg(照片)\n' +
    '  · 旧的 .json / .json.gz 可删\n\n' +
    '换手机:宝盒设置 → Google 云 →「用备份补缺」,或「导入」选这个 zip。\n';
  const boundary = 'nesio_readme';
  const meta = { name, parents: [folderId] };
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}\r\n--${boundary}--`;
  await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  }).catch(() => null);
}

export async function POST(req: NextRequest) {
  // 分片代传会打多次;20/min 会在大备份中途被掐。
  const guard = await guardAiRoute(req, 'drive', { limit: 300 });
  if (guard) return guard;
  const accessToken = await resolveGmailAccessToken(req);
  if (!accessToken) return notConnected();

  const body = await req.json().catch(() => null) as {
    action?: string;
    backup?: unknown;
    gzipBase64?: string;
    byteSize?: number;
    uploadUrl?: string;
    offset?: number;
    total?: number;
    length?: number;
    chunkBase64?: string;
    fileId?: string;
  } | null;

  // 大备份不能经 GET 整包 JSON 返回(常 >4.5MB);客户端先 open 再分片读原始字节。
  if (body?.action === 'openDownload') {
    try {
      const resolved = await resolveBackupFile(accessToken);
      if (!resolved.ok) return insufficientScope();
      if (!resolved.file) {
        return NextResponse.json({
          ok: true,
          file: null,
          folderName: FOLDER_NAME,
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
      return NextResponse.json({
        ok: true,
        fileId: resolved.file.id,
        fileName: resolved.file.name,
        size: Number(resolved.file.size || 0) || null,
        folderName: FOLDER_NAME,
        location: resolved.location,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json({ ok: false, error: 'drive_unreachable' }, { status: 502 });
    }
  }

  if (body?.action === 'readChunk') {
    const fileId = String(body.fileId || '').replace(/[^\w-]/g, '');
    const offset = Number(body.offset);
    const length = Number(body.length);
    if (!fileId || !Number.isFinite(offset) || offset < 0 || !Number.isFinite(length) || length <= 0 || length > 768 * 1024) {
      return NextResponse.json({ ok: false, error: 'invalid_chunk' }, { status: 400 });
    }
    try {
      const end = offset + length - 1;
      const res = await fetch(`${DRIVE}/files/${fileId}?alt=media`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Range: `bytes=${offset}-${end}`,
        },
      });
      if (res.status === 404) {
        return NextResponse.json({ ok: false, error: 'no_backup' }, { status: 404 });
      }
      if (!res.ok && res.status !== 206) {
        const text = await res.text().catch(() => '');
        if (isScopeError(res.status, text)) return insufficientScope();
        return NextResponse.json({
          ok: false,
          error: `drive_download_${res.status}`,
          detail: text.slice(0, 180),
        }, { status: 502 });
      }
      const ab = await res.arrayBuffer();
      let buf = Buffer.from(ab);
      // 少数环境忽略 Range、整份返回:按 offset/length 切片,避免一次塞爆响应体。
      if (buf.length > length) {
        if (res.status === 200 && offset > 0 && buf.length > offset) {
          buf = buf.subarray(offset, Math.min(offset + length, buf.length));
        } else {
          buf = buf.subarray(0, length);
        }
      }
      return NextResponse.json({
        ok: true,
        chunkBase64: buf.toString('base64'),
        bytes: buf.length,
        offset,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json({ ok: false, error: 'drive_unreachable' }, { status: 502 });
    }
  }

  // 客户端直传/直下:发短时 Google access token(同一次 OAuth;限流见 guard)。
  if (body?.action === 'session') {
    const resolved = await resolveBackupFile(accessToken);
    if (!resolved.ok) return insufficientScope();
    let folderId = resolved.folderId;
    if (!folderId) {
      const ensured = await ensureBackupFolder(accessToken);
      if (ensured === 'insufficient_scope') {
        // 旧授权无 drive.file:仍可发 token 读 appData,但不能新建可见夹 —— 标 insufficient 让前端引导重连上传。
        if (!resolved.file) return insufficientScope();
        return NextResponse.json({
          ok: true,
          accessToken,
          folderId: null,
          folderName: FOLDER_NAME,
          backupNameGz: BACKUP_ZIP_NAME,
          backupNameJson: BACKUP_NAME,
          file: resolved.file,
          location: resolved.location,
          needsDriveFileScope: true,
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
      folderId = ensured;
    }
    return NextResponse.json({
      ok: true,
      accessToken,
      folderId,
      folderName: FOLDER_NAME,
      backupNameGz: BACKUP_ZIP_NAME,
      backupNameJson: BACKUP_NAME,
      file: resolved.file,
      location: resolved.location,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // 服务端发起可续传会话:浏览器/WKWebView 读不到 Location,且直连 Google 常被 CORS 挡。
  if (body?.action === 'beginResumable') {
    const byteSize = Number(body.byteSize);
    if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > 512 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'invalid_size' }, { status: 400 });
    }
    try {
      const folderId = await ensureBackupFolder(accessToken);
      if (folderId === 'insufficient_scope') return insufficientScope();
      const existing = await findInFolder(accessToken, folderId, [BACKUP_ZIP_NAME, BACKUP_GZ_NAME, BACKUP_NAME]);
      if (existing === 'insufficient_scope') return insufficientScope();
      const existingZip = existing?.name === BACKUP_ZIP_NAME ? existing : null;
      const meta = existingZip
        ? { name: BACKUP_ZIP_NAME }
        : { name: BACKUP_ZIP_NAME, parents: [folderId] };
      const initUrl = existingZip
        ? `${UPLOAD}/files/${existingZip.id}?uploadType=resumable`
        : `${UPLOAD}/files?uploadType=resumable`;
      const initRes = await fetch(initUrl, {
        method: existingZip ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/zip',
          'X-Upload-Content-Length': String(byteSize),
        },
        body: JSON.stringify(meta),
      });
      if (!initRes.ok) {
        const text = await initRes.text().catch(() => '');
        if (isScopeError(initRes.status, text)) return insufficientScope();
        return NextResponse.json({
          ok: false,
          error: `drive_resumable_${initRes.status}`,
          detail: text.slice(0, 180),
        }, { status: 502 });
      }
      const uploadUrl = initRes.headers.get('Location');
      if (!uploadUrl) {
        return NextResponse.json({ ok: false, error: 'drive_no_upload_url' }, { status: 502 });
      }
      return NextResponse.json({
        ok: true,
        uploadUrl,
        folderName: FOLDER_NAME,
        fileName: BACKUP_ZIP_NAME,
        fileId: existingZip?.id || null,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json({ ok: false, error: 'drive_unreachable' }, { status: 502 });
    }
  }

  // 手机不直连 Google:分片经本服务 PUT 到可续传 URL(仅允许 googleapis upload 域)。
  if (body?.action === 'putChunk') {
    const uploadUrl = String(body.uploadUrl || '');
    if (!/^https:\/\/www\.googleapis\.com\/upload\//.test(uploadUrl)) {
      return NextResponse.json({ ok: false, error: 'invalid_upload_url' }, { status: 400 });
    }
    const offset = Number(body.offset);
    const total = Number(body.total);
    const b64 = String(body.chunkBase64 || '');
    if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(total) || total <= 0 || !b64) {
      return NextResponse.json({ ok: false, error: 'invalid_chunk' }, { status: 400 });
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_chunk' }, { status: 400 });
    }
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'invalid_chunk' }, { status: 400 });
    }
    const end = offset + buf.length - 1;
    try {
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(buf.length),
          'Content-Type': 'application/zip',
          'Content-Range': `bytes ${offset}-${end}/${total}`,
        },
        body: new Uint8Array(buf) as BodyInit,
      });
      if (put.status === 308) {
        return NextResponse.json({
          ok: true,
          incomplete: true,
          range: put.headers.get('Range'),
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (!put.ok) {
        const text = await put.text().catch(() => '');
        if (isScopeError(put.status, text)) return insufficientScope();
        return NextResponse.json({
          ok: false,
          error: `put_${put.status}`,
          detail: text.slice(0, 180),
        }, { status: 502 });
      }
      const done = await put.json().catch(() => null) as { id?: string } | null;
      try {
        const folderId = await ensureBackupFolder(accessToken);
        if (folderId !== 'insufficient_scope') {
          await trashLegacyBackups(accessToken, folderId);
          await ensureReadme(accessToken, folderId);
        }
      } catch { /* 清理失败不影响主备份 */ }
      return NextResponse.json({
        ok: true,
        done: true,
        fileId: done?.id || null,
        folderName: FOLDER_NAME,
        fileName: BACKUP_ZIP_NAME,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json({ ok: false, error: 'drive_unreachable' }, { status: 502 });
    }
  }

  // 小包整份代传(action 名保留 uploadGzip;按魔数写成 .zip 或 .json.gz,避免假 zip)。
  if (body?.action === 'uploadGzip') {
    const b64 = String(body.gzipBase64 || '');
    if (!b64) return NextResponse.json({ ok: false, error: 'no_backup' }, { status: 400 });
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_gzip' }, { status: 400 });
    }
    if (buf.length === 0 || buf.length > 3.6 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'too_large' }, { status: 413 });
    }
    const isZipMagic = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
    const isGzMagic = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    const outName = isZipMagic ? BACKUP_ZIP_NAME : isGzMagic ? BACKUP_GZ_NAME : BACKUP_ZIP_NAME;
    const outMime = isZipMagic ? 'application/zip' : isGzMagic ? 'application/gzip' : 'application/octet-stream';
    try {
      const folderId = await ensureBackupFolder(accessToken);
      if (folderId === 'insufficient_scope') return insufficientScope();
      const existing = await findInFolder(accessToken, folderId, [outName]);
      if (existing === 'insufficient_scope') return insufficientScope();
      const existingSame = existing?.name === outName ? existing : null;
      const boundary = 'nesio_drive_pack';
      const metadata = existingSame
        ? { name: outName }
        : { name: outName, parents: [folderId] };
      const multipart = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: ${outMime}\r\n\r\n`,
        ),
        buf,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const url = existingSame
        ? `${UPLOAD}/files/${existingSame.id}?uploadType=multipart&fields=id`
        : `${UPLOAD}/files?uploadType=multipart&fields=id`;
      const res = await fetch(url, {
        method: existingSame ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: new Uint8Array(multipart) as BodyInit,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (isScopeError(res.status, text)) return insufficientScope();
        return NextResponse.json({
          ok: false,
          error: `drive_upload_${res.status}`,
          detail: text.slice(0, 180),
        }, { status: 502 });
      }
      if (isZipMagic) await trashLegacyBackups(accessToken, folderId);
      await ensureReadme(accessToken, folderId);
      return NextResponse.json({
        ok: true,
        at: new Date().toISOString(),
        folderName: FOLDER_NAME,
        fileName: outName,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json({ ok: false, error: 'drive_unreachable' }, { status: 502 });
    }
  }

  const decoded = decodeBackupBody(body);
  if (!decoded.ok) {
    return NextResponse.json({ ok: false, error: decoded.error }, { status: decoded.status });
  }
  const payload = decoded.payload;

  try {
    const folderId = await ensureBackupFolder(accessToken);
    if (folderId === 'insufficient_scope') return insufficientScope();
    const existing = await findInFolder(accessToken, folderId, [BACKUP_NAME, BACKUP_GZ_NAME]);
    if (existing === 'insufficient_scope') return insufficientScope();
    // 小包仍写可见明文 JSON(便于在 Drive 里预览);大包走客户端 gzip 直传。
    const existingJson = existing?.name === BACKUP_NAME ? existing : null;
    const boundary = 'nesio_drive_boundary';
    const metadata = existingJson
      ? { name: BACKUP_NAME }
      : { name: BACKUP_NAME, parents: [folderId] };
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`;
    const url = existingJson
      ? `${UPLOAD}/files/${existingJson.id}?uploadType=multipart&fields=id`
      : `${UPLOAD}/files?uploadType=multipart&fields=id`;
    const res = await fetch(url, {
      method: existingJson ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (isScopeError(res.status, text)) return insufficientScope();
      return NextResponse.json({ ok: false, error: `drive_upload_${res.status}` }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      folderName: FOLDER_NAME,
      fileName: BACKUP_NAME,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'drive_unreachable' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const guard = await guardAiRoute(req, 'drive', { limit: 60 });
  if (guard) return guard;
  const accessToken = await resolveGmailAccessToken(req);
  if (!accessToken) return notConnected();
  try {
    const resolved = await resolveBackupFile(accessToken);
    if (!resolved.ok) return insufficientScope();
    if (!resolved.file) {
      return NextResponse.json({ ok: true, backup: null, folderName: FOLDER_NAME }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const res = await fetch(`${DRIVE}/files/${resolved.file.id}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (isScopeError(res.status, text)) return insufficientScope();
      return NextResponse.json({ ok: false, error: `drive_download_${res.status}` }, { status: 502 });
    }
    const buf = await res.arrayBuffer();
    const backup = await parseMediaBackup(buf, resolved.file.name);
    if (backup == null) {
      return NextResponse.json({ ok: false, error: 'invalid_backup' }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      backup,
      folderName: FOLDER_NAME,
      fileName: resolved.file.name,
      location: resolved.location,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'drive_unreachable' }, { status: 502 });
  }
}
