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
};

type SupabaseTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type CloudProductEventInput = {
  eventType: string;
  source: string;
  targetType?: string;
  targetId?: string;
  feedback?: string;
  payload?: Record<string, string | number | boolean | null>;
};

type ProductEventRow = {
  event_id?: string;
  identity_key?: string;
  user_id?: string | null;
  event_type?: string;
  source?: string;
  target_type?: string | null;
  target_id?: string | null;
  feedback?: string | null;
  payload?: unknown;
  created_at?: string;
};

function envValue(key: string): string {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      product_event_recorded: true,
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
    resource: 'product_events',
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
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
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

function sanitizeString(value: unknown, maxLength = 400): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function sanitizePayload(input: unknown): Record<string, string | number | boolean | null> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    const safeKey = sanitizeString(key, 80);
    if (!safeKey) continue;
    if (typeof value === 'string') {
      const safeValue = sanitizeString(value, 1000);
      if (safeValue) output[safeKey] = safeValue;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      output[safeKey] = value;
      continue;
    }
    if (typeof value === 'boolean' || value === null) {
      output[safeKey] = value;
    }
  }
  return output;
}

function sanitizeCloudEventInput(input: unknown): CloudProductEventInput | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const eventType = sanitizeString(raw.eventType ?? raw.event_type, 120);
  const source = sanitizeString(raw.source, 120);
  if (!eventType || !source) return null;

  return {
    eventType,
    source,
    targetType: sanitizeString(raw.targetType ?? raw.target_type, 120),
    targetId: sanitizeString(raw.targetId ?? raw.target_id, 240),
    feedback: sanitizeString(raw.feedback, 120),
    payload: sanitizePayload(raw.payload),
  };
}

function toCloudProductEvent(row: ProductEventRow) {
  return {
    eventId: row.event_id || '',
    identityKey: row.identity_key || '',
    userId: row.user_id || null,
    eventType: row.event_type || '',
    source: row.source || '',
    targetType: row.target_type || null,
    targetId: row.target_id || null,
    feedback: row.feedback || null,
    payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {},
    createdAt: row.created_at || null,
  };
}

export async function GET(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'GET', readsCloud: true, writesCloud: false });
  const config = getCloudConfig();
  if (!config.configured) {
    const setupTask = getCloudDatabaseSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_not_configured' });
    return safeJson({ ok: false, error: 'cloud_not_configured', auditId, setupTask, readsCloud: false, writesCloud: false }, 503);
  }

  const userSession = await getSignedInUser(config);
  const user = userSession.user;
  const cloudIdentity = deriveCloudIdentity(user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'not_signed_in' });
    return safeJson({ ok: false, error: 'not_signed_in', auditId, readsCloud: false, writesCloud: false }, 401);
  }

  try {
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 50), 1), 100);
    const url = new URL('/rest/v1/product_events', config.supabaseUrl);
    url.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
      headers: restHeaders(config),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase REST product event read failed: ${response.status}`);
    const rows = (await response.json()) as ProductEventRow[];

    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'GET', readsCloud: true, writesCloud: false });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: true,
      writesCloud: false,
      events: rows.map(toCloudProductEvent),
      eventCount: rows.length,
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'GET', reason: 'cloud_read_failed' });
    return safeJson({ ok: false, error: 'cloud_read_failed', auditId, readsCloud: false, writesCloud: false }, 502);
  }
}

export async function POST(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'POST', readsCloud: false, writesCloud: true });
  const config = getCloudConfig();
  if (!config.configured) {
    const setupTask = getCloudDatabaseSetupTask(request);
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'cloud_not_configured' });
    return safeJson({ ok: false, error: 'cloud_not_configured', auditId, setupTask, readsCloud: false, writesCloud: false }, 503);
  }

  const userSession = await getSignedInUser(config);
  const user = userSession.user;
  const cloudIdentity = deriveCloudIdentity(user);
  if (!cloudIdentity) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'not_signed_in' });
    return safeJson({ ok: false, error: 'not_signed_in', auditId, readsCloud: false, writesCloud: false }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const event = sanitizeCloudEventInput(body);
  if (!event) {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'invalid_event' });
    return safeJson({ ok: false, error: 'invalid_event', auditId, readsCloud: false, writesCloud: false }, 400);
  }

  try {
    const now = new Date().toISOString();
    const row = {
      event_id: globalThis.crypto?.randomUUID?.() || `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      identity_key: cloudIdentity.identityKey,
      user_id: cloudIdentity.userId,
      event_type: event.eventType,
      source: event.source,
      target_type: event.targetType || null,
      target_id: event.targetId || null,
      feedback: event.feedback || null,
      payload: event.payload || {},
      created_at: now,
    };
    const response = await fetch(`${config.supabaseUrl}/rest/v1/product_events`, {
      method: 'POST',
      headers: {
        ...restHeaders(config),
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase REST product event write failed: ${response.status}`);
    const rows = (await response.json()) as ProductEventRow[];

    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'POST', readsCloud: false, writesCloud: true });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: false,
      writesCloud: true,
      event: toCloudProductEvent(rows[0] || row),
    }), userSession.refreshedSession);
  } catch {
    logCloudRuntimeAudit('cloud_runtime_failure', { auditId, method: 'POST', reason: 'cloud_write_failed' });
    return safeJson({ ok: false, error: 'cloud_write_failed', auditId, readsCloud: false, writesCloud: false }, 502);
  }
}
