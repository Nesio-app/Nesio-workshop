import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildProductionRuntimeStatus,
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

type CloudInventoryItem = {
  id: string;
  schemaVersion: 'LocalInventoryItem@v1';
  name: string;
  category?: string;
  locationHint?: string;
  notes?: string;
  purchaseMemory?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  mode: 'personal';
};

const LOCAL_INVENTORY_ITEM_SCHEMA_VERSION = 'LocalInventoryItem@v1';

const allowedInventoryItemKeys = [
  'id',
  'schemaVersion',
  'name',
  'category',
  'locationHint',
  'notes',
  'purchaseMemory',
  'createdAt',
  'updatedAt',
  'mode',
] as const;

const allowedPurchaseMemoryKeys = ['purchasedAt', 'reason', 'worthIt', 'memoryNote'] as const;
const forbiddenPurchaseMemoryKeys = [
  'paymentMethod',
  'receiptImport',
  'bankAccount',
  'cardLast4',
  'financialAdvice',
  'merchantAuthorization',
  'budgetRecommendation',
  'creditScore',
] as const;

function envValue(key: string): string {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      cloudInventorySnapshot: true,
      ...body,
    },
    { status },
  );
}

function createCloudRuntimeAuditId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `cloud-runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logCloudRuntimeAudit(
  event: 'cloud_runtime_request' | 'cloud_runtime_success' | 'cloud_runtime_failure',
  payload: Record<string, string | number | boolean | null>,
) {
  const safePayload = {
    resource: 'inventory_items',
    ...payload,
  };
  if (event === 'cloud_runtime_failure') {
    console.warn(event, safePayload);
    return;
  }
  console.info(event, safePayload);
}

function getCloudConfig() {
  const enabled = envValue('CLOUD_DB_ENABLED').toLowerCase() === 'true';
  const supabaseUrl = envValue('SUPABASE_URL');
  const anonKey = envValue('SUPABASE_ANON_KEY');
  const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  const configured = enabled && Boolean(supabaseUrl && anonKey && serviceRoleKey);

  return {
    configured,
    enabled,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
  };
}

function getCloudDatabaseSetupTask(request?: NextRequest): ProductionRuntimeSetupTask | undefined {
  const status = buildProductionRuntimeStatus(process.env, {
    requestHost: request?.headers.get('host'),
  });
  return status.setupTaskMatrix.find(
    (task) => task.id === 'cloud_database' && task.category === 'cloud',
  );
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

function restHeaders(config: ReturnType<typeof getCloudConfig>) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
    accept: 'application/json',
  };
}

function sanitizeString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function sanitizePurchaseMemory(input: unknown): Record<string, string> | null | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  for (const key of forbiddenPurchaseMemoryKeys) {
    if (raw[key] !== undefined) return null;
  }

  const output: Record<string, string> = {};
  for (const key of allowedPurchaseMemoryKeys) {
    const value = sanitizeString(raw[key], 1000);
    if (value) output[key] = value;
  }
  return output;
}

function sanitizeInventoryItem(input: unknown): CloudInventoryItem | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<(typeof allowedInventoryItemKeys)[number] | string, unknown>;

  const id = sanitizeString(raw.id, 200);
  const name = sanitizeString(raw.name, 400);
  const mode = sanitizeString(raw.mode, 80);
  if (!id || !name || mode !== 'personal') return null;

  const schemaVersion = sanitizeString(raw.schemaVersion, 80);
  if (schemaVersion && schemaVersion !== LOCAL_INVENTORY_ITEM_SCHEMA_VERSION) return null;

  const purchaseMemory = sanitizePurchaseMemory(raw.purchaseMemory);
  if (purchaseMemory === null) return null;

  const item: CloudInventoryItem = {
    id,
    schemaVersion: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
    name,
    mode: 'personal',
  };

  for (const key of ['category', 'locationHint', 'notes', 'createdAt', 'updatedAt'] as const) {
    const value = sanitizeString(raw[key]);
    if (value) item[key] = value;
  }
  if (purchaseMemory && Object.keys(purchaseMemory).length > 0) item.purchaseMemory = purchaseMemory;

  return item;
}

function sanitizeInventoryItems(input: unknown): { items: CloudInventoryItem[]; rejectedCount: number } {
  const rawItems = Array.isArray(input) ? input : [];
  const items: CloudInventoryItem[] = [];
  let rejectedCount = 0;

  for (const rawItem of rawItems) {
    const item = sanitizeInventoryItem(rawItem);
    if (item) {
      items.push(item);
    } else {
      rejectedCount += 1;
    }
  }

  return { items, rejectedCount };
}

async function readExistingLocalIds(config: ReturnType<typeof getCloudConfig>, identityKey: string): Promise<string[]> {
  const url = new URL('/rest/v1/inventory_items', config.supabaseUrl);
  url.searchParams.set('identity_key', `eq.${identityKey}`);
  url.searchParams.set('deleted_at', 'is.null');
  url.searchParams.set('select', 'local_id');

  const response = await fetch(url.toString(), {
    headers: restHeaders(config),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase REST existing inventory read failed: ${response.status}`);
  const rows = (await response.json()) as Array<{ local_id?: string }>;
  return rows.map((row) => row.local_id).filter((value): value is string => Boolean(value));
}

