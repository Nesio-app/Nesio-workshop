import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { buildUserDataDeleteResponse } from '@/lib/portal/contracts/app-api-contract-v0.mjs';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { envValue } from '@/lib/portal/env';
import { AUTH_SIG_COOKIE, signSessionValue } from '@/lib/portal/auth/session-sig';

type SupabaseUserResponse = {
  id?: string;
};

type SupabaseTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

const CLOUD_PRODUCT_DATA_TABLES = ['user_profiles', 'profile_settings', 'memory_nodes', 'memory_edges', 'memory_assets', 'product_events'] as const;
const CLOUD_PRODUCT_DATA_REST_PATHS = {
  user_profiles: '/rest/v1/user_profiles',
  profile_settings: '/rest/v1/profile_settings',
  memory_nodes: '/rest/v1/memory_nodes',
  memory_edges: '/rest/v1/memory_edges',
  memory_assets: '/rest/v1/memory_assets',
  product_events: '/rest/v1/product_events',
} as const;

type CloudProductDataTable = (typeof CLOUD_PRODUCT_DATA_TABLES)[number];
type CloudStoragePathRow = {
  asset?: unknown;
  settings?: unknown;
};

type CloudRuntimeAuditEvent = 'cloud_runtime_request' | 'cloud_runtime_success' | 'cloud_runtime_failure';

function createCloudRuntimeAuditId(): string {
  return `cloud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function logCloudRuntimeAudit(event: CloudRuntimeAuditEvent, details: Record<string, unknown>) {
  const payload = {
    event,
    service: 'product-data-backend-v1',
    resource: 'user_data_delete',
    ...details,
  };
  if (event === 'cloud_runtime_failure') {
    console.warn('[cloud-runtime]', payload);
    return;
  }
  console.info('[cloud-runtime]', payload);
}

function getCloudConfig() {
  const enabled = envValue('CLOUD_DB_ENABLED').toLowerCase() === 'true';
  const storageEnabled = envValue('CLOUD_STORAGE_ENABLED').toLowerCase() === 'true';
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const anonKey = envValue('SUPABASE_ANON_KEY');
  const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  const storageBucket = envValue('SUPABASE_STORAGE_BUCKET');
  return {
    configured: enabled && Boolean(supabaseUrl && anonKey && serviceRoleKey),
    storageConfigured: storageEnabled && Boolean(supabaseUrl && serviceRoleKey && storageBucket),
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    storageBucket,
  };
}

async function fetchSignedInUser(config: ReturnType<typeof getCloudConfig>, accessToken: string): Promise<SupabaseUserResponse | null> {
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

async function refreshSupabaseSession(config: ReturnType<typeof getCloudConfig>, refreshToken: string): Promise<SupabaseTokenResponse | null> {
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
    const sig = signSessionValue(session.refresh_token); // 安全审计 #8:refresh 配套签名
    if (sig) response.cookies.set(AUTH_SIG_COOKIE, sig, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30 });
  }
  return response;
}

async function getSignedInUser(config: ReturnType<typeof getCloudConfig>): Promise<{
  user: SupabaseUserResponse | null;
  refreshedSession: SupabaseTokenResponse | null;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || '';
  const refreshToken = cookieStore.get('baohe_auth_refresh')?.value || '';
  const user = await fetchSignedInUser(config, accessToken);
  if (user?.id) return { user, refreshedSession: null };
  const refreshedSession = await refreshSupabaseSession(config, refreshToken);
  const refreshedUser = await fetchSignedInUser(config, refreshedSession?.access_token || '');
  if (refreshedUser?.id) {
    return { user: refreshedUser, refreshedSession };
  }
  return { user: null, refreshedSession: null };
}

function restHeaders(config: ReturnType<typeof getCloudConfig>) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    accept: 'application/json',
  };
}

function safePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asset';
}

function isStoragePathOwnedByIdentity(storagePath: string, identityKey: string): boolean {
  const identitySegment = safePathSegment(identityKey);
  if (!storagePath || storagePath.length > 600) return false;
  if (storagePath.startsWith('/') || storagePath.includes('..') || storagePath.includes('\\')) {
    return false;
  }
  return storagePath.startsWith(`${identitySegment}/`);
}

function normalizeStoragePath(value: unknown, identityKey: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isStoragePathOwnedByIdentity(trimmed, identityKey) ? trimmed : null;
}

function storagePathFromJson(value: unknown, key: 'storagePath' | 'avatarStoragePath', identityKey: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return normalizeStoragePath(record[key] || record.storage_path || record.avatar_storage_path, identityKey);
}

function uniqueStoragePaths(paths: Array<string | null>): string[] {
  return Array.from(new Set(paths.filter((path): path is string => Boolean(path))));
}

async function readCloudAssetStoragePaths(config: ReturnType<typeof getCloudConfig>, identityKey: string) {
  const url = new URL('/rest/v1/memory_assets', config.supabaseUrl);
  url.searchParams.set('identity_key', `eq.${identityKey}`);
  url.searchParams.set('select', 'asset'); // Includes asset->>storagePath contract data.
  const response = await fetch(url.toString(), {
    headers: restHeaders(config),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase storage path read failed for memory_assets: ${response.status}`);
  const rows = (await response.json()) as CloudStoragePathRow[];
  return uniqueStoragePaths(rows.map((row) => storagePathFromJson(row.asset, 'storagePath', identityKey)));
}

