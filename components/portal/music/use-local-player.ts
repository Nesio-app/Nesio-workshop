'use client';

/**
 * 本地曲库播放器(2026-07-30)。in-app 模型:声音从 Nesio 自己的音频会话出来,
 * 车机蓝牙上显示的就是 Nesio,方向盘上的上一首/下一首也归它管(MediaSession)。
 *
 * 这个 hook 只管**本地文件**这一个源。Apple Music 走 MusicKit 自己的实例、
 * Spotify 走遥控 —— 三者的播放控制天然不是一套 API,硬塞进一个"统一播放器"
 * 只会得到一层什么都不像的壳。统一的是**切换与回退的判据**(source-catalog),
 * 不是播放本身。
 *
 * 红线:每个异步动作都要有**可见失败态**。取不到文件、解不了码、自动播放被浏览器挡下,
 * 三种都会把一句人话写进 error,由面板显示 —— 不许静默回到 idle。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getTrackBlob, setTrackDuration, type LocalTrack } from '@/lib/platform/music/local-tracks';
import { nextIndex, playOrder, prevIndex, type RepeatMode } from '@/lib/platform/music/queue';
import type { MusicLocale } from '@/lib/platform/music/source-catalog';

/** 播放器自己会说的几句话。同 source-catalog:系统说的话翻译,曲名(用户数据)不翻。 */
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

export interface LocalPlayerState {
  currentId: string;
  playing: boolean;
  positionSec: number;
  durationSec: number;
  /** 非空 = 出事了,面板必须把它显示出来。 */
  error: string;
  loading: boolean;
}

export function useLocalPlayer(
  tracks: readonly LocalTrack[],
  opts: { repeat: RepeatMode; shuffle: boolean; seed: number; locale: MusicLocale },
) {
  const c = opts.locale === 'en' ? COPY.en : COPY.zh;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string>('');
  const [st, setSt] = useState<LocalPlayerState>({
    currentId: '', playing: false, positionSec: 0, durationSec: 0, error: '', loading: false,
  });

  // 最新的 opts / tracks —— 「放完自动下一首」的回调只绑一次,靠这个 ref 读到当下的值,
  // 否则用户中途切了循环模式,续播还按旧模式走。
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const revoke = () => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ''; }
  };
  // objectURL 不 revoke 会一直占着内存:一首无损几十 MB,听一晚上能把标签页撑爆。
  useEffect(() => () => revoke(), []);

  const playId = useCallback(async (id: string) => {
    const track = tracksRef.current.find((t) => t.id === id);
    if (!track) {
      setSt((s) => ({ ...s, error: c.gone, loading: false, playing: false }));
      return;
    }
    setSt((s) => ({ ...s, currentId: id, loading: true, error: '' }));
    const blob = await getTrackBlob(id);
    if (!blob) {
      setSt((s) => ({ ...s, loading: false, playing: false, error: c.fileMissing(track.title) }));
      return;
    }
    revoke();
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const el = audioRef.current;
    if (!el) { setSt((s) => ({ ...s, loading: false, error: c.notReady })); return; }
    el.src = url;
    try {
      await el.play();
      setSt((s) => ({ ...s, playing: true, loading: false, error: '' }));
    } catch (e) {
      // 浏览器的自动播放策略、或者格式解不了。两种都要说清,别让用户对着一个不动的按钮。
      const name = (e as Error)?.name || '';
      setSt((s) => ({
        ...s, playing: false, loading: false,
        error: name === 'NotAllowedError' ? c.blocked : c.badFormat(track.title),
      }));
    }
  }, [c]);

  const toggle = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (!st.currentId) {
      const first = tracksRef.current[0];
      if (first) await playId(first.id);
      return;
    }
    if (el.paused) {
      try { await el.play(); setSt((s) => ({ ...s, playing: true, error: '' })); }
      catch { setSt((s) => ({ ...s, playing: false, error: c.retry })); }
    } else {
      el.pause();
      setSt((s) => ({ ...s, playing: false }));
    }
  }, [st.currentId, playId, c]);

  const step = useCallback((dir: 'next' | 'prev', auto: boolean) => {
    const list = tracksRef.current;
    if (!list.length) return;
    const order = playOrder(list.length, optsRef.current.shuffle, optsRef.current.seed);
    const cur = Math.max(0, list.findIndex((t) => t.id === st.currentId));
    const idx = dir === 'next'
      ? nextIndex(cur, order, optsRef.current.repeat, auto)
      : prevIndex(cur, order);
    if (idx == null) {
      // 到头了就**停**。不悄悄从头再放一遍 —— 睡前放的歌不该响一整夜。
      setSt((s) => ({ ...s, playing: false }));
      audioRef.current?.pause();
      return;
    }
    const t = list[idx];
    if (t) void playId(t.id);
  }, [st.currentId, playId]);

  const seek = useCallback((sec: number) => {
    const el = audioRef.current;
    if (el && Number.isFinite(sec)) el.currentTime = Math.max(0, sec);
  }, []);

  // audio 元素的事件 → state。时长读出来顺手补回曲库(导入时还不知道)。
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setSt((s) => ({ ...s, positionSec: el.currentTime }));
    const onMeta = () => {
      setSt((s) => ({ ...s, durationSec: el.duration || 0 }));
      if (st.currentId) setTrackDuration(st.currentId, el.duration);
    };
    const onEnd = () => step('next', true);
    const onErr = () => setSt((s) => ({ ...s, playing: false, loading: false, error: c.midway }));
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onErr);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onErr);
    };
  }, [st.currentId, step, c]);

  /**
   * MediaSession —— 车机屏幕、锁屏、耳机线控上显示的曲名和那几个键。
   * 这是 in-app 模型**唯一**能让车里看到「Nesio 正在放什么」的接口;
   * 不接的话车机上是一片空白,用户会以为没在放。
   */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const t = tracks.find((x) => x.id === st.currentId);
    const ms = navigator.mediaSession;
    if (t && typeof MediaMetadata !== 'undefined') {
      ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: '' });
    }
    ms.playbackState = st.playing ? 'playing' : 'paused';
    try {
      ms.setActionHandler('play', () => { void toggle(); });
      ms.setActionHandler('pause', () => { void toggle(); });
      ms.setActionHandler('nexttrack', () => step('next', false));
      ms.setActionHandler('previoustrack', () => step('prev', false));
    } catch { /* 老浏览器不认某个 action,不影响其它 */ }
  }, [st.currentId, st.playing, tracks, toggle, step]);

  return {
    audioRef,
    state: st,
    playId,
    toggle,
    next: () => step('next', false),
    prev: () => step('prev', false),
    seek,
    clearError: () => setSt((s) => ({ ...s, error: '' })),
    /** 当前这首被移出曲库时调 —— 曲库里没了却还在响,是同屏自相矛盾的一种。 */
    stop: () => {
      audioRef.current?.pause();
      revoke();
      setSt((s) => ({ ...s, playing: false, currentId: '', positionSec: 0, durationSec: 0 }));
    },
  };
}
