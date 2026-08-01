'use client';

/**
 * 悬浮播放球(2026-07-31,用户:「开始播放后可以变成一个圆形的悬浮按钮么。
 * 可以播放暂停下一首和关闭」)。
 *
 * 挂在 Portal 层、不在音乐面板里 —— 它要在**任何一页**都看得见。
 * 音频本体在 player-engine 的模块级 audio 上,所以离开音乐页歌不会断,
 * 这颗球就是那时候唯一的控制入口。
 *
 * ── 2026-08-01 三条(用户实测)────────────────────────────────────────────
 *
 * ①「点一下,悬浮球缩回去那个按钮不管用」——**它根本不存在**。
 *   展开态原来只有三个键:暂停 / 下一首 / ×,而 × 是 stop(停止播放,球随之消失),
 *   不是收起。用户点了以为「缩回去坏了」,其实是音乐被他关掉了。
 *   现在收起是**独立的一个键**(⌄),× 只管停止播放,两件事分开;
 *   曲名条也整块可点 = 收起(手指落在哪都行)。
 *
 * ②「长按可以任意挪位置」—— 长按 400ms 进拖动态,松手记住位置(每台设备自己的)。
 *   为什么是长按而不是直接拖:这颗球贴在屏幕边上,页面本身要滚动 ——
 *   直接拖会把滚动吃掉,而滚动比挪球高频得多。
 *
 * ③「如果不操作 3 秒钟,变为半透明」—— 让它不挡路,但**不消失**:
 *   消失了「怎么关掉这首歌」就又没有答案了(这正是当初不把关闭藏进长按的理由)。
 *   碰一下就恢复。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  currentState, currentTrack, isPanelOpen, step, stop, subscribe, toggle, type PlayerState,
} from '@/lib/platform/music/player-engine';

/** 展开态自动收起的时长。够看清曲名、够按到关闭,又不会一直挡着。 */
const COLLAPSE_MS = 6_000;
/** 多久不碰就变半透明(用户点名 3 秒)。 */
const DIM_MS = 3_000;
/** 按住多久算「要挪它」而不是「要点它」。短了会把页面滚动吃掉。 */
const LONG_PRESS_MS = 400;

/**
 * 球停在哪。**cache 类**:「换台设备从零开始是否正确?」—— 是的,
 * 这是这台机器上「我把它拖到了哪」的 UI 状态,不是用户数据。
 * 必须在 scripts/storage-key-registry.test.mjs 登记。
 */
export const FP_POS_KEY = 'nesio-fp-pos-v1';

interface Pos { x: number; y: number }

function loadPos(): Pos | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = JSON.parse(localStorage.getItem(FP_POS_KEY) || 'null') as Pos | null;
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return raw;
  } catch { /* 存坏了当没有 */ }
  return null;
}

/** 夹在视口里 —— 换了屏幕方向/设备之后,存着的坐标可能落到屏幕外,那球就再也点不到了。 */
function clampPos(p: Pos, w: number, h: number): Pos {
  if (typeof window === 'undefined') return p;
  const maxX = Math.max(0, window.innerWidth - w);
  const maxY = Math.max(0, window.innerHeight - h);
  return { x: Math.min(Math.max(0, p.x), maxX), y: Math.min(Math.max(0, p.y), maxY) };
}

