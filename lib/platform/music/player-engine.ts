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
import { findPlayable, type ProbeOutcome } from './auto-advance';
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
/**
 * 正在放的**远端**曲目(网易那类:音频是一个普通 URL,不在本地曲库里)。
 * 与本地曲库互斥 —— 谁最后放,currentId 就指向谁。
 */
let remote: { id: string; title: string; artist: string } | null = null;

/**
 * 远端那条队列(2026-08-01,用户:「哪都没有,自动播放下一个」)。
 *
 * 在这之前 step() 放远端曲目时**直接停住**,注释写着「远端目前没有队列概念,
 * 所以就停在这儿,不假装能续」。那句在当时是诚实的,但结果就是用户说的
 * 「我要一个个点」—— 一首放完什么都不发生。
 *
 * 补上队列之后,远端的「下一首」和本地是同一件事,只是多一步:
 * 下一首可能取不到音频(受限),那就再往下找 —— 交给 findPlayable,
 * 它知道什么时候该继续、什么时候该停(风控见一次就停)。
 */
let entryQueue: readonly QueueEntry[] = [];
let resolveRemote: ((id: string) => Promise<ProbeOutcome>) | null = null;
/** 自动往下找的过程中用户点了别的 —— 用这个序号作废掉上一趟。 */
let remoteRun = 0;
let onRemoteStop: ((r: { stop: string; skipped: number }) => void) | null = null;
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
 * 队列里的一条。**本地和远端用同一个形状** —— 一个歌单里两种源混着是常态
 * (自己导的几首 + 网易搜到的几首),队列要是分成两条,「下一首」就会在
 * 两种源的交界处莫名其妙地停住。
 */
export interface QueueEntry {
  ref: string;
  source: 'local' | 'netease';
  id: string;
  title: string;
  artist: string;
  durationSec: number;
}

/**
 * 把一批曲目交给引擎当队列,并告诉它**怎么问一首远端的歌能不能放**。
 *
 * resolver 由界面注入而不是引擎自己 fetch:哪个源、走哪条路由是界面的事,
 * 而「往下找到哪儿为止」才是引擎的事。分开之后这两件都能单独测。
 *
 * onStop 是**停下来那一刻要说的话**的出口。没有它的话,自动往下找的三种
 * 停法(风控/断网/都放不了)会静默地什么都不发生 —— 那正是「按了没反应」的根。
 */
export function setEntryQueue(
  list: readonly QueueEntry[],
  resolver: (id: string) => Promise<ProbeOutcome>,
  onStop?: (r: { stop: string; skipped: number }) => void,
): void {
  entryQueue = list;
  resolveRemote = resolver;
  onRemoteStop = onStop || null;
}

export function currentQueue(): readonly QueueEntry[] {
  return entryQueue;
}

