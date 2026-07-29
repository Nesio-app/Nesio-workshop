import {
  deriveCloudIdentity,
  getCloudConfig,
  serviceRoleRestHeaders,
  type CloudRuntimeConfig,
  type SupabaseUserResponse,
} from './cloud-server-runtime';

export type BootstrapResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  identityKey?: string;
};

export type BootstrapStatusMeta = {
  profileBootstrapped: boolean;
  profileBootstrapStatus: string;
  profileBootstrapBlocking: boolean;
  authReady: boolean;
};

function normalizeBootstrapReason(reason: unknown): string {
  if (typeof reason !== 'string') return 'profile_bootstrap_unknown';
  const normalized = reason.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, '_').slice(0, 120);
  return normalized || 'profile_bootstrap_unknown';
}

export function buildCloudAccountProfileBootstrapMeta(result?: BootstrapResult | null): BootstrapStatusMeta {
  if (result?.ok && result.identityKey && !result.skipped) {
    return {
      profileBootstrapped: true,
      profileBootstrapStatus: 'profile_bootstrapped',
      profileBootstrapBlocking: false,
      authReady: true,
    };
  }

  if (result?.skipped) {
    return {
      profileBootstrapped: false,
      profileBootstrapStatus: normalizeBootstrapReason(result.reason) || 'profile_bootstrap_skipped',
      profileBootstrapBlocking: false,
      authReady: true,
    };
  }

  return {
    profileBootstrapped: false,
    profileBootstrapStatus: normalizeBootstrapReason(result?.reason) || 'profile_bootstrap_failed',
    profileBootstrapBlocking: false,
    authReady: true,
  };
}

function sanitizeString(value: unknown, maxLength = 400): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
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


/**
 * 登录链路上的每一跳都必须能超时。
 *
 * 这几个 Supabase 往返原本一个超时都没有 —— Supabase 冷启动或网络抖一下,
 * 桥页就永远停在「正在完成登录」(标注 图2/图3 报的就是卡住和很慢)。
 * 8 秒到点就当失败:profile 落库是 best-effort,宁可不建,不能挡着人进门。
 */
const HOP_TIMEOUT_MS = 8000;
function hopSignal(): AbortSignal | undefined {
  try { return AbortSignal.timeout(HOP_TIMEOUT_MS); } catch { return undefined; }
}

async function fetchSupabaseUser(config: CloudRuntimeConfig, accessToken: string): Promise<SupabaseUserResponse | null> {
  if (!accessToken) return null;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
    signal: hopSignal(),
  });
  if (!response.ok) return null;
  return response.json() as Promise<SupabaseUserResponse>;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 600);
  } catch {
    return '';
  }
}

function isProfileTableUnavailable(response: Response, body: string): boolean {
  if (response.status === 404) return true;
  return /user_profiles|PGRST205|42P01|could not find|does not exist/i.test(body);
}

async function findExistingUserProfile(config: CloudRuntimeConfig, identityKey: string): Promise<{
  ok: boolean;
  found: boolean;
  tableUnavailable: boolean;
  status?: number;
}> {
  const url = new URL('/rest/v1/user_profiles', config.supabaseUrl);
  url.searchParams.set('identity_key', `eq.${identityKey}`);
  url.searchParams.set('select', 'identity_key,user_id');
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString(), {
    headers: serviceRoleRestHeaders(config, {
      Prefer: 'return=representation',
    }),
    cache: 'no-store',
    signal: hopSignal(),
  });

  if (!response.ok) {
    const body = await readErrorBody(response);
    return {
      ok: false,
      found: false,
      tableUnavailable: isProfileTableUnavailable(response, body),
      status: response.status,
    };
  }

  let rows: unknown = [];
  try {
    rows = await response.json();
  } catch {
    rows = [];
  }

  return {
    ok: true,
    found: Array.isArray(rows) && rows.length > 0,
    tableUnavailable: false,
    status: response.status,
  };
}

function buildUserProfileRow(user: SupabaseUserResponse) {
  const identity = deriveCloudIdentity(user);
  if (!identity) return null;
  const userMetadata = user.user_metadata || {};
  const providers = normalizeProviders(user);
  const provider = providers[0] || identity.provider;
  const now = new Date().toISOString();

  return {
    identity_key: identity.identityKey,
    user_id: identity.userId,
    email: sanitizeString(user.email || userMetadata.email, 320),
    phone: sanitizeString(user.phone, 80),
    provider,
    providers,
    display_name:
      sanitizeString(userMetadata.full_name, 200) ||
      sanitizeString(userMetadata.name, 200) ||
      sanitizeString(user.email, 200),
    avatar_url:
      sanitizeString(userMetadata.avatar_url, 2000) ||
      sanitizeString(userMetadata.picture, 2000),
    onboarding_completed: false,
    profile: {},
    last_seen_at: now,
    updated_at: now,
  };
}

/**
 * @param knownUser 调用方**已经查到的** Supabase user。
 *
 * 不传的话这里会自己再查一遍 —— 而 /api/auth/import 和 /api/auth/session 两处
 * 都是刚刚用同一个 token 查过 user 才调过来的,等于同一个用户在登录关键路径上
 * 被查了两次,白白多一个 RTT。传进来就省掉。
 */
export async function bootstrapCloudAccountProfile(
  accessToken?: string | null,
  knownUser?: SupabaseUserResponse | null,
): Promise<BootstrapResult> {
  const config = getCloudConfig();
  if (!config.configured) return { ok: true, skipped: true, reason: 'cloud_not_configured' };
  if (!accessToken) return { ok: true, skipped: true, reason: 'missing_access_token' };

  try {
    const user = knownUser ?? await fetchSupabaseUser(config, accessToken);
    const row = user ? buildUserProfileRow(user) : null;
    if (!row) return { ok: false, reason: 'invalid_user' };

    const existing = await findExistingUserProfile(config, row.identity_key);
    if (existing.tableUnavailable) {
      return {
        ok: true,
        skipped: true,
        reason: 'profile_bootstrap_deferred:user_profiles_unavailable',
        identityKey: row.identity_key,
      };
    }
    if (existing.found) {
      return { ok: true, reason: 'profile_already_bootstrapped', identityKey: row.identity_key };
    }

    const url = new URL('/rest/v1/user_profiles', config.supabaseUrl);
    url.searchParams.set('on_conflict', 'identity_key');
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: serviceRoleRestHeaders(config, {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      signal: hopSignal(),
      body: JSON.stringify(row),
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      if (isProfileTableUnavailable(response, body)) {
        return {
          ok: true,
          skipped: true,
          reason: 'profile_bootstrap_deferred:user_profiles_unavailable',
          identityKey: row.identity_key,
        };
      }
      const maybeCreated = await findExistingUserProfile(config, row.identity_key);
      if (maybeCreated.found) {
        return { ok: true, reason: 'profile_already_bootstrapped', identityKey: row.identity_key };
      }
      return { ok: false, reason: `profile_upsert_failed:${response.status}` };
    }
    return { ok: true, identityKey: row.identity_key };
  } catch {
    return { ok: false, reason: 'profile_bootstrap_failed' };
  }
}
