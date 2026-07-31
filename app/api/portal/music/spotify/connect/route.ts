/**
 * GET /api/portal/music/spotify/connect —— 发起 Spotify 授权。
 * 形制照 tesla/connect:state cookie 防 CSRF,没配环境变量就明说缺哪几个。
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  SPOTIFY_AUTH_URL, SPOTIFY_SCOPES, SPOTIFY_STATE_COOKIE,
  envValue, spotifyConfigured, spotifyMissingEnv,
} from '@/lib/platform/music/spotify-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function callbackUrl(req: NextRequest): string {
  const configured = envValue('SPOTIFY_REDIRECT_URI');
  if (configured) return configured;
  return `${new URL(req.url).origin}/api/portal/music/spotify/callback`;
}

export async function GET(req: NextRequest) {
  if (!spotifyConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'provider_not_configured', provider: 'spotify', missingEnv: spotifyMissingEnv() },
      { status: 503 },
    );
  }
  const state = `nesio_spotify:${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`;
  const url = new URL(SPOTIFY_AUTH_URL);
  url.searchParams.set('client_id', envValue('SPOTIFY_CLIENT_ID'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', callbackUrl(req));
  url.searchParams.set('scope', SPOTIFY_SCOPES);
  url.searchParams.set('state', state);

  const res = NextResponse.redirect(url);
  res.cookies.set(SPOTIFY_STATE_COOKIE, state, {
    httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/', maxAge: 10 * 60,
  });
  return res;
}
