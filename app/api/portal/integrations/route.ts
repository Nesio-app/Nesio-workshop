/**
 * /api/portal/integrations
 * GET  → returns current user's connected integrations (no token values)
 * POST → stores tokens for a provider (called by OAuth callbacks)
 * DELETE?provider=gmail → revokes a provider
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  getSupabaseUserId,
  readIntegrations,
  writeIntegrations,
  readTokensFromCookies,
  setTokenCookiesOnResponse,
  type IntegrationProvider,
  type IntegrationTokens,
} from '@/lib/portal/integrations';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const supabaseToken = cookieStore.get('baohe_auth_access')?.value;

  let integrationMap = {} as ReturnType<typeof readIntegrations> extends Promise<infer T> ? T : never;
  let userId: string | null = null;

  if (supabaseToken) {
    userId = await getSupabaseUserId(supabaseToken);
    if (userId) integrationMap = await readIntegrations(userId, supabaseToken);
  }

  // Merge cookie tokens for providers not in Supabase
  for (const provider of ['gmail', 'calendar'] as IntegrationProvider[]) {
    if (!integrationMap[provider]) {
      const t = readTokensFromCookies(provider);
      if (t) integrationMap[provider] = t;
    }
  }

  return NextResponse.json({
    ok: true,
    isLoggedIn: Boolean(userId),
    integrations: Object.fromEntries(
      Object.entries(integrationMap).map(([k, v]) => [
        k,
        { connected: Boolean((v as IntegrationTokens)?.accessToken), connectedAt: (v as IntegrationTokens)?.connectedAt },
      ]),
    ),
  });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabaseToken = cookieStore.get('baohe_auth_access')?.value;

  const body = await req.json() as {
    provider: IntegrationProvider;
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    scope?: string;
  };

  const tokens: IntegrationTokens = {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiresAt: body.expiresIn ? Date.now() + body.expiresIn * 1000 : undefined,
    scope: body.scope,
    connectedAt: new Date().toISOString(),
  };

  const response = NextResponse.json({ ok: true, provider: body.provider });
  setTokenCookiesOnResponse(response, body.provider, tokens);

  if (supabaseToken) {
    const userId = await getSupabaseUserId(supabaseToken);
    if (userId) {
      const existing = await readIntegrations(userId, supabaseToken);
      existing[body.provider] = tokens;
      await writeIntegrations(userId, supabaseToken, existing);
    }
  }

  return response;
}

export async function DELETE(req: NextRequest) {
  const cookieStore = await cookies();
  const supabaseToken = cookieStore.get('baohe_auth_access')?.value;
  const { searchParams } = new URL(req.url);
  const provider = searchParams.get('provider') as IntegrationProvider | null;
  if (!provider) return NextResponse.json({ ok: false, error: 'missing_provider' }, { status: 400 });

  const response = NextResponse.json({ ok: true, provider });
  const prefix = provider === 'gmail' ? 'nesio_gmail' : 'nesio_google_calendar';
  response.cookies.delete(`${prefix}_access`);
  response.cookies.delete(`${prefix}_refresh`);

  if (supabaseToken) {
    const userId = await getSupabaseUserId(supabaseToken);
    if (userId) {
      const existing = await readIntegrations(userId, supabaseToken);
      delete existing[provider];
      await writeIntegrations(userId, supabaseToken, existing);
    }
  }

  return response;
}
