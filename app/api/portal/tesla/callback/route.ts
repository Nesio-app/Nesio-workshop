/**
 * GET /api/portal/tesla/callback — Tesla Fleet API OAuth callback.
 * Verifies state (CSRF), exchanges the code for tokens, persists them to
 * Supabase (cross-device) and mirrors to HTTP-only cookies, then redirects home.
 */
import { NextRequest, NextResponse } from 'next/server';
import { exchangeTeslaCode, registerPartnerAccount } from '@/lib/portal/tesla';
import { saveIntegrationToken, saveIntegrationTokenByUserId, setTokenCookiesOnResponse } from '@/lib/portal/integrations';
import { verifySessionValue } from '@/lib/portal/auth/session-sig';

export const dynamic = 'force-dynamic';

const TESLA_OAUTH_STATE_COOKIE = 'nesio_tesla_oauth_state';
// 签名 state 有效窗(同 gmail 修法):防旧 state 重放做账号绑定。
const SIGNED_STATE_TTL_MS = 15 * 60 * 1000;

/** 解析签名 state(nesio_tesla:<ts>:<uid>:<sig>),验签+验时效,失败返回 null。 */
function verifiedStateUid(state: string): string | null {
  const parts = state.split(':');
  if (parts.length !== 4 || parts[0] !== 'nesio_tesla') return null;
  const [prefix, ts, uid, sig] = parts;
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > SIGNED_STATE_TTL_MS) return null;
  return verifySessionValue(`${prefix}:${ts}:${uid}`, sig) ? uid : null;
}

function envValue(key: string): string {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

function callbackUrl(req: NextRequest): string {
  const configured = envValue('TESLA_REDIRECT_URI');
  if (configured) return configured;
  const url = new URL(req.url);
  return `${url.origin}${url.pathname}`;
}

function safeRedirectUrl(req: NextRequest, params: Record<string, string>) {
  const target = new URL('/', req.url);
  for (const [k, v] of Object.entries(params)) if (v) target.searchParams.set(k, v);
  return target;
}

export async function GET(req: NextRequest) {
  const source = new URL(req.url);
  const error = source.searchParams.get('error') || '';
  const code = source.searchParams.get('code') || '';
  const returnedState = source.searchParams.get('state') || '';
  const storedState = req.cookies.get(TESLA_OAUTH_STATE_COOKIE)?.value || '';

  // CSRF:同环境走 cookie 比对;iOS PWA 的回调落在独立存储的应用内浏览器
  // (cookie 必缺,此前在这里必挂)→ 改认发起侧签名的 state(只有服务端能签,
  // 带 15min 时效),两条路都不通才拒。
  const signedUid = returnedState ? verifiedStateUid(returnedState) : null;
  const cookieStateOk = Boolean(returnedState && storedState && returnedState === storedState);
  if (!cookieStateOk && !signedUid) {
    console.warn('tesla_oauth_failure', { reason: 'tesla_oauth_state_mismatch' });
    const response = NextResponse.redirect(safeRedirectUrl(req, { tesla: 'oauth_failed', status: 'tesla_oauth_state_mismatch' }));
    response.cookies.delete(TESLA_OAUTH_STATE_COOKIE);
    return response;
  }

  if (error) {
    console.warn('tesla_oauth_failure', { reason: error });
    const response = NextResponse.redirect(safeRedirectUrl(req, { tesla: 'oauth_failed', status: error }));
    response.cookies.delete(TESLA_OAUTH_STATE_COOKIE);
    return response;
  }

  const tokens = await exchangeTeslaCode(code, callbackUrl(req));
  console.info(tokens?.accessToken ? 'tesla_oauth_success' : 'tesla_oauth_failure', {
    reason: tokens?.accessToken ? 'tesla_session_established' : 'tesla_token_exchange_failed',
  });

  const response = NextResponse.redirect(safeRedirectUrl(req, {
    tesla: tokens?.accessToken ? 'oauth_connected' : 'oauth_failed',
    status: tokens?.accessToken ? 'tesla_session_established' : 'tesla_token_exchange_failed',
  }));
  response.cookies.delete(TESLA_OAUTH_STATE_COOKIE);

  if (tokens?.accessToken) {
    const stored = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    };
    await saveIntegrationToken('tesla', stored, req);
    // 跨环境归属:回调环境没有登录 cookie 时,凭发起侧签进 state 的 uid 直写云端。
    if (signedUid) {
      const wrote = await saveIntegrationTokenByUserId(signedUid, 'tesla', stored);
      if (!wrote) console.error('tesla_oauth_state_uid_save_failed', signedUid.slice(0, 8));
    }
    // 合作方域名注册(幂等):域名切换后没人对新域名重新注册过,Fleet API 会拒
    // 数据调用。授权成功顺手补一次;前提是本域名能服务公钥(TESLA_PUBLIC_KEY
    // 已配),失败只记日志不拦流程。
    const partnerDomain = new URL(callbackUrl(req)).hostname;
    registerPartnerAccount(partnerDomain)
      .then((ok) => console.info('tesla_partner_register_on_callback', { domain: partnerDomain, ok }))
      .catch(() => {});
    setTokenCookiesOnResponse(response, 'tesla', { ...stored, connectedAt: new Date().toISOString() });
  }
  return response;
}
