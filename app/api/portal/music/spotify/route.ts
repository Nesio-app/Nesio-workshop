/**
 * GET    /api/portal/music/spotify —— 这个账号此刻的真实状态
 * DELETE /api/portal/music/spotify —— 断开(清 cookie)
 *
 * GET 存在的意义是把 canPlayNow 的三项**测出来**,而不是让前端猜:
 *   configured  —— 服务端有没有 client id/secret
 *   authorized  —— cookie 里有没有还能刷新的 refresh token
 *   streamable  —— **product === 'premium'**。这是正向判据的关键一项:
 *                  免费账号连得上、搜得到、就是放不出声。查不出 product
 *                  (接口挂了/被限流)一律算 false —— 不是「没被拦住就算能放」。
 *
 * 读的是用户的 Spotify 账号信息,属私密数据 → guardAiRoute。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import {
  SPOTIFY_COOKIE, parseSpotifySession, refreshSpotifyToken, sessionFresh,
  spotifyConfigured, spotifyCookieOptions, spotifyMissingEnv,
} from '@/lib/platform/music/spotify-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(req: NextRequest) {
  const blocked = await guardAiRoute(req, 'music-spotify-status', { limit: 20, windowMs: 60_000 });
  if (blocked) return blocked;

  if (!spotifyConfigured()) {
    return NextResponse.json(
      { ok: true, configured: false, authorized: false, streamable: false, missingEnv: spotifyMissingEnv() },
      { headers: noStore },
    );
  }
  const session = parseSpotifySession(req.cookies.get(SPOTIFY_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { ok: true, configured: true, authorized: false, streamable: false },
      { headers: noStore },
    );
  }

  let live = session;
  if (!sessionFresh(session)) {
    const refreshed = await refreshSpotifyToken(session.refreshToken).catch(() => null);
    if (!refreshed) {
      // 刷不动了 = 授权已经作废。如实说 authorized:false,别让界面继续显示「已连接」
      // 却每次播放都失败 —— 那正是「同屏自相矛盾」那一类。
      const dead = NextResponse.json(
        { ok: true, configured: true, authorized: false, streamable: false, error: 'reauth_needed' },
        { headers: noStore },
      );
      dead.cookies.delete(SPOTIFY_COOKIE);
      return dead;
    }
    live = refreshed;
  }

  let product = '';
  let displayName = '';
  try {
    const me = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${live.accessToken}` },
      cache: 'no-store',
    });
    if (me.ok) {
      const j = await me.json() as { product?: string; display_name?: string };
      product = String(j.product || '');
      displayName = String(j.display_name || '');
    }
  } catch { /* 查不出就是查不出,下面按 false 算 */ }

  const res = NextResponse.json({
    ok: true,
    configured: true,
    authorized: true,
    // 正向:必须**确认**是 premium 才算能放。空串(查不到)算不能放。
    streamable: product === 'premium',
    product,
    displayName,
    // 给 Web Playback SDK 用。它只在浏览器里活一小时,前端不落盘。
    accessToken: live.accessToken,
    expiresAt: live.expiresAt,
  }, { headers: noStore });

  if (live !== session) res.cookies.set(SPOTIFY_COOKIE, JSON.stringify(live), spotifyCookieOptions);
  return res;
}

export async function DELETE(req: NextRequest) {
  const blocked = await guardAiRoute(req, 'music-spotify-disconnect', { limit: 10, windowMs: 60_000 });
  if (blocked) return blocked;
  const res = NextResponse.json({ ok: true, authorized: false }, { headers: noStore });
  res.cookies.delete(SPOTIFY_COOKIE);
  return res;
}