export default function FloatingPlayer() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [st, setSt] = useState<PlayerState>(() => currentState());
  const [expanded, setExpanded] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dim, setDim] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const pressRef = useRef<{ t: number; x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const dimTimer = useRef<number | null>(null);

  useEffect(() => subscribe((s) => { setSt(s); setPanelOpen(isPanelOpen()); }), []);
  useEffect(() => { setPos(loadPos()); }, []);

  /** 碰一下就醒过来,重新开始数 3 秒。 */
  const wake = useCallback(() => {
    setDim(false);
    if (dimTimer.current) window.clearTimeout(dimTimer.current);
    dimTimer.current = window.setTimeout(() => setDim(true), DIM_MS);
  }, []);

  // 出现/换曲/展开收起都算「刚被碰过」
  useEffect(() => { wake(); return () => { if (dimTimer.current) window.clearTimeout(dimTimer.current); }; }, [wake, expanded, st.currentId, st.playing]);

  // 换了一首(或刚开始放)就展开一次,再自己收回去。
  useEffect(() => {
    if (!st.currentId) return;
    setExpanded(true);
    const t = window.setTimeout(() => setExpanded(false), COLLAPSE_MS);
    return () => window.clearTimeout(t);
  }, [st.currentId]);

  // ── 长按拖动 ────────────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    wake();
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    pressRef.current = { t: Date.now(), x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false };
    // 长按到点 → 进拖动态。此后 pointermove 才开始挪它。
    window.setTimeout(() => {
      if (pressRef.current && !pressRef.current.moved) {
        setDragging(true);
        try { el.setPointerCapture(e.pointerId); } catch { /* 老浏览器 */ }
      }
    }, LONG_PRESS_MS);
  }, [wake]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const p = pressRef.current;
    if (!p) return;
    // 还没进拖动态时的位移只用来「取消长按」—— 那是在滚页面,不是在挪球
    if (!dragging) {
      if (Math.abs(e.clientX - p.x) > 8 || Math.abs(e.clientY - p.y) > 8) p.moved = true;
      return;
    }
    const el = rootRef.current;
    const r = el?.getBoundingClientRect();
    setPos(clampPos({ x: e.clientX - p.ox, y: e.clientY - p.oy }, r?.width ?? 0, r?.height ?? 0));
  }, [dragging]);

  const endPress = useCallback(() => {
    if (dragging && pos) {
      // 红线:存储写失败不许哑吞。位置存不下只是下次回到默认角,不阻断播放。
      try { localStorage.setItem(FP_POS_KEY, JSON.stringify(pos)); } catch { /* 下次再说 */ }
    }
    pressRef.current = null;
    setDragging(false);
    wake();
  }, [dragging, pos, wake]);

  // 没有当前曲目 = 没在放,也没什么可控的 —— 球不该存在。
  // 这同时是「关闭」的效果:stop() 清掉 currentId,球随之消失。
  if (!st.currentId) return null;
  // 音乐页开着的时候让位:那一页底部已经有一条完整的播放条,
  // 再飘一个球就是同一屏两套控制。
  if (panelOpen) return null;

  const track = currentTrack();
  const pct = st.durationSec > 0 ? Math.min(100, (st.positionSec / st.durationSec) * 100) : 0;
  const playLabel = st.playing ? L(dict, '暂停', 'Pause') : L(dict, '播放', 'Play');

  // 拖过就用绝对坐标;没拖过保持 CSS 里那个默认角(right/bottom),不写死 left/top。
  const posStyle = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' }
    : undefined;
  const stateClass = `${dragging ? ' is-dragging' : ''}${dim && !dragging ? ' is-dim' : ''}`;

  const dragProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endPress,
    onPointerCancel: endPress,
  };

  if (!expanded) {
    return (
      <div
        ref={rootRef}
        className={`nesio-fp-ball-wrap${stateClass}`}
        style={posStyle}
        {...dragProps}
      >
        <button
          type="button"
          className="nesio-fp-ball"
          aria-label={L(dict, '打开播放控制(长按可挪位置)', 'Open playback controls (long-press to move)')}
          // 拖完那一下不该顺手把它展开 —— 手指抬起来的地方通常不是他想点的东西
          onClick={() => { if (!dragging) setExpanded(true); }}
        >
          {/* 进度环:一眼知道这首还剩多少,不用展开。 */}
          <span className="nesio-fp-ring" style={{ ['--fp-pct' as string]: `${pct}%` }} aria-hidden />
          <span className="nesio-fp-glyph" aria-hidden>{st.playing ? '❙❙' : '▶'}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`nesio-fp${stateClass}`}
      role="group"
      aria-label={L(dict, '正在播放', 'Now playing')}
      style={posStyle}
      {...dragProps}
    >
      {/* 曲名条整块 = 收起。手指落在哪都行,不用瞄准那颗小键。 */}
      <button
        type="button"
        className="nesio-fp-meta"
        aria-label={L(dict, '收起', 'Collapse')}
        onClick={() => { if (!dragging) setExpanded(false); }}
      >
        <strong>{track?.title || L(dict, '载入中…', 'Loading…')}</strong>
        {!!track?.artist && <span>{track.artist}</span>}
      </button>
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
        {/*
         * 收起 —— 2026-08-01 新增。用户「点一下,悬浮球缩回去那个按钮不管用」:
         * 那个按钮**原来不存在**,他点的 × 是停止播放。两件事分开之后,
         * 「我想让它别挡着」和「我不想听了」不再是同一颗键。
         */}
        <button
          type="button"
          className="nesio-fp-btn"
          aria-label={L(dict, '收起', 'Collapse')}
          onClick={() => setExpanded(false)}
        >⌄</button>
        <button
          type="button"
          className="nesio-fp-btn is-close"
          aria-label={L(dict, '停止播放', 'Stop playback')}
          title={L(dict, '停止播放', 'Stop playback')}
          onClick={stop}
        >×</button>
      </div>
      {/* 播放出的岔子在这儿也要说 —— 用户这会儿多半不在音乐页,
          那边的错误提示他看不到。 */}
      {!!st.error && <p className="nesio-fp-err">{st.error}</p>}
    </div>
  );
}
