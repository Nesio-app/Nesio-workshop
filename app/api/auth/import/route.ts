import { NextRequest, NextResponse } from 'next/server';
import { bootstrapCloudAccountProfile, buildCloudAccountProfileBootstrapMeta } from '@/lib/portal/cloud-account-profile';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { envValue } from '@/lib/portal/env';

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  phone?: string;
  created_at?: string;
  app_metadata?: {
    provider?: string;
    providers?: string[];
  };
};

type AuthImportMode = 'login' | 'register';

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

async function fetchSupabaseUser(accessToken: string): Promise<SupabaseUserResponse | null> {
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const supabaseAnonKey = envValue('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !accessToken) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) return null;
  return response.json() as Promise<SupabaseUserResponse>;
}

function setAuthCookies(
  response: NextResponse,
  session: { accessToken: string; refreshToken?: string; expiresIn?: number; provider?: string },
) {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge =
    Number.isFinite(session.expiresIn) && session.expiresIn && session.expiresIn > 0
      ? Math.min(session.expiresIn, 60 * 60 * 24)
      : 60 * 60;

  response.cookies.set('baohe_auth_access', session.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });

  if (session.refreshToken) {
    response.cookies.set('baohe_auth_refresh', session.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  if (session.provider) {
    response.cookies.set('baohe_auth_provider', session.provider, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

function normalizeAuthType(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  return normalized || 'unknown';
}

function deriveAuthMode(authType: string): AuthImportMode {
  if (authType === 'signup' || authType === 'invite') return 'register';
  if (authType === 'magiclink' || authType === 'recovery' || authType === 'unknown') return 'login';
  return 'login';
}

function normalizeAuthProvider(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

export async function POST(req: NextRequest) {
  let body: {
    accessToken?: unknown;
    refreshToken?: unknown;
    expiresIn?: unknown;
    type?: unknown;
    intent?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return safeJson({ ok: false, loggedIn: false, status: 'invalid_json' }, 400);
  }

  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';
  const expiresIn = typeof body.expiresIn === 'number' ? body.expiresIn : Number(body.expiresIn);
  const authType = normalizeAuthType(body.type);
  const authMode = deriveAuthMode(authType);
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const supabaseAnonKey = envValue('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    return safeJson({ ok: false, loggedIn: false, status: 'missing_supabase_config' }, 503);
  }

  if (!accessToken) {
    return safeJson({ ok: false, loggedIn: false, status: 'missing_access_token' }, 400);
  }

  const user = await fetchSupabaseUser(accessToken);
  if (!user?.id) {
    return safeJson({ ok: false, loggedIn: false, status: 'invalid_access_token' }, 401);
  }

  // 批次 31 QA:「登录」tab 走 Google/Apple,OAuth 对没注册过的账号也会静默建号 ——
  // 用户要求:登录只认已注册账号,新账号提示先去注册。判据:意图=login + OAuth
  // provider + 账号刚刚建立(created_at 在 10 分钟内 = 本次 OAuth 顺手创建的)。
  // 不落 cookie,前端跳回登录页给「先创建账号」提示。
  const intent = typeof body.intent === 'string' ? body.intent : '';
  const oauthProvider = normalizeAuthProvider(user.app_metadata?.provider);
  if (intent === 'login' && (oauthProvider === 'google' || oauthProvider === 'apple') && user.created_at) {
    const ageMs = Date.now() - new Date(user.created_at).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 10 * 60_000) {
      return safeJson({ ok: false, loggedIn: false, status: 'account_not_registered', authProvider: oauthProvider });
    }
  }

  const profileBootstrap = await bootstrapCloudAccountProfile(accessToken);
  const profileBootstrapMeta = buildCloudAccountProfileBootstrapMeta(profileBootstrap);
  const authProvider = normalizeAuthProvider(user.app_metadata?.provider);

  const response = safeJson({
    ok: true,
    loggedIn: true,
    hasRefreshToken: Boolean(refreshToken),
    status: 'session_imported',
    authType,
    authMode,
    profileBootstrapped: profileBootstrapMeta.profileBootstrapped,
    profileBootstrapStatus: profileBootstrapMeta.profileBootstrapStatus,
    profileBootstrapBlocking: profileBootstrapMeta.profileBootstrapBlocking,
    authReady: profileBootstrapMeta.authReady,
    user: {
      id: user.id,
      email: user.email || '',
      phone: user.phone || '',
      provider: authProvider,
      providers: user.app_metadata?.providers || [],
    },
  });

  setAuthCookies(response, {
    accessToken,
    refreshToken,
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
    provider: authProvider,
  });

  return response;
}
