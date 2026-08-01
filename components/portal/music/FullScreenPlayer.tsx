'use client';

/**
 * 全屏播放器(2026-08-01,用户:「发现没有原来设计好的 UI。播放全屏,歌词。都没有」)。
 *
 * 在这之前音乐页底部只有一条 sticky 播放条:曲名、暂停、上下首、一条进度。
 * 那条现在留着(它在列表页是对的 —— 边看列表边控制),这一屏补的是
 * 「我就在听这一首」的时候该有的东西:大封面、逐行歌词、完整的控制排。
 *
 * ── 三个不显然的地方 ────────────────────────────────────────────────────────
 *
 * ① **歌词的三种状态要分开**:在找 / 有词 / **这一首没有词**。
 *    第三种**不给重试** —— 纯音乐重试一万次也还是没有,挂一个点不好的按钮
 *    比不给更伤。只有真的取不到(网络/风控)才给重试。
 *
 * ② **歌词点一行 = 跳到那儿**。这是全屏歌词最常被用的一个动作(想再听一遍那句),
 *    而它不需要任何新界面 —— 每一行本来就知道自己在第几秒。
 *
 * ③ **投放只做 AirPlay**。蓝牙是系统层的连接,连上之后网页的声音本来就跟着过去了,
 *    网页既没有 API 也不需要有;Cast 要 SDK 而 iOS Safari 不支持。
 *    所以这个按钮**只在真能用的设备上出现** —— 一个点了什么都不发生的投放键,
 *    比没有投放键更让人以为是坏了。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import NesioSheet from '../ui/NesioSheet';
import {
  canAirPlay, showAirPlayPicker, seek, step, toggle, type PlayerState,
} from '@/lib/platform/music/player-engine';
import { activeLineIndex, type LyricLine } from '@/lib/platform/music/lyrics';
import { loadLyrics, type LyricsStatus } from '@/lib/platform/music/lyrics-source';
import { isLiked, toggleLiked, trackRef, type TrackSource } from '@/lib/platform/music/playlists';
import { prettyDuration } from '@/lib/platform/music/local-tracks';
import type { RepeatMode } from '@/lib/platform/music/queue';

export interface NowPlaying {
  source: TrackSource;
  id: string;
  title: string;
  artist: string;
  durationSec: number;
}

interface Props {
  now: NowPlaying;
  state: PlayerState;
  repeat: RepeatMode;
  shuffle: boolean;
  onRepeat: (v: RepeatMode) => void;
  onShuffle: (v: boolean) => void;
  onClose: () => void;
  /** 「加到歌单」—— 由外面弹选择器(它要列出全部歌单,那是列表页的事)。 */
  onAddToPlaylist: (n: NowPlaying) => void;
}

