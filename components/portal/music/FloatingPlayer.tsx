'use client';

/**
 * 悬浮播放球(2026-07-31,用户:「开始播放后可以变成一个圆形的悬浮按钮么。
 * 可以播放暂停下一首和关闭」)。
 *
 * 挂在 Portal 层、不在音乐面板里 —— 它要在**任何一页**都看得见。
 * 音频本体在 player-engine 的模块级 audio 上,所以离开音乐页歌不会断,
 * 这颗球就是那时候唯一的控制入口。
 *
 * ── 交互为什么是这样 ────────────────────────────────────────────────────
 * 刚开始放的时候**默认展开**(曲名 + 三个键),几秒后自己收成一个圆球。
 * 理由:三个动作里「暂停」最高频,但「关闭」最要紧 —— 一个用户要是找不到怎么关掉,
 * 他会去清后台、退出 App。所以不把关闭藏进长按里,一开始就摆在手边;
 * 等他不管它了,再收成一个不挡路的球。收起后点球即重新展开。
 *
 * 收起态刻意**不做**「点球直接暂停」:球贴在屏幕边上,滑动时误触的代价是
 * 音乐莫名其妙停了,而用户根本不知道自己碰到了什么。展开一次再点,便宜得多。
 */

import { useEffect, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  currentState, currentTrack, isPanelOpen, step, stop, subscribe, toggle, type PlayerState,
} from '@/lib/platform/music/player-engine';

/** 展开态自动收起的时长。够看清曲名、够按到关闭,又不会一直挡着。 */
const COLLAPSE_MS = 6_000;

export default function FloatingPlayer() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [st, setSt] = useState<PlayerState>(() => currentState());
  const [expanded, setExpanded] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => subscribe((s) => { setSt(s); setPanelOpen(isPanelOpen()); }), []);

  // 换了一首(或刚开始放)就展开一次,再自己收回去。
  useEffect(() => {
    if (!st.currentId) return;
    setExpanded(true);
    const t = window.setTimeout(() => setExpanded(false), COLLAPSE_MS);
    return () => window.clearTimeout(t);
  }, [st.currentId]);

  // 没有当前曲目 = 没在放,也没什么可控的 —— 球不该存在。
  // 这同时是「关闭」的效果:stop() 清掉 currentId,球随之消失。
  if (!st.currentId) return null;
  // 音乐页开着的时候让位:那一页底部已经有一条完整的播放条,
  // 再飘一个球就是同一屏两套控制。
  if (panelOpen) return null;

  const track = currentTrack();
  const pct = st.durationSec > 0 ? Math.min(100, (st.positionSec / st.durationSec) * 100) : 0;
  const playLabel = st.playing ? L(dict, '暂停', 'Pause') : L(dict, '播放', 'Play');

  if (!expanded) {
    return (
      <button
        type="button"
        className="nesio-fp-ball"
        aria-label={L(dict, '打开播放控制', 'Open playback controls')}
        onClick={() => setExpanded(true)}
      >
        {/* 进度环:一眼知道这首还剩多少,不用展开。 */}
        <span className="nesio-fp-ring" style={{ ['--fp-pct' as string]: `${pct}%` }} aria-hidden />
        <span className="nesio-fp-glyph" aria-hidden>{st.playing ? '❙❙' : '▶'}</span>
      </button>
    );
  }

  return (
    <div className="nesio-fp" role="group" aria-label={L(dict, '正在播放', 'Now playing')}>
      <div className="nesio-fp-meta">
        <strong>{track?.title || L(dict, '载入中…', 'Loading…')}</strong>
        {!!track?.artist && <span>{track.artist}</span>}
      </div>
      <div className="nesio-fp-acts">
        <button
          type="button"
          className="nesio-fp-btn is-main"
          aria-label={playLabel}
          onClick={() => { void toggle(); }}
        >{st.playing ? '❙❙' : '▶'}</button>
        <button
          type="button"
          className="nesio-fp-btn"
          aria-label={L(dict, '下一首', 'Next track')}
          onClick={() => step('next', false)}
        >››</button>
        <button
          type="button"
          className="nesio-fp-btn is-close"
          aria-label={L(dict, '关闭播放', 'Stop and close')}
          onClick={stop}
        >×</button>
      </div>
      {/* 播放出的岔子在这儿也要说 —— 用户这会儿多半不在音乐页,
          那边的错误提示他看不到。 */}
      {!!st.error && <p className="nesio-fp-err">{st.error}</p>}
    </div>
  );
}
