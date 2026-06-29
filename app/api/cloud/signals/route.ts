import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import type { Signal, SignalSensitivity, SignalSource, RetentionPolicy } from '@/lib/life-domain/signal';

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

const SIGNAL_SCHEMA_VERSION = 'Signal@v1';
const ALLOWED_SOURCES = new Set<SignalSource>([
  'voice',
  'photo',
  'calendar',
  'gmail',
  'health',
  'task',
  'weather',
  'hardware_pulse',
  'manual',
  'ai_observation',
  'flomo',
  'notion',
  'toggl',
  'reminder',
  'keep',
  'wechat_reading',
  'device',
]);
const ALLOWED_RETENTION = new Set<RetentionPolicy>(['AlwaysAlive', 'LongLiving', 'Normal', 'Disposable']);
const ALLOWED_SENSITIVITY = new Set<SignalSensitivity>(['normal', 'private', 'health', 'financial', 'family', 'work']);

function envValue(key: string): string {
  return (process.env[key] || '').trim();
}

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      cloudSignalsSnapshot: true,
      ...body,
    },
    { status },
  );
}

function getCloudConfig() {
  const enabled = envValue('CLOUD_DB_ENABLED').toLowerCase() === 'true';
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const anonKey = envValue('SUPABASE_ANON_KEY');
  const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  return {
    configured: enabled && Boolean(supabaseUrl && anonKey && serviceRoleKey),
    enabled,
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
  const cookieStore = cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || '';
  const refreshToken = cookieStore.get('baohe_auth_refresh')?.value || '';
  const user = await fetchSignedInUser(config, accessToken);
  if (user?.id) return { user, refreshedSession: null };

  const refreshedSession = await refreshSupabaseSession(config, refreshToken);
  const refreshedUser = await fetchSignedInUser(config, refreshedSession?.access_token || '');
  if (refreshedUser?.id) return { user: refreshedUser, refreshedSession };
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

function sanitizeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sanitizeJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, 80) : [];
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}

