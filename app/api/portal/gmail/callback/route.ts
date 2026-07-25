/**
 * GET /api/portal/gmail/callback
 * Receives OAuth code, exchanges for tokens, stores per-user via lib/portal/integrations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { saveIntegrationToken, saveIntegrationTokenByUserId, setTokenCookiesOnResponse } from '@/lib/portal/integrations';
import { envValue } from '@/lib/portal/env';
import { verifySessionValue } from '@/lib/portal/auth/session-sig';

const STATE_COOKIE = 'nesio_gmail_oauth_state';
// 签名 state 的有效窗口:发起→回调正常几十秒,15 分钟足够宽,过期即忽略 uid
// (退回 cookie 归属),防旧 state 被重放做账号绑定。
const SIGNED_STATE_TTL_MS = 15 * 60 * 1000;

/** 解析签名 state(nesio_gmail:<ts>:<uid>:<sig>),验签+验时效,失败返回 null。 */
function verifiedStateUid(state: string | null): string | null {
  if (!state) return null;
  const parts = state.split(':');
  if (parts.length !== 4 || parts[0] !== 'nesio_gmail') return null;
  const [prefix, ts, uid, sig] = parts;
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > SIGNED_STATE_TTL_MS) return null;
  return verifySessionValue(`${prefix}:${ts}:${uid}`, sig) ? uid : null;
}

function callbackUrl(req: NextRequest): string {
  // 必须与 connect 侧同逻辑(token 交换的 redirect_uri 要和授权时完全一致):
  // 只在 env host 与当前 host 一致时用 env,否则用当前 origin。见 connect 路由注释。
  const url = new URL(req.url);
  const fallback = `${url.origin}/api/portal/gmail/callback`;
  const configured = envValue('GMAIL_REDIRECT_URI');
  if (configured) {
    try {
      if (new URL(configured).host === url.host) return configured;
    } catch { /* 配置非法 URL → 用当前 origin 兜底 */ }
  }
  return fallback;
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
  const tokenPayload = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
    scope: token.scope,
  };
  const savedTokens = await saveIntegrationToken('gmail', tokenPayload, req);
  // iOS PWA:回调跑在独立存储的应用内浏览器里,请求不带主环境登录 cookie,
  // 上面的 cookie 归属会静默跳过 Supabase —— 用发起侧签进 state 的 uid 兜底,
  // service role 直写该用户(验签+15min 时效,伪造/重放不认)。
  const stateUid = verifiedStateUid(state);
  if (stateUid) {
    const wrote = await saveIntegrationTokenByUserId(stateUid, 'gmail', tokenPayload);
    if (!wrote) console.error('gmail_oauth_state_uid_save_failed', stateUid.slice(0, 8));
  }

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
    await saveIntegrationToken('calendar', tokenPayload, req);
    if (stateUid) await saveIntegrationTokenByUserId(stateUid, 'calendar', tokenPayload);
    setTokenCookiesOnResponse(redirect, 'calendar', savedTokens);
  }
  redirect.cookies.delete(STATE_COOKIE);
  return redirect;
}
