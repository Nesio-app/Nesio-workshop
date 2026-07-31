/**
 * 音乐偏好(2026-07-30)。只放**换台设备也该跟过去**的三件事:
 * 首选音源、循环模式、要不要随机。
 *
 * 「上次播到哪一首」**不在这里** —— 它指向本机曲库里的一个 id,同步到另一台设备
 * 只会指到一首不存在的歌。那条另走 cache 键(见 LAST_PLAYED_KEY)。
 * 这个分界就是存储三分类的判据本身:换台设备从零开始是否正确?
 * 首选音源 —— 不正确(用户选过了),durable;上次播到哪 —— 正确,cache。
 */

import type { MusicSourceId } from './source-catalog';
import type { RepeatMode } from './queue';

/** durable:用户的选择。必须在 scripts/storage-key-registry.test.mjs 登记。 */
export const MUSIC_PREFS_KEY = 'nesio-music-prefs-v1';
/** cache:本机播放位置,跨设备同步过去只会指向不存在的曲目。同样要登记。 */
export const LAST_PLAYED_KEY = 'nesio-music-last-played-v1';

export interface MusicPrefs {
  preferredSource: MusicSourceId;
  repeat: RepeatMode;
  shuffle: boolean;
}

export const DEFAULT_PREFS: MusicPrefs = Object.freeze({
  // 默认本地:唯一不要账号、不要订阅、不看网络就能出声的源。
  preferredSource: 'local',
  repeat: 'off',
  shuffle: false,
});

const SOURCES: readonly MusicSourceId[] = ['local', 'netease', 'apple', 'spotify'];
const REPEATS: readonly RepeatMode[] = ['off', 'one', 'all'];

export function loadMusicPrefs(): MusicPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const v = JSON.parse(localStorage.getItem(MUSIC_PREFS_KEY) || '{}') as Partial<MusicPrefs>;
    return {
      // 逐字段校验而不是整个 spread:存坏的值(老版本/手改)会变成一个放不出声的源,
      // 而症状是「点播放没反应」—— 这一类最难查。
      preferredSource: SOURCES.includes(v.preferredSource as MusicSourceId) ? v.preferredSource as MusicSourceId : DEFAULT_PREFS.preferredSource,
      repeat: REPEATS.includes(v.repeat as RepeatMode) ? v.repeat as RepeatMode : DEFAULT_PREFS.repeat,
      shuffle: v.shuffle === true,
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function saveMusicPrefs(p: MusicPrefs): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(MUSIC_PREFS_KEY, JSON.stringify(p)); } catch { /* 这次会话内有效 */ }
}

export function loadLastPlayed(): string {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem(LAST_PLAYED_KEY) || ''; } catch { return ''; }
}

export function saveLastPlayed(trackId: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LAST_PLAYED_KEY, trackId); } catch { /* 无所谓 */ }
}
