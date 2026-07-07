import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { buildUserDataExportResponse } from '@/lib/portal/app-api-contract-v0.mjs';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { envValue } from '@/lib/portal/env';

type SupabaseUserResponse = {
  id?: string;
};

type SupabaseTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

const CLOUD_PRODUCT_DATA_REST_PATHS = {
  user_profiles: '/rest/v1/user_profiles',
  profile_settings: '/rest/v1/profile_settings',
  memory_nodes: '/rest/v1/memory_nodes',
  memory_edges: '/rest/v1/memory_edges',
  memory_assets: '/rest/v1/memory_assets',
  product_events: '/rest/v1/product_events',
} as const;

type CloudProductDataTable = keyof typeof CLOUD_PRODUCT_DATA_REST_PATHS;
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
    resource: 'user_data_export',
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
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const anonKey = envValue('SUPABASE_ANON_KEY');
  const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  return {
    configured: enabled && Boolean(supabaseUrl && anonKey && serviceRoleKey),
    supabaseUrl,
    anonKey,
    serviceRoleKey,
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
  if (storagePath.startsWith('/') || storagePath.includes('..') || storagePath.includes('\\')) return false;
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

function collectStorageObjects({
  assets,
  profileSettings,
  identityKey,
}: {
  assets: unknown[];
  profileSettings: unknown[];
  identityKey: string;
}) {
  // Includes asset->>storagePath contract data without serializing temporary signed URLs.
  const assetRows = assets as CloudStoragePathRow[];
  const profileRows = profileSettings as CloudStoragePathRow[];
  return uniqueStoragePaths([
    ...assetRows.map((row) => storagePathFromJson(row.asset, 'storagePath', identityKey)),
    ...profileRows.map((row) => storagePathFromJson(row.settings, 'avatarStoragePath', identityKey)),
  ]);
}

async function readCloudRows(config: ReturnType<typeof getCloudConfig>, table: CloudProductDataTable, identityKey: string) {
  const url = new URL(CLOUD_PRODUCT_DATA_REST_PATHS[table], config.supabaseUrl);
  url.searchParams.set('identity_key', `eq.${identityKey}`);
  url.searchParams.set('select', '*');
  const response = await fetch(url.toString(), {
    headers: restHeaders(config),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase export read failed for ${table}: ${response.status}`);
  return response.json() as Promise<unknown[]>;
}

async function buildCloudUserDataExportResponse(auditId: string) {
  const config = getCloudConfig();
  if (!config.configured) {
    logCloudRuntimeAudit('cloud_runtime_failure', {
      auditId,
      reason: 'cloud_not_configured',
      readsCloud: false,
      writesCloud: false,
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
    });
    return null;
  }

  const [accountProfiles, profileSettings, nodes, edges, assets, productEvents] = await Promise.all([
    readCloudRows(config, 'user_profiles', cloudIdentity.identityKey),
    readCloudRows(config, 'profile_settings', cloudIdentity.identityKey),
    readCloudRows(config, 'memory_nodes', cloudIdentity.identityKey),
    readCloudRows(config, 'memory_edges', cloudIdentity.identityKey),
    readCloudRows(config, 'memory_assets', cloudIdentity.identityKey),
    readCloudRows(config, 'product_events', cloudIdentity.identityKey),
  ]);
  const storageObjects = collectStorageObjects({
    assets,
    profileSettings,
    identityKey: cloudIdentity.identityKey,
  });
  logCloudRuntimeAudit('cloud_runtime_success', {
    auditId,
    profileKind: 'cloud_profile',
    readsCloud: true,
    writesCloud: false,
    tableCount: 6,
    storageObjectCount: storageObjects.length,
  });

  return {
    body: {
      ok: true,
      auditId,
      endpoint: '/api/user-data/export',
      generatedAt: new Date().toISOString(),
      contract: 'api-contract-v0',
      exportKind: 'cloud-product-data-export',
      cloudExportKind: 'supabase-product-data-v1',
      profile: {
        profileId: cloudIdentity.identityKey,
        profileKind: 'cloud_profile',
        authProvider: cloudIdentity.provider,
        source: 'supabase',
      },
      includesRealUserData: true,
      readsCloud: true,
      writesCloud: false,
      storageObjects,
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
      payload: {
        accountProfiles,
        profileSettings,
        memoryNodes: nodes,
        memoryEdges: edges,
        memoryAssets: assets,
        productEvents,
        storageObjects,
      },
    },
    refreshedSession: userSession.refreshedSession,
  };
}

export async function GET() {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', {
    auditId,
    method: 'GET',
    readsCloud: true,
    writesCloud: false,
  });
  try {
    const cloudResponse = await buildCloudUserDataExportResponse(auditId);
    if (cloudResponse) {
      return setRefreshedAuthCookies(NextResponse.json(cloudResponse.body), cloudResponse.refreshedSession);
    }
  } catch (error) {
    logCloudRuntimeAudit('cloud_runtime_failure', {
      auditId,
      reason: 'cloud_export_failed',
      readsCloud: true,
      writesCloud: false,
    });
    return NextResponse.json(
      {
        ...buildUserDataExportResponse(),
        auditId,
        ok: false,
        error: 'cloud_export_failed',
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ...buildUserDataExportResponse(),
    auditId,
  });
}
