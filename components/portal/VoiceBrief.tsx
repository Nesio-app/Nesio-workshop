'use client';

/**
 * VoiceBrief — plays a meeting/event brief using OpenAI TTS (natural voice).
 */

import { useEffect, useRef, useState } from 'react';
import { useSheetDismiss } from '@/lib/portal/use-sheet-dismiss';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

export interface VoiceBriefProps {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  points?: string[];
}

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error';

function buildScript(title: string, body: string, points?: string[], dict: string = 'zh'): string {
  const intro = title + L(dict, '。', '.');
  if (points?.length) {
    return intro + ' ' + points.map((p, i) => L(dict, `第${['一','二','三','四','五'][i] || i+1}点，${p}。`, `Point ${i + 1}: ${p}.`)).join(' ');
  }
  return intro + ' ' + body;
}

export default function VoiceBrief({ open, onClose, title, body, points }: VoiceBriefProps) {
  useSheetDismiss(onClose, { enabled: open });
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
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
  }

  async function startPlay() {
    setState('loading');
    const script = buildScript(title, body, points, dict);

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
        audio.onerror = () => setState('error');

        await audio.play();
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }

  function togglePause() {
    const audio = audioRef.current;
    if (audio) {
      if (state === 'playing') { audio.pause(); setState('paused'); }
      else { audio.play(); setState('playing'); }
      return;
    }
  }

  function restart() { stopAll(); setProgress(0); startPlay(); }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const currentSec = duration ? (progress / 100) * duration : 0;

  if (!open) return null;

  return (
    <div className="nesio-voice-brief-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '语音简报', 'Voice brief')}>
      <div className="nesio-voice-brief-backdrop" onClick={onClose} />
      <div className="nesio-voice-brief-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-voice-brief-header">
          <div>
            <p className="nesio-voice-brief-kicker">
              {state === 'loading' ? L(dict, '正在生成语音…', 'Generating audio…') : L(dict, '语音简报 · AI 朗读', 'Voice brief · read by AI')}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--portal-muted)', margin: '-0.4rem 0 0.5rem' }}>
          <span>{formatTime(currentSec)}</span>
          <span>{duration ? formatTime(duration) : '—'}</span>
        </div>

        {/* Script */}
        <p className="nesio-voice-brief-script">
          {points?.length ? points.map((p, i) => `${i+1}. ${p}`).join(' · ') : body}
        </p>

        {/* Controls */}
        {state === 'error' ? (
          <p style={{ textAlign: 'center', color: 'var(--status-risk)', fontSize: '0.82rem' }}>{L(dict, '真人语音暂不可用，请检查 OpenAI TTS 配置或网络。', 'Natural voice unavailable — check OpenAI TTS config or your network.')}</p>
        ) : (
          <div className="nesio-voice-brief-controls">
            <button type="button" className="nesio-voice-brief-btn" onClick={restart} aria-label={L(dict, '重播', 'Replay')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M1 4v6h6M3.51 15a9 9 0 102.13-9.36L1 10"/>
              </svg>
            </button>
            <button type="button" className="nesio-voice-brief-play-btn" onClick={state === 'done' ? restart : (state === 'loading' ? () => {} : togglePause)} aria-label={state === 'playing' ? L(dict, '暂停', 'Pause') : L(dict, '播放', 'Play')}>
              {state === 'loading' ? (
                <span style={{ width: 10, height: 10, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
              ) : state === 'playing' ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><polygon points="5,3 19,12 5,21"/></svg>
              )}
            </button>
            <button type="button" className="nesio-voice-brief-btn" onClick={() => { stopAll(); onClose(); }} aria-label={L(dict, '完成', 'Done')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
            </button>
          </div>
        )}
        {state === 'done' && <p style={{ textAlign: 'center', color: 'var(--status-go)', fontSize: '0.82rem', marginTop: '0.5rem' }}>{L(dict, '播放完毕 ✓', 'Playback finished ✓')}</p>}
      </div>
    </div>
  );
}
