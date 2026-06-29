import { NextRequest, NextResponse } from 'next/server';
import { bootstrapCloudAccountProfile, buildCloudAccountProfileBootstrapMeta } from '@/lib/portal/cloud-account-profile';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';

type SupabaseTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

type WechatTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  openid?: string;
  scope?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

const SUPABASE_OTP_TYPES = new Set(['signup', 'magiclink', 'recovery', 'invite', 'email_change', 'email', 'sms', 'phone']);

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

function setAuthCookies(response: NextResponse, session: SupabaseTokenResponse) {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = Number.isFinite(session.expires_in) && session.expires_in ? session.expires_in : 60 * 60;
  if (session.access_token) {
    response.cookies.set('baohe_auth_access', session.access_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge,
    });
  }
  if (session.refresh_token) {
    response.cookies.set('baohe_auth_refresh', session.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

function setWechatCookies(response: NextResponse, session: WechatTokenResponse) {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = Number.isFinite(session.expires_in) && session.expires_in ? session.expires_in : 60 * 60 * 24 * 30;
  const cookies = response.cookies;

  cookies.set('baohe_auth_provider', 'wechat', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });
  if (session.openid) {
    cookies.set('baohe_wechat_openid', session.openid, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge,
    });
  }
  if (session.unionid) {
    cookies.set('baohe_wechat_unionid', session.unionid, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge,
    });
  }
  if (session.refresh_token) {
    cookies.set('baohe_wechat_refresh', session.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

function authHashBridgeHtml(provider: string) {
  const safeProvider = provider.replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown';
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nesio 登录中</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #eef6ff;
        color: #17223b;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(82vw, 360px);
        padding: 28px;
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.82);
        box-shadow: 0 24px 80px rgba(70, 115, 180, 0.18);
        text-align: center;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }
      p {
        margin: 0;
        color: #63708a;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>正在完成登录</h1>
      <p>请稍等一下，Nesio 正在建立你的本次会话。</p>
    </main>
    <script>
      (async function () {
        const provider = ${JSON.stringify(safeProvider)};
        const done = (status, extra) => {
          const params = new URLSearchParams({
            safePublicStatus: 'true',
            secretsRedacted: 'true',
            auth: status === 'session_established' ? 'auth_callback_received' : 'auth_callback_failed',
            provider,
            status,
            ...(extra || {})
          });
          window.location.replace('/?' + params.toString());
        };
        try {
          const hash = window.location.hash && window.location.hash.startsWith('#')
            ? window.location.hash.slice(1)
            : '';
          const params = new URLSearchParams(hash);
          const accessToken = (params.get('access_token') || '').trim();
          if (!accessToken) {
            done('callback_received_without_browser_token');
            return;
          }
          const response = await fetch('/api/auth/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accessToken,
              refreshToken: (params.get('refresh_token') || '').trim() || undefined,
              expiresIn: Number(params.get('expires_in') || '') || undefined,
              type: (params.get('type') || '').trim() || undefined
            }),
            cache: 'no-store'
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data || !data.ok) {
            done('session_import_failed');
            return;
          }
          done('session_established', {
            profileBootstrapStatus: data.profileBootstrapStatus || 'profile_bootstrap_unknown'
          });
        } catch (error) {
          done('session_import_failed');
        }
      })();
    </script>
  </body>
</html>`;
}

async function exchangeSupabaseCode(code: string, redirectTo: string): Promise<SupabaseTokenResponse | null> {
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const supabaseAnonKey = envValue('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=authorization_code`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_to: redirectTo,
    }),
  });

  if (!response.ok) return null;
  return response.json() as Promise<SupabaseTokenResponse>;
}

async function exchangeWechatCode(code: string): Promise<WechatTokenResponse | null> {
  const appId = envValue('WECHAT_APP_ID');
  const appSecret = envValue('WECHAT_APP_SECRET');
  if (!appId || !appSecret || !code) return null;

  const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', appSecret);
  url.searchParams.set('code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;
  const session = (await response.json()) as WechatTokenResponse;
  if (!session.openid || session.errcode) return null;
  return session;
}

async function verifySupabaseOtp(tokenHash: string, type: string): Promise<SupabaseTokenResponse | null> {
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const supabaseAnonKey = envValue('SUPABASE_ANON_KEY');
  const otpType = SUPABASE_OTP_TYPES.has(type) ? type : '';
  if (!supabaseUrl || !supabaseAnonKey || !tokenHash || !otpType) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token_hash: tokenHash,
      type: otpType,
    }),
  });

  if (!response.ok) return null;
  return response.json() as Promise<SupabaseTokenResponse>;
}

export async function GET(req: NextRequest) {
  const source = new URL(req.url);
  const provider = source.searchParams.get('provider') || source.searchParams.get('state') || 'unknown';
  const error = source.searchParams.get('error') || source.searchParams.get('error_code') || '';
  const code = source.searchParams.get('code') || '';
  const tokenHash = source.searchParams.get('token_hash') || '';
  const type = source.searchParams.get('type') || '';

  if (error) {
    const target = safeRedirectUrl(req, {
      safePublicStatus: 'true',
      secretsRedacted: 'true',
      auth: 'auth_callback_failed',
      provider,
      status: error,
    });

    return NextResponse.redirect(target);
  }

  if (provider === 'wechat' && code) {
    const session = await exchangeWechatCode(code);
    const target = safeRedirectUrl(req, {
      safePublicStatus: 'true',
      secretsRedacted: 'true',
      auth: session?.openid ? 'auth_callback_received' : 'auth_callback_failed',
      provider,
      status: session?.openid ? 'session_established' : 'wechat_exchange_failed',
    });
    const response = NextResponse.redirect(target);
    if (session?.openid) setWechatCookies(response, session);
    return response;
  }

  if (code) {
    const session = await exchangeSupabaseCode(code, `${source.origin}${source.pathname}`);
    const profileBootstrap = session?.access_token ? await bootstrapCloudAccountProfile(session?.access_token || '') : null;
    const profileBootstrapMeta = buildCloudAccountProfileBootstrapMeta(profileBootstrap);
    const target = safeRedirectUrl(req, {
      safePublicStatus: 'true',
      secretsRedacted: 'true',
      auth: session?.access_token ? 'auth_callback_received' : 'auth_callback_failed',
      provider,
      status: session?.access_token ? 'session_established' : 'session_exchange_failed',
      profileBootstrapStatus: session?.access_token ? profileBootstrapMeta.profileBootstrapStatus : 'profile_bootstrap_not_started',
    });
    const response = NextResponse.redirect(target);
    if (session?.access_token) {
      setAuthCookies(response, session);
    }
    return response;
  }

  if (tokenHash && type) {
    const session = await verifySupabaseOtp(tokenHash, type);
    const profileBootstrap = session?.access_token ? await bootstrapCloudAccountProfile(session?.access_token || '') : null;
    const profileBootstrapMeta = buildCloudAccountProfileBootstrapMeta(profileBootstrap);
    const target = safeRedirectUrl(req, {
      safePublicStatus: 'true',
      secretsRedacted: 'true',
      auth: session?.access_token ? 'auth_callback_received' : 'auth_callback_failed',
      provider,
      status: session?.access_token ? 'session_established' : 'otp_verify_failed',
      profileBootstrapStatus: session?.access_token ? profileBootstrapMeta.profileBootstrapStatus : 'profile_bootstrap_not_started',
    });
    const response = NextResponse.redirect(target);
    if (session?.access_token) {
      setAuthCookies(response, session);
    }
    return response;
  }

  return new NextResponse(authHashBridgeHtml(provider), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
