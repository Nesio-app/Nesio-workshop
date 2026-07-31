'use client';

/**
 * 本地曲库播放器的 React 接口(2026-07-31 改造)。
 *
 * 播放本身**不在这里** —— 它在 lib/platform/music/player-engine 那个模块级单例上。
 * 这次改造的起因是悬浮球:原来 `<audio>` 是 MusicPanel 里的一个 JSX 节点,
 * 切走那一页音乐就断了,而悬浮球的全部意义正是「人走了、歌还在放」。
 *
 * 所以这个 hook 现在只做三件事:把曲库和播放选项同步给引擎、订阅引擎的状态、
 * 把控制方法透出去。多个组件(音乐面板 + 悬浮球)同时用它,看到的是**同一份**状态。
 */

import { useEffect, useState } from 'react';
import type { LocalTrack } from '@/lib/platform/music/local-tracks';
import type { RepeatMode } from '@/lib/platform/music/queue';
import type { MusicLocale } from '@/lib/platform/music/source-catalog';
import {
  clearError, currentState, playId, seek, step, stop, subscribe,
  setOptions, setTracks, toggle, type PlayerState,
} from '@/lib/platform/music/player-engine';

export type { PlayerState as LocalPlayerState };

export function useLocalPlayer(
  tracks: readonly LocalTrack[],
  opts: { repeat: RepeatMode; shuffle: boolean; seed: number; locale: MusicLocale },
) {
  const [st, setSt] = useState<PlayerState>(() => currentState());

  useEffect(() => subscribe(setSt), []);

  // 曲库/选项变了就告诉引擎。「下一首是哪首」由引擎算,它得拿到当下的这两样 ——
  // 用户中途改了循环模式,续播必须按新模式走。
  useEffect(() => { setTracks(tracks); }, [tracks]);
  useEffect(() => { setOptions(opts); }, [opts.repeat, opts.shuffle, opts.seed, opts.locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // 车机/锁屏由引擎自己维护(它跟着正在放的东西走,不跟着哪个组件还挂着)——
  // 这里不再插一手,免得成了两处真源。

  return {
    state: st,
    playId,
    toggle,
    next: () => step('next', false),
    prev: () => step('prev', false),
    seek,
    clearError,
    /** 当前这首被移出曲库时调 —— 曲库里没了却还在响,是同屏自相矛盾的一种。 */
    stop,
  };
}
