import { NextRequest, NextResponse } from 'next/server';

function safeRedirectUrl(req: NextRequest, params: Record<string, string>) {
  const target = new URL('/', req.url);
  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value);
  }
  return target;
}

export async function GET(req: NextRequest) {
  const source = new URL(req.url);
  const provider = source.searchParams.get('provider') || source.searchParams.get('state') || 'unknown';
  const error = source.searchParams.get('error') || source.searchParams.get('error_code') || '';
  const hasCode = Boolean(source.searchParams.get('code'));

  const target = safeRedirectUrl(req, {
    safePublicStatus: 'true',
    secretsRedacted: 'true',
    auth: error ? 'auth_callback_failed' : 'auth_callback_received',
    provider,
    status: error || (hasCode ? 'code_received' : 'callback_received'),
  });

  return NextResponse.redirect(target);
}
