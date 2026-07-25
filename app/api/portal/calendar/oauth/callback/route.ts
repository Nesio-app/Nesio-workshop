import { NextRequest, NextResponse } from 'next/server';
import { saveIntegrationToken } from '@/lib/portal/integrations';
import { envValue } from '@/lib/portal/env';

const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = 'nesio_google_calendar_oauth_state';

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

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
  // 与 connect 同逻辑:只在 env host 与当前 host 一致时用 env,否则用当前 origin。
  const url = new URL(req.url);
  const fallback = `${url.origin}${url.pathname}`;
  const configured = envValue('GOOGLE_CALENDAR_REDIRECT_URI');
  if (configured) {
    try {
      if (new URL(configured).host === url.host) return configured;
    } catch { /* 非法 URL → 用当前 origin */ }
  }
  return fallback;
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

  // Consent now covers both calendar + gmail scopes — mirror tokens to the
  // gmail cookie set so one authorization keeps both connectors alive.
  const grantsGmail = !session.scope || session.scope.includes('gmail');
  if (!grantsGmail) return;
  if (session.access_token) {
    response.cookies.set('nesio_gmail_access', session.access_token, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge,
    });
  }
  if (session.refresh_token) {
    response.cookies.set('nesio_gmail_refresh', session.refresh_token, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 90,
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
  if (session?.access_token) {
    setCalendarCookies(response, session);
    // 批次 10:此前这条回调只写 cookie,gmail route 走 Supabase 读不到,
    // 造成「日历正常、邮件永远授权失效」。同一份授权同时落 Supabase,
    // 登录会话有效时 gmail/calendar 两个 provider 都能跨设备读到。
    const stored = {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_in ? Date.now() + session.expires_in * 1000 : undefined,
      scope: session.scope,
    };
    await saveIntegrationToken('calendar', stored, req);
    if (!session.scope || session.scope.includes('gmail')) {
      await saveIntegrationToken('gmail', stored, req);
    }
  }
  return response;
}
