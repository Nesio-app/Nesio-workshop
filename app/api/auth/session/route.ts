import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  BootstrapResult,
  bootstrapCloudAccountProfile,
  buildCloudAccountProfileBootstrapMeta,
} from '@/lib/portal/cloud-account-profile';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { envValue } from '@/lib/portal/env';

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  phone?: string;
  app_metadata?: {
    provider?: string;
    providers?: string[];
  };
};

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

type SupabaseTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

function setRefreshedAuthCookies(response: NextResponse, session: SupabaseTokenResponse | null) {
  if (!session?.access_token) return response;

  const secure = process.env.NODE_ENV === 'production';
  const maxAge = Number.isFinite(session.expires_in) && session.expires_in ? session.expires_in : 60 * 60;
  response.cookies.set('baohe_auth_access', session.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });
  if (session.refresh_token) {
    response.cookies.set('baohe_auth_refresh', session.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
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

async function refreshSupabaseSession(refreshToken: string): Promise<SupabaseTokenResponse | null> {
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const supabaseAnonKey = envValue('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !refreshToken) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) return null;
  return response.json() as Promise<SupabaseTokenResponse>;
}

function signedInResponse(
  user: SupabaseUserResponse,
  hasRefreshToken: boolean,
  refreshedSession: SupabaseTokenResponse | null = null,
  profileBootstrap: BootstrapResult | null = null,
) {
  const profileBootstrapMeta = buildCloudAccountProfileBootstrapMeta(profileBootstrap);
  const response = safeJson({
    ok: true,
    loggedIn: true,
    hasRefreshToken,
    status: refreshedSession?.access_token ? 'session_refreshed' : 'signed_in',
    profileBootstrapped: profileBootstrapMeta.profileBootstrapped,
    profileBootstrapStatus: profileBootstrapMeta.profileBootstrapStatus,
    profileBootstrapBlocking: profileBootstrapMeta.profileBootstrapBlocking,
    authReady: profileBootstrapMeta.authReady,
    user: {
      id: user.id,
      email: user.email || '',
      phone: user.phone || '',
      provider: user.app_metadata?.provider || '',
      providers: user.app_metadata?.providers || [],
    },
  });

  return setRefreshedAuthCookies(response, refreshedSession);
}

export async function GET() {
  const cookieStore = await cookies();
  const accessCookie = cookieStore.get('baohe_auth_access')?.value || '';
  const refreshCookie = cookieStore.get('baohe_auth_refresh')?.value || '';
  const authProviderCookie = cookieStore.get('baohe_auth_provider')?.value || '';
  const wechatOpenidCookie = cookieStore.get('baohe_wechat_openid')?.value || '';

  if (accessCookie) {
    const user = await fetchSupabaseUser(accessCookie);
    if (user?.id) {
      const profileBootstrap = await bootstrapCloudAccountProfile(accessCookie);
      return signedInResponse(user, Boolean(refreshCookie), null, profileBootstrap);
    }
  }

  if (refreshCookie) {
    const refreshedSession = await refreshSupabaseSession(refreshCookie);
    if (refreshedSession?.access_token) {
      const refreshedUser = await fetchSupabaseUser(refreshedSession.access_token);
      if (refreshedUser?.id) {
        const profileBootstrap = await bootstrapCloudAccountProfile(refreshedSession.access_token);
        return signedInResponse(refreshedUser, true, refreshedSession, profileBootstrap);
      }
    }
  }

  // No Supabase configured → local-only mode: treat user as authenticated.
  // Ignore stale auth cookies when there's no Supabase to validate them against;
  // checking !accessCookie blocked users who had leftover cookies from a previous setup.
  const supabaseConfigured = Boolean(envValue('SUPABASE_URL') && envValue('SUPABASE_ANON_KEY'));
  if (!supabaseConfigured && !wechatOpenidCookie) {
    return safeJson({
      ok: true,
      loggedIn: true,
      hasRefreshToken: false,
      status: 'signed_in',
      viewerRole: 'local',
      user: {
        id: 'local',
        email: '',
        phone: '',
        provider: 'local',
        providers: ['local'],
      },
    });
  }

  if (authProviderCookie === 'wechat' && wechatOpenidCookie) {
    return safeJson({
      ok: true,
      loggedIn: true,
      hasRefreshToken: false,
      status: 'signed_in',
      user: {
        id: `wechat_openid:${wechatOpenidCookie}`,
        email: '',
        phone: '',
        provider: 'wechat',
        providers: ['wechat'],
      },
    });
  }

  if (!accessCookie) {
    return safeJson({
      ok: true,
      loggedIn: false,
      hasRefreshToken: Boolean(refreshCookie),
      status: 'signed_out',
    });
  }

  return safeJson({
    ok: true,
    loggedIn: false,
    hasRefreshToken: Boolean(refreshCookie),
    status: 'session_unverified',
  });
}