async function readCloudAvatarStoragePaths(config: ReturnType<typeof getCloudConfig>, identityKey: string) {
  const url = new URL('/rest/v1/profile_settings', config.supabaseUrl);
  url.searchParams.set('identity_key', `eq.${identityKey}`);
  url.searchParams.set('select', 'settings');
  url.searchParams.set('limit', '1');
  const response = await fetch(url.toString(), {
    headers: restHeaders(config),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase storage path read failed for profile_settings: ${response.status}`);
  const rows = (await response.json()) as CloudStoragePathRow[];
  return uniqueStoragePaths(rows.map((row) => storagePathFromJson(row.settings, 'avatarStoragePath', identityKey)));
}

function storageObjectUrl(config: ReturnType<typeof getCloudConfig>, storagePath: string) {
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  return new URL(`/storage/v1/object/${config.storageBucket}/${encodedPath}`, config.supabaseUrl);
}

async function deleteCloudStorageObjects(config: ReturnType<typeof getCloudConfig>, storagePaths: string[]) {
  for (const storagePath of storagePaths) {
    const response = await fetch(storageObjectUrl(config, storagePath).toString(), {
      method: 'DELETE',
      headers: restHeaders(config),
      cache: 'no-store',
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Supabase Storage object delete failed: ${response.status}`);
    }
  }
}

