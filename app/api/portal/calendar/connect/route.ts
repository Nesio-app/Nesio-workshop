import { NextRequest, NextResponse } from 'next/server';
import {
  buildProductionRuntimeStatus,
  type ProductionRuntimeSetupTask,
} from '@/lib/portal/production-runtime';
import { envValue } from '@/lib/portal/env';

// Request gmail scope alongside calendar so one consent covers both connectors
// and the resulting refresh token can serve either API.
// 免费最大化·Google 扩展授权:与 gmail/connect 同步加 Drive/Tasks/People,一次授权覆盖。
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/contacts.readonly';
const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE = 'nesio_google_calendar_oauth_state';

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      ...body,
    },
    { status },
  );
}

function createCalendarOAuthAuditId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `calendar-oauth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logCalendarOAuthAudit(
  event: 'calendar_oauth_start' | 'calendar_oauth_blocked',
  payload: Record<string, string | number | boolean | null>,
) {
  console.info(event, {
    provider: 'google_calendar',
    ...payload,
  });
}

function callbackUrl(req: NextRequest): string {
  const configured = envValue('GOOGLE_CALENDAR_REDIRECT_URI');
  if (configured) return configured;
  const url = new URL(req.url);
  return `${url.origin}/api/portal/calendar/oauth/callback`;
}

function getGoogleCalendarSetupTask(req: NextRequest): ProductionRuntimeSetupTask | undefined {
  const status = buildProductionRuntimeStatus(process.env, {
    requestHost: req.headers.get('host'),
  });
  return status.setupTaskMatrix.find(
    (task) => task.id === 'google_calendar' && task.category === 'third_party',
  );
}

export async function GET(req: NextRequest) {
  const auditId = createCalendarOAuthAuditId();
  const clientId = envValue('GOOGLE_CLIENT_ID');
  const clientSecretConfigured = Boolean(envValue('GOOGLE_CLIENT_SECRET'));
  const setupTask = getGoogleCalendarSetupTask(req);

  if (setupTask?.blockedReason || !clientId || !clientSecretConfigured) {
    logCalendarOAuthAudit('calendar_oauth_blocked', {
      auditId,
      blockedReason: setupTask?.blockedReason || 'provider_not_configured',
    });
    return safeJson(
      {
        ok: false,
        error: setupTask?.blockedReason === 'canonical_domain_mismatch'
          ? 'canonical_domain_mismatch'
          : 'provider_not_configured',
        provider: 'google_calendar',
        auditId,
        missingEnv: [
          ...(!clientId ? ['GOOGLE_CLIENT_ID'] : []),
          ...(!clientSecretConfigured ? ['GOOGLE_CLIENT_SECRET'] : []),
        ],
        setupTask,
      },
      503,
    );
  }

  const state = `nesio_google_calendar:${auditId}`;
  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl(req));
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE);
  authorizeUrl.searchParams.set('access_type', 'offline');
  authorizeUrl.searchParams.set('prompt', 'consent');
  authorizeUrl.searchParams.set('state', state);

  logCalendarOAuthAudit('calendar_oauth_start', {
    auditId,
    redirectOrigin: new URL(callbackUrl(req)).origin,
  });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
