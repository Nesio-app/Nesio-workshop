import { NextRequest, NextResponse } from 'next/server';
import {
  buildProductionRuntimeStatus,
  type ProductionRuntimeSetupTask,
} from '@/lib/portal/production-runtime';
import { envValue } from '@/lib/portal/env';
import { isPortalRequestAuthorized } from '@/lib/portal/auth/api-auth';

// Request gmail scope alongside calendar so one consent covers both connectors
// and the resulting refresh token can serve either API.
// 免费最大化·Google 扩展授权:与 gmail/connect 同步加 Drive/Tasks/People,一次授权覆盖。
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/contacts.readonly';
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
  // 回调跟随发起域名:只在 env host 与当前 host 一致时用 env,否则用当前 origin,
  // 避免 env 被钉到 sibling 部署(nesio)导致 workshop 连接被甩走、令牌落错库。
  const url = new URL(req.url);
  const fallback = `${url.origin}/api/portal/calendar/oauth/callback`;
  const configured = envValue('GOOGLE_CALENDAR_REDIRECT_URI');
  if (configured) {
    try {
      if (new URL(configured).host === url.host) return configured;
    } catch { /* 非法 URL → 用当前 origin */ }
  }
  return fallback;
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
  // P0 隐私:连接私有数据源(日历)必须先登录 —— 匿名授权 = 无主 token(见 gmail/connect)。
  if (!(await isPortalRequestAuthorized(req))) {
    const url = new URL(req.url);
    return NextResponse.redirect(new URL('/login?reason=connect_requires_account', url.origin));
  }

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
