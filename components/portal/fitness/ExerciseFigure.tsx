'use client';

/**
 * ExerciseFigure — 动作定格动图播放器。
 * 把一组帧(exerciseAnimFrames 生成的 /exercise-anim/<id>/fNN.webp)按步进循环播放,
 * 得到「定格动画」效果。帧来源:动作视频经 scripts/video-to-anim.mjs 抽帧。
 *
 * 红线遵循:
 * - 加载失败必须有可见失败态(消息 + 重试),不静默空白。
 * - prefers-reduced-motion:reduce → 只显首帧静图,不循环。
 * - 无帧(动作没配动图)→ 返回 null,UI 优雅降级为纯文字卡。
 */

import { useEffect, useRef, useState } from 'react';

export default function ExerciseFigure({
  frames,
  fps = 8,
  pingpong = false,
  alt = '',
  className = '',
}: {
  frames: string[];
  fps?: number;
  pingpong?: boolean;
  alt?: string;
  className?: string;
}) {
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reduced, setReduced] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const dirRef = useRef(1);
  const idxRef = useRef(0);

  const key = frames.join('|');

  // 预加载全部帧(命中缓存后切 src 不再触发网络,避免闪烁);统计成功/失败。
  useEffect(() => {
    if (!frames.length) { setStatus('error'); return; }
    let alive = true;
    let ok = 0;
    let bad = 0;
    idxRef.current = 0; dirRef.current = 1; setIdx(0); setStatus('loading');
    frames.forEach((src) => {
      const im = new Image();
      const done = () => {
        if (!alive) return;
        if (ok + bad === frames.length) setStatus(bad === frames.length ? 'error' : 'ready');
      };
      im.onload = () => { ok += 1; done(); };
      im.onerror = () => { bad += 1; done(); };
      im.src = src;
    });
    return () => { alive = false; };
  }, [key, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 尊重系统「减少动态效果」。
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const h = () => setReduced(mq.matches);
    mq.addEventListener?.('change', h);
    return () => mq.removeEventListener?.('change', h);
  }, []);

  // 步进循环(可乒乓来回)。
  useEffect(() => {
    if (status !== 'ready' || reduced || frames.length < 2) return;
    const ms = 1000 / Math.max(1, Math.min(24, fps));
    const t = setInterval(() => {
      if (pingpong) {
        let n = idxRef.current + dirRef.current;
        if (n >= frames.length - 1) { n = frames.length - 1; dirRef.current = -1; }
        else if (n <= 0) { n = 0; dirRef.current = 1; }
        idxRef.current = n;
      } else {
        idxRef.current = (idxRef.current + 1) % frames.length;
      }
      setIdx(idxRef.current);
    }, ms);
    return () => clearInterval(t);
  }, [status, reduced, fps, pingpong, frames.length]);

  if (!frames.length || status === 'error') {
    return (
      <div className={`nesio-exfig nesio-exfig--error ${className}`.trim()} role="img" aria-label={alt}>
        <span className="nesio-exfig-msg">动图先歇会儿</span>
        {frames.length > 0 && (
          <button type="button" className="nesio-exfig-retry" onClick={() => setReloadKey((k) => k + 1)}>
            重试
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`nesio-exfig ${className}`.trim()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="nesio-exfig-img"
        src={frames[reduced ? 0 : idx] || frames[0]}
        alt={alt}
        draggable={false}
      />
      {status === 'loading' && <div className="nesio-exfig-loading" aria-hidden="true" />}
    </div>
  );
}
