/**
 * 歌单数据层(2026-08-01,用户:「歌单要新建数据层 —— 本地存 + 走通用云同步」)。
 *
 * 在这之前曲库是一张平铺列表:所有导入的文件按时间倒序排成一排,
 * 没有「歌单」也没有「我喜欢的音乐」。这一层补的就是这两个概念。
 *
 * 三个决定,都是被具体的坏结果逼出来的:
 *
 * ① **曲目引用带源前缀**(`local:lt-x` / `netease:12345`),不是裸 id。
 *    本地曲库的 id 是自己发的 `lt-<时间戳>`,网易的 id 是它那边的数字 ——
 *    两个 id 空间各发各的,迟早撞上;撞上的表现是歌单里点一首放出另一首,
 *    而这种 bug 没人会往「id 撞了」上想。前缀让它撞不了,也让读的一方
 *    不用查曲库就知道该问谁要这首歌。
 *
 * ② **条目自带快照**(名字/艺人/时长),不是只存一个 ref。
 *    歌单是 durable、要上云的;云端那份落到另一台设备时,那台机器的本地曲库
 *    是空的(音频本体在 IndexedDB,**不进备份** —— 见 storage-manifest 里
 *    nesio-music-local-tracks-v1 判 cache 的那段)。只存 ref 的话,
 *    新设备上的歌单是一串认不出来的 id;存了快照,至少「这首叫什么」还在,
 *    还能拿这个名字去网易找同一首。歌单记的是**我想听什么**,
 *    不是**这台机器上有什么**。
 *
 * ③ **「我喜欢的音乐」是一个固定 id 的歌单**,不是单独一张表。
 *    它和别的歌单需要的是同一套东西:加、删、排序、播放全部、算总时长。
 *    另立一张表就要把这些全写两遍,然后其中一份慢慢落后。
 *    它只多两条规矩:删不掉、改不了名。
 *
 * 存储判据(「换台设备从零开始是否正确?」):**不正确** —— 我攒的歌单
 * 换台手机就该还在。所以 durable,走通用 cloud-module-sync
 * (durable 且非 dedicated 的 key 自动被它带上去,不用额外接线)。
 */

import { logDropped, reportStorageDropped } from '@/lib/portal/storage-health';

/** durable:走通用云同步。必须在 scripts/storage-key-registry.test.mjs 登记。 */
export const PLAYLISTS_KEY = 'nesio-music-playlists-v1';

/** 歌单变了 —— 界面据此重读(和 LOCAL_TRACKS_CHANGED 同一套路)。 */
export const PLAYLISTS_CHANGED = 'nesio-music-playlists-changed';

/** 「我喜欢的音乐」那一份的固定 id。删不掉、改不了名。 */
export const LIKED_ID = 'liked';

/** 目前能进歌单的两个源。本地 = 这台机器上的文件,网易 = 联网点播。 */
export type TrackSource = 'local' | 'netease';

/** `local:lt-1754…` / `netease:1974443814`。 */
export type TrackRef = string;

export interface PlaylistEntry {
  ref: TrackRef;
  /** 快照:加进歌单那一刻的名字。曲库里那份改了名不回头改这里 —— 歌单是我当时想听的那首。 */
  title: string;
  /** 取不到就空串。**不填「未知艺术家」** —— 界面自己决定空的时候怎么显示。 */
  artist: string;
  /** 秒。0 = 还不知道(本地文件要等 audio 元素读出来)。 */
  durationSec: number;
  addedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  entries: PlaylistEntry[];
  createdAt: number;
  updatedAt: number;
}

/* ── ref 的拼与拆 ─────────────────────────────────────────────────────────── */

export function trackRef(source: TrackSource, id: string): TrackRef {
  const raw = String(id ?? '').trim();
  if (!raw) return '';
  return `${source}:${raw}`;
}

/**
 * 拆回 { source, id }。拆不动返回 null ——
 * **不猜**:一个没有前缀的字符串可能是老数据也可能是脏数据,
 * 当成 local 去 IndexedDB 里找只会得到一首放不出声的歌,
 * 而症状是「点了没反应」,查起来比直接不显示贵得多。
 */
