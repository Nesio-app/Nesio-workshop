/**
 * GET /api/portal/tesla/connect
 * Starts the Tesla Fleet API OAuth flow (read-only Vehicle Info + Charging).
 * Sets a state cookie for CSRF protection, then redirects to Tesla's login.
 */
import { NextRequest, NextResponse } from 'next/server';
import { TESLA_AUTH_URL, TESLA_SCOPES, TESLA_AUDIENCE, teslaConfigured } from '@/lib/portal/tesla';
import { getRefreshedUserId } from '@/lib/portal/integrations';
import { signSessionValue } from '@/lib/portal/auth/session-sig';

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
  return `${url.origin}/api/portal/tesla/callback`;
}

function auditId(): string {
  return globalThis.crypto?.randomUUID?.() || `tesla-oauth-${Date.now().toString(36)}`;
}

export async function GET(req: NextRequest) {
  if (!teslaConfigured()) {
    console.info('tesla_oauth_blocked', { reason: 'provider_not_configured' });
    return NextResponse.json(
      {
        ok: false,
        error: 'provider_not_configured',
        provider: 'tesla',
        missingEnv: [
          ...(!envValue('TESLA_CLIENT_ID') ? ['TESLA_CLIENT_ID'] : []),
          ...(!envValue('TESLA_CLIENT_SECRET') ? ['TESLA_CLIENT_SECRET'] : []),
        ],
      },
      { status: 503 },
    );
  }

  // iOS PWA 修(同 gmail):发起侧(登录态)把 uid 签进 state,回调凭签归属 token,
  // 不依赖回调环境的 cookie。未登录/无密钥退回旧 state(cookie CSRF 路径不变)。
  const ts = Date.now();
  const uid = await getRefreshedUserId();
  const sig = uid ? signSessionValue(`nesio_tesla:${ts}:${uid}`) : '';
  const state = uid && sig ? `nesio_tesla:${ts}:${uid}:${sig}` : `nesio_tesla:${auditId()}`;
  const authorizeUrl = new URL(TESLA_AUTH_URL);
  authorizeUrl.searchParams.set('client_id', envValue('TESLA_CLIENT_ID'));
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl(req));
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', TESLA_SCOPES);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('audience', TESLA_AUDIENCE);

  console.info('tesla_oauth_start', { redirectOrigin: new URL(callbackUrl(req)).origin });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(TESLA_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