async function countCloudRows(config: ReturnType<typeof getCloudConfig>, table: CloudProductDataTable, identityKey: string) {
  const url = new URL(CLOUD_PRODUCT_DATA_REST_PATHS[table], config.supabaseUrl);
  url.searchParams.set('identity_key', `eq.${identityKey}`);
  url.searchParams.set('select', '*');
  const response = await fetch(url.toString(), {
    method: 'HEAD',
    headers: {
      ...restHeaders(config),
      Prefer: 'count=exact',
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase delete count failed for ${table}: ${response.status}`);
  return Number(response.headers.get('content-range')?.split('/')?.[1] || 0);
}

async function deleteCloudRows(config: ReturnType<typeof getCloudConfig>, table: CloudProductDataTable, identityKey: string) {
  const url = new URL(CLOUD_PRODUCT_DATA_REST_PATHS[table], config.supabaseUrl);
  url.searchParams.set('identity_key', `eq.${identityKey}`);
  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: restHeaders(config),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase delete failed for ${table}: ${response.status}`);
}

async function buildCloudUserDataDeleteResponse({
  dryRun,
  confirmation,
  auditId,
}: {
  dryRun: boolean;
  confirmation?: string;
  auditId: string;
}) {
  const config = getCloudConfig();
  if (!config.configured) {
    logCloudRuntimeAudit('cloud_runtime_failure', {
      auditId,
      reason: 'cloud_not_configured',
      readsCloud: false,
      writesCloud: false,
      dryRun,
    });
    return null;
  }
  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', {
      auditId,
      reason: 'not_signed_in',
      readsCloud: false,
      writesCloud: false,
      dryRun,
    });
    // 云已配置但会话过期/未登录:真删除绝不能落进本地 mock 假成功
    //(合规级「以为删了其实云端一条没删」)。dryRun 预览可降级为本地。
    return dryRun ? null : { authRequired: true as const };
  }
  const withRefreshedSession = <T extends Record<string, unknown>>(body: T) => ({
    body,
    refreshedSession: userSession.refreshedSession,
  });

  const counts = Object.fromEntries(
    await Promise.all(CLOUD_PRODUCT_DATA_TABLES.map(async (table) => [table, await countCloudRows(config, table, cloudIdentity.identityKey)])),
  ) as Record<CloudProductDataTable, number>;
  const storageObjects = uniqueStoragePaths([
    ...(await readCloudAssetStoragePaths(config, cloudIdentity.identityKey)),
    ...(await readCloudAvatarStoragePaths(config, cloudIdentity.identityKey)),
  ]);
  const storageDeletionReady = config.storageConfigured || storageObjects.length === 0;

  const hasProductDataConfirmation = confirmation === 'DELETE_CLOUD_PRODUCT_DATA';

  if (!dryRun && !hasProductDataConfirmation) {
    logCloudRuntimeAudit('cloud_runtime_failure', {
      auditId,
      reason: 'confirmation_required',
      readsCloud: true,
      writesCloud: false,
      dryRun,
      storageObjectCount: storageObjects.length,
    });
    return withRefreshedSession({
      ok: false,
      auditId,
      error: 'confirmation_required',
      endpoint: '/api/user-data/delete',
      generatedAt: new Date().toISOString(),
      contract: 'api-contract-v0',
      deleteKind: 'cloud-product-data-delete',
      cloudDeleteKind: 'supabase-product-data-v1',
      dryRun,
      deletesRealUserData: false,
      deletesCloudData: false,
      readsCloud: true,
      writesCloud: false,
      storageObjects,
      storageDeletionReady,
      deletesCloudStorage: false,
      boundaries: {
        implementation: 'supabase-cloud-v1',
        dataSource: 'supabase-postgres-storage',
        readsRealUserData: true,
        writesRealUserData: false,
        usesRealAuth: true,
        writesCloud: false,
        writesNotion: false,
        authorizesExternalServices: false,
        productionDataAccess: true,
      },
      deleted: [],
      wouldDelete: [
        ...Object.entries(counts).map(([table, count]) => `${table}:${count}`),
        `storage_objects:${storageObjects.length}`,
      ],
    });
  }

  if (!dryRun) {
    if (!storageDeletionReady) {
      logCloudRuntimeAudit('cloud_runtime_failure', {
        auditId,
        reason: 'storage_bucket_required',
        readsCloud: true,
        writesCloud: false,
        dryRun,
        storageObjectCount: storageObjects.length,
      });
      return withRefreshedSession({
        ok: false,
        auditId,
        error: 'storage_bucket_required',
        endpoint: '/api/user-data/delete',
        generatedAt: new Date().toISOString(),
        contract: 'api-contract-v0',
        deleteKind: 'cloud-product-data-delete',
        cloudDeleteKind: 'supabase-product-data-v1',
        dryRun,
        deletesRealUserData: false,
        deletesCloudData: false,
        deletesCloudStorage: false,
        readsCloud: true,
        writesCloud: false,
        storageObjects,
        storageDeletionReady,
        boundaries: {
          implementation: 'supabase-cloud-v1',
          dataSource: 'supabase-postgres-storage',
          readsRealUserData: true,
          writesRealUserData: false,
          usesRealAuth: true,
          writesCloud: false,
          writesNotion: false,
          authorizesExternalServices: false,
          productionDataAccess: true,
        },
        deleted: [],
        wouldDelete: [
          ...Object.entries(counts).map(([table, count]) => `${table}:${count}`),
          `storage_objects:${storageObjects.length}`,
        ],
      });
    }
    await deleteCloudStorageObjects(config, storageObjects);
    for (const table of CLOUD_PRODUCT_DATA_TABLES) {
      await deleteCloudRows(config, table, cloudIdentity.identityKey);
    }
  }
  logCloudRuntimeAudit('cloud_runtime_success', {
    auditId,
    profileKind: 'cloud_profile',
    readsCloud: true,
    writesCloud: !dryRun,
    dryRun,
    tableCount: CLOUD_PRODUCT_DATA_TABLES.length,
    storageObjectCount: storageObjects.length,
  });

  return withRefreshedSession({
    ok: true,
    auditId,
    endpoint: '/api/user-data/delete',
    generatedAt: new Date().toISOString(),
    contract: 'api-contract-v0',
    deleteKind: 'cloud-product-data-delete',
    cloudDeleteKind: 'supabase-product-data-v1',
    dryRun,
    cloudDeleteExecution: {
      writesCloud: true,
      deletesCloudStorage: true,
      confirmationRequired: 'DELETE_CLOUD_PRODUCT_DATA',
    },
    profile: {
      profileId: cloudIdentity.identityKey,
      profileKind: 'cloud_profile',
      authProvider: cloudIdentity.provider,
      source: 'supabase',
    },
    deletesRealUserData: !dryRun,
    deletesCloudData: true,
    deletesCloudStorage: !dryRun,
    readsCloud: true,
    writesCloud: !dryRun,
    storageObjects,
    storageDeletionReady,
    boundaries: {
      implementation: 'supabase-cloud-v1',
      dataSource: 'supabase-postgres-storage',
      readsRealUserData: true,
      writesRealUserData: !dryRun,
      usesRealAuth: true,
      writesCloud: !dryRun,
      writesNotion: false,
      authorizesExternalServices: false,
      productionDataAccess: true,
    },
    deleted: dryRun ? [] : [...Object.keys(counts), 'storage_objects'],
    wouldDelete: [
      ...Object.entries(counts).map(([table, count]) => `${table}:${count}`),
      `storage_objects:${storageObjects.length}`,
    ],
  });
}

