/**
 * GET /api/portal/music/spotify/callback —— 授权回来,换 token 并写进 httpOnly cookie。
 *
 * 失败一律**带着原因跳回音乐页**(?spotify=xxx),不留在一个白页上:
 * OAuth 回调是最容易「点了没反应」的地方 —— 用户从 Spotify 跳回来,
 * 看到的必须是一句能读懂的话,不是一片空白或一段 JSON。
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  SPOTIFY_COOKIE, SPOTIFY_STATE_COOKIE, SPOTIFY_TOKEN_URL,
  envValue, spotifyConfigured, spotifyCookieOptions,
} from '@/lib/platform/music/spotify-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function callbackUrl(req: NextRequest): string {
  const configured = envValue('SPOTIFY_REDIRECT_URI');
  if (configured) return configured;
  return `${new URL(req.url).origin}/api/portal/music/spotify/callback`;
}

const back = (req: NextRequest, status: string) =>
  NextResponse.redirect(new URL(`/?music=1&spotify=${status}`, new URL(req.url).origin));

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const expected = req.cookies.get(SPOTIFY_STATE_COOKIE)?.value || '';

  if (url.searchParams.get('error')) return back(req, 'denied');
  if (!spotifyConfigured()) return back(req, 'unconfigured');
  if (!code || !state || state !== expected) return back(req, 'state_mismatch');

  let res: Response;
  try {
    res = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${envValue('SPOTIFY_CLIENT_ID')}:${envValue('SPOTIFY_CLIENT_SECRET')}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(req) }),
      cache: 'no-store',
    });
  } catch { return back(req, 'network'); }

  if (!res.ok) return back(req, 'exchange_failed');
  const j = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!j.access_token || !j.refresh_token) return back(req, 'exchange_failed');

  const out = back(req, 'connected');
  out.cookies.set(SPOTIFY_COOKIE, JSON.stringify({
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
  }), spotifyCookieOptions);
  out.cookies.delete(SPOTIFY_STATE_COOKIE);
  return out;
}
