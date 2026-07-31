/**
 * Spotify 服务端共用件(2026-07-30)。
 *
 * 播放模型是 **遥控**,不是「Nesio 多了一个音源」:
 * 声音由 Spotify 出、车机上显示的是 Spotify,Nesio 只发指令。
 * 这一点在 source-catalog 里写死成 model:'remote',UI 换源前必须提示。
 *
 * 令牌只放 **httpOnly cookie**,不落 localStorage:
 * 音乐模块的红线之一是「账号凭证仅本机私有、不进云同步」。
 * 存 localStorage 的话它会被 storage-manifest 扫到 —— 就算判成 auth 不进备份,
 * 也仍然暴露在任何一段前端代码面前。cookie 里 JS 读不到,这是更硬的边界。
 */

export const SPOTIFY_COOKIE = 'nesio_music_spotify';
export const SPOTIFY_STATE_COOKIE = 'nesio_music_spotify_state';

/**
 * 权限范围。只要**播放**需要的那几项 —— 不要 playlist 读写、不要邮箱。
 * user-read-private 是为了读 product 字段(免费 / Premium),
 * 而这正是 canPlayNow 的正向依据:不是 Premium 就是放不了,必须能查出来。
 */
export const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming',
].join(' ');

export const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

export interface SpotifySession {
  accessToken: string;
  refreshToken: string;
  /** access token 到期时刻(ms)。到期前 60s 就当过期,别卡着边界发请求。 */
  expiresAt: number;
}

export function envValue(key: string): string {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

export function spotifyConfigured(): boolean {
  return !!envValue('SPOTIFY_CLIENT_ID') && !!envValue('SPOTIFY_CLIENT_SECRET');
}

export function spotifyMissingEnv(): string[] {
  return ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'].filter((k) => !envValue(k));
}

export function parseSpotifySession(raw: string | undefined): SpotifySession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SpotifySession>;
    if (typeof v.refreshToken !== 'string' || !v.refreshToken) return null;
    return {
      accessToken: typeof v.accessToken === 'string' ? v.accessToken : '',
      refreshToken: v.refreshToken,
      expiresAt: Number(v.expiresAt) || 0,
    };
  } catch { return null; }
}

export function sessionFresh(s: SpotifySession): boolean {
  return !!s.accessToken && s.expiresAt > Date.now() + 60_000;
}

function basicAuth(): string {
  return Buffer.from(`${envValue('SPOTIFY_CLIENT_ID')}:${envValue('SPOTIFY_CLIENT_SECRET')}`).toString('base64');
}

/** 用 refresh token 换一枚新的 access token。失败返回 null —— 调用方据此报「连接过期了,重连一下」。 */
export async function refreshSpotifyToken(refreshToken: string): Promise<SpotifySession | null> {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const j = await res.json() as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!j.access_token) return null;
  return {
    accessToken: j.access_token,
    // Spotify 刷新时**不一定**回传新的 refresh token;不回传就继续用旧的,
    // 覆盖成空串会让下一次刷新直接失效(表现是「昨天还好好的今天要重连」)。
    refreshToken: j.refresh_token || refreshToken,
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
  };
}

export const spotifyCookieOptions = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
};
