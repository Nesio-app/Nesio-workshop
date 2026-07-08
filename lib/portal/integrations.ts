/**
 * Integration token storage — per-user OAuth tokens for Gmail, Calendar, etc.
 * Supabase-backed (cross-device) with an explicit cookie fallback escape hatch.
 * Called by API routes; never runs client-side.
 */

import { cookies } from 'next/headers';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { envValue } from '@/lib/portal/env';
import { getCloudConfig, getSignedInUser } from '@/lib/portal/cloud-server-runtime';

export type IntegrationProvider = 'gmail' | 'calendar' | 'notion' | 'tesla';

export interface IntegrationTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  connectedAt: string;
}

export type IntegrationMap = Partial<Record<IntegrationProvider, IntegrationTokens>>;

// ── Env ──────────────────────────────────────────────────────────────────────

// ── Supabase ─────────────────────────────────────────────────────────────────

export async function getSupabaseUserId(accessToken: string): Promise<string | null> {
  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  if (!url || !accessToken) return null;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: {
        apikey: envValue('SUPABASE_ANON_KEY'),
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { id?: string };
    return data.id || null;
  } catch { return null; }
}

async function supabaseRequest(method: string, path: string, userToken: string, body?: unknown, prefer?: string): Promise<Response> {
  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_ANON_KEY');
  return fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json',
      Prefer: prefer ?? 'resolution=merge-duplicates',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * 读取某用户的 integrations map。
 * 返回值区分「失败」与「空」——静默失败审计 #5:读失败必须返回哨兵 null(而非 {}),
 * 否则 read-modify-write 的写侧会以「空」为基底覆写,静默清掉另一 provider 的 token。
 *   - `null`  = 读取失败(网络/鉴权/5xx/解析异常),状态未知,调用方不得据此覆写。
 *   - `{}`    = 请求成功但该用户确实没有任何 integration。
 */
export async function readIntegrations(userId: string, userToken: string): Promise<IntegrationMap | null> {
  if (!userId) return null;
  try {
    const res = await supabaseRequest('GET', `user_profiles?user_id=eq.${userId}&select=integrations&limit=1`, userToken);
    if (!res.ok) {
      console.error('integrations_read_failed', res.status);
      return null;
    }
    const rows = await res.json() as Array<{ integrations?: IntegrationMap | string | null }>;
    const raw = rows[0]?.integrations;
    if (!raw) return {};
    // jsonb 列返回对象;历史 JSON.stringify 双编码写入返回字符串,两者都吃
    return typeof raw === 'string' ? (JSON.parse(raw) as IntegrationMap) : raw;
  } catch { return null; }
}

export async function writeIntegrations(userId: string, userToken: string, data: IntegrationMap): Promise<void> {
  if (!userId) return;
  try {
    // 行由登录时的 profile bootstrap 创建,按 user_id PATCH 定位。
    // 老写法 POST upsert 不带主键 identity_key → 插入 400 被静默吞掉,
    // 是"跨设备 token 层从来没生效"的写入侧断点。
    const patch = await supabaseRequest(
      'PATCH',
      `user_profiles?user_id=eq.${userId}`,
      userToken,
      { integrations: data },
      'return=representation',
    );
    if (patch.ok) {
      const rows = await patch.json().catch(() => []) as unknown[];
      if (Array.isArray(rows) && rows.length > 0) return;
    } else {
      console.error('integrations_write_patch_failed', patch.status);
    }
    // 行还不存在(bootstrap 前的极端时序)→ 带主键的 upsert 兜底
    const insert = await supabaseRequest('POST', 'user_profiles', userToken, {
      identity_key: `supabase:${userId}`,
      user_id: userId,
      integrations: data,
    });
    if (!insert.ok) console.error('integrations_write_insert_failed', insert.status);
  } catch (e) {
    console.error('integrations_write_failed', e instanceof Error ? e.message : 'unknown');
  }
}

// ── Cookies (fallback) ────────────────────────────────────────────────────────

const COOKIE_PREFIX: Record<IntegrationProvider, string> = {
  gmail: 'nesio_gmail',
  calendar: 'nesio_google_calendar',
  notion: 'nesio_notion',
  tesla: 'nesio_tesla',
};

export async function readTokensFromCookies(provider: IntegrationProvider): Promise<IntegrationTokens | null> {
  const cookieStore = await cookies();
  const prefix = COOKIE_PREFIX[provider];
  const accessToken = cookieStore.get(`${prefix}_access`)?.value;
  const refreshToken = cookieStore.get(`${prefix}_refresh`)?.value;
  // Return even when accessToken is missing — as long as refreshToken exists,
  // the caller can call the provider's refresh endpoint and retry.
  if (!accessToken && !refreshToken) return null;
  return { accessToken: accessToken || '', refreshToken, connectedAt: new Date().toISOString() };
}

export function allowCookieIntegrationFallback(): boolean {
  if (envValue('NESIO_ALLOW_COOKIE_INTEGRATION_FALLBACK').toLowerCase() === 'true') return true;
  // No Supabase configured → cookie fallback is the only storage available
  return !envValue('SUPABASE_URL') || !envValue('SUPABASE_ANON_KEY');
}

export function setTokenCookiesOnResponse(
  response: { cookies: { set: (name: string, value: string, opts: object) => void } },
  provider: IntegrationProvider,
  tokens: IntegrationTokens,
) {
  const prefix = COOKIE_PREFIX[provider];
  const secure = process.env.NODE_ENV === 'production';
  const expiresIn = tokens.expiresAt ? Math.round((tokens.expiresAt - Date.now()) / 1000) : 3600;
  response.cookies.set(`${prefix}_access`, tokens.accessToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: expiresIn });
  if (tokens.refreshToken) {
    // 90 days to match the calendar refresh cookie lifetime
    response.cookies.set(`${prefix}_refresh`, tokens.refreshToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 90 });
  }
}

