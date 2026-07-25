import { NextRequest, NextResponse } from 'next/server';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import * as cloudRuntime from '@/lib/portal/cloud-server-runtime';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const allowedAssetMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'audio/mpeg',
  'audio/mp4',
  'audio/webm',
  'audio/wav',
  'application/pdf',
  'text/plain',
]);

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      ...body,
    },
    { status },
  );
}

function createCloudRuntimeAuditId(): string {
  return cloudRuntime.createCloudRuntimeAuditId('cloud-asset');
}

function logCloudRuntimeAudit(
  event: 'cloud_runtime_request' | 'cloud_runtime_success' | 'cloud_runtime_failure',
  payload: Record<string, string | number | boolean | null>,
) {
  cloudRuntime.logCloudRuntimeAudit(event, payload, { resource: 'cloud_assets' });
}

function getCloudStorageConfig() {
  return cloudRuntime.getCloudConfig({ storage: true });
}

function getCloudStorageSetupTask(request?: NextRequest) {
  return cloudRuntime.getCloudStorageSetupTask(request);
}

type CloudUserSession = Awaited<ReturnType<typeof cloudRuntime.getSignedInUser>>;

function setRefreshedAuthCookies(response: NextResponse, session?: CloudUserSession['refreshedSession']) {
  return cloudRuntime.setRefreshedAuthCookies(response, session);
}

async function getSignedInUser(config: ReturnType<typeof getCloudStorageConfig>) {
  return cloudRuntime.getSignedInUser(config);
}

function sanitizeString(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function safePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asset';
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'image/heif') return 'heif';
  if (mimeType === 'audio/mpeg') return 'mp3';
  if (mimeType === 'audio/mp4') return 'm4a';
  if (mimeType === 'audio/webm') return 'webm';
  if (mimeType === 'audio/wav') return 'wav';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'txt';
}

function storageHeaders(config: ReturnType<typeof getCloudStorageConfig>, contentType: string) {
  return cloudRuntime.serviceRoleStorageHeaders(config, contentType, { 'x-upsert': 'false' });
}

function pickLatestBackupObject(
  objects: cloudRuntime.StorageObjectEntry[],
): cloudRuntime.StorageObjectEntry | null {
  const valid = objects.filter(
    (o) => o && typeof o.name === 'string' && o.name && o.name !== '.emptyFolderPlaceholder' && o.id !== null,
  );
  if (valid.length === 0) return null;
  // created_at 倒序挑最新;并列(或缺 created_at)时按 name 倒序兜底 —— 上传路径嵌
  // `${Date.now()}-${uuid}`,13 位毫秒戳在同世纪内字典序即时间序,足够定位最新那份。
  valid.sort((a, b) => {
    const ta = a.created_at || '';
    const tb = b.created_at || '';
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.name < b.name ? 1 : -1;
  });
  return valid[0];
}

function isStoragePathOwnedByIdentity(storagePath: string, identityKey: string): boolean {
  const identitySegment = safePathSegment(identityKey);
  if (!storagePath || storagePath.length > 600) return false;
  if (storagePath.startsWith('/') || storagePath.includes('..') || storagePath.includes('\\')) {
    return false;
  }
  return storagePath.startsWith(`${identitySegment}/`);
}

function normalizeSignedStorageUrl(config: ReturnType<typeof getCloudStorageConfig>, signedUrl: string): string {
  return cloudRuntime.normalizeSignedStorageUrl(config, signedUrl);
}

async function createSignedAssetUrl(
  config: ReturnType<typeof getCloudStorageConfig>,
  storagePath: string,
  expiresIn: number,
): Promise<string | null> {
  return cloudRuntime.createSignedAssetUrl(config, storagePath, expiresIn);
}

