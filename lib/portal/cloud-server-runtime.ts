import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildProductionRuntimeStatus,
  normalizeSupabaseRuntimeUrl,
  type ProductionRuntimeSetupTask,
} from '@/lib/portal/production-runtime';
import {
  deriveCloudIdentity,
  type CloudIdentity,
} from '@/lib/portal/cloud-identity';
import { envValue } from '@/lib/portal/env';
import { AUTH_SIG_COOKIE, WECHAT_SIG_COOKIE, signSessionValue, verifiedWechatOpenid } from '@/lib/portal/auth/session-sig';
import { singleflightRefresh } from '@/lib/portal/auth/refresh-singleflight';

export { deriveCloudIdentity };
export type { CloudIdentity };

export type CloudRuntimeAuditEvent =
  | 'cloud_runtime_request'
  | 'cloud_runtime_success'
  | 'cloud_runtime_failure';

export type CloudRuntimeConfig = {
  configured: boolean;
  enabled: boolean;
  storageEnabled: boolean;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  storageBucket: string;
  bucket: string;
};

export type SupabaseUserResponse = {
  id?: string;
  email?: string;
  phone?: string;
  app_metadata?: {
    provider?: string;
    providers?: string[];
  };
  user_metadata?: {
    avatar_url?: string;
    email?: string;
    email_verified?: boolean;
    full_name?: string;
    name?: string;
    picture?: string;
    provider_id?: string;
    sub?: string;
  };
};

export type SupabaseTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

export function getCloudConfig(options: { storage?: boolean } = {}): CloudRuntimeConfig {
  const databaseEnabled = envValue('CLOUD_DB_ENABLED').toLowerCase() === 'true';
  const storageEnabled = envValue('CLOUD_STORAGE_ENABLED').toLowerCase() === 'true';
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const anonKey = envValue('SUPABASE_ANON_KEY');
  const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  const storageBucket = envValue('SUPABASE_STORAGE_BUCKET');
  const enabled = options.storage ? storageEnabled : databaseEnabled;
  const configured = enabled
    && Boolean(supabaseUrl && anonKey && serviceRoleKey)
    && (!options.storage || Boolean(storageBucket));

  return {
    configured,
    enabled,
    storageEnabled,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    storageBucket,
    bucket: storageBucket,
  };
}

export function getCloudDatabaseSetupTask(request?: NextRequest): ProductionRuntimeSetupTask | undefined {
  const status = buildProductionRuntimeStatus(process.env, {
    requestHost: request?.headers.get('host'),
  });
  return status.setupTaskMatrix.find(
    (task) => task.id === 'cloud_database' && task.category === 'cloud',
  );
}

export function getCloudStorageSetupTask(request?: NextRequest): ProductionRuntimeSetupTask | undefined {
  const status = buildProductionRuntimeStatus(process.env, {
    requestHost: request?.headers.get('host'),
  });
  return status.setupTaskMatrix.find(
    (task) => task.id === 'cloud_storage' && task.category === 'cloud',
  );
}

export function failClosedCloudJson(
  body: Record<string, unknown>,
  status = 200,
  defaults: Record<string, unknown> = {},
) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      ...defaults,
      ...body,
    },
    { status },
  );
}

export function createCloudRuntimeAuditId(prefix = 'cloud-runtime'): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function logCloudRuntimeAudit(
  event: CloudRuntimeAuditEvent,
  payload: Record<string, string | number | boolean | null>,
  options: { resource?: string } = {},
) {
  const safePayload = {
    resource: options.resource || payload.resource || 'cloud_runtime',
    ...payload,
  };
  if (event === 'cloud_runtime_failure') {
    console.warn(event, safePayload);
    return;
  }
  console.info(event, safePayload);
}

async function fetchSignedInUser(
  config: CloudRuntimeConfig,
  accessToken: string,
): Promise<SupabaseUserResponse | null> {
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

async function refreshSupabaseSession(
  config: CloudRuntimeConfig,
  refreshToken: string,
): Promise<SupabaseTokenResponse | null> {
  if (!refreshToken) return null;

  // 同进程单飞(与 /api/auth/session 共用 Map):access 过期后 session 刷新 + 云 API
  // 并行 refresh 会把旋转后的 refresh token 互踢失效。
  return singleflightRefresh(refreshToken, async () => {
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
  });
}

export function setRefreshedAuthCookies(response: NextResponse, session?: SupabaseTokenResponse | null) {
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
    const sig = signSessionValue(session.refresh_token); // 安全审计 #8:refresh 配套签名
    if (sig) response.cookies.set(AUTH_SIG_COOKIE, sig, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30 });
  }
  return response;
}