/** 放队列里的某一条。本地走 blob,远端先问地址 —— 调用方不用管是哪种。 */
export async function playEntry(e: QueueEntry): Promise<void> {
  cancelAutoAdvance();          // 用户明确点了这一首:作废掉正在跑的自动往下找
  if (e.source === 'local') { await playId(e.id); return; }
  const resolver = resolveRemote;
  if (!resolver) { emit({ error: copy().notReady, loading: false, playing: false }); return; }
  emit({ currentId: e.id, loading: true, error: '' });
  const run = ++remoteRun;
  const r = await findPlayable([0], 0, async () => resolver(e.id), { isCancelled: () => run !== remoteRun });
  if (run !== remoteRun) return;
  if (r.index >= 0 && r.url) { await playRemote(r.url, { id: e.id, title: e.title, artist: e.artist }); return; }
  emit({ playing: false, loading: false });
  onRemoteStop?.({ stop: r.stop, skipped: r.skipped });
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

/**
 * 那个 audio 元素本身。**只给需要碰浏览器原生播放能力的地方用**
 * (目前只有 AirPlay 的投放选择器 —— 它是 audio 元素上的一个方法,
 * 没有别的调用途径)。控制播放请走上面那些函数,别在外面直接改 src/currentTime:
 * 那样状态就有两个真源了。
 */
export function audioElement(): HTMLAudioElement | null {
  return typeof document === 'undefined' ? null : audio();
}

/**
 * 这台设备能不能投到 AirPlay。
 *
 * 只有 Safari(iOS/macOS)有这个 API,而且**必须由用户手势触发** ——
 * 所以这里只回答「要不要显示那个按钮」,点了之后由系统自己出选择器。
 *
 * 蓝牙不在这里:蓝牙是**系统层**的连接,连上之后网页的声音本来就跟着过去了,
 * 网页既没有 API 也不需要有 —— 给它做一个按钮只会是一个点了什么都不发生的键。
 * Google Cast 同理:要 SDK,而 iOS Safari 根本不支持。
 */
export function canAirPlay(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { WebKitPlaybackTargetAvailabilityEvent?: unknown };
  const a = audio() as unknown as { webkitShowPlaybackTargetPicker?: unknown } | null;
  return Boolean(w.WebKitPlaybackTargetAvailabilityEvent && a && typeof a.webkitShowPlaybackTargetPicker === 'function');
}

/** 弹出系统的投放选择器(AirPlay / 支持 AirPlay 的音箱)。必须在用户手势里调。 */
export function showAirPlayPicker(): boolean {
  const a = audio() as unknown as { webkitShowPlaybackTargetPicker?: () => void } | null;
  if (!a || typeof a.webkitShowPlaybackTargetPicker !== 'function') return false;
  try { a.webkitShowPlaybackTargetPicker(); return true; } catch { return false; }
}

export function currentState(): PlayerState {
  return state;
}

export function currentTrack(): { id: string; title: string; artist: string } | null {
  if (remote && remote.id === state.currentId) return remote;
  const t = tracks.find((x) => x.id === state.currentId);
  return t ? { id: t.id, title: t.title, artist: t.artist } : null;
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

  // 把记着的 MIME 一起带过去 —— 读回来的 blob 没有 type 的话(iOS 上是常态)
  // 靠它重新包一层,否则 Safari 拿到一个空 MIME 的 blob URL 就是不出声。
  const blob = await getTrackBlob(id, track.mimeType);
  if (!blob) { emit({ loading: false, playing: false, error: c.fileMissing(track.title) }); return; }

  const a = audio();
  if (!a) { emit({ loading: false, error: c.notReady }); return; }
  remote = null;                  // 换回本地曲目:远端那条身份作废,不然 currentTrack 认错人
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

/**
 * 放一个**远端**地址(网易那类)。
 *
 * 和 playId 的差别只在音频从哪来:那边是本地 blob,这边是一个 URL。
 * 别的都一样 —— 同一个 audio 元素、同一份状态、同一套失败话术,
 * 所以悬浮球、车机显示、暂停键全都照旧管用,不需要第二套。
 *
 * 「这一首取不到」不在这里判:那是调用方问过 song-url 之后的事,
 * 而且它要说的是「换一首」而不是「重试」——两种话不该在同一处拼。
 */
export async function playRemote(url: string, meta: { id: string; title: string; artist?: string }): Promise<void> {
  const c = copy();
  const a = audio();
  if (!a) { emit({ loading: false, error: c.notReady }); return; }
  remote = { id: meta.id, title: meta.title, artist: meta.artist || '' };
  emit({ currentId: meta.id, loading: true, error: '' });
  revoke();                       // 上一首要是本地的,把它的 objectURL 放掉
  a.src = url;
  try {
    await a.play();
    emit({ playing: true, loading: false, error: '' });
  } catch (e) {
    const name = (e as Error)?.name || '';
    emit({ playing: false, loading: false, error: name === 'NotAllowedError' ? c.blocked : c.badFormat(meta.title) });
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
  // 正在放远端的那一首时,本地队列里根本没有它 —— 按本地顺序「下一首」会跳到
  // 一首毫不相干的歌。走远端自己那条队列。
  if (entryQueue.some((e) => e.id === state.currentId)) { void stepEntry(dir, auto); return; }
  if (remote && remote.id === state.currentId) { void stepEntry(dir, auto); return; }
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

/**
 * 远端的上一首/下一首。和本地的差别只有一处:下一首**可能取不到音频**,
 * 那就继续往下找 —— 但风控时立刻停(见 auto-advance 里那段说明)。
 */
async function stepEntry(dir: 'next' | 'prev', auto: boolean): Promise<void> {
  const resolver = resolveRemote;
  if (!entryQueue.length || !resolver) {
    // 没有队列可续:停住,别假装能续。
    audio()?.pause();
    emit({ playing: false });
    return;
  }
  const order = playOrder(entryQueue.length, opts.shuffle, opts.seed);
  const cur = Math.max(0, entryQueue.findIndex((t) => t.id === state.currentId));
  const idx = dir === 'next' ? nextIndex(cur, order, opts.repeat, auto) : prevIndex(cur, order);
  if (idx == null) { audio()?.pause(); emit({ playing: false }); return; }

  const startPos = Math.max(0, order.indexOf(idx));
  const run = ++remoteRun;
  emit({ loading: true, error: '' });
  const r = await findPlayable(order, startPos, async (i) => {
    const t = entryQueue[i];
    if (!t) return { kind: 'failed' };
    // 本地曲目不用问任何人 —— 文件就在这台机器上。给一个占位 url 让 findPlayable
    // 认为「这一首行」,真正的播放走下面的 playEntry(它会分派到 blob 那条路)。
    if (t.source === 'local') return { kind: 'ok', url: 'local' };
    return resolver(t.id);
  }, { isCancelled: () => run !== remoteRun });

  if (run !== remoteRun) return;          // 这一趟已经被用户点别的作废了
  if (r.index >= 0 && r.url) {
    const t = entryQueue[r.index];
    if (t.source === 'local') await playId(t.id);
    else await playRemote(r.url, { id: t.id, title: t.title, artist: t.artist });
    // 跳过了几首也要说 —— 默默换歌用户会以为自己点错了
    if (r.skipped > 0) onRemoteStop?.({ stop: 'played', skipped: r.skipped });
    return;
  }
  audio()?.pause();
  emit({ playing: false, loading: false });
  onRemoteStop?.({ stop: r.stop, skipped: r.skipped });
}

/** 用户手动点了别的 —— 作废掉正在跑的那一趟自动往下找。 */
export function cancelAutoAdvance(): void {
  remoteRun += 1;
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
  remote = null;
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