export default function FullScreenPlayer({
  now, state, repeat, shuffle, onRepeat, onShuffle, onClose, onAddToPlaylist,
}: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const zh = dict !== 'en';

  const ref = useMemo(() => trackRef(now.source, now.id), [now.source, now.id]);

  const [lyrics, setLyrics] = useState<{ status: LyricsStatus | 'loading'; lines: LyricLine[]; from: string }>(
    { status: 'loading', lines: [], from: '' },
  );
  const [liked, setLiked] = useState(false);
  const [airplay, setAirplay] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { setLiked(isLiked(ref)); }, [ref]);
  // 只在挂载后问一次:这个 API 要 audio 元素已经存在
  useEffect(() => { setAirplay(canAirPlay()); }, []);

  useEffect(() => {
    let alive = true;
    setLyrics({ status: 'loading', lines: [], from: '' });
    void loadLyrics({ ref, title: now.title, artist: now.artist, durationSec: now.durationSec })
      .then((r) => { if (alive) setLyrics({ status: r.status, lines: r.lines, from: r.from }); });
    return () => { alive = false; };
  }, [ref, now.title, now.artist, now.durationSec, reloadKey]);

  const posMs = Math.round((state.positionSec || 0) * 1000);
  const active = activeLineIndex(lyrics.lines, posMs);

  // 当前那一行滚到中间。**只在行号变了才滚** —— 跟着 timeupdate 每秒滚好几次
  // 会把用户自己往上翻的动作一直拽回来。
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-lyric-line="${active}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  const onLike = useCallback(() => {
    setLiked(toggleLiked({ ref, title: now.title, artist: now.artist, durationSec: now.durationSec }));
  }, [ref, now.title, now.artist, now.durationSec]);

  const dur = state.durationSec || now.durationSec || 0;

  return (
    <NesioSheet
      variant="fullscreen"
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      ariaLabel={L(dict, '正在播放', 'Now playing')}
      className="nesio-fsp"
      card={false}
    >
      <div className="nesio-fsp-top">
        <button type="button" className="nesio-fsp-icon" onClick={onClose} aria-label={L(dict, '收起', 'Collapse')}>⌄</button>
        <span className="nesio-fsp-top-label">{L(dict, '正在播放', 'Now playing')}</span>
        {airplay ? (
          <button
            type="button"
            className="nesio-fsp-icon"
            onClick={() => { showAirPlayPicker(); }}
            aria-label={L(dict, '投放到其他设备', 'Play on another device')}
          >
            ⇱
          </button>
        ) : <span className="nesio-fsp-icon is-empty" aria-hidden />}
      </div>

      {/* 封面。远端曲目暂时没有封面图,用一块跟着曲名走的渐变代替 ——
          比一个灰色占位框好:它至少每首歌不一样。 */}
      <div className="nesio-fsp-art" aria-hidden>
        <span className="nesio-fsp-art-note">♪</span>
      </div>

      <div className="nesio-fsp-meta">
        <strong>{now.title}</strong>
        <span>{now.artist || L(dict, '未知艺人', 'Unknown artist')}</span>
      </div>

      {/* ── 歌词 ─────────────────────────────────────────────────────────── */}
      <div className="nesio-fsp-lyrics" ref={listRef}>
        {lyrics.status === 'loading' && (
          <p className="nesio-fsp-lyric-note">{L(dict, '正在找这一首的歌词…', 'Looking for lyrics…')}</p>
        )}
        {lyrics.status === 'none' && (
          // **不给重试**:这一首确实没有词,重试一万次也还是没有
          <p className="nesio-fsp-lyric-note">{L(dict, '这一首没有歌词。', 'No lyrics for this one.')}</p>
        )}
        {lyrics.status === 'error' && (
          <div className="nesio-fsp-lyric-err">
            <p>{L(dict, '歌词这次没取到。', 'Could not fetch the lyrics this time.')}</p>
            <button type="button" onClick={() => setReloadKey((k) => k + 1)}>{L(dict, '再试一次', 'Try again')}</button>
          </div>
        )}
        {lyrics.status === 'ok' && lyrics.lines.map((line, i) => (
          <button
            key={`${line.at}-${i}`}
            type="button"
            data-lyric-line={i}
            className={`nesio-fsp-lyric${i === active ? ' is-on' : ''}`}
            // 点一行跳到那儿 —— 想再听一遍那句是全屏歌词最常被用的动作
            onClick={() => seek(line.at / 1000)}
          >
            <span>{line.text || '♪'}</span>
            {showTranslation && line.translated && <em>{line.translated}</em>}
          </button>
        ))}
        {lyrics.status === 'ok' && lyrics.from === 'netease' && (
          <p className="nesio-fsp-lyric-note is-src">{L(dict, '歌词来自网易云', 'Lyrics from NetEase')}</p>
        )}
      </div>

      {/* ── 进度 ─────────────────────────────────────────────────────────── */}
      <div className="nesio-fsp-seek">
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(dur))}
          value={Math.min(Math.floor(state.positionSec || 0), Math.max(1, Math.floor(dur)))}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label={L(dict, '播放进度', 'Seek')}
        />
        <div className="nesio-fsp-seek-time">
          <span>{prettyDuration(state.positionSec || 0)}</span>
          <span>{dur > 0 ? prettyDuration(dur) : '--:--'}</span>
        </div>
      </div>

      {/* ── 控制 ─────────────────────────────────────────────────────────── */}
      <div className="nesio-fsp-ctrl">
        <button
          type="button"
          className={`nesio-fsp-mini${shuffle ? ' is-on' : ''}`}
          onClick={() => onShuffle(!shuffle)}
          aria-label={L(dict, '随机播放', 'Shuffle')}
          aria-pressed={shuffle}
        >⤨</button>
        <button type="button" className="nesio-fsp-step" onClick={() => step('prev', false)} aria-label={L(dict, '上一首', 'Previous')}>⏮</button>
        <button
          type="button"
          className="nesio-fsp-play"
          onClick={() => { void toggle(); }}
          aria-label={state.playing ? L(dict, '暂停', 'Pause') : L(dict, '播放', 'Play')}
        >
          {state.loading ? '…' : state.playing ? '⏸' : '▶'}
        </button>
        <button type="button" className="nesio-fsp-step" onClick={() => step('next', false)} aria-label={L(dict, '下一首', 'Next')}>⏭</button>
        <button
          type="button"
          className={`nesio-fsp-mini${repeat !== 'off' ? ' is-on' : ''}`}
          onClick={() => onRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}
          aria-label={repeat === 'one' ? L(dict, '单曲循环', 'Repeat one') : repeat === 'all' ? L(dict, '列表循环', 'Repeat all') : L(dict, '不循环', 'Repeat off')}
        >{/* 不用 🔁/🔂:渲染层的原生 emoji 在这个仓里是禁的(见 ui-consistency),
             而且两个 emoji 在小尺寸下几乎分不出来。↻ 加一个上标 1 反而更清楚。 */}
          {repeat === 'one' ? '↻¹' : '↻'}</button>
      </div>

      {/* 播放出错的话必须显示出来 —— 不许静默回到 idle */}
      {state.error && <p className="nesio-fsp-err">{state.error}</p>}

      <div className="nesio-fsp-foot">
        <button
          type="button"
          className={`nesio-fsp-foot-btn${liked ? ' is-on' : ''}`}
          onClick={onLike}
          aria-pressed={liked}
        >
          {liked ? '♥' : '♡'} {L(dict, '喜欢', 'Like')}
        </button>
        <button type="button" className="nesio-fsp-foot-btn" onClick={() => onAddToPlaylist(now)}>
          ＋ {L(dict, '加到歌单', 'Add to playlist')}
        </button>
        {lyrics.lines.some((l) => l.translated) && (
          <button
            type="button"
            className={`nesio-fsp-foot-btn${showTranslation ? ' is-on' : ''}`}
            onClick={() => setShowTranslation((v) => !v)}
            aria-pressed={showTranslation}
          >
            {zh ? '译' : 'A文'} {L(dict, '翻译', 'Translation')}
          </button>
        )}
      </div>
    </NesioSheet>
  );
}
