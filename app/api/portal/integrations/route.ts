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
  integrationCookieNames,
  type IntegrationProvider,
  type IntegrationTokens,
} from '@/lib/portal/integrations';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const supabaseToken = cookieStore.get('baohe_auth_access')?.value;

  let integrationMap: NonNullable<Awaited<ReturnType<typeof readIntegrations>>> = {};
  let userId: string | null = null;

  if (supabaseToken) {
    userId = await getSupabaseUserId(supabaseToken);
    // 读失败(null)按「无 integration」展示,不影响 cookie 兜底合并
    if (userId) integrationMap = (await readIntegrations(userId, supabaseToken)) ?? {};
  }

  // Merge cookie tokens for providers not in Supabase
  for (const provider of ['gmail', 'calendar'] as IntegrationProvider[]) {
    if (!integrationMap[provider]) {
      const t = await readTokensFromCookies(provider);
      if (t) integrationMap[provider] = t;
    }
  }

  const integrations: Record<string, { connected: boolean; connectedAt?: string }> = {};
  for (const [k, v] of Object.entries(integrationMap)) {
    if (k === 'plaid') continue; // plaid 是加密令牌数组条目,单独判(下方)
    integrations[k] = { connected: Boolean((v as IntegrationTokens)?.accessToken), connectedAt: (v as IntegrationTokens)?.connectedAt };
  }
  // Plaid:云端有加密令牌条目即算已连(跨浏览器复原连接状态,不再"换浏览器显示未连")。
  const plaidEntry = integrationMap.plaid;
  if (plaidEntry?.tokensEnc) integrations.plaid = { connected: true, connectedAt: plaidEntry.connectedAt };

  return NextResponse.json({ ok: true, isLoggedIn: Boolean(userId), integrations });
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
      // 读失败:不以「空」覆写云端(会清掉另一 provider 的 token)。cookie 已写(上方),跳过云写。
      if (existing) {
        existing[body.provider] = tokens;
        await writeIntegrations(userId, supabaseToken, existing);
      } else {
        console.error('integrations_save_aborted_read_failed', body.provider);
      }
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
  // 用 provider→cookie 规范映射(此前硬编码 gmail/calendar → notion/tesla/granola 断连会误删日历 cookie、
  // 真正的 provider cookie 留活。S2:Notion 断连不撤销的真因之一)。
  for (const name of integrationCookieNames(provider)) response.cookies.delete(name);

  if (supabaseToken) {
    const userId = await getSupabaseUserId(supabaseToken);
    if (userId) {
      const existing = await readIntegrations(userId, supabaseToken);
      // 读失败:不以「空」覆写(会清掉另一 provider)。cookie 已删,云端断连稍后可重试。
      if (existing) {
        delete existing[provider];
        await writeIntegrations(userId, supabaseToken, existing);
      } else {
        console.error('integrations_delete_aborted_read_failed', provider);
      }
    }
  }

  return response;
}