export async function GET(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'GET', readsCloud: true, writesCloud: false });
  const config = getCloudConfig();
  if (!config.configured) {
    const setupTask = getCloudDatabaseSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_not_configured' });
    return safeJson(
      {
        ok: false,
        error: 'cloud_not_configured',
        auditId,
        setupTask,
        readsCloud: false,
        writesCloud: false,
      },
      503,
    );
  }

  const userSession = await getSignedInUser(config);
  const user = userSession.user;
  const cloudIdentity = deriveCloudIdentity(user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'not_signed_in' });
    return safeJson(
      {
        ok: false,
        error: 'not_signed_in',
        auditId,
        readsCloud: false,
        writesCloud: false,
      },
      401,
    );
  }

  try {
    const url = new URL('/rest/v1/inventory_items', config.supabaseUrl);
    url.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
    url.searchParams.set('deleted_at', 'is.null');
    url.searchParams.set('select', 'local_id,item,updated_at');
    url.searchParams.set('order', 'updated_at.desc');

    const response = await fetch(url.toString(), {
      headers: restHeaders(config),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase REST inventory read failed: ${response.status}`);
    const rows = (await response.json()) as Array<{ item?: unknown; updated_at?: string }>;
    const items = rows.map((row) => sanitizeInventoryItem(row.item)).filter((item): item is CloudInventoryItem => Boolean(item));

    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'GET', readsCloud: true, writesCloud: false, itemCount: items.length });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: true,
      writesCloud: false,
      items,
      itemCount: items.length,
      updatedAt: rows[0]?.updated_at || null,
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_read_failed' });
    return safeJson(
      {
        ok: false,
        error: 'cloud_read_failed',
        auditId,
        readsCloud: false,
        writesCloud: false,
      },
      502,
    );
  }
}

export async function POST(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'POST', readsCloud: false, writesCloud: true });
  const config = getCloudConfig();
  if (!config.configured) {
    const setupTask = getCloudDatabaseSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'cloud_not_configured' });
    return safeJson(
      {
        ok: false,
        error: 'cloud_not_configured',
        auditId,
        setupTask,
        readsCloud: false,
        writesCloud: false,
      },
      503,
    );
  }

  const userSession = await getSignedInUser(config);
  const user = userSession.user;
  const cloudIdentity = deriveCloudIdentity(user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'not_signed_in' });
    return safeJson(
      {
        ok: false,
        error: 'not_signed_in',
        auditId,
        readsCloud: false,
        writesCloud: false,
      },
      401,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'invalid_json' });
    return safeJson(
      {
        ok: false,
        error: 'invalid_json',
        auditId,
        readsCloud: false,
        writesCloud: false,
      },
      400,
    );
  }

  const rawBody = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const { items, rejectedCount } = sanitizeInventoryItems(rawBody.items);
  const updatedAt = new Date().toISOString();

  try {
    if (items.length > 0) {
      const url = new URL('/rest/v1/inventory_items', config.supabaseUrl);
      url.searchParams.set('on_conflict', 'identity_key,local_id');
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          ...restHeaders(config),
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(
          items.map((item) => ({
            identity_key: cloudIdentity.identityKey,
            user_id: cloudIdentity.userId,
            local_id: item.id,
            schema_version: LOCAL_INVENTORY_ITEM_SCHEMA_VERSION,
            item: {
              ...item,
              updatedAt: item.updatedAt || updatedAt,
            },
            updated_at: item.updatedAt || updatedAt,
            deleted_at: null,
          })),
        ),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Supabase REST inventory write failed: ${response.status}`);
    }

    let deletedMissingCount = 0;
    if (rawBody.deleteMissing === true) {
      const existingLocalIds = await readExistingLocalIds(config, cloudIdentity.identityKey);
      const keptLocalIds = new Set(items.map((item) => item.id));
      const missingLocalIds = existingLocalIds.filter((localId) => !keptLocalIds.has(localId));
      for (const localId of missingLocalIds) {
        const url = new URL('/rest/v1/inventory_items', config.supabaseUrl);
        url.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
        url.searchParams.set('local_id', `eq.${localId}`);
        const response = await fetch(url.toString(), {
          method: 'PATCH',
          headers: restHeaders(config),
          body: JSON.stringify({
            updated_at: updatedAt,
            deleted_at: updatedAt,
          }),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Supabase REST inventory delete-missing failed: ${response.status}`);
      }
      deletedMissingCount = missingLocalIds.length;
    }

    logCloudRuntimeAudit('cloud_runtime_success', {
      auditId,
      method: 'POST',
      readsCloud: rawBody.deleteMissing === true,
      writesCloud: true,
      savedCount: items.length,
      rejectedCount,
      deletedMissingCount,
    });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: rawBody.deleteMissing === true,
      writesCloud: true,
      savedCount: items.length,
      rejectedCount,
      deletedMissingCount,
      updatedAt,
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'cloud_write_failed' });
    return safeJson(
      {
        ok: false,
        error: 'cloud_write_failed',
        auditId,
        readsCloud: false,
        writesCloud: false,
      },
      502,
    );
  }
}
