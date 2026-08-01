/**
 * 四个源此刻的就绪状态(2026-07-30)。
 *
 * 这里是**唯一**把 SourceReadiness 三项测出来的地方 —— 别处一律读它的结论。
 * 散在各处各测一份的下场,这个仓刚在「登录态」上栽过:同一屏里一半组件
 * 以为登录了、另一半以为没登录。
 *
 * 每一项都必须**有证据**才为 true:
 *   local   —— 曲库里真有歌(空库放不出声,这不是苛刻,是事实)
 *   apple   —— 服务端签得出 token(configured)+ MusicKit 已授权(authorized)
 *   spotify —— 服务端说 configured/authorized,且 product 确认是 premium
 *   netease —— model 是 metadata-only,canPlayNow 恒 false;这里只报「配没配」,
 *              让界面能区分「没配所以搜不了」和「配了、能搜、就是放不出声」
 */

import type { MusicSourceId, SourceReadiness } from './source-catalog';
import { UNREADY } from './source-catalog';
import { loadLocalTracks } from './local-tracks';
import { appleAuthorizedNow, fetchAppleToken } from './apple-client';

export type ReadinessMap = Partial<Record<MusicSourceId, SourceReadiness>>;

export interface SpotifyStatus {
  configured: boolean;
  authorized: boolean;
  streamable: boolean;
  product?: string;
  displayName?: string;
  accessToken?: string;
}

export async function fetchSpotifyStatus(): Promise<SpotifyStatus> {
  try {
    const res = await fetch('/api/portal/music/spotify', { cache: 'no-store' });
    if (!res.ok) return { configured: false, authorized: false, streamable: false };
    const j = await res.json() as Partial<SpotifyStatus>;
    return {
      configured: j.configured === true,
      authorized: j.authorized === true,
      streamable: j.streamable === true,
      product: j.product,
      displayName: j.displayName,
      accessToken: j.accessToken,
    };
  } catch {
    // 探不到就是探不到 —— 一律算不能放,不做「大概还连着」的推断。
    return { configured: false, authorized: false, streamable: false };
  }
}

async function neteaseConfigured(): Promise<boolean> {
  try {
    const res = await fetch('/api/portal/music/netease/search?q=', { cache: 'no-store' });
    if (!res.ok) return false;
    return ((await res.json()) as { configured?: boolean }).configured === true;
  } catch { return false; }
}

export function localReadiness(): SourceReadiness {
  const has = loadLocalTracks().length > 0;
  // 本地文件不需要谁来授权:文件就在这台机器上。
  return { configured: true, authorized: true, streamable: has };
}

/**
 * 全量探一次。并发发起,任何一路挂了都不拖垮其它路 ——
 * 一个源探测失败不该让整个音乐页转圈。
 */
export async function probeReadiness(): Promise<ReadinessMap> {
  const [apple, spotify, neteaseOk] = await Promise.all([
    fetchAppleToken().catch(() => ({ ok: false, configured: false } as const)),
    fetchSpotifyStatus().catch(() => ({ configured: false, authorized: false, streamable: false })),
    neteaseConfigured().catch(() => false),
  ]);

  const appleAuthed = appleAuthorizedNow();
  return {
    local: localReadiness(),
    apple: {
      configured: apple.configured === true,
      authorized: appleAuthed,
      // 已授权即代表这个 Apple ID 的订阅在有效期内 —— MusicKit 授权本身就卡这一关。
      streamable: apple.configured === true && appleAuthed,
    },
    spotify: {
      configured: spotify.configured,
      authorized: spotify.authorized,
      streamable: spotify.streamable,
    },
    /*
     * 网易:2026-07-31 更正。上一版写死 streamable:false,理由是「没有国内出口
     * 就拿不到播放地址」—— 用户当场指出那是过度概括:「不是所有歌都锁着的」。
     * 事实是**逐曲**的,所以源级别只能说「接得上」(配了 API base 就有一半的歌能放),
     * 具体哪一首取不到,点下去问过 song-url 才知道 —— 那时候再说,而且说的是
     * 「换一首」不是「这个源不能用」。
     */
    netease: { configured: neteaseOk, authorized: neteaseOk, streamable: neteaseOk },
  };
}

export const EMPTY_READINESS: ReadinessMap = Object.freeze({
  local: UNREADY, apple: UNREADY, spotify: UNREADY, netease: UNREADY,
});
