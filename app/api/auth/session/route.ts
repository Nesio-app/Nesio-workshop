import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

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
  const supabaseUrl = envValue('SUPABASE_URL');
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

export async function GET() {
  const cookieStore = cookies();
  const accessCookie = cookieStore.get('baohe_auth_access')?.value || '';
  const refreshCookie = cookieStore.get('baohe_auth_refresh')?.value || '';

  if (!accessCookie) {
    return safeJson({
      ok: true,
      loggedIn: false,
      hasRefreshToken: Boolean(refreshCookie),
      status: 'signed_out',
    });
  }

  const user = await fetchSupabaseUser(accessCookie);
  if (!user?.id) {
    return safeJson({
      ok: true,
      loggedIn: false,
      hasRefreshToken: Boolean(refreshCookie),
      status: 'session_unverified',
    });
  }

  return safeJson({
    ok: true,
    loggedIn: true,
    hasRefreshToken: Boolean(refreshCookie),
    status: 'signed_in',
    user: {
      id: user.id,
      email: user.email || '',
      phone: user.phone || '',
      provider: user.app_metadata?.provider || '',
      providers: user.app_metadata?.providers || [],
    },
  });
}
