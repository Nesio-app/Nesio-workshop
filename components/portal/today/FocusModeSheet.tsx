'use client';

/**
 * Focus mode + meeting recorder sheets — extracted from TodayFeed (was a
 * 2100-line monolith). MeetingCountdown is internal to these sheets.
 */

import { useEffect, useRef, useState } from 'react';
import { addMeetingNotes, focusTimeHint, type FocusNode } from '@/lib/platform/view-models/today-view-model';

// ---- Meeting countdown ----

function MeetingCountdown({ startTime }: { startTime: Date }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  const diffMs = startTime.getTime() - now.getTime();
  const timeStr = startTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (diffMs < -120 * 60_000) return null;

  if (diffMs < 0) {
    const pastMin = Math.round(-diffMs / 60_000);
    return <span className="nesio-focus-meeting-badge nesio-focus-meeting-badge--now">{timeStr} · 进行中 +{pastMin}min</span>;
  }

  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin <= 15) return <span className="nesio-focus-meeting-badge nesio-focus-meeting-badge--soon">{timeStr} · {diffMin}分钟后</span>;
  const hh = Math.floor(diffMin / 60);
  const mm = diffMin % 60;
  const countdown = hh > 0 ? `${hh}h${mm}m后` : `${mm}分钟后`;
  return <span className="nesio-focus-meeting-badge">{timeStr} · {countdown}</span>;
}

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

// ---- Meeting Recorder Sheet ----

type SpeechRecAPI = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  start(): void;
  stop(): void;
};

export function MeetingRecorderSheet({ open, meetingNode, onClose }: {
  open: boolean;
  meetingNode: FocusNode | null;
  onClose: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [saved, setSaved] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recognitionRef = useRef<SpeechRecAPI | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      setRecording(false);
      setTranscript('');
      setSaved(false);
      setSeconds(0);
      if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }, [open]);

  function startRecording() {
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);

    try {
      const win = window as unknown as Record<string, unknown>;
      const SpeechRec = (win.webkitSpeechRecognition || win.SpeechRecognition) as (new () => SpeechRecAPI) | undefined;
      if (SpeechRec) {
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'zh-CN';
        rec.onresult = (e) => {
          const text = Array.from(e.results).map((r) => r[0].transcript).join('');
          setTranscript(text);
        };
        rec.start();
        recognitionRef.current = rec;
      }
    } catch {
      // SpeechRecognition not available — manual input still works
    }
  }

  function stopRecording() {
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
  }

  function saveNotes() {
    const finalText = transcript.trim() || '（无内容）';
    const nowStr = new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    addMeetingNotes(meetingNode?.id || '', meetingNode?.name || nowStr, finalText);
    setSaved(true);
    setTimeout(() => onClose(), 1800);
  }

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  if (!open) return null;

  return (
    <div className="nesio-recorder-overlay" role="dialog" aria-modal aria-label="会议记录">
      <div className="nesio-recorder-backdrop" onClick={onClose} />
      <div className="nesio-recorder-sheet">
        <div className="nesio-sheet-handle" aria-hidden />

        {saved ? (
          <div className="nesio-recorder-saved">
            <span className="nesio-recorder-saved-icon">📝</span>
            <p className="nesio-recorder-saved-title">会议记录已保存</p>
            <p className="nesio-recorder-saved-hint">已存入记忆，和会议条目关联</p>
          </div>
        ) : (
          <>
            <div className="nesio-recorder-header">
              <p className="nesio-recorder-title">🎙 会议记录</p>
              {meetingNode && <p className="nesio-recorder-meeting-name">{meetingNode.name}</p>}
            </div>

            <div className="nesio-recorder-body">
              <div className="nesio-recorder-viz">
                {recording ? (
                  <>
                    <div className="nesio-recorder-wave">
                      {Array.from({ length: 20 }, (_, i) => (
                        <span key={i} className="nesio-recorder-wave-bar" style={{ animationDelay: `${i * 0.06}s` }} />
                      ))}
                    </div>
                    <span className="nesio-recorder-timer">{formatTime(seconds)}</span>
                  </>
                ) : (
                  <span className="nesio-recorder-mic-icon">🎙</span>
                )}
              </div>

              {transcript ? (
                <div className="nesio-recorder-transcript">
                  <p className="nesio-recorder-transcript-label">转写内容</p>
                  <p className="nesio-recorder-transcript-text">{transcript}</p>
                </div>
              ) : (
                !recording && <p className="nesio-recorder-hint">点击录音，自动转写中文语音</p>
              )}
            </div>

            <div className="nesio-recorder-actions">
              {!recording ? (
                <button type="button" className="nesio-recorder-start-btn" onClick={startRecording}>开始录音</button>
              ) : (
                <button type="button" className="nesio-recorder-stop-btn" onClick={stopRecording}>停止录音</button>
              )}

              {!recording && (
                <textarea
                  className="nesio-recorder-notes-input"
                  placeholder="或直接输入会议笔记…"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={3}
                />
              )}

              <button
                type="button"
                className={`nesio-recorder-save-btn${transcript.trim() ? ' nesio-recorder-save-btn--ready' : ''}`}
                onClick={saveNotes}
                disabled={recording || !transcript.trim()}
              >
                {transcript.trim() ? '保存会议记录' : '先录音或输入笔记'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Focus card constants ----
