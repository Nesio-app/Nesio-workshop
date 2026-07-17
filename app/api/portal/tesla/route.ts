/**
 * GET /api/portal/tesla — read-only Tesla snapshot for the connector.
 * Returns normalized { drives, charges }. Refreshes the access token on
 * expiry / 401 and persists the rotated token. Cheap when not connected:
 * returns { ok:false, error:'not_connected' } without calling Tesla.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isPortalRequestAuthorized, isRateLimited } from '@/lib/portal/api-auth';
import { getIntegrationToken, saveIntegrationToken, setTokenCookiesOnResponse } from '@/lib/portal/integrations';
import { collectTeslaData, refreshTeslaToken, registerPartnerAccount, teslaConfigured } from '@/lib/portal/tesla';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isPortalRequestAuthorized(req))) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });
  }
  if (isRateLimited(req, 'tesla_sync', { limit: 20 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  if (!teslaConfigured()) {
    return NextResponse.json({ ok: false, error: 'provider_not_configured' }, { status: 503 });
  }

  const token = await getIntegrationToken('tesla');
  if (!token?.accessToken && !token?.refreshToken) {
    return NextResponse.json({ ok: false, error: 'not_connected' });
  }

  let accessToken = token.accessToken || '';
  let rotated: { accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string } | null = null;

  // No access token but a refresh token exists → refresh up front.
  if (!accessToken && token.refreshToken) {
    const fresh = await refreshTeslaToken(token.refreshToken);
    if (!fresh) return NextResponse.json({ ok: false, error: 'token_expired' });
    accessToken = fresh.accessToken;
    rotated = { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, expiresAt: fresh.expiresAt, scope: fresh.scope };
  }

  let snapshot = await collectTeslaData(accessToken);

  // 401 → refresh once and retry.
  if (snapshot.status === 401 && token.refreshToken) {
    const fresh = await refreshTeslaToken(token.refreshToken);
    if (!fresh) return NextResponse.json({ ok: false, error: 'token_expired' });
    accessToken = fresh.accessToken;
    rotated = { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, expiresAt: fresh.expiresAt, scope: fresh.scope };
    snapshot = await collectTeslaData(accessToken);
  }

  if (snapshot.status === 401) {
    return NextResponse.json({ ok: false, error: 'token_expired' });
  }

  // 412 = 合作方域名未注册(域名切换后的典型状态)。就地注册一次再重试 ——
  // 不再要求用户重新授权才触发(回调里的自动注册只覆盖新授权)。
  if (snapshot.vehiclesStatus === 412) {
    const configured = envValue('TESLA_REDIRECT_URI');
    const domain = configured ? new URL(configured).hostname : (req.headers.get('host') || '').split(':')[0];
    const registered = domain ? await registerPartnerAccount(domain) : false;
    console.info('tesla_partner_register_on_sync', { domain, registered });
    if (registered) snapshot = await collectTeslaData(accessToken);
  }
  // 车辆列表仍拿不到 → 把真实状态透出去,别让 UI 只能显示「没有车」。
  if (snapshot.vehiclesStatus && snapshot.vehiclesStatus !== 200) {
    console.warn('tesla_vehicles_failed', { status: snapshot.vehiclesStatus });
    return NextResponse.json({
      ok: false,
      error: snapshot.vehiclesStatus === 412 ? 'partner_not_registered' : 'tesla_fetch_failed',
      status: snapshot.vehiclesStatus,
    });
  }

  if (snapshot.status !== 200) {
    console.warn('tesla_fetch_failed', { status: snapshot.status });
    return NextResponse.json({ ok: false, error: 'tesla_fetch_failed', status: snapshot.status });
  }

  const response = NextResponse.json({ ok: true, drives: snapshot.drives, charges: snapshot.charges });

  // Persist rotated token (Supabase + cookies) so we don't refresh every call.
  if (rotated) {
    await saveIntegrationToken('tesla', rotated, req);
    setTokenCookiesOnResponse(response, 'tesla', { ...rotated, connectedAt: new Date().toISOString() });
  }
  return response;
}
