import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildProductionRuntimeStatus,
  normalizeSupabaseRuntimeUrl,
  type ProductionRuntimeSetupTask,
} from '@/lib/portal/production-runtime';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  phone?: string;
};

type SupabaseTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

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

function envValue(key: string): string {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

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
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `cloud-asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logCloudRuntimeAudit(
  event: 'cloud_runtime_request' | 'cloud_runtime_success' | 'cloud_runtime_failure',
  payload: Record<string, string | number | boolean | null>,
) {
  const safePayload = {
    resource: 'cloud_assets',
    ...payload,
  };
  if (event === 'cloud_runtime_failure') {
    console.warn(event, safePayload);
    return;
  }
  console.info(event, safePayload);
}

function getCloudStorageConfig() {
  const enabled = envValue('CLOUD_STORAGE_ENABLED').toLowerCase() === 'true';
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const anonKey = envValue('SUPABASE_ANON_KEY');
  const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  const bucket = envValue('SUPABASE_STORAGE_BUCKET');
  const configured = enabled && Boolean(supabaseUrl && anonKey && serviceRoleKey && bucket);

  return {
    configured,
    enabled,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    bucket,
  };
}

function getCloudStorageSetupTask(request?: NextRequest): ProductionRuntimeSetupTask | undefined {
  const status = buildProductionRuntimeStatus(process.env, {
    requestHost: request?.headers.get('host'),
  });
  return status.setupTaskMatrix.find(
    (task) => task.id === 'cloud_storage' && task.category === 'cloud',
  );
}

async function fetchSignedInUser(config: ReturnType<typeof getCloudStorageConfig>, accessToken: string): Promise<SupabaseUserResponse | null> {
  if (!accessToken) return null;

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) return null;
  return response.json() as Promise<SupabaseUserResponse>;
}

async function refreshSupabaseSession(config: ReturnType<typeof getCloudStorageConfig>, refreshToken: string): Promise<SupabaseTokenResponse | null> {
  if (!refreshToken) return null;

  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: 'no-store',
  });

  if (!response.ok) return null;
  return response.json() as Promise<SupabaseTokenResponse>;
}

function setRefreshedAuthCookies(response: NextResponse, session?: SupabaseTokenResponse | null) {
  if (!session?.access_token) return response;
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = Number.isFinite(session.expires_in) && session.expires_in ? session.expires_in : 60 * 60;
  response.cookies.set('baohe_auth_access', session.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });
  if (session.refresh_token) {
    response.cookies.set('baohe_auth_refresh', session.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return response;
}

async function getSignedInUser(config: ReturnType<typeof getCloudStorageConfig>): Promise<{
  user: SupabaseUserResponse | null;
  refreshedSession: SupabaseTokenResponse | null;
}> {
  const cookieStore = cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || '';
  const refreshToken = cookieStore.get('baohe_auth_refresh')?.value || '';
  const authProvider = cookieStore.get('baohe_auth_provider')?.value || '';
  const wechatOpenid = cookieStore.get('baohe_wechat_openid')?.value || '';
  const user = await fetchSignedInUser(config, accessToken);
  if (user?.id) return { user, refreshedSession: null };

  const refreshedSession = await refreshSupabaseSession(config, refreshToken);
  const refreshedUser = await fetchSignedInUser(config, refreshedSession?.access_token || '');
  if (refreshedUser?.id) {
    return { user: refreshedUser, refreshedSession };
  }

  if (authProvider === 'wechat' && wechatOpenid) {
    return {
      user: {
        id: `wechat_openid:${wechatOpenid}`,
      },
      refreshedSession: null,
    };
  }

  return { user: null, refreshedSession: null };
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
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': contentType,
    'x-upsert': 'false',
  };
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
  if (signedUrl.startsWith('http://') || signedUrl.startsWith('https://')) {
    return signedUrl;
  }
  if (signedUrl.startsWith('/')) {
    return `${config.supabaseUrl}${signedUrl}`;
  }
  return `${config.supabaseUrl}/storage/v1/${signedUrl.replace(/^\/+/, '')}`;
}

async function createSignedAssetUrl(
  config: ReturnType<typeof getCloudStorageConfig>,
  storagePath: string,
  expiresIn: number,
): Promise<string | null> {
  const signUrl = new URL(`/storage/v1/object/sign/${config.bucket}/${storagePath}`, config.supabaseUrl);
  const response = await fetch(signUrl.toString(), {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
    cache: 'no-store',
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as { signedURL?: string; signedUrl?: string };
  const signedUrl = payload.signedURL || payload.signedUrl;
  return signedUrl ? normalizeSignedStorageUrl(config, signedUrl) : null;
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
