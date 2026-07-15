/**
 * Shared Gmail access-token resolver — used by the send + draft-reply routes.
 * Mirrors the candidate/refresh dance in app/api/portal/gmail/route.ts so a
 * write path (sending mail) is as resilient to stale tokens as the read path:
 *   Supabase token → borrow calendar refresh → this-device cookies → refresh.
 * Never runs client-side.
 */
import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getIntegrationToken, saveIntegrationToken } from '@/lib/portal/integrations';
import { envValue } from '@/lib/portal/env';
import { hasVerifiedSessionCookie } from '@/lib/portal/api-auth';

/** Anonymous requests must not reach a send path. Returns true when a Nesio session exists.
 *  数据审计 P0 同源:session 存在判定改走验签(伪造 refresh/openid 不再算「有会话」)。 */
export async function hasNesioSession(): Promise<boolean> {
  const noSupabase = !envValue('SUPABASE_URL') || !envValue('SUPABASE_ANON_KEY');
  return (await hasVerifiedSessionCookie()) || noSupabase;
}

async function refreshAccessToken(refreshTk: string): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshTk,
        client_id: envValue('GOOGLE_CLIENT_ID'),
        client_secret: envValue('GOOGLE_CLIENT_SECRET'),
        grant_type: 'refresh_token',
      }),
    });
    const data = await res.json() as { access_token?: string };
    return data.access_token || null;
  } catch { return null; }
}

/** Cheap probe: does this access token still work against Gmail? */
async function tokenWorks(accessToken: string): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch { return false; }
}

/**
 * Resolve a currently-valid Gmail access token for the logged-in user, refreshing
 * as needed. Returns null when no candidate works (caller should send the user to
 * /api/portal/gmail/connect to re-consent — needed after the gmail.send scope add).
 */
export async function resolveGmailAccessToken(req: NextRequest): Promise<string | null> {
  let tokens = await getIntegrationToken('gmail');
  if (!tokens?.refreshToken) {
    const calendarTokens = await getIntegrationToken('calendar');
    if (calendarTokens?.refreshToken) {
      tokens = { accessToken: tokens?.accessToken || '', refreshToken: calendarTokens.refreshToken };
    }
  }

  const cookieStore = await cookies();
  const cookieAccess = cookieStore.get('nesio_gmail_access')?.value
    || cookieStore.get('nesio_google_calendar_access')?.value || '';
  const cookieRefresh = cookieStore.get('nesio_gmail_refresh')?.value
    || cookieStore.get('nesio_google_calendar_refresh')?.value || '';

  const candidates: Array<{ accessToken: string; refreshToken?: string }> = [];
  if (tokens) candidates.push(tokens);
  if ((cookieAccess || cookieRefresh)
    && (cookieAccess !== tokens?.accessToken || cookieRefresh !== (tokens?.refreshToken || ''))) {
    candidates.push({ accessToken: cookieAccess, refreshToken: cookieRefresh || undefined });
  }

  for (const cand of candidates) {
    if (cand.accessToken && await tokenWorks(cand.accessToken)) {
      return cand.accessToken;
    }
    if (cand.refreshToken) {
      const fresh = await refreshAccessToken(cand.refreshToken);
      if (fresh && await tokenWorks(fresh)) {
        // Heal Supabase + cookie so the next request skips the refresh.
        await saveIntegrationToken('gmail', { accessToken: fresh, refreshToken: cand.refreshToken }, req);
        return fresh;
      }
    }
  }
  return null;
}
