import { NextRequest, NextResponse } from 'next/server';

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

function envValue(key: string): string {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function safeRedirectUrl(req: NextRequest, params: Record<string, string>) {
  const target = new URL('/', req.url);
  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value);
  }
  return target;
}

function callbackUrl(req: NextRequest): string {
  const configured = envValue('GOOGLE_CALENDAR_REDIRECT_URI');
  if (configured) return configured;
  const url = new URL(req.url);
  return `${url.origin}${url.pathname}`;
}

function setCalendarCookies(response: NextResponse, session: GoogleTokenResponse) {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = Number.isFinite(session.expires_in) && session.expires_in ? session.expires_in : 60 * 60;
  if (session.access_token) {
    response.cookies.set('nesio_google_calendar_access', session.access_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge,
    });
  }
  if (session.refresh_token) {
    response.cookies.set('nesio_google_calendar_refresh', session.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 90,
    });
  }
}

async function exchangeGoogleCode(code: string, req: NextRequest): Promise<GoogleTokenResponse | null> {
  const clientId = envValue('GOOGLE_CLIENT_ID');
  const clientSecret = envValue('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret || !code) return null;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl(req),
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  });

  if (!response.ok) return null;
  return response.json() as Promise<GoogleTokenResponse>;
}

export async function GET(req: NextRequest) {
  const source = new URL(req.url);
  const error = source.searchParams.get('error') || '';
  const code = source.searchParams.get('code') || '';

  if (error) {
    return NextResponse.redirect(
      safeRedirectUrl(req, {
        safePublicStatus: 'true',
        secretsRedacted: 'true',
        calendar: 'google_oauth_failed',
        status: error,
      }),
    );
  }

  const session = await exchangeGoogleCode(code, req);
  const response = NextResponse.redirect(
    safeRedirectUrl(req, {
      safePublicStatus: 'true',
      secretsRedacted: 'true',
      calendar: session?.access_token ? 'google_oauth_connected' : 'google_oauth_failed',
      status: session?.access_token ? 'calendar_session_established' : 'calendar_token_exchange_failed',
    }),
  );

  if (session?.access_token) setCalendarCookies(response, session);
  return response;
}
