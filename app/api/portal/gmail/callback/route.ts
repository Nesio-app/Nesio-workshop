/**
 * GET /api/portal/gmail/callback
 * Receives OAuth code from Google, exchanges for access+refresh tokens,
 * stores in HttpOnly cookies, redirects back to app.
 */
import { NextRequest, NextResponse } from 'next/server';

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
  error?: string;
};

function setGmailCookies(response: NextResponse, token: TokenResponse) {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = token.expires_in ?? 3600;
  if (token.access_token) {
    response.cookies.set('nesio_gmail_access', token.access_token, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge,
    });
  }
  if (token.refresh_token) {
    response.cookies.set('nesio_gmail_refresh', token.refresh_token, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30,
    });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;

  if (!code) {
    return NextResponse.redirect(new URL('/?connector=gmail&error=no_code', req.url));
  }

  // State validation (relaxed — just check prefix)
  if (!state?.startsWith('nesio_gmail:') || (stateCookie && stateCookie !== state)) {
    return NextResponse.redirect(new URL('/?connector=gmail&error=state_mismatch', req.url));
  }

  // Exchange code for tokens
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
    return NextResponse.redirect(new URL(`/?connector=gmail&error=${token.error || 'token_failed'}`, req.url));
  }

  const response = NextResponse.redirect(new URL('/?connector=gmail&status=connected', req.url));
  setGmailCookies(response, token);
  response.cookies.delete(STATE_COOKIE);
  return response;
}
