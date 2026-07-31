/**
 * 播放引擎(2026-07-31,用户:「开始播放后可以变成一个圆形的悬浮按钮么」)。
 *
 * 为什么要从 hook 里搬出来:**React 元素会随组件卸载被销毁,音乐也就停了**。
 * 播放器原来是 MusicPanel 里的一个 `<audio>` JSX 节点 —— 切到别的页面那一刻
 * 音乐就断了。而悬浮球的全部意义正是「人走了、歌还在放」,所以音频本体必须活在
 * React 树之外:一个挂在 document.body 上的模块级 audio 元素,由这里独占。
 *
 * 形制照 lib/portal/session-state:模块级单一真源 + 订阅。
 * 谁都别再自己 new Audio() —— 两个音频元素同时出声是这类模块最典型的事故。
 *
 * 红线不变:每一条失败路径都要**带着一句人话**进 state,由界面显示;
 * 不许静默回到 idle(「按了没反应」的根)。
 */

import { getTrackBlob, setTrackDuration, type LocalTrack } from './local-tracks';
import { nextIndex, playOrder, prevIndex, type RepeatMode } from './queue';
import type { MusicLocale } from './source-catalog';

/** 引擎自己会说的几句话。系统说的话翻译,曲名(用户数据)不翻。 */
const COPY = {
  zh: {
    gone: '这首歌在曲库里找不到了。',
    fileMissing: (t: string) => `「${t}」的音频文件不在了 —— 清过浏览器数据的话会这样。重新导入一次就好。`,
    notReady: '播放器还没准备好,稍等一下再点。',
    blocked: '浏览器挡下了自动播放 —— 再点一次播放键就能出声。',
    badFormat: (t: string) => `「${t}」这个格式这台设备放不了。`,
    retry: '这一下没播起来,再点一次试试。',
    midway: '这首放到一半出错了,跳过它试试下一首。',
  },
  en: {
    gone: 'That track is no longer in the library.',
    fileMissing: (t: string) => `The audio file for “${t}” is gone — clearing browser data does that. Import it again and you are set.`,
    notReady: 'The player is not ready yet — give it a second and tap again.',
    blocked: 'The browser blocked autoplay — tap play once more and it will sound.',
    badFormat: (t: string) => `This device cannot play the format of “${t}”.`,
    retry: 'That did not start — tap once more.',
    midway: 'That one hit an error midway. Skip it and try the next.',
  },
} as const;

export interface PlayerState {
  currentId: string;
  playing: boolean;
  positionSec: number;
  durationSec: number;
  /** 非空 = 出事了,界面必须把它显示出来。 */
  error: string;
  loading: boolean;
}

export interface PlayerOptions {
  repeat: RepeatMode;
  shuffle: boolean;
  seed: number;
  locale: MusicLocale;
}

const INITIAL: PlayerState = Object.freeze({
  currentId: '', playing: false, positionSec: 0, durationSec: 0, error: '', loading: false,
});

let state: PlayerState = INITIAL;
let tracks: readonly LocalTrack[] = [];
let opts: PlayerOptions = { repeat: 'off', shuffle: false, seed: 1, locale: 'zh' };
let el: HTMLAudioElement | null = null;
let objectUrl = '';
const listeners = new Set<(s: PlayerState) => void>();

const copy = () => (opts.locale === 'en' ? COPY.en : COPY.zh);

function emit(patch: Partial<PlayerState>): void {
  const before = state;
  state = { ...state, ...patch };
  // 车机/锁屏跟着**正在放的东西**走,不跟着「哪个组件还挂着」走。
  // 交给组件去同步的话,关掉音乐页之后车机上会一直停在上一首 —— 而这正是
  // 悬浮球场景下最常见的一屏(人已经离开音乐页了)。
  // 只在这两项真的变了才同步:timeupdate 每秒来好几次,不能跟着它刷。
  if (before.currentId !== state.currentId || before.playing !== state.playing) syncMediaSession();
  for (const fn of listeners) fn(state);
}

function revoke(): void {
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = ''; }
}

/**
 * 拿到那个唯一的 audio 元素,没有就造一个挂到 body 上。
 * **挂在 body 而不是某个组件里** —— 这是整个悬浮球能成立的前提。
 */
function audio(): HTMLAudioElement | null {
  if (typeof document === 'undefined') return null;
  if (el) return el;
  el = document.createElement('audio');
  el.preload = 'metadata';
  el.setAttribute('data-nesio-music', '1');
  el.addEventListener('timeupdate', () => emit({ positionSec: el?.currentTime || 0 }));
  el.addEventListener('loadedmetadata', () => {
    const d = el?.duration || 0;
    emit({ durationSec: d });
    if (state.currentId) setTrackDuration(state.currentId, d);
  });
  el.addEventListener('ended', () => step('next', true));
  el.addEventListener('error', () => emit({ playing: false, loading: false, error: copy().midway }));
  document.body.appendChild(el);
  return el;
}

/* ── 外部同步进来的东西 ──────────────────────────────────────────────────── */

/** 曲库快照。面板导入/删除后要调 —— 引擎靠它算「下一首是哪首」。 */
export function setTracks(list: readonly LocalTrack[]): void {
  tracks = list;
}

