/**
 * POST /api/portal/tesla/disconnect
 * Real revoke闭环: best-effort revoke at Tesla + clear the token cookies.
 * (Mirrors the Google disconnect route — "disconnect" must mean revoke,
 * not just flip a localStorage flag; see security-audit S2.)
 *
 * Note: this clears the cookie copy. The Supabase-stored token for the
 * logged-in user should also be cleared by overwriting on next connect;
 * we revoke at Tesla here so the grant itself dies.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isPortalRequestAuthorized, isRateLimited } from '@/lib/portal/api-auth';
import { getIntegrationToken, saveIntegrationToken } from '@/lib/portal/integrations';
import { revokeTeslaToken } from '@/lib/portal/tesla';

export const dynamic = 'force-dynamic';

const COOKIE_NAMES = ['nesio_tesla_access', 'nesio_tesla_refresh'];

export async function POST(req: NextRequest) {
  if (!(await isPortalRequestAuthorized(req))) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });
  }
  if (isRateLimited(req, 'tesla_disconnect', { limit: 10 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const token = await getIntegrationToken('tesla');
  let revoked = false;
  // Revoking the refresh token kills the grant; fall back to access token.
  for (const t of [token?.refreshToken, token?.accessToken].filter((v): v is string => Boolean(v))) {
    if (await revokeTeslaToken(t)) { revoked = true; break; }
  }

  // Overwrite the Supabase-stored token so it can't be read/refreshed again.
  try { await saveIntegrationToken('tesla', { accessToken: '' }, req); } catch { /* best effort */ }

  const response = NextResponse.json({ ok: true, revoked, hadTokens: Boolean(token?.accessToken || token?.refreshToken) });
  const secure = process.env.NODE_ENV === 'production';
  for (const name of COOKIE_NAMES) {
    response.cookies.set(name, '', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0 });
  }
  return response;
}
