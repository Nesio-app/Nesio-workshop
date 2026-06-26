'use client';

/**
 * VoiceBrief — plays a meeting/event brief using OpenAI TTS (natural voice).
 * Falls back to Web Speech Synthesis if no API key.
 */

import { useEffect, useRef, useState } from 'react';

export interface VoiceBriefProps {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  points?: string[];
}

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error';

function buildScript(title: string, body: string, points?: string[]): string {
  const intro = title + '。';
  if (points?.length) {
    return intro + ' ' + points.map((p, i) => `第${['一','二','三','四','五'][i] || i+1}点，${p}。`).join(' ');
  }
  return intro + ' ' + body;
}

export default function VoiceBrief({ open, onClose, title, body, points }: VoiceBriefProps) {
  const [state, setState] = useState<PlayState>('idle');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (open) {
      setState('idle');
      setProgress(0);
      startPlay();
    } else {
      stopAll();
    }
    return stopAll;
  }, [open]);

  function stopAll() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    clearInterval(intervalRef.current ?? undefined);
    window.speechSynthesis?.cancel();
  }

  async function startPlay() {
    setState('loading');
    const script = buildScript(title, body, points);

    try {
      // Try OpenAI TTS
      const res = await fetch('/api/portal/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script, voice: 'nova', speed: 1.05 }),
      });

      if (res.ok && res.headers.get('content-type')?.includes('audio')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onloadedmetadata = () => setDuration(audio.duration);
        audio.onplay = () => {
          setState('playing');
          intervalRef.current = setInterval(() => {
            setProgress(Math.round((audio.currentTime / audio.duration) * 100));
          }, 300);
        };
        audio.onpause = () => { setState('paused'); clearInterval(intervalRef.current ?? undefined); };
        audio.onended = () => { setState('done'); setProgress(100); clearInterval(intervalRef.current ?? undefined); };
        audio.onerror = () => fallbackToWebSpeech(script);

        await audio.play();
      } else {
        // No API key or error — fall back to Web Speech
        fallbackToWebSpeech(script);
      }
    } catch {
      fallbackToWebSpeech(buildScript(title, body, points));
    }
  }

  function fallbackToWebSpeech(script: string) {
    if (!window.speechSynthesis) { setState('error'); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(script);
    utt.lang = 'zh-CN';
    utt.rate = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.find((v) => v.lang.startsWith('zh') && !v.name.includes('compact')) || voices.find((v) => v.lang.startsWith('zh'));
    if (zh) utt.voice = zh;
    utt.onstart = () => { setState('playing'); startFakeProgress(script.length); };
    utt.onend = () => { setState('done'); setProgress(100); clearInterval(intervalRef.current ?? undefined); };
    utt.onerror = () => setState('error');
    window.speechSynthesis.speak(utt);
  }

  function startFakeProgress(len: number) {
    const ms = (len / 5) * (1000 / 1.0);
    const start = Date.now();
    intervalRef.current = setInterval(() => {
      setProgress(Math.min(99, Math.round(((Date.now() - start) / ms) * 100)));
    }, 200);
  }

  function togglePause() {
    const audio = audioRef.current;
    if (audio) {
      if (state === 'playing') { audio.pause(); setState('paused'); }
      else { audio.play(); setState('playing'); }
      return;
    }
    if (state === 'playing') { window.speechSynthesis?.pause(); setState('paused'); }
    else { window.speechSynthesis?.resume(); setState('playing'); }
  }

  function restart() { stopAll(); setProgress(0); startPlay(); }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const currentSec = duration ? (progress / 100) * duration : 0;

  if (!open) return null;

  return (
    <div className="nesio-voice-brief-overlay" role="dialog" aria-modal="true" aria-label="语音简报">
      <div className="nesio-voice-brief-backdrop" onClick={onClose} />
      <div className="nesio-voice-brief-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-voice-brief-header">
          <div>
            <p className="nesio-voice-brief-kicker">
              {state === 'loading' ? '正在生成语音…' : '语音简报 · AI 朗读'}
            </p>
            <h2 className="nesio-voice-brief-title">{title}</h2>
          </div>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* Waveform */}
        <div className="nesio-voice-brief-viz" aria-hidden>
          {Array.from({ length: 32 }, (_, i) => {
            const active = state === 'playing' && (i / 32) * 100 < progress;
            const h = 4 + Math.abs(Math.sin(i * 0.45) * 14);
            return <span key={i} className={`nesio-voice-brief-bar${active ? ' nesio-voice-brief-bar--active' : ''}`} style={{ height: `${h}px` }} />;
          })}
        </div>

        {/* Progress */}
        <div className="nesio-voice-brief-progress-track">
          <div className="nesio-voice-brief-progress-fill" style={{ width: `${progress}%`, transition: 'width 0.3s linear' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#8fa3c0', margin: '-0.4rem 0 0.5rem' }}>
          <span>{formatTime(currentSec)}</span>
          <span>{duration ? formatTime(duration) : '—'}</span>
        </div>

        {/* Script */}
        <p className="nesio-voice-brief-script">
          {points?.length ? points.map((p, i) => `${i+1}. ${p}`).join(' · ') : body}
        </p>

        {/* Controls */}
        {state === 'error' ? (
          <p style={{ textAlign: 'center', color: '#ef4444', fontSize: '0.82rem' }}>语音生成失败，请检查网络。</p>
        ) : (
          <div className="nesio-voice-brief-controls">
            <button type="button" className="nesio-voice-brief-btn" onClick={restart} aria-label="重播">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M1 4v6h6M3.51 15a9 9 0 102.13-9.36L1 10"/>
              </svg>
            </button>
            <button type="button" className="nesio-voice-brief-play-btn" onClick={state === 'done' ? restart : (state === 'loading' ? () => {} : togglePause)} aria-label={state === 'playing' ? '暂停' : '播放'}>
              {state === 'loading' ? (
                <span style={{ width: 10, height: 10, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
              ) : state === 'playing' ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><polygon points="5,3 19,12 5,21"/></svg>
              )}
            </button>
            <button type="button" className="nesio-voice-brief-btn" onClick={() => { stopAll(); onClose(); }} aria-label="完成">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
            </button>
          </div>
        )}
        {state === 'done' && <p style={{ textAlign: 'center', color: '#10b981', fontSize: '0.82rem', marginTop: '0.5rem' }}>播放完毕 ✓</p>}
      </div>
    </div>
  );
}
