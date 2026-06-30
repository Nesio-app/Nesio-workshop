import { NextRequest, NextResponse } from 'next/server';
import { type ProductionRuntimeSetupTask } from '@/lib/portal/production-runtime';
import { deriveCloudIdentity } from '@/lib/portal/cloud-identity';
import * as cloudRuntime from '@/lib/portal/cloud-server-runtime';

type SupabaseUserResponse = {
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

type SupabaseTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type AccountProfilePatch = {
  displayName?: string;
  avatarUrl?: string;
  onboardingCompleted?: boolean;
  profile?: Record<string, string | number | boolean | null>;
};

type AccountProfileRow = {
  identity_key?: string;
  user_id?: string | null;
  email?: string | null;
  phone?: string | null;
  provider?: string | null;
  providers?: string[] | null;
  display_name?: string | null;
  avatar_url?: string | null;
  onboarding_completed?: boolean | null;
  profile?: unknown;
  last_seen_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      cloudAccountProfile: true,
      ...body,
    },
    { status },
  );
}

function createCloudRuntimeAuditId(): string {
  return cloudRuntime.createCloudRuntimeAuditId();
}

function logCloudRuntimeAudit(
  event: 'cloud_runtime_request' | 'cloud_runtime_success' | 'cloud_runtime_failure',
  payload: Record<string, string | number | boolean | null>,
) {
  cloudRuntime.logCloudRuntimeAudit(event, payload, { resource: 'user_profiles' });
}

function getCloudConfig() {
  return cloudRuntime.getCloudConfig();
}

function getCloudDatabaseSetupTask(request?: NextRequest): ProductionRuntimeSetupTask | undefined {
  return cloudRuntime.getCloudDatabaseSetupTask(request);
}

function setRefreshedAuthCookies(response: NextResponse, session?: SupabaseTokenResponse | null) {
  return cloudRuntime.setRefreshedAuthCookies(response, session);
}

async function getSignedInUser(config: ReturnType<typeof getCloudConfig>): Promise<{
  user: SupabaseUserResponse | null;
  refreshedSession: SupabaseTokenResponse | null;
}> {
  return cloudRuntime.getSignedInUser(config);
}

function restHeaders(config: ReturnType<typeof getCloudConfig>) {
  return cloudRuntime.serviceRoleRestHeaders(config);
}

function sanitizeString(value: unknown, maxLength = 400): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function sanitizeProfileObject(input: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
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

function sanitizeAccountProfilePatch(input: unknown): AccountProfilePatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const patch: AccountProfilePatch = {};

  const displayName = sanitizeString(raw.displayName ?? raw.display_name, 200);
  if (displayName) patch.displayName = displayName;

  const avatarUrl = sanitizeString(raw.avatarUrl ?? raw.avatar_url, 2000);
  if (avatarUrl) patch.avatarUrl = avatarUrl;

  const onboardingCompleted = raw.onboardingCompleted ?? raw.onboarding_completed;
  if (typeof onboardingCompleted === 'boolean') patch.onboardingCompleted = onboardingCompleted;

  const profile = sanitizeProfileObject(raw.profile);
  if (profile) patch.profile = profile;

  return patch;
}

function normalizeProviders(user: SupabaseUserResponse): string[] {
  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers)) {
    return providers
      .map((provider) => sanitizeString(provider, 80))
      .filter((provider): provider is string => Boolean(provider));
  }
  const provider = sanitizeString(user.app_metadata?.provider, 80);
  return provider ? [provider] : [];
}

function buildAccountProfileFromUser(user: SupabaseUserResponse, patch: AccountProfilePatch = {}) {
  const identity = deriveCloudIdentity(user);
  if (!identity) return null;

  const providers = normalizeProviders(user);
  const provider = providers[0] || identity.provider;
  const userMetadata = user.user_metadata || {};
  const displayName =
    patch.displayName ||
    sanitizeString(userMetadata.full_name, 200) ||
    sanitizeString(userMetadata.name, 200) ||
    sanitizeString(user.email, 200) ||
    null;
  const avatarUrl =
    patch.avatarUrl ||
    sanitizeString(userMetadata.avatar_url, 2000) ||
    sanitizeString(userMetadata.picture, 2000) ||
    null;

  return {
    identity_key: identity.identityKey,
    user_id: identity.userId,
    email: sanitizeString(user.email || userMetadata.email, 320) || null,
    phone: sanitizeString(user.phone, 80) || null,
    provider,
    providers,
    display_name: displayName,
    avatar_url: avatarUrl,
    onboarding_completed: patch.onboardingCompleted ?? false,
    profile: patch.profile || {},
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function toAccountProfile(row: AccountProfileRow) {
  return {
    identityKey: row.identity_key || '',
    userId: row.user_id || null,
    email: row.email || null,
    phone: row.phone || null,
    provider: row.provider || null,
    providers: Array.isArray(row.providers) ? row.providers : [],
    displayName: row.display_name || null,
    avatarUrl: row.avatar_url || null,
    onboardingCompleted: Boolean(row.onboarding_completed),
    profile: row.profile && typeof row.profile === 'object' && !Array.isArray(row.profile) ? row.profile : {},
    lastSeenAt: row.last_seen_at || null,
    updatedAt: row.updated_at || null,
    createdAt: row.created_at || null,
  };
}

async function upsertCloudAccountProfile(
  config: ReturnType<typeof getCloudConfig>,
  user: SupabaseUserResponse,
  patch: AccountProfilePatch = {},
): Promise<AccountProfileRow | null> {
  const row = buildAccountProfileFromUser(user, patch);
  if (!row) return null;

  const url = new URL('/rest/v1/user_profiles', config.supabaseUrl);
  url.searchParams.set('on_conflict', 'identity_key');
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      ...restHeaders(config),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase REST account upsert failed: ${response.status}`);
  const rows = (await response.json()) as AccountProfileRow[];
  return rows[0] || null;
}

export async function GET(request: NextRequest) {
  const auditId = createCloudRuntimeAuditId();
  logCloudRuntimeAudit('cloud_runtime_request', { auditId, method: 'GET', readsCloud: true, writesCloud: true });
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
  if (!user || !cloudIdentity) {
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
    const url = new URL('/rest/v1/user_profiles', config.supabaseUrl);
    url.searchParams.set('identity_key', `eq.${cloudIdentity.identityKey}`);
    url.searchParams.set('select', '*');
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      headers: restHeaders(config),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase REST account read failed: ${response.status}`);
    const rows = (await response.json()) as AccountProfileRow[];
    const row = rows[0] || await upsertCloudAccountProfile(config, user);

    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'GET', readsCloud: true, writesCloud: !rows[0] });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: true,
      writesCloud: !rows[0],
      created: !rows[0],
      profile: row ? toAccountProfile(row) : null,
      updatedAt: row?.updated_at || null,
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
  if (!user || !cloudIdentity) {
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
    body = {};
  }

  try {
    const row = await upsertCloudAccountProfile(config, user, sanitizeAccountProfilePatch((body as { profile?: unknown })?.profile || body));
    logCloudRuntimeAudit('cloud_runtime_success', { auditId, method: 'POST', readsCloud: false, writesCloud: true });
    return setRefreshedAuthCookies(safeJson({
      ok: true,
      auditId,
      readsCloud: false,
      writesCloud: true,
      profile: row ? toAccountProfile(row) : null,
      updatedAt: row?.updated_at || null,
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
