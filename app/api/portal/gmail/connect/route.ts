/**
 * GET /api/portal/gmail/connect
 * Starts Google OAuth flow with Gmail readonly scope.
 * Redirects user to Google consent screen.
 */
import { NextRequest, NextResponse } from 'next/server';

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
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

export async function GET(req: NextRequest) {
  const clientId = envValue('GOOGLE_CLIENT_ID');
  const clientSecret = envValue('GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { ok: false, error: 'provider_not_configured', missingEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
      { status: 503 },
    );
  }

  const state = `nesio_gmail:${Date.now()}`;
  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl(req));
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', GMAIL_SCOPE);
  authorizeUrl.searchParams.set('access_type', 'offline');
  authorizeUrl.searchParams.set('prompt', 'consent');
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