export function parseTrackRef(ref: TrackRef | null | undefined): { source: TrackSource; id: string } | null {
  const raw = String(ref ?? '');
  const i = raw.indexOf(':');
  if (i <= 0) return null;
  const source = raw.slice(0, i);
  const id = raw.slice(i + 1);
  if (!id) return null;
  if (source !== 'local' && source !== 'netease') return null;
  return { source, id };
}

/* ── 读写 ─────────────────────────────────────────────────────────────────── */

function emptyLiked(now: number): Playlist {
  // name 留空:「我喜欢的音乐」这个名字是**界面上的字**,不是数据。
  // 存进去的话英文界面会读到一行中文,而且这份要上云 —— 中英两台设备互相覆盖名字。
  return { id: LIKED_ID, name: '', entries: [], createdAt: now, updatedAt: now };
}

/** 显示用的歌单名。「我喜欢的音乐」的名字由界面给,不从数据里读。 */
export function playlistName(p: Pick<Playlist, 'id' | 'name'>, locale: 'zh' | 'en' = 'zh'): string {
  if (p.id === LIKED_ID) return locale === 'zh' ? '我喜欢的音乐' : 'Liked songs';
  return p.name || (locale === 'zh' ? '未命名歌单' : 'Untitled');
}

function sanitizeEntry(v: unknown): PlaylistEntry | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Partial<PlaylistEntry>;
  const ref = String(e.ref ?? '');
  if (!parseTrackRef(ref)) return null;   // 拆不动的条目直接丢:留着就是一行点不动的歌
  const dur = Number(e.durationSec);
  return {
    ref,
    title: String(e.title ?? ''),
    artist: String(e.artist ?? ''),
    durationSec: Number.isFinite(dur) && dur > 0 ? dur : 0,
    addedAt: Number(e.addedAt) || 0,
  };
}

function sanitizePlaylist(v: unknown): Playlist | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Partial<Playlist>;
  const id = String(p.id ?? '').trim();
  if (!id) return null;
  const entries = Array.isArray(p.entries)
    ? p.entries.map(sanitizeEntry).filter((e): e is PlaylistEntry => e !== null)
    : [];
  // 同一首只留第一次进来那条 —— 存坏了/两台设备各加一次都会有重复,
  // 而重复的表现是列表里同一首出现两遍、播放全部时听两次。
  const seen = new Set<string>();
  const deduped = entries.filter((e) => (seen.has(e.ref) ? false : (seen.add(e.ref), true)));
  return {
    id,
    name: String(p.name ?? ''),
    entries: deduped,
    createdAt: Number(p.createdAt) || 0,
    updatedAt: Number(p.updatedAt) || 0,
  };
}

/**
 * 读全部歌单。**「我喜欢的音乐」永远在第一位且一定存在** ——
 * 界面上那一栏不该出现「今天有、明天没有」的情况。
 */
export function loadPlaylists(): Playlist[] {
  const now = Date.now();
  if (typeof window === 'undefined') return [emptyLiked(now)];
  let raw: unknown[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]');
    raw = Array.isArray(parsed) ? parsed : [];
  } catch { raw = []; }

  const list = raw.map(sanitizePlaylist).filter((p): p is Playlist => p !== null);
  const liked = list.find((p) => p.id === LIKED_ID);
  const rest = list.filter((p) => p.id !== LIKED_ID);
  return [liked || emptyLiked(now), ...rest];
}

/**
 * 写回。写不进去要**说出来** —— 攒了半天的歌单静默丢掉是最伤的那一类,
 * 而 localStorage 满了的时候正是它最容易发生的时候。
 */
export function savePlaylists(list: readonly Playlist[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(list));
    try { window.dispatchEvent(new CustomEvent(PLAYLISTS_CHANGED)); } catch { /* 事件发不出去不影响已经写成的那份 */ }
    return true;
  } catch (e) {
    logDropped('music.playlists.save', e);
    reportStorageDropped();
    return false;
  }
}

/* ── 增删改 ───────────────────────────────────────────────────────────────── */