export function setOptions(next: PlayerOptions): void {
  opts = next;
}

/**
 * 音乐面板是不是正开着。
 *
 * 开着的时候悬浮球要让位:那一页底部已经有一条完整的播放条,
 * 右下角再飘一个球就是同一屏两套控制 —— 用户会怀疑它俩是不是一回事。
 * 由面板在挂载/卸载时报告,球订阅同一份状态。
 */
let panelOpen = false;

export function setPanelOpen(v: boolean): void {
  if (panelOpen === v) return;
  panelOpen = v;
  for (const fn of listeners) fn(state);   // 让球重新算一次要不要显示
}

export function isPanelOpen(): boolean {
  return panelOpen;
}

export function currentState(): PlayerState {
  return state;
}

export function currentTrack(): LocalTrack | null {
  return tracks.find((t) => t.id === state.currentId) || null;
}

export function subscribe(fn: (s: PlayerState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/* ── 播放控制 ────────────────────────────────────────────────────────────── */

export async function playId(id: string): Promise<void> {
  const track = tracks.find((t) => t.id === id);
  const c = copy();
  if (!track) { emit({ error: c.gone, loading: false, playing: false }); return; }
  emit({ currentId: id, loading: true, error: '' });

  const blob = await getTrackBlob(id);
  if (!blob) { emit({ loading: false, playing: false, error: c.fileMissing(track.title) }); return; }

  const a = audio();
  if (!a) { emit({ loading: false, error: c.notReady }); return; }
  revoke();
  objectUrl = URL.createObjectURL(blob);
  a.src = objectUrl;
  try {
    await a.play();
    emit({ playing: true, loading: false, error: '' });
  } catch (e) {
    // 自动播放被挡下 ≠ 格式放不了:前者再点一次就能出声,后者只能换歌。
    // 合成一句「放不出来」等于把唯一有效的动作藏起来。
    const name = (e as Error)?.name || '';
    emit({ playing: false, loading: false, error: name === 'NotAllowedError' ? c.blocked : c.badFormat(track.title) });
  }
}

export async function toggle(): Promise<void> {
  const a = audio();
  if (!a) return;
  if (!state.currentId) {
    const first = tracks[0];
    if (first) await playId(first.id);
    return;
  }
  if (a.paused) {
    try { await a.play(); emit({ playing: true, error: '' }); }
    catch { emit({ playing: false, error: copy().retry }); }
  } else {
    a.pause();
    emit({ playing: false });
  }
}

export function step(dir: 'next' | 'prev', auto: boolean): void {
  if (!tracks.length) return;
  const order = playOrder(tracks.length, opts.shuffle, opts.seed);
  const cur = Math.max(0, tracks.findIndex((t) => t.id === state.currentId));
  const idx = dir === 'next' ? nextIndex(cur, order, opts.repeat, auto) : prevIndex(cur, order);
  if (idx == null) {
    // 到头了就停。不悄悄从头再放一遍 —— 睡前放的歌不该响一整夜。
    audio()?.pause();
    emit({ playing: false });
    return;
  }
  const t = tracks[idx];
  if (t) void playId(t.id);
}

export function seek(sec: number): void {
  const a = audio();
  if (a && Number.isFinite(sec)) a.currentTime = Math.max(0, sec);
}

export function clearError(): void {
  emit({ error: '' });
}

/**
 * 关掉。**真停**:暂停 + 断源 + 放掉 objectURL + 清空当前曲目。
 *
 * 悬浮球上的 × 走的就是这里。它不能只是「把球藏起来」——
 * 藏起来而声音还在,用户会满屋子找是谁在唱歌,而且再也没有入口关掉它。
 * 清空 currentId 同时也是球的消失条件(没有当前曲目就没有球)。
 */
export function stop(): void {
  const a = audio();
  if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
  revoke();
  emit({ currentId: '', playing: false, positionSec: 0, durationSec: 0, loading: false });
  // 车机/锁屏上的残留也要清:关掉了,那边还显示着曲名和一个暂停键,
  // 用户会以为没关干净、回头去翻后台。
  clearMediaSession();
}

/* ── 车机 / 锁屏 ─────────────────────────────────────────────────────────── */

/**
 * MediaSession —— 车机屏幕、锁屏、耳机线控上显示的曲名和那几个键。
 * 由引擎统一维护:它跟着**正在放的东西**走,而不是跟着哪个组件还挂着。
 */
export function syncMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const t = currentTrack();
  if (t && typeof MediaMetadata !== 'undefined') {
    ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: '' });
  }
  ms.playbackState = state.playing ? 'playing' : 'paused';
  try {
    ms.setActionHandler('play', () => { void toggle(); });
    ms.setActionHandler('pause', () => { void toggle(); });
    ms.setActionHandler('nexttrack', () => step('next', false));
    ms.setActionHandler('previoustrack', () => step('prev', false));
  } catch { /* 老浏览器不认某个 action,不影响其它 */ }
}

/** 关掉之后把车机/锁屏上的残留清干净。 */
export function clearMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  ms.metadata = null;
  ms.playbackState = 'none';
}
