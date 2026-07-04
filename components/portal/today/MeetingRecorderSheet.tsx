'use client';

/**
 * MeetingRecorderSheet — 会议记录 sheet:Web Speech 中文转写 + 手动输入,
 * 保存为会议纪要节点(addMeetingNotes)。从 FocusModeSheet 拆出。
 */

import { useEffect, useRef, useState } from 'react';
import { addMeetingNotes, type FocusNode } from '@/lib/platform/view-models/today-view-model';

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