export function createPlaylist(name: string): Playlist {
  const now = Date.now();
  const p: Playlist = {
    id: `pl-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    // 空名就存空串,显示时由 playlistName 兜底 —— 同上,默认名是界面上的字,不是数据
    name: String(name ?? '').trim(),
    entries: [],
    createdAt: now,
    updatedAt: now,
  };
  savePlaylists([...loadPlaylists(), p]);
  return p;
}

export function renamePlaylist(id: string, name: string): void {
  if (id === LIKED_ID) return;   // 「我喜欢的音乐」改不了名
  const next = String(name ?? '').trim();
  if (!next) return;
  savePlaylists(loadPlaylists().map((p) => (p.id === id ? { ...p, name: next, updatedAt: Date.now() } : p)));
}

export function deletePlaylist(id: string): void {
  if (id === LIKED_ID) return;   // 「我喜欢的音乐」删不掉
  savePlaylists(loadPlaylists().filter((p) => p.id !== id));
}

/**
 * 加一首。**幂等** —— 「加歌单」那个按钮会被重复点(点完没有明显反馈的按钮
 * 每个人都会再点一次),第二次不该在列表里多出一行。
 * 返回 true = 这次真的加进去了,false = 本来就在里面(界面据此说
 * 「已经在这个歌单里了」而不是假装又加了一次)。
 */
export function addToPlaylist(playlistId: string, entry: Omit<PlaylistEntry, 'addedAt'>): boolean {
  const clean = sanitizeEntry({ ...entry, addedAt: Date.now() });
  if (!clean) return false;
  const list = loadPlaylists();
  const target = list.find((p) => p.id === playlistId);
  if (!target) return false;
  if (target.entries.some((e) => e.ref === clean.ref)) return false;
  savePlaylists(list.map((p) => (
    p.id === playlistId ? { ...p, entries: [...p.entries, clean], updatedAt: clean.addedAt } : p
  )));
  return true;
}

export function removeFromPlaylist(playlistId: string, ref: TrackRef): void {
  savePlaylists(loadPlaylists().map((p) => (
    p.id === playlistId
      ? { ...p, entries: p.entries.filter((e) => e.ref !== ref), updatedAt: Date.now() }
      : p
  )));
}

/* ── 我喜欢的音乐 ─────────────────────────────────────────────────────────── */

export function isLiked(ref: TrackRef): boolean {
  return loadPlaylists().find((p) => p.id === LIKED_ID)?.entries.some((e) => e.ref === ref) ?? false;
}

/** ♥ 的开关。返回切换之后的状态(true = 现在是喜欢的)。 */
export function toggleLiked(entry: Omit<PlaylistEntry, 'addedAt'>): boolean {
  const clean = sanitizeEntry({ ...entry, addedAt: Date.now() });
  if (!clean) return false;
  if (isLiked(clean.ref)) {
    removeFromPlaylist(LIKED_ID, clean.ref);
    return false;
  }
  addToPlaylist(LIKED_ID, entry);
  return true;
}

/* ── 显示用 ───────────────────────────────────────────────────────────────── */

/**
 * 「42 首 · 3.2 小时」那一行。时长未知(0)的曲目**只是不计入总时长**,
 * 不该把整行变成「未知」—— 一首刚导入还没读出时长的歌不该让另外 41 首失去意义。
 */
export function playlistHeadline(p: Pick<Playlist, 'entries'>, locale: 'zh' | 'en' = 'zh'): string {
  const n = p.entries.length;
  const sec = p.entries.reduce((s, e) => s + (Number(e.durationSec) > 0 ? Number(e.durationSec) : 0), 0);
  const zh = locale === 'zh';
  if (!n) return zh ? '还没有歌曲' : 'No tracks yet';
  const count = zh ? `${n} 首` : `${n} ${n === 1 ? 'track' : 'tracks'}`;
  if (sec <= 0) return count;
  if (sec < 3600) {
    const min = Math.max(1, Math.round(sec / 60));
    return zh ? `${count} · ${min} 分钟` : `${count} · ${min} min`;
  }
  const hours = Math.round((sec / 3600) * 10) / 10;
  return zh ? `${count} · ${hours} 小时` : `${count} · ${hours} h`;
}
