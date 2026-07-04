'use client';

/**
 * FocusModeSheet — 聚焦模式 sheet:环形计时器 + 时长选择 + 完成动作。
 * 会议记录在同目录 MeetingRecorderSheet.tsx。
 */

import { useEffect, useRef, useState } from 'react';
import { focusTimeHint, type FocusNode } from '@/lib/platform/view-models/today-view-model';

// ---- Focus Mode Sheet ----

const FOCUS_DURATIONS = [
  { label: '25 分钟', value: 25 },
  { label: '50 分钟', value: 50 },
  { label: '5 分钟', value: 5 },
];

export function FocusModeSheet({ node, onClose, onDone }: {
  node: FocusNode | null;
  onClose: () => void;
  onDone: (node: FocusNode) => void;
}) {
  const [durMin, setDurMin] = useState(25);
  const [secsLeft, setSecsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!node) { setRunning(false); setFinished(false); return; }
    setSecsLeft(durMin * 60);
    setRunning(false);
    setFinished(false);
  }, [node, durMin]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSecsLeft((s) => {
          if (s <= 1) {
            clearInterval(intervalRef.current!);
            setRunning(false);
            setFinished(true);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  if (!node) return null;

  const totalSecs = durMin * 60;
  const progress = (totalSecs - secsLeft) / totalSecs;
  const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
  const ss = String(secsLeft % 60).padStart(2, '0');
  const hint = focusTimeHint(node);

  function handleDurationChange(v: number) {
    setDurMin(v);
    setSecsLeft(v * 60);
    setRunning(false);
    setFinished(false);
  }

  return (
    <div className="nesio-focus-mode-overlay" role="dialog" aria-modal aria-label="聚焦模式">
      <div className="nesio-focus-mode-backdrop" onClick={onClose} />
      <div className="nesio-focus-mode-sheet">
        <button type="button" className="nesio-focus-mode-close" onClick={onClose} aria-label="退出聚焦">✕</button>

        <p className="nesio-focus-mode-label">现在专注于</p>
        <h2 className="nesio-focus-mode-title">{node.name}</h2>
        {hint && <p className="nesio-focus-mode-hint">{hint}</p>}

        {/* Circular timer */}
        <div className="nesio-focus-mode-timer-wrap">
          <svg viewBox="0 0 120 120" className="nesio-focus-mode-ring">
            <circle cx="60" cy="60" r="54" fill="none" stroke="var(--portal-border, rgba(0,0,0,.08))" strokeWidth="8" />
            <circle
              cx="60" cy="60" r="54"
              fill="none"
              stroke={finished ? 'var(--status-go)' : 'var(--portal-accent)'}
              strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 54}`}
              strokeDashoffset={`${2 * Math.PI * 54 * (1 - progress)}`}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <div className="nesio-focus-mode-time">
            {finished ? '🎉' : `${mm}:${ss}`}
          </div>
        </div>

        {/* Duration picker */}
        {!running && !finished && (
          <div className="nesio-focus-mode-durations">
            {FOCUS_DURATIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                className={`nesio-focus-mode-dur-btn${durMin === d.value ? ' nesio-focus-mode-dur-btn--active' : ''}`}
                onClick={() => handleDurationChange(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}

        {finished ? (
          <p className="nesio-focus-mode-done-msg">时间到！要标记完成吗？</p>
        ) : (
          <button
            type="button"
            className="nesio-focus-mode-play-btn"
            onClick={() => setRunning((r) => !r)}
          >
            {running ? '⏸ 暂停' : secsLeft < totalSecs ? '▶ 继续' : '▶ 开始'}
          </button>
        )}

        <div className="nesio-focus-mode-actions">
          <button type="button" className="nesio-focus-mode-done-btn" onClick={() => { onDone(node); onClose(); }}>
            ✓ 完成了
          </button>
          <button type="button" className="nesio-focus-mode-later-btn" onClick={onClose}>
            稍后再说
          </button>
        </div>
      </div>
    </div>
  );
}
