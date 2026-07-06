/**
 * GET /api/portal/gmail/callback
 * Receives OAuth code, exchanges for tokens, stores per-user via lib/portal/integrations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { saveIntegrationToken, setTokenCookiesOnResponse } from '@/lib/portal/integrations';
import { envValue } from '@/lib/portal/env';

const STATE_COOKIE = 'nesio_gmail_oauth_state';

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

  // 批次 15:请求了 gmail scope 但 Google 没授出(同意屏幕未配置该 scope /
  // 应用未过审时会被静默丢弃)——这是「重新授权后仍 403」死循环的根源,
  // 必须显式报错而不是让用户在授权页转圈。
  if (token.scope && !token.scope.includes('gmail')) {
    console.error('gmail_oauth_scope_not_granted', token.scope);
    return NextResponse.redirect(
      new URL('/?connector=gmail&error=gmail_scope_not_granted', req.url),
    );
  }

  // Consent now covers both gmail + calendar scopes — mirror tokens to the
  // calendar cookie set so one authorization keeps both connectors alive.
  const grantsCalendar = !token.scope || token.scope.includes('calendar');
  const redirect = NextResponse.redirect(new URL(
    grantsCalendar
      ? '/?connector=gmail&status=connected&calendar=google_oauth_connected'
      : '/?connector=gmail&status=connected',
    req.url,
  ));
  setTokenCookiesOnResponse(redirect, 'gmail', savedTokens);
  if (grantsCalendar) {
    await saveIntegrationToken('calendar', {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
      scope: token.scope,
    }, req);
    setTokenCookiesOnResponse(redirect, 'calendar', savedTokens);
  }
  redirect.cookies.delete(STATE_COOKIE);
  return redirect;
}