function iso(value: unknown): string {
  if (typeof value === 'string' || value instanceof Date) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function buildSignalSearchText(signal: Pick<Signal, 'title' | 'source' | 'type' | 'payload' | 'tags' | 'evidence'>): string {
  return [
    signal.title,
    signal.source,
    signal.type,
    ...(signal.tags || []),
    JSON.stringify(signal.payload || {}),
    signal.evidence?.raw || '',
  ].join(' ').slice(0, 8000);
}

function sanitizeSignal(input: unknown): Signal | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const id = sanitizeString(raw.id, 240);
  const source = sanitizeString(raw.source, 80) as SignalSource | undefined;
  const type = sanitizeString(raw.type, 120);
  const title = sanitizeString(raw.title, 600);
  if (!id || !source || !type || !title || !ALLOWED_SOURCES.has(source)) return null;
  const retentionPolicy = sanitizeString(raw.retentionPolicy || raw.retention_policy, 80) as RetentionPolicy | undefined;
  const sensitivity = sanitizeString(raw.sensitivity, 80) as SignalSensitivity | undefined;
  return {
    id,
    source,
    type,
    occurredAt: iso(raw.occurredAt),
    capturedAt: iso(raw.capturedAt),
    title,
    payload: sanitizeJsonObject(raw.payload),
    content: sanitizeJsonObject(raw.payload),
    entities: sanitizeJsonArray(raw.entities) as Signal['entities'],
    confidence: clampConfidence(raw.confidence),
    sensitivity: sensitivity && ALLOWED_SENSITIVITY.has(sensitivity) ? sensitivity : 'normal',
    retentionPolicy: retentionPolicy && ALLOWED_RETENTION.has(retentionPolicy) ? retentionPolicy : 'Normal',
    evidence: sanitizeJsonObject(raw.evidence) as unknown as Signal['evidence'],
    tags: sanitizeJsonArray(raw.tags).flatMap((tag) => {
      const value = sanitizeString(tag, 80);
      return value ? [value.replace(/^#/, '')] : [];
    }),
  };
}

function sanitizeSignals(input: unknown): { signals: Signal[]; rejectedCount: number } {
  const rawSignals = Array.isArray(input) ? input : [];
  const signals: Signal[] = [];
  let rejectedCount = 0;
  for (const rawSignal of rawSignals) {
    const signal = sanitizeSignal(rawSignal);
    if (signal) signals.push(signal);
    else rejectedCount += 1;
  }
  return { signals, rejectedCount };
}

function signalRow(identityKey: string, userId: string | null, signal: Signal) {
  return {
    identity_key: identityKey,
    user_id: userId,
    signal_id: signal.id,
    schema_version: SIGNAL_SCHEMA_VERSION,
    source: signal.source,
    type: signal.type,
    occurred_at: signal.occurredAt,
    captured_at: signal.capturedAt,
    title: signal.title,
    payload: signal.payload || {},
    entities: signal.entities || [],
    evidence: signal.evidence || {},
    confidence: signal.confidence,
    sensitivity: signal.sensitivity,
    retention_policy: signal.retentionPolicy,
    embedding_text: buildSignalSearchText(signal),
    feedback: {},
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };
}

export async function GET(request: NextRequest) {
  const config = getCloudConfig();
  if (!config.configured) return safeJson({ ok: false, error: 'cloud_not_configured', readsCloud: false, writesCloud: false }, 503);
  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) return safeJson({ ok: false, error: 'not_signed_in', readsCloud: false, writesCloud: false }, 401);

  const url = new URL('/rest/v1/signals', config.supabaseUrl);
  url.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
  url.searchParams.set('deleted_at', 'is.null');
  url.searchParams.set('select', 'signal_id,source,type,occurred_at,captured_at,title,payload,entities,evidence,confidence,sensitivity,retention_policy,feedback,embedding_text');
  url.searchParams.set('order', 'captured_at.desc');
  url.searchParams.set('limit', request.nextUrl.searchParams.get('limit') || '200');

  const response = await fetch(url.toString(), { headers: restHeaders(config), cache: 'no-store' });
  if (!response.ok) return safeJson({ ok: false, error: 'cloud_read_failed', readsCloud: false, writesCloud: false }, 502);
  const rows = await response.json() as Array<Record<string, unknown>>;
  return setRefreshedAuthCookies(safeJson({
    ok: true,
    readsCloud: true,
    writesCloud: false,
    signals: rows,
    signalCount: rows.length,
  }), userSession.refreshedSession);
}

export async function POST(request: NextRequest) {
  const config = getCloudConfig();
  if (!config.configured) return safeJson({ ok: false, error: 'cloud_not_configured', readsCloud: false, writesCloud: false }, 503);
  const userSession = await getSignedInUser(config);
  const cloudIdentity = deriveCloudIdentity(userSession.user);
  if (!cloudIdentity) return safeJson({ ok: false, error: 'not_signed_in', readsCloud: false, writesCloud: false }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return safeJson({ ok: false, error: 'invalid_json', readsCloud: false, writesCloud: false }, 400);
  }

  const input = body.signals || (body.signal ? [body.signal] : []);
  const { signals, rejectedCount } = sanitizeSignals(input);
  if (!signals.length) return safeJson({ ok: false, error: 'empty_signals', rejectedCount, readsCloud: false, writesCloud: false }, 400);

  const url = new URL('/rest/v1/signals', config.supabaseUrl);
  url.searchParams.set('on_conflict', 'identity_key,signal_id');
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      ...restHeaders(config),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(signals.map((signal) => signalRow(cloudIdentity.identityKey, cloudIdentity.userId, signal))),
    cache: 'no-store',
  });
  if (!response.ok) return safeJson({ ok: false, error: 'cloud_write_failed', rejectedCount, readsCloud: false, writesCloud: false }, 502);
  return setRefreshedAuthCookies(safeJson({
    ok: true,
    readsCloud: false,
    writesCloud: true,
    savedCount: signals.length,
    rejectedCount,
  }), userSession.refreshedSession);
}
