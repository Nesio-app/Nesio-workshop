'use client';

/**
 * VoiceBrief — TTS playback of a meeting/event brief.
 * Uses Web Speech Synthesis API (free, no API key).
 * Can be triggered from a Today Card "播放" button.
 */

import { useEffect, useRef, useState } from 'react';

export interface VoiceBriefProps {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  /** Optional structured points for better TTS script */
  points?: string[];
}

type PlayState = 'idle' | 'playing' | 'paused' | 'done' | 'unavailable';

export default function VoiceBrief({ open, onClose, title, body, points }: VoiceBriefProps) {
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [progress, setProgress] = useState(0);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) { stop(); setProgress(0); setPlayState('idle'); }
    else {
      if (!window.speechSynthesis) setPlayState('unavailable');
      else setTimeout(play, 400); // auto-start
    }
    return stop;
  }, [open]);

  function buildScript(): string {
    const intro = `${title}。`;
    if (points?.length) {
      return intro + ' ' + points.map((p, i) => `第${['一', '二', '三', '四', '五'][i] || (i + 1)}点，${p}。`).join(' ');
    }
    return intro + ' ' + body;
  }

  function play() {
    if (!window.speechSynthesis) { setPlayState('unavailable'); return; }
    window.speechSynthesis.cancel();

    const script = buildScript();
    const utt = new SpeechSynthesisUtterance(script);
    utt.lang = 'zh-CN';
    utt.rate = 1.05;
    utt.pitch = 1.0;

    // Try to pick a Chinese voice
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find((v) => v.lang.startsWith('zh') && !v.name.includes('compact')) || voices.find((v) => v.lang.startsWith('zh'));
    if (zhVoice) utt.voice = zhVoice;

    utt.onstart = () => { setPlayState('playing'); startProgress(script.length); };
    utt.onpause = () => setPlayState('paused');
    utt.onresume = () => setPlayState('playing');
    utt.onend = () => { setPlayState('done'); setProgress(100); clearInterval(intervalRef.current ?? undefined); };
    utt.onerror = () => { setPlayState('unavailable'); clearInterval(intervalRef.current ?? undefined); };

    utterRef.current = utt;
    window.speechSynthesis.speak(utt);
  }

  function startProgress(textLen: number) {
    const estimatedMs = (textLen / 5) * (1000 / 1.05); // ~5 chars/sec at rate 1.05
    const start = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(99, Math.round((elapsed / estimatedMs) * 100)));
    }, 200);
  }

  function stop() {
    window.speechSynthesis?.cancel();
    clearInterval(intervalRef.current ?? undefined);
  }

  function togglePause() {
    if (!window.speechSynthesis) return;
    if (playState === 'playing') { window.speechSynthesis.pause(); setPlayState('paused'); }
    else if (playState === 'paused') { window.speechSynthesis.resume(); setPlayState('playing'); }
  }

  function restart() { setProgress(0); play(); }

  if (!open) return null;

  const isPlaying = playState === 'playing';
  const isPaused = playState === 'paused';
  const isDone = playState === 'done';

  return (
    <div className="nesio-voice-brief-overlay" role="dialog" aria-modal="true" aria-label="语音简报">
      <div className="nesio-voice-brief-backdrop" onClick={onClose} />
      <div className="nesio-voice-brief-card">
        <div className="nesio-sheet-handle" aria-hidden />

        <div className="nesio-voice-brief-header">
          <div>
            <p className="nesio-voice-brief-kicker">语音简报 · 90 秒</p>
            <h2 className="nesio-voice-brief-title">{title}</h2>
          </div>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* Waveform visualization */}
        <div className="nesio-voice-brief-viz" aria-hidden>
          {Array.from({ length: 32 }, (_, i) => {
            const active = isPlaying && (i / 32) * 100 < progress;
            const height = 8 + Math.sin(i * 0.45 + (isPlaying ? Date.now() / 300 : 0)) * 10;
            return (
              <span key={i} className={`nesio-voice-brief-bar${active ? ' nesio-voice-brief-bar--active' : ''}`}
                style={{ height: `${Math.max(4, height)}px` }} />
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="nesio-voice-brief-progress-track">
          <div className="nesio-voice-brief-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {/* Script preview */}
        <p className="nesio-voice-brief-script">
          {points?.length ? points.map((p, i) => `${i + 1}. ${p}`).join(' · ') : body}
        </p>

        {/* Controls */}
        {playState === 'unavailable' ? (
          <p style={{ textAlign: 'center', color: '#ef4444', fontSize: '0.82rem' }}>
            此浏览器不支持语音合成。请在 Safari 或 Chrome 中使用。
          </p>
        ) : (
          <div className="nesio-voice-brief-controls">
            <button type="button" className="nesio-voice-brief-btn" onClick={restart} aria-label="重播">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M1 4v6h6M3.51 15a9 9 0 102.13-9.36L1 10"/>
              </svg>
            </button>
            <button type="button" className="nesio-voice-brief-play-btn" onClick={isDone ? restart : togglePause} aria-label={isPlaying ? '暂停' : '播放'}>
              {isPlaying ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                  <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
              )}
            </button>
            <button type="button" className="nesio-voice-brief-btn" onClick={() => { stop(); onClose(); }} aria-label="完成">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
            </button>
          </div>
        )}

        {isDone && (
          <p style={{ textAlign: 'center', color: '#10b981', fontSize: '0.82rem', marginTop: '0.5rem' }}>
            播放完毕 ✓
          </p>
        )}
      </div>
    </div>
  );
}
