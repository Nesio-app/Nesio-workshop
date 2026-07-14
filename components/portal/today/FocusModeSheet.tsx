'use client';

/**
 * FocusModeSheet — 聚焦模式 sheet:环形计时器 + 时长选择 + 完成动作。
 * 会议记录在同目录 MeetingRecorderSheet.tsx。
 */

import { useEffect, useRef, useState } from 'react';
import { focusTimeHint, type FocusNode } from '@/lib/platform/view-models/today-view-model';
import { createSignal } from '@/lib/life-domain';
import { track } from '@/lib/portal/telemetry';
import { IconPlay } from '../icons';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { useSheetDismiss } from '@/lib/portal/use-sheet-dismiss';
import { useSheetDrag } from '../use-sheet-drag';

/**
 * 专注时长入统计(批次 6 用户问「这个数据有进入统计范围么」——此前没有):
 * - 遥测 focus_session(/admin Top 事件可见次数与时长分布)
 * - focus.session 信号进事实库,供洞察/实验消费(专注分布、与精力的相关性)
 */
function recordFocusSession(node: FocusNode, elapsedMin: number, completed: boolean) {
  if (elapsedMin < 1) return; // 秒开秒关不算一次专注
  track('focus_session', { minutes: elapsedMin, completed });
  createSignal({
    source: 'manual',
    type: 'focus.session',
    title: `专注 ${elapsedMin} 分钟 · ${node.name.slice(0, 24)}`,
    payload: { minutes: elapsedMin, completed, nodeId: node.id, nodeName: node.name.slice(0, 60) },
    confidence: 1,
    tags: ['聚焦模式'],
    raw: node.name,
  });
}

// ---- Focus Mode Sheet ----

const FOCUS_DURATIONS = [
  { zh: '25 分钟', en: '25 min', value: 25 },
  { zh: '50 分钟', en: '50 min', value: 50 },
  { zh: '5 分钟', en: '5 min', value: 5 },
];

export function FocusModeSheet({ node, onClose, onDone }: {
  node: FocusNode | null;
  onClose: () => void;
  onDone: (node: FocusNode) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [durMin, setDurMin] = useState(25);
  const [secsLeft, setSecsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0); // 累计专注秒数(跨暂停)

  useEffect(() => {
    if (!node) { setRunning(false); setFinished(false); return; }
    elapsedRef.current = 0;
    setSecsLeft(durMin * 60);
    setRunning(false);
    setFinished(false);
  }, [node, durMin]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSecsLeft((s) => {
          elapsedRef.current += 1;
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

  useSheetDismiss(!!node, onClose);
  const { handleProps, cardStyle, expanded } = useSheetDrag(onClose);

  if (!node) return null;

  const totalSecs = durMin * 60;
  const progress = (totalSecs - secsLeft) / totalSecs;
  const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
  const ss = String(secsLeft % 60).padStart(2, '0');
  const hint = focusTimeHint(node, dict);

  function handleDurationChange(v: number) {
    setDurMin(v);
    setSecsLeft(v * 60);
    setRunning(false);
    setFinished(false);
  }

  return (
    <div className="nesio-focus-mode-overlay" role="dialog" aria-modal aria-label={L(dict, '聚焦模式', 'Focus mode')}>
      <div className="nesio-focus-mode-backdrop" onClick={onClose} />
      <div className={`nesio-focus-mode-sheet${expanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle}>
        <div className="nesio-sheet-grip" {...handleProps} />

        <p className="nesio-focus-mode-label">{L(dict, '现在专注于', 'Focusing on')}</p>
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
            {finished ? L(dict, '完成', 'Done') : `${mm}:${ss}`}
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
                {L(dict, d.zh, d.en)}
              </button>
            ))}
          </div>
        )}

        {finished ? (
          <p className="nesio-focus-mode-done-msg">{L(dict, '时间到！要标记完成吗？', 'Time! Mark it done?')}</p>
        ) : (
          <button
            type="button"
            className="nesio-focus-mode-play-btn"
            onClick={() => setRunning((r) => !r)}
          >
            {running ? L(dict, '暂停', 'Pause') : secsLeft < totalSecs ? <><IconPlay size={13} /> {L(dict, '继续', 'Resume')}</> : <><IconPlay size={13} /> {L(dict, '开始', 'Start')}</>}
          </button>
        )}

        <div className="nesio-focus-mode-actions">
          <button type="button" className="nesio-focus-mode-done-btn" onClick={() => { recordFocusSession(node, Math.round(elapsedRef.current / 60), true); onDone(node); onClose(); }}>
            ✓ {L(dict, '完成了', 'Done')}
          </button>
          <button type="button" className="nesio-focus-mode-later-btn" onClick={() => { recordFocusSession(node, Math.round(elapsedRef.current / 60), false); onClose(); }}>
            {L(dict, '稍后再说', 'Later')}
          </button>
        </div>
      </div>
    </div>
  );
}
