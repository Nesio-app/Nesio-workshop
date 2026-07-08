/**
 * GET /.well-known/appspecific/com.tesla.3p.public-key.pem
 * Serves the app's EC public key (PEM) so Tesla can register this partner
 * domain. The value lives in env (TESLA_PUBLIC_KEY) — the matching private
 * key stays server-side and is never committed. Public key is not secret.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const key = (process.env.TESLA_PUBLIC_KEY || '').trim();
  if (!key) return new NextResponse('not_configured', { status: 404 });
  return new NextResponse(`${key}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-pem-file',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