export async function POST(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  const dryRun = request.nextUrl.searchParams.get('dryRun') !== '0';
  logCloudRuntimeAudit('cloud_runtime_request', {
    auditId,
    method: 'POST',
    readsCloud: true,
    writesCloud: !dryRun,
    dryRun,
  });
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const confirmation = body && typeof body === 'object' && !Array.isArray(body)
    ? String((body as Record<string, unknown>).confirmation || '')
    : '';

  try {
    const cloudResponse = await buildCloudUserDataDeleteResponse({ dryRun, confirmation, auditId });
    if (cloudResponse) {
      if ('authRequired' in cloudResponse) {
        // 云已配置但未登录:真删除返回 401 auth_required,绝不谎称删除成功
        return NextResponse.json(
          { auditId, ok: false, error: 'auth_required', requiresSignIn: true, dryRun: false },
          { status: 401 },
        );
      }
      return setRefreshedAuthCookies(NextResponse.json(cloudResponse.body, { status: cloudResponse.body.ok ? 200 : 400 }), cloudResponse.refreshedSession);
    }
  } catch (error) {
    logCloudRuntimeAudit('cloud_runtime_failure', {
      auditId,
      reason: 'cloud_delete_failed',
      readsCloud: true,
      writesCloud: !dryRun,
      dryRun,
    });
    return NextResponse.json(
      {
        ...buildUserDataDeleteResponse({ dryRun: true }),
        auditId,
        ok: false,
        error: 'cloud_delete_failed',
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ...buildUserDataDeleteResponse({ dryRun: true }),
    auditId,
  });
}
