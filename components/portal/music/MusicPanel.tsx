'use client';

/**
 * 音乐面板(2026-07-30,用户:「那就做本地歌曲,网易,歌曲加自由切换,spotify 和 apple music」)。
 *
 * 这一屏要老实交代的一件事:**四个音源不是一回事**。
 *   · 本地歌曲 / Apple Music —— Nesio 自己出声,车机上显示 Nesio;
 *   · Spotify               —— Nesio 只是遥控器,声音和车机界面都在 Spotify 那边;
 *   · 网易云                —— 也是 Nesio 自己出声,但**逐曲**:多数歌能放,
 *                              版权受限那部分取不到,点下去才知道(2026-07-31 更正,
 *                              上一版把它整个判成「放不出声」是过度概括)。
 * 所以换源不是换个下拉框那么轻:跨过这条线,用户在车里看到的东西会当场变。
 * switchNotice() 那句话就是为此存在,而且必须在**切之前**说。
 *
 * 每个源都自报「现在能不能放、差哪一步」(canPlayNow / blockedReason),
 * 不能放就不进回退链 —— 正向判据。界面上不留一个点了没反应的按钮。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  MUSIC_SOURCES, blockedReason, canPlayNow, fallbackChain, noSourceLine,
  perTrackNote, sourceInfo, sourceName, switchNotice, type MusicSourceId,
} from '@/lib/platform/music/source-catalog';
import {
  importLocalTrack, deleteLocalTrack, loadLocalTracks, libraryHeadline,
  prettyDuration, renameLocalTrack, parseTrackName, LOCAL_TRACKS_CHANGED, type LocalTrack,
} from '@/lib/platform/music/local-tracks';
import { prettyBytes } from '@/lib/portal/local-file-store';
import { loadMusicPrefs, saveMusicPrefs, loadLastPlayed, saveLastPlayed, type MusicPrefs } from '@/lib/platform/music/prefs';
import { EMPTY_READINESS, fetchSpotifyStatus, localReadiness, probeReadiness, type ReadinessMap, type SpotifyStatus } from '@/lib/platform/music/readiness';
import { authorizeApple, lastAppleError } from '@/lib/platform/music/apple-client';
import { useSessionState } from '../use-session-state';
import { playRemote, setPanelOpen, setEntryQueue, cancelAutoAdvance, type QueueEntry } from '@/lib/platform/music/player-engine';
import type { ProbeOutcome } from '@/lib/platform/music/auto-advance';
import { autoAdvanceMessage } from '@/lib/platform/music/auto-advance';
import { trackRef, type PlaylistEntry } from '@/lib/platform/music/playlists';
import FullScreenPlayer, { type NowPlaying } from './FullScreenPlayer';
import AddToPlaylistSheet from './AddToPlaylistSheet';
import PlaylistsTab from './PlaylistsTab';
import { useLocalPlayer } from './use-local-player';
import type { RepeatMode } from '@/lib/platform/music/queue';

interface NeteaseHit { id: string; title: string; artist: string; album: string; durationSec: number }

/** 播放进度用:0 秒是**有效**位置,该显示 0:00;prettyDuration 的 --:-- 表示的是「不知道多长」。 */
const clockTime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function MusicPanel() {
  // 必须过 portalLocaleToDictionaryLocale:PortalLocale 有 12 种(ja/fr/de/…),
  // 而 L() 只认 'en'。直接把 locale 丢进去,法语用户会看到中文 —— 上一轮 #24 修的
  // 正是这一类,这里不能再犯。
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  // 三个远端源的探测路由都走 guardAiRoute —— 没登录一律 401。
  // 不看登录态的话,探测结果会被翻译成「Apple Music 还没配好开发者密钥」,
  // 而真实原因是「还没登录」。给错原因比不给更糟:用户会去改一个没坏的东西。
  const session = useSessionState();
  const signedOut = session.state === 'signed-out';
  const [prefs, setPrefs] = useState<MusicPrefs>(() => loadMusicPrefs());
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [readiness, setReadiness] = useState<ReadinessMap>(EMPTY_READINESS);
  const [probed, setProbed] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [pendingSwitch, setPendingSwitch] = useState<{ to: MusicSourceId; notice: string } | null>(null);
  const [connectMsg, setConnectMsg] = useState('');
  // Spotify 授权回来的那一句。**不放进 spotify 那一段里** —— 用户当前停在哪个源都得看见,
  // 否则从 Spotify 跳回来,当前源还是「本地」,这句话就永远显示不出来。
  const [callbackMsg, setCallbackMsg] = useState('');
  const [neteaseQ, setNeteaseQ] = useState('');
  const [neteaseHits, setNeteaseHits] = useState<NeteaseHit[]>([]);
  const [neteaseMsg, setNeteaseMsg] = useState('');
  const [searching, setSearching] = useState(false);
  /** 正在问播放地址的那一首。只允许一首在飞 —— 连点两行会让后回来的那首抢走播放。 */
  const [neteaseTrying, setNeteaseTrying] = useState('');
  /**
   * 某一首的结果。`kind` 是关键:
   *   'restricted' —— 这一首确实取不到,唯一有效的动作是**换一首**,给重试键是骗人;
   *   'failed'     —— 上游/网络故障,重试是对的动作,所以给重试键。
   * 两者合成一句「播放失败」的下场,是用户对着一首永远放不了的歌一直点重试。
   */
  const [neteaseTrackMsg, setNeteaseTrackMsg] = useState<{ id: string; kind: 'restricted' | 'blocked' | 'failed'; text: string } | null>(null);
  /**
   * 正在放的那一首网易歌曲。**不能从 neteaseHits 里现找** ——
   * 放起来之后再搜一次别的,hits 就换了一批,播放条会当场消失:
   * 歌还在响,而暂停键没了(悬浮球在这一页是让位的),用户没有任何地方能关掉它。
   */
  const [nowRemote, setNowRemote] = useState<NeteaseHit | null>(null);
  const [spotifyInfo, setSpotifyInfo] = useState<SpotifyStatus | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 随机序列的种子。挂载时定一次 —— 每次渲染重掷会让「上一首」回到一首没听过的歌。
  const seedRef = useRef(Math.floor(Math.random() * 1_000_000) + 1);

  // 「上次听到哪」只在客户端读:渲染期直接读 localStorage 会让服务端渲染出的
  // 那一帧与客户端不一致(水合告警),而且首屏会闪一下。
  const [lastId, setLastId] = useState('');
  /** 曲库 / 歌单 两个子 tab(用户:「在音乐板面应该有歌单 子tab 才对」)。 */
  const [tab, setTab] = useState<'library' | 'playlists'>('library');
  /** 全屏播放器开着没有。**默认关** —— 点一首歌不该抢走整屏。 */
  const [fullscreen, setFullscreen] = useState(false);
  /** 「加到歌单」弹层要加的那一首。 */
  const [adding, setAdding] = useState<Omit<PlaylistEntry, 'addedAt'> | null>(null);
  /** 自动往下找停下来时说的那句话(风控/断网/都放不了)。不许静默。 */
  const [queueMsg, setQueueMsg] = useState('');
  useEffect(() => { setTracks(loadLocalTracks()); setLastId(loadLastPlayed()); }, []);
  // 时长是播起来之后才知道的,由引擎写回 localStorage。不听这个事件的话,
  // 列表上那一栏会永远停在「--:--」—— 数据早就有了,只是这份快照不知道。
  useEffect(() => {
    const onChanged = () => setTracks(loadLocalTracks());
    window.addEventListener(LOCAL_TRACKS_CHANGED, onChanged);
    return () => window.removeEventListener(LOCAL_TRACKS_CHANGED, onChanged);
  }, []);
  // 告诉悬浮球「这一页开着,你先让位」—— 同一屏两套播放控制会让人怀疑它俩不是一回事。
  useEffect(() => { setPanelOpen(true); return () => setPanelOpen(false); }, []);
  useEffect(() => {
    let alive = true;
    // 明确未登录时不去打那三个 guard 路由 —— 每次都是 401,除了给限流器添噪音没有别的作用。
    // 'unknown'(还没问出来)照常探:那时候贸然当成未登录,已登录的用户会白等一轮。
    if (signedOut) {
      setReadiness({ ...EMPTY_READINESS, local: localReadiness() });
      setProbed(true);
      return;
    }
    probeReadiness().then((r) => { if (alive) { setReadiness(r); setProbed(true); } });
    return () => { alive = false; };
  }, [signedOut]);

  // Spotify 回调:`/?music=1&spotify=…`。每种失败都给一句**不一样**的话 ——
  // 「被拒」「来源没对上」「换令牌失败」需要的下一步动作各不相同,合成一句「连接失败」
  // 等于什么都没说。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const st = params.get('spotify');
    if (!st) return;
    const MSG: Record<string, string> = {
      connected: L(dict, 'Spotify 连上了。', 'Spotify connected.'),
      denied: L(dict, '这次没有授权 —— 随时可以再来一次。', 'Authorization was declined — you can try again anytime.'),
      state_mismatch: L(dict, '这次授权的来源没对上,为安全起见没有保存。重新连一次就好。', 'Could not verify where that came from, so nothing was saved. Please connect again.'),
      exchange_failed: L(dict, '换令牌那一步没成功,再连一次试试。', 'Token exchange did not go through — try connecting again.'),
      unconfigured: L(dict, 'Spotify 还没在服务端配好,这一步得先补上。', 'Spotify is not configured on the server yet.'),
      network: L(dict, '网络没通,这次没连上。', 'Network error — not connected.'),
    };
    setCallbackMsg(MSG[st] || L(dict, '这次没连上。', 'Not connected.'));
    params.delete('spotify');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    if (st === 'connected') void probeReadiness().then(setReadiness);
  }, [dict]);
  // 曲库变了(导入/删除),local 的 streamable 也跟着变 —— 不重探的话
  // 「刚导进第一首歌」之后界面还在说「先导几首吧」。
  useEffect(() => {
    setReadiness((r) => ({ ...r, local: { configured: true, authorized: true, streamable: tracks.length > 0 } }));
  }, [tracks.length]);

  const player = useLocalPlayer(tracks, { repeat: prefs.repeat, shuffle: prefs.shuffle, seed: seedRef.current, locale: dict });
  useEffect(() => { if (player.state.currentId) saveLastPlayed(player.state.currentId); }, [player.state.currentId]);

  const source = prefs.preferredSource;
  const info = sourceInfo(source);
  const ready = readiness[source];
  const playable = !!ready && canPlayNow(source, ready);
  const blocked = ready ? blockedReason(source, ready, dict) : '';
  const chain = useMemo(() => fallbackChain(source, readiness), [source, readiness]);
  const head = useMemo(() => libraryHeadline(tracks), [tracks]);

  const setPref = useCallback((patch: Partial<MusicPrefs>) => {
    setPrefs((p) => { const next = { ...p, ...patch }; saveMusicPrefs(next); return next; });
  }, []);

  /** 换源。跨播放模型时先把话说清楚,用户点了「知道了」再换。 */
  const requestSwitch = useCallback((to: MusicSourceId) => {
    if (to === source) return;
    const notice = switchNotice(source, to, dict);
    if (!notice) { setPref({ preferredSource: to }); return; }
    setPendingSwitch({ to, notice });
  }, [source, setPref, dict]);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setImportMsg('');
    const failed: string[] = [];
    let added = 0;
    for (const f of Array.from(files)) {
      const r = await importLocalTrack(f, dict);
      if (r.ok) added += 1; else if (r.error) failed.push(r.error);
    }
    setTracks(loadLocalTracks());
    // 成功几首、哪几首没进来 —— 两边都说。只说「导入完成」会掩盖掉失败的那几首。
    setImportMsg([
      added ? L(dict, `加进来 ${added} 首。`, `Added ${added}.`) : '',
      ...failed,
    ].filter(Boolean).join(' '));
    if (fileRef.current) fileRef.current.value = '';
  }, [dict]);

  const onConnectApple = useCallback(async () => {
    setConnectMsg(L(dict, '正在连 Apple Music…', 'Connecting Apple Music…'));
    const ok = await authorizeApple();
    if (ok) {
      setConnectMsg(L(dict, 'Apple Music 连上了。', 'Apple Music connected.'));
      setReadiness(await probeReadiness());
    } else {
      // 失败必须有话说:没配密钥 / 组件没加载 / 用户取消,三种都不一样。
      setConnectMsg(lastAppleError() || L(dict, '这次没连上,再试一次或先用本地歌曲。', 'Not connected. Try again, or use local files.'));
    }
  }, [dict]);

  // 选到 Spotify 那一格时才去问详情 —— 免费/Premium 与账号名都要照实显示。
  useEffect(() => {
    if (source !== 'spotify') return;
    let alive = true;
    fetchSpotifyStatus().then((v) => { if (alive) setSpotifyInfo(v); });
    return () => { alive = false; };
  }, [source, readiness.spotify?.authorized]);

  const onSearchNetease = useCallback(async () => {
    const q = neteaseQ.trim();
    if (!q) return;
    setSearching(true);
    setNeteaseMsg('');
    try {
      const res = await fetch(`/api/portal/music/netease/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const j = await res.json() as { ok?: boolean; configured?: boolean; hits?: NeteaseHit[]; reason?: string };
      if (j.reason === 'blocked') {
        // 被风控不是「没搜到」:换个词再搜一遍没用,这一句必须自己一支。
        setNeteaseHits([]);
        setNeteaseMsg(L(dict,
          '网易这会儿不接受这台服务器的请求,换个词再搜也一样。先用别的源,或者过一阵再来。',
          'NetEase is not accepting requests from this server right now — a different search will not help. Use another source, or come back later.'));
      } else if (!j.ok) {
        setNeteaseHits([]);
        setNeteaseMsg(L(dict, '这次没搜到,过一会儿再试。', 'Search failed. Try again shortly.'));
      } else {
        setNeteaseHits(j.hits || []);
        if (!j.hits?.length) setNeteaseMsg(L(dict, '没找到这首。', 'Nothing found.'));
      }
    } catch {
      setNeteaseHits([]);
      setNeteaseMsg(L(dict, '网络没通,搜索没发出去。', 'Network error — search did not go through.'));
    } finally {
      setSearching(false);
    }
  }, [neteaseQ, dict]);

  /**
   * 问一首网易的歌现在能不能放。**只回答,不播** ——
   * 这样同一个判断既能给用户手点用,也能给引擎自动往下找用,不写两份。
   */
  const probeRemote = useCallback(async (id: string): Promise<ProbeOutcome> => {
    try {
      const res = await fetch(`/api/portal/music/netease/song-url?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({})) as { ok?: boolean; url?: string; reason?: string };
      if (res.ok && j.ok && j.url) return { kind: 'ok', url: j.url };
      if (j.reason === 'blocked') return { kind: 'blocked' };
      if (res.ok && j.reason === 'restricted') return { kind: 'restricted' };
      return { kind: 'failed' };
    } catch {
      return { kind: 'failed' };
    }
  }, []);

  /**
   * 自动往下找停在哪儿了。**必须说出来** —— 一首放完什么都不发生,
   * 用户只会觉得「播放器又坏了」,而这四种停法各有各的下一步。
   */
  const onQueueStop = useCallback((r: { stop: string; skipped: number }) => {
    setQueueMsg(autoAdvanceMessage(
      { index: r.stop === 'played' ? 0 : -1, url: '', skipped: r.skipped, stop: r.stop as never },
      dict === 'en' ? 'en' : 'zh',
    ));
  }, [dict]);

  /**
   * 搜索结果就是一条队列。**这是「自动播放下一个」的接线**:
   * 在这之前一首放完就停住了(引擎里写着「远端没有队列概念」),
   * 于是用户说的「我要一个个点」。
   */
  useEffect(() => {
    if (!neteaseHits.length) return;
    setEntryQueue(
      neteaseHits.map((h) => ({
        ref: trackRef('netease', h.id), source: 'netease' as const, id: h.id,
        title: h.title, artist: h.artist, durationSec: h.durationSec,
      })) satisfies QueueEntry[],
      probeRemote,
      onQueueStop,
    );
  }, [neteaseHits, probeRemote, onQueueStop]);

  /**
   * 点一首网易的歌。**这一步才知道它能不能放** —— 源级别只能说「多数能放」。
   *
   * 四种结局必须说四种话,因为**下一步动作各不相同**:
   *   拿到地址 → 直接出声;
   *   这一首受限 → 换一首(那句里没有「重试」两个字,它永远不会成功);
   *   整台被风控 → 换歌也没用,得换出口 —— 说成「这首受限」会让人一首一首试到放弃;
   *   故障 → 才给重试。
   * 混着说 = 让人对着一堵墙一直撞。
   */
  const onPlayNetease = useCallback(async (h: NeteaseHit) => {
    cancelAutoAdvance();      // 用户明确点了这一首:作废掉正在跑的自动往下找
    setQueueMsg('');
    setNeteaseTrying(h.id);
    setNeteaseTrackMsg(null);
    try {
      const res = await fetch(`/api/portal/music/netease/song-url?id=${encodeURIComponent(h.id)}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({})) as { ok?: boolean; url?: string; reason?: string };
      if (res.ok && j.ok && j.url) {
        setNowRemote(h);
        await playRemote(j.url, { id: h.id, title: h.title, artist: h.artist });
        return;
      }
      if (j.reason === 'blocked') {
        setNeteaseTrackMsg({
          id: h.id,
          kind: 'blocked',
          text: L(dict,
            '网易这会儿不接受这台服务器的请求 —— 跟这一首没关系,换歌也一样。先用别的源,或者过一阵再来。',
            'NetEase is not accepting requests from this server right now — this is not about this track, so switching tracks will not help. Use another source, or come back later.'),
        });
        return;
      }
      if (res.ok && j.reason === 'restricted') {
        // 不是故障:这一首有版权限制。给的出口是「换一首 / 换个源 / 导本地」,不是重试。
        setNeteaseTrackMsg({
          id: h.id,
          kind: 'restricted',
          text: L(dict,
            '这一首有版权限制,取不到音频。换一首,或者在别的源找同一首、把文件导进本地歌曲。',
            'This one is rights-restricted, so there is no audio to fetch. Try another track, or import the file into local music.'),
        });
        return;
      }
      setNeteaseTrackMsg({ id: h.id, kind: 'failed', text: L(dict, '这次没取到播放地址,过一会儿再试。', 'Could not fetch the stream this time — try again shortly.') });
    } catch {
      setNeteaseTrackMsg({ id: h.id, kind: 'failed', text: L(dict, '网络没通,这次没请求出去。', 'Network error — the request did not go through.') });
    } finally {
      setNeteaseTrying('');
    }
  }, [dict]);

  /**
   * 自动往下找换了一首之后,把「正在放的远端曲目」跟上。
   *
   * 不跟的话,播放条和全屏播放器会停在**上一首**的名字上,而声音已经是下一首了 ——
   * 这一屏上两个说法打架,用户只会得出「这播放器是乱的」。
   */
  useEffect(() => {
    const id = player.state.currentId;
    if (!id || nowRemote?.id === id) return;
    const hit = neteaseHits.find((h) => h.id === id);
    if (hit) setNowRemote(hit);
  }, [player.state.currentId, neteaseHits, nowRemote?.id]);

  const current = tracks.find((t) => t.id === player.state.currentId) || null;
  const resumeTrack = !current && lastId ? tracks.find((t) => t.id === lastId) || null : null;

  /**
   * 正在放的那一首,统一成一个形状 —— 本地和远端在全屏播放器里没有区别,
   * 它要的只是「叫什么、谁唱的、多长、去哪儿要歌词」。
   */
  const now: NowPlaying | null = current
    ? { source: 'local', id: current.id, title: current.title, artist: current.artist, durationSec: current.durationSec }
    : (nowRemote && nowRemote.id === player.state.currentId)
      ? { source: 'netease', id: nowRemote.id, title: nowRemote.title, artist: nowRemote.artist, durationSec: nowRemote.durationSec }
      : null;

  return (
    <div className="nesio-music">
      {/* 音源。每个 chip 自己说得清能不能放 —— 不做「灰掉但不说为什么」。 */}
      <div className="nesio-music-sources">
        {MUSIC_SOURCES.map((s) => {
          const r = readiness[s.id];
          const ok = !!r && canPlayNow(s.id, r);
          return (
            <button
              key={s.id}
              type="button"
              className={`nesio-music-src${s.id === source ? ' is-on' : ''}`}
              onClick={() => requestSwitch(s.id)}
            >
              <span className="nesio-music-src-name">{L(dict, s.zh, s.en)}</span>
              {/* 没配好的源直接标在 chip 上 —— 四个长得一模一样、点进去才发现三个用不了,
                  那是让人一个一个去撞墙。本地歌曲不标:它不需要配任何东西。 */}
              {probed && !signedOut && s.id !== 'local' && r && !r.configured && (
                <span className="nesio-music-src-tag">{L(dict, '未配置', 'not set up')}</span>
              )}
              <span className={`nesio-music-src-dot${ok ? ' is-live' : ''}`} aria-hidden />
            </button>
          );
        })}
      </div>

      {/* 换源前的那句话。跨播放模型才出现 —— 同模型之间不打扰。 */}
      {/* 曲库 / 歌单 两个子 tab。歌单**跨源** —— 一个歌单里本地和网易的歌混着是常态,
          所以它不跟着上面那排音源走。 */}
      <div className="nesio-music-tabs" role="tablist">
        <button
          type="button" role="tab" aria-selected={tab === 'library'}
          className={`nesio-music-tab${tab === 'library' ? ' is-on' : ''}`}
          onClick={() => setTab('library')}
        >{L(dict, '曲库', 'Library')}</button>
        <button
          type="button" role="tab" aria-selected={tab === 'playlists'}
          className={`nesio-music-tab${tab === 'playlists' ? ' is-on' : ''}`}
          onClick={() => setTab('playlists')}
        >{L(dict, '歌单', 'Playlists')}</button>
      </div>

      {tab === 'playlists' && (
        <PlaylistsTab probeRemote={probeRemote} onQueueStop={onQueueStop} currentId={player.state.currentId} />
      )}

      {queueMsg && (
        <div className="nesio-music-err">
          <span>{queueMsg}</span>
          <button type="button" onClick={() => setQueueMsg('')}>{L(dict, '知道了', 'OK')}</button>
        </div>
      )}

      {pendingSwitch && (
        <div className="nesio-music-notice">
          <p>{pendingSwitch.notice}</p>
          <div className="nesio-music-notice-acts">
            <button type="button" onClick={() => { setPref({ preferredSource: pendingSwitch.to }); setPendingSwitch(null); }}>
              {L(dict, '知道了,换过去', 'Got it, switch')}
            </button>
            <button type="button" className="ghost" onClick={() => setPendingSwitch(null)}>
              {L(dict, '算了', 'Never mind')}
            </button>
          </div>
        </div>
      )}

      {callbackMsg && <p className="nesio-music-msg">{callbackMsg}</p>}
      {/* 未登录时,远端三源的探测一律 401 —— 先把真原因说出来,别让下面那些
          「还没配好 / 还没连上」的话去背这口锅。本地歌曲不受影响,照常能听。 */}
      {signedOut && source !== 'local' && (
        <p className="nesio-music-blocked">
          {L(dict,
            `${sourceName(source, dict)}要先登录 Nesio 才连得上。本地歌曲不用登录,现在就能听。`,
            `${sourceName(source, dict)} needs you signed in to Nesio first. Local files work without an account.`)}
        </p>
      )}

      {/* 这个源现在的处境。能放就不说话。 */}
      {/* 顶上这句只在**这一段自己不说明**的时候出现。
          Apple / Spotify / 网易 各自的段落都会把「差什么、去哪补」讲清楚,
          再在顶上写一遍,屏幕上就是两句「还没配好」(实测截图正是如此)。 */}
      {probed && !playable && blocked
        && !(signedOut && source !== 'local')
        && !(source !== 'local' && ready && !ready.configured)
        && <p className="nesio-music-blocked">{blocked}</p>}
      {/* 回退链的真实出口:当前源放不了时,把**真能放**的那几个摆出来、一键切过去。
          光说「放不了」而不给下一步,就是把用户留在死路上。切过去仍然走 requestSwitch,
          跨播放模型的那句提示不会被绕过。 */}
      {probed && !playable && !!chain.length && (
        <div className="nesio-music-fallback">
          <span>{L(dict, '现在能放的是:', 'These can play right now:')}</span>
          {chain.map((id) => (
            <button key={id} type="button" onClick={() => requestSwitch(id)}>
              {sourceName(id, dict)}
            </button>
          ))}
        </div>
      )}
      {probed && !chain.length && <p className="nesio-music-blocked">{noSourceLine(readiness, dict)}</p>}
      {playable && info.model === 'remote' && (
        <p className="nesio-music-model">
          {L(dict,
            `声音由 ${info.zh} 播,车机上显示的是 ${info.showsOnCar}。`,
            `${info.en} plays the audio; your car shows ${info.showsOnCar}.`)}
        </p>
      )}

      {/* ── 本地歌曲 ─────────────────────────────────────────────── */}
      {tab === 'library' && source === 'local' && (
        <section className="nesio-music-sec">
          <div className="nesio-music-libhead">
            <span>{head.count
              ? L(dict, `${head.count} 首 · ${prettyBytes(head.bytes)}`, `${head.count} tracks · ${prettyBytes(head.bytes)}`)
              : L(dict, '曲库还是空的', 'Library is empty')}</span>
            <button type="button" onClick={() => fileRef.current?.click()}>
              {L(dict, '导入歌曲', 'Import')}
            </button>
          </div>
          {/* 不能用 hidden / display:none —— iOS 的 WKWebView 会忽略这种 input 的 click(),
              表现正是「点导入完全没反应」而桌面一切正常。视觉隐藏即可(test:qa-ui-truth 压这条)。 */}
          <input
            ref={fileRef}
            type="file"
            /* **不设 accept**。仓里已经为这件事栽过一次(见 CaptureBar 的 CAPTURE_ACCEPT=''):
               在 iOS 的「文件」选择器里,accept 会把一大片本来能选的文件灰掉 ——
               iCloud Drive 同步下来的音频常常没有 MIME、甚至没有扩展名。
               实测症状就是用户说的「无法识别任何格式,无法上传」:一首都选不中。
               让他先选得到,收不收由 isAudioFile 判、能不能放由 audio 元素判。 */
            multiple
            className="nesio-visually-hidden"
            onChange={(e) => { void onFiles(e.target.files); }}
          />
          {importMsg && <p className="nesio-music-msg">{importMsg}</p>}

          {player.state.error && (
            <div className="nesio-music-err">
              <span>{player.state.error}</span>
              <button type="button" onClick={player.clearError}>{L(dict, '知道了', 'OK')}</button>
            </div>
          )}

          {!tracks.length && (
            <p className="nesio-music-empty">
              {L(dict,
                '把手机里的歌拖进来,离线也听得到 —— 这一路不要账号、不要订阅。',
                'Drop in audio files. This path needs no account and no subscription.')}
            </p>
          )}

          {resumeTrack && (
            <button type="button" className="nesio-music-resume" onClick={() => { void player.playId(resumeTrack.id); }}>
              {L(dict, `接着听「${resumeTrack.title}」`, `Resume “${resumeTrack.title}”`)}
            </button>
          )}

          <ul className="nesio-music-list">
            {tracks.map((t) => (
              <li key={t.id} className={t.id === player.state.currentId ? 'is-cur' : ''}>
                <button type="button" className="nesio-music-row" onClick={() => { void player.playId(t.id); }}>
                  <span className="nesio-music-title">{t.title}</span>
                  <span className="nesio-music-sub">
                    {[t.artist, prettyDuration(t.durationSec)].filter(Boolean).join(' · ')}
                  </span>
                </button>
                {/* 「加歌单」(用户:「每一个可以的歌曲要有按钮可以加歌单」)。
                    本地曲目也能进歌单 —— 歌单是跨源的。 */}
                <button
                  type="button"
                  className="nesio-music-add"
                  aria-label={L(dict, `把「${t.title}」加到歌单`, `Add “${t.title}” to a playlist`)}
                  onClick={() => setAdding({
                    ref: trackRef('local', t.id), title: t.title, artist: t.artist, durationSec: t.durationSec,
                  })}
                >＋</button>
                <button
                  type="button"
                  className="nesio-music-del"
                  aria-label={L(dict, '移出曲库', 'Remove')}
                  onClick={async () => {
                    // 正在放的这首被移出曲库,得停 —— 列表里没了却还在响是同屏矛盾。
                    if (t.id === player.state.currentId) player.stop();
                    await deleteLocalTrack(t.id);
                    setTracks(loadLocalTracks());
                  }}
                >×</button>
              </li>
            ))}
          </ul>

          {(current || player.state.loading) && (
            <div className="nesio-music-bar">
              <div className="nesio-music-bar-meta">
                <strong>{current?.title || L(dict, '载入中…', 'Loading…')}</strong>
                <span>{current?.artist || ''}</span>
              </div>
              <div className="nesio-music-bar-acts">
                {/* 展开成全屏(大封面 + 歌词)。这条窄播放条在列表页是对的 ——
                    边看列表边控制;要看歌词的人从这里进去。 */}
                <button
                  type="button"
                  className="nesio-music-expand"
                  onClick={() => setFullscreen(true)}
                  aria-label={L(dict, '全屏播放', 'Full screen player')}
                >⌃</button>
                <button type="button" onClick={player.prev} aria-label={L(dict, '上一首', 'Previous')}>‹‹</button>
                <button type="button" onClick={() => { void player.toggle(); }}>
                  {player.state.playing ? L(dict, '暂停', 'Pause') : L(dict, '播放', 'Play')}
                </button>
                <button type="button" onClick={player.next} aria-label={L(dict, '下一首', 'Next')}>››</button>
                <button
                  type="button"
                  onClick={() => {
                    if (!current) return;
                    // 曲名是从文件名**猜**的,猜错很常见 —— 所以必须给得起改。
                    // 一次输入,格式跟文件名一样(「艺术家 - 曲名」),复用同一套解析。
                    const raw = window.prompt(
                      L(dict, '改成(艺术家 - 曲名):', 'Rename (artist - title):'),
                      [current.artist, current.title].filter(Boolean).join(' - ') || current.title,
                    );
                    if (raw == null || !raw.trim()) return;
                    const parsed = parseTrackName(raw.trim());
                    renameLocalTrack(current.id, parsed.title, parsed.artist);
                    setTracks(loadLocalTracks());
                  }}
                >{L(dict, '改名', 'Rename')}</button>
              </div>
              <div className="nesio-music-bar-time">
                {clockTime(player.state.positionSec)} / {prettyDuration(player.state.durationSec)}
              </div>
              {/* 可拖的进度 —— 时长还没读出来(durationSec=0)时不给拖:
                  一个拖了不动的滑块比没有滑块更让人以为坏了。 */}
              {player.state.durationSec > 0 && (
                <input
                  className="nesio-music-seek"
                  type="range"
                  min={0}
                  max={Math.floor(player.state.durationSec)}
                  value={Math.floor(player.state.positionSec)}
                  aria-label={L(dict, '拖动到某一处', 'Seek')}
                  onChange={(e) => player.seek(Number(e.target.value))}
                />
              )}
            </div>
          )}

          <div className="nesio-music-modes">
            <button
              type="button"
              className={prefs.shuffle ? 'is-on' : ''}
              onClick={() => setPref({ shuffle: !prefs.shuffle })}
            >{L(dict, '随机', 'Shuffle')}</button>
            {(['off', 'all', 'one'] as RepeatMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={prefs.repeat === m ? 'is-on' : ''}
                onClick={() => setPref({ repeat: m })}
              >
                {m === 'off' ? L(dict, '不循环', 'No repeat') : m === 'all' ? L(dict, '列表循环', 'Repeat all') : L(dict, '单曲循环', 'Repeat one')}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Apple Music ─────────────────────────────────────────── */}
      {tab === 'library' && source === 'apple' && (
        <section className="nesio-music-sec">
          <p className="nesio-music-model">
            {L(dict,
              '连上之后,声音仍然从 Nesio 自己播,车机上显示的也还是 Nesio。',
              'Once connected, Nesio itself plays; your car still shows Nesio.')}
          </p>
          {/* 服务端没配开发者密钥时**不给这颗按钮** —— 点了必然失败,
              而失败那句话跟顶上那句是同一件事,屏幕上就会出现两遍「还没配好」
              (实测截图里正是如此)。没得点的时候,给一句能照着做的话。 */}
          {readiness.apple?.configured ? (
            <>
              <button type="button" className="nesio-music-connect" onClick={() => { void onConnectApple(); }}>
                {readiness.apple?.authorized
                  ? L(dict, '已连接 Apple Music', 'Apple Music connected')
                  : L(dict, '连接 Apple Music', 'Connect Apple Music')}
              </button>
              {connectMsg && <p className="nesio-music-msg">{connectMsg}</p>}
            </>
          ) : (
            <p className="nesio-music-msg">
              {L(dict,
                '要用它得先在服务端配上 Apple 的开发者密钥(APPLE_MUSIC_TEAM_ID / KEY_ID / PRIVATE_KEY)。配好之前这一格只能看。',
                'This needs Apple developer keys on the server (APPLE_MUSIC_TEAM_ID / KEY_ID / PRIVATE_KEY). Until then this tab is read-only.')}
            </p>
          )}
        </section>
      )}

      {/* ── Spotify ─────────────────────────────────────────────── */}
      {tab === 'library' && source === 'spotify' && (
        <section className="nesio-music-sec">
          <p className="nesio-music-model">
            {L(dict,
              'Spotify 这条是遥控:Nesio 发指令,声音由 Spotify 播,车机上显示 Spotify。需要 Premium。',
              'Spotify is remote control: Nesio sends commands, Spotify plays. Premium required.')}
          </p>
          {spotifyInfo?.authorized && (
            <p className="nesio-music-msg">
              {spotifyInfo.displayName
                ? L(dict, `已连接:${spotifyInfo.displayName}`, `Connected as ${spotifyInfo.displayName}`)
                : L(dict, '已连接。', 'Connected.')}
              {spotifyInfo.product && ` · ${spotifyInfo.product === 'premium'
                ? L(dict, 'Premium,能放', 'Premium — can play')
                : L(dict, '免费版,搜得到但放不了', 'Free plan — search works, playback does not')}`}
            </p>
          )}
          {readiness.spotify?.authorized ? (
            <button
              type="button"
              className="nesio-music-connect"
              onClick={async () => {
                await fetch('/api/portal/music/spotify', { method: 'DELETE' }).catch(() => null);
                setReadiness(await probeReadiness());
              }}
            >{L(dict, '断开 Spotify', 'Disconnect Spotify')}</button>
          ) : readiness.spotify?.configured ? (
            <a className="nesio-music-connect" href="/api/portal/music/spotify/connect">
              {L(dict, '连接 Spotify', 'Connect Spotify')}
            </a>
          ) : (
            /* 服务端没配 client id/secret 时**绝不放这个链接出去**:
               那条路由回的是 503 + 一段 JSON,浏览器会原样铺满整屏
               —— 实测截图就是一屏黑底白字的 {"ok":false,"error":"provider_not_configured"…}。
               内部错误码不该出现在用户眼前(红线:内部文案泄露)。 */
            <p className="nesio-music-msg">
              {L(dict,
                '要用它得先在服务端配上 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET。配好之前这一格只能看。',
                'This needs SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET on the server. Until then this tab is read-only.')}
            </p>
          )}
        </section>
      )}

      {/* ── 网易云:能搜,多数能放,受限那部分点下去才知道 ─────────── */}
      {tab === 'library' && source === 'netease' && (
        <section className="nesio-music-sec">
          {/* 这一段自己说 —— 顶上那句 blocked 对没就绪的远端源是让位的(见上面的条件),
              这里不说就是整屏一句解释都没有。
              2026-07-31 起网易**不需要配任何东西**(直连),所以这句话不再是「去配 XX」,
              而是「暂时连不上」。逃生口(指一个自建实例)是部署者的事,写在 .env.example
              和 STATE.md 里,不塞进用户界面 —— 环境变量名不该出现在这儿。 */}
          {probed && !signedOut && readiness.netease && !readiness.netease.configured && (
            <p className="nesio-music-msg">
              {L(dict,
                '网易这会儿连不上 —— 不用你配什么,过一阵再来试试。想现在就听的话,本地歌曲照常能用。',
                'NetEase is unreachable right now — nothing for you to set up, just try again later. Local files still work.')}
            </p>
          )}
          <div className="nesio-music-search">
            <input
              value={neteaseQ}
              onChange={(e) => setNeteaseQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void onSearchNetease(); }}
              placeholder={L(dict, '搜歌名或歌手', 'Search songs or artists')}
            />
            <button type="button" onClick={() => { void onSearchNetease(); }} disabled={searching}>
              {searching ? L(dict, '搜索中…', 'Searching…') : L(dict, '搜索', 'Search')}
            </button>
          </div>
          {neteaseMsg && <p className="nesio-music-msg">{neteaseMsg}</p>}
          {player.state.error && (
            <div className="nesio-music-err">
              <span>{player.state.error}</span>
              <button type="button" onClick={player.clearError}>{L(dict, '知道了', 'OK')}</button>
            </div>
          )}
          <ul className="nesio-music-list">
            {neteaseHits.map((h) => (
              <li key={h.id} className={h.id === player.state.currentId ? 'is-cur' : ''}>
                {/* 可点。上一版这里是 is-static 的一块死文本 —— 那是「不是所有歌都锁着」
                    这条事实被我判反了的产物。现在点下去才去问,问到什么说什么。 */}
                <button
                  type="button"
                  className="nesio-music-row"
                  disabled={!!neteaseTrying}
                  onClick={() => { void onPlayNetease(h); }}
                >
                  <span className="nesio-music-title">{h.title}</span>
                  <span className="nesio-music-sub">
                    {neteaseTrying === h.id
                      ? L(dict, '正在取播放地址…', 'Fetching stream…')
                      : [h.artist, h.album, prettyDuration(h.durationSec)].filter(Boolean).join(' · ')}
                  </span>
                </button>
                <button
                  type="button"
                  className="nesio-music-add"
                  aria-label={L(dict, `把「${h.title}」加到歌单`, `Add “${h.title}” to a playlist`)}
                  onClick={() => setAdding({
                    ref: trackRef('netease', h.id), title: h.title, artist: h.artist, durationSec: h.durationSec,
                  })}
                >＋</button>
                {neteaseTrackMsg?.id === h.id && (
                  <div className="nesio-music-err">
                    <span>{neteaseTrackMsg.text}</span>
                    {/* 三种结局三个动作。只有**故障**才给重试:受限那一首重试一万次
                        也是同一个答案;被风控时连「换一首」都是错的建议(每一首都一样)。
                        给错按钮 = 把用户按在墙上让他自己撞。 */}
                    {neteaseTrackMsg.kind === 'failed' ? (
                      <button type="button" onClick={() => { void onPlayNetease(h); }}>{L(dict, '再试一次', 'Try again')}</button>
                    ) : neteaseTrackMsg.kind === 'restricted' ? (
                      <button type="button" onClick={() => setNeteaseTrackMsg(null)}>{L(dict, '换一首', 'Another track')}</button>
                    ) : (
                      <button type="button" onClick={() => setNeteaseTrackMsg(null)}>{L(dict, '知道了', 'OK')}</button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!!neteaseHits.length && (
            <p className="nesio-music-model">{perTrackNote('netease', dict)}</p>
          )}

          {/* 正在放的是网易这一首时,给一条播放条 —— 否则点完出声了,页面上却
              没有任何暂停/继续的地方(悬浮球在这一页是让位的)。
              认的是 nowRemote 而不是当前这批搜索结果:再搜一次别的,这条不能跟着消失。 */}
          {nowRemote && player.state.currentId === nowRemote.id && (
            <div className="nesio-music-bar">
              <div className="nesio-music-bar-meta">
                <strong>{nowRemote.title}</strong>
                <span>{nowRemote.artist}</span>
              </div>
              <div className="nesio-music-bar-acts">
                <button
                  type="button"
                  className="nesio-music-expand"
                  onClick={() => setFullscreen(true)}
                  aria-label={L(dict, '全屏播放', 'Full screen player')}
                >⌃</button>
                <button type="button" onClick={player.prev} aria-label={L(dict, '上一首', 'Previous')}>‹‹</button>
                <button type="button" onClick={() => { void player.toggle(); }}>
                  {player.state.playing ? L(dict, '暂停', 'Pause') : L(dict, '播放', 'Play')}
                </button>
                {/* 「下一首」在这里是**新的**:在这之前远端一首放完就停住,
                    这个键也没有意义。现在它走的是搜索结果那条队列。 */}
                <button type="button" onClick={player.next} aria-label={L(dict, '下一首', 'Next')}>››</button>
                <button type="button" onClick={() => { cancelAutoAdvance(); player.stop(); setNowRemote(null); }}>{L(dict, '停止', 'Stop')}</button>
              </div>
              <div className="nesio-music-bar-time">
                {clockTime(player.state.positionSec)} / {prettyDuration(player.state.durationSec)}
              </div>
              {player.state.durationSec > 0 && (
                <input
                  className="nesio-music-seek"
                  type="range"
                  min={0}
                  max={Math.floor(player.state.durationSec)}
                  value={Math.floor(player.state.positionSec)}
                  aria-label={L(dict, '拖动到某一处', 'Seek')}
                  onChange={(e) => player.seek(Number(e.target.value))}
                />
              )}
            </div>
          )}
        </section>
      )}

      {/* 全屏播放器(用户:「播放全屏,歌词。都没有」)。**默认不开** ——
          点一首歌不该抢走整屏;要看歌词的人自己点开。 */}
      {fullscreen && now && (
        <FullScreenPlayer
          now={now}
          state={player.state}
          repeat={prefs.repeat}
          shuffle={prefs.shuffle}
          onRepeat={(v) => setPref({ repeat: v })}
          onShuffle={(v) => setPref({ shuffle: v })}
          onClose={() => setFullscreen(false)}
          onAddToPlaylist={(n) => setAdding({
            ref: trackRef(n.source, n.id), title: n.title, artist: n.artist, durationSec: n.durationSec,
          })}
        />
      )}

      {adding && <AddToPlaylistSheet entry={adding} onClose={() => setAdding(null)} />}

      {/* 音频元素**不在这里** —— 它挂在 document.body 上、由 player-engine 独占。
          放在组件里的话,切走这一页音乐就断了,悬浮球也就没有存在的意义了。 */}
    </div>
  );
}
