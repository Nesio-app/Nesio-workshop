/**
 * POST /api/portal/tesla/register — one-time partner onboarding.
 * Registers this deployment's domain with Tesla so the public key hosted at
 * /.well-known/appspecific/com.tesla.3p.public-key.pem is associated with the
 * app. Idempotent — safe to call again. Run once after deploying with
 * TESLA_CLIENT_ID / TESLA_CLIENT_SECRET / TESLA_PUBLIC_KEY set.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isPortalRequestAuthorized, isRateLimited } from '@/lib/portal/api-auth';
import { registerPartnerAccount, teslaConfigured } from '@/lib/portal/tesla';

export const dynamic = 'force-dynamic';

function envValue(key: string): string {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

export async function POST(req: NextRequest) {
  if (!(await isPortalRequestAuthorized(req))) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });
  }
  if (isRateLimited(req, 'tesla_register', { limit: 5 })) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  if (!teslaConfigured()) {
    return NextResponse.json({ ok: false, error: 'provider_not_configured' }, { status: 503 });
  }
  if (!envValue('TESLA_PUBLIC_KEY')) {
    return NextResponse.json({ ok: false, error: 'public_key_not_set' }, { status: 503 });
  }

  // Derive the domain from the configured redirect URI (canonical) or the request host.
  const redirect = envValue('TESLA_REDIRECT_URI');
  const domain = redirect ? new URL(redirect).hostname : (req.headers.get('host') || '').split(':')[0];
  if (!domain) return NextResponse.json({ ok: false, error: 'domain_unresolved' }, { status: 400 });

  const registered = await registerPartnerAccount(domain);
  console.info('tesla_partner_register', { domain, registered });
  return NextResponse.json({ ok: registered, domain });
}
