import { NextRequest, NextResponse } from 'next/server';
import { normalizeSupabaseRuntimeUrl } from '@/lib/portal/production-runtime';

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  phone?: string;
  app_metadata?: {
    provider?: string;
    providers?: string[];
  };
};

function envValue(key: string): string {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

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
  session: { accessToken: string; refreshToken?: string; expiresIn?: number },
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
}

export async function POST(req: NextRequest) {
  let body: {
    accessToken?: unknown;
    refreshToken?: unknown;
    expiresIn?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return safeJson({ ok: false, loggedIn: false, status: 'invalid_json' }, 400);
  }

  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';
  const expiresIn = typeof body.expiresIn === 'number' ? body.expiresIn : Number(body.expiresIn);
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

  const response = safeJson({
    ok: true,
    loggedIn: true,
    hasRefreshToken: Boolean(refreshToken),
    status: 'session_imported',
    user: {
      id: user.id,
      email: user.email || '',
      phone: user.phone || '',
      provider: user.app_metadata?.provider || '',
      providers: user.app_metadata?.providers || [],
    },
  });

  setAuthCookies(response, {
    accessToken,
    refreshToken,
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
  });

  return response;
}
