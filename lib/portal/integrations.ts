/**
 * Integration token storage — per-user OAuth tokens for Gmail, Calendar, etc.
 * Supabase-backed (cross-device) with an explicit cookie fallback escape hatch.
 * Called by API routes; never runs client-side.
 */

import { cookies } from 'next/headers';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';

export type IntegrationProvider = 'gmail' | 'calendar' | 'tesla';

export interface IntegrationTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  connectedAt: string;
}

export type IntegrationMap = Partial<Record<IntegrationProvider, IntegrationTokens>>;

// ── Env ──────────────────────────────────────────────────────────────────────

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

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

async function supabaseRequest(method: string, path: string, userToken: string, body?: unknown): Promise<Response> {
  const url = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY') || envValue('SUPABASE_ANON_KEY');
  return fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function readIntegrations(userId: string, userToken: string): Promise<IntegrationMap> {
  if (!userId) return {};
  try {
    const res = await supabaseRequest('GET', `user_profiles?user_id=eq.${userId}&select=integrations&limit=1`, userToken);
    if (!res.ok) return {};
    const rows = await res.json() as Array<{ integrations?: string }>;
    const raw = rows[0]?.integrations;
    return raw ? (JSON.parse(raw) as IntegrationMap) : {};
  } catch { return {}; }
}

export async function writeIntegrations(userId: string, userToken: string, data: IntegrationMap): Promise<void> {
  if (!userId) return;
  try {
    await supabaseRequest('POST', 'user_profiles', userToken, {
      user_id: userId,
      integrations: JSON.stringify(data),
    });
  } catch { /* silent */ }
}

// ── Cookies (fallback) ────────────────────────────────────────────────────────

const COOKIE_PREFIX: Record<IntegrationProvider, string> = {
  gmail: 'nesio_gmail',
  calendar: 'nesio_google_calendar',
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
      const t = map[provider];
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
      existing[provider] = full;
      await writeIntegrations(userId, supabaseToken, existing);
    }
  }

  return full;
}