export async function GET(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'GET', readsCloud: true, writesCloud: false });
  const config = getCloudStorageConfig();
  if (!config.configured) {
    const setupTask = getCloudStorageSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_storage_not_configured' });
    return safeJson({ ok: false, cloudAssetRead: true, error: 'cloud_storage_not_configured', auditId, setupTask, readsCloud: false, writesCloud: false }, 503);
  }

  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'not_signed_in' });
    return safeJson({ ok: false, cloudAssetRead: true, error: 'not_signed_in', auditId, readsCloud: false, writesCloud: false }, 401);
  }

  // 「按账号找最新备份」模式(交接清单 ①,跨浏览器同步命门):新浏览器不知道备份那串带
  // 时间戳的路径,这里列出登录用户 {identity}/backup/ 下全部对象、挑最新那份、直接回签名读 URL。
  // 前缀由服务端按已鉴权身份拼(不接受用户传路径),天然隔离。云端确实没备份 → found:false(非错误)。
  const listMode = sanitizeString(request.nextUrl.searchParams.get('list'), 40);
  if (listMode === 'backup') {
    const identitySegment = safePathSegment(cloudIdentity.identityKey);
    const backupPrefix = `${identitySegment}/backup/`;
    const listExpiresIn = 60 * 10;
    try {
      const objects = await cloudRuntime.listStorageObjects(config, backupPrefix, { limit: 100 });
      const latest = pickLatestBackupObject(objects);
      if (!latest) {
        logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'GET', readsCloud: true, writesCloud: false });
        return setRefreshedAuthCookies(safeJson({
          ok: true, cloudBackupList: true, found: false, auditId, readsCloud: true, writesCloud: false,
        }), userSession.refreshedSession);
      }
      const latestPath = `${backupPrefix}${latest.name}`;
      const signedUrl = await createSignedAssetUrl(config, latestPath, listExpiresIn);
      if (!signedUrl) throw new Error('Supabase Storage signed URL failed');
      logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'GET', readsCloud: true, writesCloud: false });
      return setRefreshedAuthCookies(safeJson({
        ok: true,
        cloudBackupList: true,
        found: true,
        auditId,
        readsCloud: true,
        writesCloud: false,
        storagePath: latestPath,
        signedUrl,
        expiresIn: listExpiresIn,
        createdAt: latest.created_at ?? null,
      }), userSession.refreshedSession);
    } catch {
      logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_asset_read_failed' });
      return setRefreshedAuthCookies(safeJson({ ok: false, cloudBackupList: true, error: 'cloud_asset_read_failed', auditId, readsCloud: false, writesCloud: false }, 502), userSession.refreshedSession);
    }
  }

  const storagePath = sanitizeString(request.nextUrl.searchParams.get('storagePath'), 600);
  if (!storagePath) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'missing_storage_path' });
    return setRefreshedAuthCookies(safeJson({ ok: false, cloudAssetRead: true, error: 'missing_storage_path', auditId, readsCloud: false, writesCloud: false }, 400), userSession.refreshedSession);
  }

  if (!isStoragePathOwnedByIdentity(storagePath, cloudIdentity.identityKey)) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'forbidden_storage_path' });
    return setRefreshedAuthCookies(safeJson({ ok: false, cloudAssetRead: true, error: 'forbidden_storage_path', auditId, readsCloud: false, writesCloud: false }, 403), userSession.refreshedSession);
  }

  const expiresIn = 60 * 10;
  try {
    const signedUrl = await createSignedAssetUrl(config, storagePath, expiresIn);
    if (!signedUrl) throw new Error('Supabase Storage signed URL failed');
    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'GET', readsCloud: true, writesCloud: false });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      cloudAssetRead: true,
      auditId,
      readsCloud: true,
      writesCloud: false,
      storagePath,
      signedUrl,
      expiresIn,
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_asset_read_failed' });
    return setRefreshedAuthCookies(safeJson({ ok: false, cloudAssetRead: true, error: 'cloud_asset_read_failed', auditId, readsCloud: false, writesCloud: false }, 502), userSession.refreshedSession);
  }
}

export async function POST(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'POST', readsCloud: false, writesCloud: true });
  const config = getCloudStorageConfig();
  if (!config.configured) {
    const setupTask = getCloudStorageSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'cloud_storage_not_configured' });
    return safeJson({ ok: false, cloudAssetUpload: true, error: 'cloud_storage_not_configured', auditId, setupTask, readsCloud: false, writesCloud: false }, 503);
  }

  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'not_signed_in' });
    return safeJson({ ok: false, cloudAssetUpload: true, error: 'not_signed_in', auditId, readsCloud: false, writesCloud: false }, 401);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'invalid_form_data' });
    return safeJson({ ok: false, cloudAssetUpload: true, error: 'invalid_form_data', auditId, readsCloud: false, writesCloud: false }, 400);
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'invalid_form_data' });
    return safeJson({ ok: false, cloudAssetUpload: true, error: 'invalid_form_data', auditId, readsCloud: false, writesCloud: false }, 400);
  }
  if (!allowedAssetMimeTypes.has(file.type)) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'unsupported_file_type' });
    return safeJson({ ok: false, cloudAssetUpload: true, error: 'unsupported_file_type', auditId, readsCloud: false, writesCloud: false }, 415);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'file_too_large' });
    return safeJson({ ok: false, cloudAssetUpload: true, error: 'file_too_large', auditId, readsCloud: false, writesCloud: false, maxBytes: MAX_UPLOAD_BYTES }, 413);
  }

  const purpose = safePathSegment(sanitizeString(formData.get('purpose'), 40) || 'memory');
  const identitySegment = safePathSegment(cloudIdentity.identityKey);
  const originalName = safePathSegment(file.name || 'upload');
  const ext = extensionFromMime(file.type);
  const storagePath = `${identitySegment}/${purpose}/${Date.now()}-${globalThis.crypto.randomUUID()}.${originalName}.${ext}`;
  const uploadUrl = new URL(`/storage/v1/object/${config.bucket}/${storagePath}`, config.supabaseUrl);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const uploadResponse = await fetch(uploadUrl.toString(), {
      method: 'POST',
      headers: storageHeaders(config, file.type),
      body: arrayBuffer,
      cache: 'no-store',
    });
    if (!uploadResponse.ok) throw new Error('Supabase Storage upload failed');

    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'POST', readsCloud: false, writesCloud: true, size: file.size });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      cloudAssetUpload: true,
      auditId,
      readsCloud: false,
      writesCloud: true,
      storagePath,
      requiresSignedUrl: true,
      mimeType: file.type,
      size: file.size,
      purpose,
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'cloud_asset_upload_failed' });
    return safeJson({ ok: false, cloudAssetUpload: true, error: 'cloud_asset_upload_failed', auditId, readsCloud: false, writesCloud: false }, 502);
  }
}
