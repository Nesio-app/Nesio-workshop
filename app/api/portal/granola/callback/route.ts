/**
 * GET /api/portal/granola/callback  (批次 157)
 * Granola OAuth 回调 —— 校验 state → 用授权码 + PKCE verifier 换 bearer token → 存到该用户名下。
 * 授权服务器元数据在这里重新发现(不塞进 cookie,保持 cookie 小),再做 code 交换。
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  discoverAuthorizationServerMetadata,
  exchangeAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { saveIntegrationToken } from '@/lib/portal/integrations';
import { GRANOLA_OAUTH_COOKIE } from '../connect/route';

export const dynamic = 'force-dynamic';

function fail(origin: string, reason: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/?granola=connect_failed&reason=${encodeURIComponent(reason.slice(0, 80))}`, origin));
  res.cookies.delete(GRANOLA_OAUTH_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error');
  if (oauthErr) return fail(origin, oauthErr);
  if (!code || !state) return fail(origin, 'missing_code');

  const raw = req.cookies.get(GRANOLA_OAUTH_COOKIE)?.value;
  if (!raw) return fail(origin, 'no_oauth_state');

  let stash: {
    state: string; codeVerifier: string; clientId: string; clientSecret: string | null;
    authServerUrl: string; resource: string; redirectUri: string;
  };
  try {
    stash = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    return fail(origin, 'bad_oauth_state');
  }
  if (stash.state !== state) return fail(origin, 'state_mismatch'); // CSRF 防线

  try {
    const metadata = await discoverAuthorizationServerMetadata(stash.authServerUrl);
    const tokens = await exchangeAuthorization(stash.authServerUrl, {
      metadata,
      clientInformation: { client_id: stash.clientId, ...(stash.clientSecret ? { client_secret: stash.clientSecret } : {}) },
      authorizationCode: code,
      codeVerifier: stash.codeVerifier,
      redirectUri: stash.redirectUri,
      resource: new URL(stash.resource),
    });

    await saveIntegrationToken('granola', {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      scope: tokens.scope,
    }, req);

    const res = NextResponse.redirect(new URL('/?granola=connected', origin));
    res.cookies.delete(GRANOLA_OAUTH_COOKIE);
    return res;
  } catch (err) {
    return fail(origin, err instanceof Error ? err.message : 'exchange_failed');
  }
}