export async function getSignedInUser(config: CloudRuntimeConfig): Promise<{
  user: SupabaseUserResponse | null;
  refreshedSession: SupabaseTokenResponse | null;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || '';
  const refreshToken = cookieStore.get('baohe_auth_refresh')?.value || '';
  const authProvider = cookieStore.get('baohe_auth_provider')?.value || '';
  // 数据审计 P0:openid 必须验签才认(伪造 openid 越权)。verifiedWechatOpenid 无合法签名返回 ''。
  const wechatOpenid = verifiedWechatOpenid(cookieStore.get('baohe_wechat_openid')?.value, cookieStore.get(WECHAT_SIG_COOKIE)?.value);
  const user = await fetchSignedInUser(config, accessToken);
  if (user?.id) return { user, refreshedSession: null };

  const refreshedSession = await refreshSupabaseSession(config, refreshToken);
  const refreshedUser = await fetchSignedInUser(config, refreshedSession?.access_token || '');
  if (refreshedUser?.id) {
    return { user: refreshedUser, refreshedSession };
  }

  // wechatOpenid 已验签(伪造 openid → 上面为 ''),这里只在验真通过时才生成 identityKey。
  if (authProvider === 'wechat' && wechatOpenid) {
    return {
      user: {
        id: `wechat_openid:${wechatOpenid}`,
        app_metadata: { provider: 'wechat', providers: ['wechat'] },
      },
      refreshedSession: null,
    };
  }

  return { user: null, refreshedSession: null };
}

export function serviceRoleRestHeaders(config: CloudRuntimeConfig, extra: Record<string, string> = {}) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
    accept: 'application/json',
    ...extra,
  };
}

export function serviceRoleStorageHeaders(
  config: CloudRuntimeConfig,
  contentType = 'application/octet-stream',
  extra: Record<string, string> = {},
) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': contentType,
    'x-upsert': 'false',
    ...extra,
  };
}

export function normalizeSignedStorageUrl(config: CloudRuntimeConfig, signedUrl: string): string {
  if (signedUrl.startsWith('http://') || signedUrl.startsWith('https://')) {
    return signedUrl;
  }
  if (signedUrl.startsWith('/')) {
    // Supabase 返回的 signedURL 形如 /object/sign/<bucket>/<path>?token=... —— 相对 storage
    // API 根,需补 /storage/v1 段。此前直接拼 supabaseUrl 丢了这段 → 生产 GET 404 → 物品图
    // 破图「?」。已含 /storage/v1 的则原样返回,避免重复。
    const path = signedUrl.replace(/^\/+/, '');
    const withPrefix = path.startsWith('storage/v1/') ? path : `storage/v1/${path}`;
    return `${config.supabaseUrl}/${withPrefix}`;
  }
  return `${config.supabaseUrl}/storage/v1/${signedUrl.replace(/^\/+/, '')}`;
}

export async function createSignedAssetUrl(
  config: CloudRuntimeConfig,
  storagePath: string,
  expiresIn: number,
): Promise<string | null> {
  const signUrl = new URL(`/storage/v1/object/sign/${config.storageBucket}/${storagePath}`, config.supabaseUrl);
  const response = await fetch(signUrl.toString(), {
    method: 'POST',
    headers: serviceRoleRestHeaders(config),
    body: JSON.stringify({ expiresIn }),
    cache: 'no-store',
  });

  if (!response.ok) return null;
  const payload = await response.json() as { signedURL?: string; signedUrl?: string };
  const signedUrl = payload.signedURL || payload.signedUrl;
  return signedUrl ? normalizeSignedStorageUrl(config, signedUrl) : null;
}

export interface StorageObjectEntry {
  name: string;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: { size?: number | null } | null;
}

/**
 * 列出某前缀下的存储对象(service-role)。用于「按账号找最新备份」——
 * 换浏览器登录后并不知道备份那串带时间戳的路径,靠这个列出 {identity}/backup/ 下全部对象、
 * 由调用方挑最新那份。前缀始终由服务端按**已鉴权身份**拼接(绝不接受用户传入路径),
 * 天然身份隔离,拿不到别人的备份。失败(未配置/网络/响应非数组)一律返回空数组,
 * 调用方据此走 found:false —— 与「无备份」同态,不谎称错误。
 */
export async function listStorageObjects(
  config: CloudRuntimeConfig,
  prefix: string,
  opts: { limit?: number } = {},
): Promise<StorageObjectEntry[]> {
  const listUrl = new URL(`/storage/v1/object/list/${config.storageBucket}`, config.supabaseUrl);
  const response = await fetch(listUrl.toString(), {
    method: 'POST',
    headers: serviceRoleRestHeaders(config),
    body: JSON.stringify({
      prefix,
      limit: opts.limit ?? 100,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' },
    }),
    cache: 'no-store',
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload)) return [];
  return payload as StorageObjectEntry[];
}
