/**
 * GET /api/portal/gmail/callback
 * Receives OAuth code, exchanges for tokens, stores per-user via lib/portal/integrations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { saveIntegrationToken, setTokenCookiesOnResponse } from '@/lib/portal/integrations';

const STATE_COOKIE = 'nesio_gmail_oauth_state';

function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

function callbackUrl(req: NextRequest): string {
  const configured = envValue('GMAIL_REDIRECT_URI');
  if (configured) return configured;
  const url = new URL(req.url);
  return `${url.origin}/api/portal/gmail/callback`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');
  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;

  if (error === 'access_denied') {
    return NextResponse.redirect(new URL('/?connector=gmail&error=access_denied', req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL('/?connector=gmail&error=no_code', req.url));
  }
  if (stateCookie && state && stateCookie !== state) {
    return NextResponse.redirect(new URL('/?connector=gmail&error=state_mismatch', req.url));
  }

  // Exchange code → tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: envValue('GOOGLE_CLIENT_ID'),
      client_secret: envValue('GOOGLE_CLIENT_SECRET'),
      redirect_uri: callbackUrl(req),
      grant_type: 'authorization_code',
    }),
  });

  const token = await tokenRes.json() as TokenResponse;

  if (!token.access_token) {
    console.error('gmail_oauth_token_failed', token.error);
    return NextResponse.redirect(
      new URL(`/?connector=gmail&error=${encodeURIComponent(token.error || 'token_failed')}`, req.url),
    );
  }

  // Save token per user (Supabase + cookies)
  const savedTokens = await saveIntegrationToken(
    'gmail',
    {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
      scope: token.scope,
    },
    req,
  );

  const redirect = NextResponse.redirect(new URL('/?connector=gmail&status=connected', req.url));
  setTokenCookiesOnResponse(redirect, 'gmail', savedTokens);
  redirect.cookies.delete(STATE_COOKIE);
  return redirect;
}
