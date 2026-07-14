import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';
import { envValue } from '@/lib/portal/env';

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

function expireAuthCookie(
  response: NextResponse,
  name:
    | 'baohe_auth_access'
    | 'baohe_auth_refresh'
    | 'baohe_auth_provider'
    | 'baohe_wechat_openid'
    | 'baohe_wechat_unionid'
    | 'baohe_wechat_refresh'
    | 'baohe_auth_sig'
    | 'baohe_wechat_sig'
    | 'nesio_google_calendar_access'
    | 'nesio_google_calendar_refresh',
) {
  response.cookies.set(name, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

async function revokeSupabaseSession(accessToken: string): Promise<boolean> {
  const supabaseUrl = normalizeSupabaseRuntimeUrl(envValue('SUPABASE_URL'));
  const supabaseAnonKey = envValue('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !accessToken) return false;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function POST() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || '';
  const supabaseRevoked = await revokeSupabaseSession(accessToken);
  const response = safeJson({
    ok: true,
    signedOut: true,
    supabaseRevoked,
  });

  expireAuthCookie(response, 'baohe_auth_access');
  expireAuthCookie(response, 'baohe_auth_refresh');
  expireAuthCookie(response, 'baohe_auth_provider');
  expireAuthCookie(response, 'baohe_wechat_openid');
  expireAuthCookie(response, 'baohe_wechat_unionid');
  expireAuthCookie(response, 'baohe_wechat_refresh');
  expireAuthCookie(response, 'baohe_auth_sig'); // 安全审计 #8:配套签名 cookie 一并清
  expireAuthCookie(response, 'baohe_wechat_sig');
  expireAuthCookie(response, 'nesio_google_calendar_access');
  expireAuthCookie(response, 'nesio_google_calendar_refresh');

  return response;
}
