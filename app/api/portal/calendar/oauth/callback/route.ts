import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = 'nesio_google_calendar_oauth_state';

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

function createCalendarOAuthAuditId(state: string): string {
  const [, auditId] = state.split(':');
  if (auditId) return auditId;
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `calendar-oauth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logCalendarOAuthAudit(
  event: 'calendar_oauth_callback' | 'calendar_oauth_failure' | 'calendar_oauth_success',
  payload: Record<string, string | number | boolean | null>,
) {
  if (event === 'calendar_oauth_failure') {
    console.warn(event, {
      provider: 'google_calendar',
      ...payload,
    });
    return;
  }
  console.info(event, {
    provider: 'google_calendar',
    ...payload,
  });
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
  const returnedState = source.searchParams.get('state') || '';
  const storedState = req.cookies.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value || '';
  const auditId = createCalendarOAuthAuditId(returnedState || storedState);

  logCalendarOAuthAudit('calendar_oauth_callback', {
    auditId,
    hasCode: Boolean(code),
    hasError: Boolean(error),
    statePresent: Boolean(returnedState),
  });

  if (!returnedState || !storedState || returnedState !== storedState) {
    logCalendarOAuthAudit('calendar_oauth_failure', {
      auditId,
      reason: 'calendar_oauth_state_mismatch',
    });
    const response = NextResponse.redirect(
      safeRedirectUrl(req, {
        safePublicStatus: 'true',
        secretsRedacted: 'true',
        calendar: 'google_oauth_failed',
        status: 'calendar_oauth_state_mismatch',
        auditId,
      }),
    );
    response.cookies.delete(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE);
    return response;
  }

  if (error) {
    logCalendarOAuthAudit('calendar_oauth_failure', {
      auditId,
      reason: error,
    });
    const response = NextResponse.redirect(
      safeRedirectUrl(req, {
        safePublicStatus: 'true',
        secretsRedacted: 'true',
        calendar: 'google_oauth_failed',
        status: error,
        auditId,
      }),
    );
    response.cookies.delete(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE);
    return response;
  }

  const session = await exchangeGoogleCode(code, req);
  logCalendarOAuthAudit(session?.access_token ? 'calendar_oauth_success' : 'calendar_oauth_failure', {
    auditId,
    reason: session?.access_token ? 'calendar_session_established' : 'calendar_token_exchange_failed',
  });
  const response = NextResponse.redirect(
    safeRedirectUrl(req, {
      safePublicStatus: 'true',
      secretsRedacted: 'true',
      calendar: session?.access_token ? 'google_oauth_connected' : 'google_oauth_failed',
      status: session?.access_token ? 'calendar_session_established' : 'calendar_token_exchange_failed',
      auditId,
    }),
  );

  response.cookies.delete(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE);
  if (session?.access_token) setCalendarCookies(response, session);
  return response;
}
