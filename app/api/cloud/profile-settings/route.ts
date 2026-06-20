import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

type SupabaseUserResponse = {
  id?: string;
  email?: string;
  phone?: string;
};

type ProfileSettings = {
  displayName?: string;
  avatarUrl?: string;
  locale?: string;
  displayLanguage?: string;
  coachStyle?: string;
  theme?: string;
  calendarUrl?: string;
};

const allowedSettingsKeys = [
  'displayName',
  'avatarUrl',
  'locale',
  'displayLanguage',
  'coachStyle',
  'theme',
  'calendarUrl',
] as const;

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

function getCloudConfig() {
  const enabled = envValue('CLOUD_DB_ENABLED').toLowerCase() === 'true';
  const supabaseUrl = envValue('SUPABASE_URL');
  const anonKey = envValue('SUPABASE_ANON_KEY');
  const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  const configured = enabled && Boolean(supabaseUrl && anonKey && serviceRoleKey);

  return {
    configured,
    enabled,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
  };
}

function sanitizeSettings(input: unknown): ProfileSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const output: ProfileSettings = {};

  for (const key of allowedSettingsKeys) {
    const value = raw[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 2000) continue;
    output[key] = trimmed;
  }

  return output;
}

async function getSignedInUser(config: ReturnType<typeof getCloudConfig>): Promise<SupabaseUserResponse | null> {
  const accessToken = cookies().get('baohe_auth_access')?.value || '';
  if (!accessToken) return null;

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) return null;
  return response.json() as Promise<SupabaseUserResponse>;
}

function restHeaders(config: ReturnType<typeof getCloudConfig>) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
    accept: 'application/json',
  };
}

export async function GET() {
  const config = getCloudConfig();
  if (!config.configured) {
    return safeJson(
      {
        ok: false,
        error: 'cloud_not_configured',
        readsCloud: false,
        writesCloud: false,
      },
      503,
    );
  }

  const user = await getSignedInUser(config);
  if (!user?.id) {
    return safeJson(
      {
        ok: false,
        error: 'not_signed_in',
        readsCloud: false,
        writesCloud: false,
      },
      401,
    );
  }

  try {
    const url = new URL('/rest/v1/profile_settings', config.supabaseUrl);
    url.searchParams.set('user_id', `eq.${user.id}`);
    url.searchParams.set('select', 'settings,updated_at');
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      headers: restHeaders(config),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase REST read failed: ${response.status}`);
    const rows = (await response.json()) as Array<{ settings?: unknown; updated_at?: string }>;
    const row = rows[0];

    return safeJson({
      ok: true,
      readsCloud: true,
      writesCloud: false,
      settings: sanitizeSettings(row?.settings),
      updatedAt: row?.updated_at || null,
    });
  } catch {
    return safeJson(
      {
        ok: false,
        error: 'cloud_read_failed',
        readsCloud: false,
        writesCloud: false,
      },
      502,
    );
  }
}

export async function POST(request: NextRequest) {
  const config = getCloudConfig();
  if (!config.configured) {
    return safeJson(
      {
        ok: false,
        error: 'cloud_not_configured',
        readsCloud: false,
        writesCloud: false,
      },
      503,
    );
  }

  const user = await getSignedInUser(config);
  if (!user?.id) {
    return safeJson(
      {
        ok: false,
        error: 'not_signed_in',
        readsCloud: false,
        writesCloud: false,
      },
      401,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const settings = sanitizeSettings((body as { settings?: unknown })?.settings || body);
  const updatedAt = new Date().toISOString();

  try {
    const url = new URL('/rest/v1/profile_settings', config.supabaseUrl);
    url.searchParams.set('on_conflict', 'user_id');
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        ...restHeaders(config),
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        user_id: user.id,
        settings,
        updated_at: updatedAt,
      }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase REST write failed: ${response.status}`);
    const rows = (await response.json()) as Array<{ settings?: unknown; updated_at?: string }>;
    const row = rows[0];

    return safeJson({
      ok: true,
      readsCloud: false,
      writesCloud: true,
      settings: sanitizeSettings(row?.settings || settings),
      updatedAt: row?.updated_at || updatedAt,
    });
  } catch {
    return safeJson(
      {
        ok: false,
        error: 'cloud_write_failed',
        readsCloud: false,
        writesCloud: false,
      },
      502,
    );
  }
}