// ── Main: get token for current user ─────────────────────────────────────────

/**
 * Returns the OAuth tokens for the given provider for the currently
 * logged-in user. Checks Supabase first (cross-device). Cookie fallback is
 * disabled by default so OAuth cookies cannot become an anonymous data path.
 */
export async function getIntegrationToken(
  provider: IntegrationProvider,
): Promise<{ accessToken: string; refreshToken?: string } | null> {
  const cookieStore = await cookies();
  const supabaseToken = cookieStore.get('baohe_auth_access')?.value;

  if (supabaseToken) {
    const userId = await getSupabaseUserId(supabaseToken);
    if (userId) {
      const map = await readIntegrations(userId, supabaseToken);
      const t = map?.[provider];
      if (t?.accessToken) return { accessToken: t.accessToken, refreshToken: t.refreshToken };
    }
  }

  // Positive-form gate — the anonymous-private-data-gate contract asserts
  // cookie fallback only happens inside this explicit escape hatch.
  if (allowCookieIntegrationFallback()) {
    return readTokensFromCookies(provider);
  }
  return null;
}

/**
 * 刷新链解析当前用户的真实 Supabase userId。access cookie 过期(手机上很
 * 常见,只剩 refresh cookie)时 getSupabaseUserId 会失败,这里走
 * getSignedInUser 的 access→refresh 完整链。wechat 伪 id 返回 null
 * (user_profiles.user_id 是 auth.users 外键,写不进去)。
 */
export async function getRefreshedUserId(): Promise<string | null> {
  try {
    const config = getCloudConfig();
    if (!config.supabaseUrl || !config.anonKey) return null;
    const { user } = await getSignedInUser(config);
    const id = user?.id || '';
    if (!id || id.startsWith('wechat_openid:')) return null;
    return id;
  } catch { return null; }
}

/**
 * getIntegrationToken 的会话刷新版:access cookie 过期时先刷新会话再读
 * integrations。OAuth 连接器的 status/同步路径用这个 —— 否则手机上
 * access 过期后云端 token 读不到,按钮又退回「接入」。
 */
export async function getIntegrationTokenRefreshed(
  provider: IntegrationProvider,
): Promise<{ accessToken: string; refreshToken?: string } | null> {
  const direct = await getIntegrationToken(provider);
  if (direct?.accessToken) return direct;
  const userId = await getRefreshedUserId();
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  if (!userId || !serviceKey) return null;
  const map = await readIntegrations(userId, serviceKey);
  const t = map?.[provider];
  return t?.accessToken ? { accessToken: t.accessToken, refreshToken: t.refreshToken } : null;
}

/**
 * Save tokens for a KNOWN userId using the service role key — for OAuth
 * callbacks that land in a different browser context than the one that
 * started the flow (iOS PWA → 授权被 Notion App 劫持 → 回调落在 Safari,
 * 那里没有 Nesio 会话 cookie)。userId 由签名 state 携带,不来自请求 cookie。
 */
export async function saveIntegrationTokenByUserId(
  userId: string,
  provider: IntegrationProvider,
  tokens: Omit<IntegrationTokens, 'connectedAt'>,
): Promise<boolean> {
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  if (!userId || !serviceKey) return false;
  const full: IntegrationTokens = { ...tokens, connectedAt: new Date().toISOString() };
  const existing = await readIntegrations(userId, serviceKey);
  if (existing === null) {
    // 读失败:基底未知,绝不以「空」覆写(会清掉另一 provider 的 token)。放弃本次云端回写,
    // 让调用方走 cookie 兜底 / 稍后重试(静默失败审计 #5)。
    console.error('integrations_save_aborted_read_failed', provider);
    return false;
  }
  existing[provider] = full;
  await writeIntegrations(userId, serviceKey, existing);
  return true;
}

/**
 * Save tokens for the current user. Writes to both Supabase and cookies.
 * Call this from OAuth callback routes.
 */
export async function saveIntegrationToken(
  provider: IntegrationProvider,
  tokens: Omit<IntegrationTokens, 'connectedAt'>,
  req: { cookies: { get: (name: string) => { value?: string } | undefined }; headers: { get: (name: string) => string | null } },
): Promise<IntegrationTokens> {
  const full: IntegrationTokens = { ...tokens, connectedAt: new Date().toISOString() };
  const supabaseToken = req.cookies.get('baohe_auth_access')?.value;

  if (supabaseToken) {
    const userId = await getSupabaseUserId(supabaseToken);
    if (userId) {
      const existing = await readIntegrations(userId, supabaseToken);
      if (existing === null) {
        // 读失败:不以「空」覆写云端(会清掉另一 provider 的 token)。跳过云写,cookie 仍写(下方)。
        console.error('integrations_save_aborted_read_failed', provider);
      } else {
        existing[provider] = full;
        await writeIntegrations(userId, supabaseToken, existing);
      }
    }
  }

  return full;
}
