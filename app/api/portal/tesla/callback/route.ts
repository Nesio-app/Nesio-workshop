/**
 * GET /api/portal/tesla/callback — Tesla Fleet API OAuth callback.
 * Verifies state (CSRF), exchanges the code for tokens, persists them to
 * Supabase (cross-device) and mirrors to HTTP-only cookies, then redirects home.
 */
import { NextRequest, NextResponse } from 'next/server';
import { exchangeTeslaCode } from '@/lib/portal/tesla';
import { saveIntegrationToken, setTokenCookiesOnResponse } from '@/lib/portal/integrations';

export const dynamic = 'force-dynamic';

const TESLA_OAUTH_STATE_COOKIE = 'nesio_tesla_oauth_state';

function envValue(key: string): string {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

function callbackUrl(req: NextRequest): string {
  const configured = envValue('TESLA_REDIRECT_URI');
  if (configured) return configured;
  const url = new URL(req.url);
  return `${url.origin}${url.pathname}`;
}

function safeRedirectUrl(req: NextRequest, params: Record<string, string>) {
  const target = new URL('/', req.url);
  for (const [k, v] of Object.entries(params)) if (v) target.searchParams.set(k, v);
  return target;
}

export async function GET(req: NextRequest) {
  const source = new URL(req.url);
  const error = source.searchParams.get('error') || '';
  const code = source.searchParams.get('code') || '';
  const returnedState = source.searchParams.get('state') || '';
  const storedState = req.cookies.get(TESLA_OAUTH_STATE_COOKIE)?.value || '';

  // CSRF: returned state must match the cookie we set at /connect.
  if (!returnedState || !storedState || returnedState !== storedState) {
    console.warn('tesla_oauth_failure', { reason: 'tesla_oauth_state_mismatch' });
    const response = NextResponse.redirect(safeRedirectUrl(req, { tesla: 'oauth_failed', status: 'tesla_oauth_state_mismatch' }));
    response.cookies.delete(TESLA_OAUTH_STATE_COOKIE);
    return response;
  }

  if (error) {
    console.warn('tesla_oauth_failure', { reason: error });
    const response = NextResponse.redirect(safeRedirectUrl(req, { tesla: 'oauth_failed', status: error }));
    response.cookies.delete(TESLA_OAUTH_STATE_COOKIE);
    return response;
  }

  const tokens = await exchangeTeslaCode(code, callbackUrl(req));
  console.info(tokens?.accessToken ? 'tesla_oauth_success' : 'tesla_oauth_failure', {
    reason: tokens?.accessToken ? 'tesla_session_established' : 'tesla_token_exchange_failed',
  });

  const response = NextResponse.redirect(safeRedirectUrl(req, {
    tesla: tokens?.accessToken ? 'oauth_connected' : 'oauth_failed',
    status: tokens?.accessToken ? 'tesla_session_established' : 'tesla_token_exchange_failed',
  }));
  response.cookies.delete(TESLA_OAUTH_STATE_COOKIE);

  if (tokens?.accessToken) {
    const stored = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    };
    await saveIntegrationToken('tesla', stored, req);
    setTokenCookiesOnResponse(response, 'tesla', { ...stored, connectedAt: new Date().toISOString() });
  }
  return response;
}
