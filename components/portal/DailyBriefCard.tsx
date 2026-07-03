'use client';

/**
 * DailyBriefCard — 听今日简报
 * Podcast-host style briefing.
 * TTS: OpenAI nova (primary) → browser SpeechSynthesis (fallback, no API key needed).
 */

import { useEffect, useRef, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { loadCalendarFromLocal } from '@/lib/portal/calendar-local-store';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { CalendarEvent } from '@/lib/portal/types';

interface WeatherView {
  temperatureC: number;
  condition: string;
  forecastNote?: string;
  placeLabel?: string;
}

const BRIEF_CACHE_KEY = 'nesio-daily-brief-v2';
interface BriefCache { date: string; script: string; }

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error';
type TTSMode = 'openai' | 'browser';

function getCalendarEvents(): CalendarEvent[] {
  const local = loadCalendarFromLocal() as CalendarEvent[];
  if (local.length > 0) return local;
  const cached = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
  return cached?.events ?? [];
}

function getEmailHighlights(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const nodes = JSON.parse(localStorage.getItem('nesio-life-graph-v1') || '[]') as Array<{
      source?: string; name?: string; rawInput?: string; createdAt?: string;
    }>;
    return nodes
      .filter((n) => n.source === 'email' && n.name)
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .slice(0, 5)
      .map((n) => n.rawInput ? `${n.name}（${n.rawInput.slice(0, 60)}）` : n.name!);
  } catch { return []; }
}

function getMemoryNotes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const nodes = JSON.parse(localStorage.getItem('nesio-life-graph-v1') || '[]') as Array<{
      source?: string; name?: string; type?: string; createdAt?: string;
    }>;
    return nodes
      .filter((n) => n.source === 'manual' && n.name && n.type !== 'event')
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .slice(0, 3)
      .map((n) => n.name!);
  } catch { return []; }
}

export default function DailyBriefCard({
  canUsePrivateData,
  memoryCount: _memoryCount,
  memoryNotes: _memoryNotesProp,
  circular,
}: {
  canUsePrivateData: boolean;
  memoryCount: number;
  memoryNotes: readonly string[];
  circular?: boolean;
}) {
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [displayName, setDisplayName] = useState('');
  const [cachedScript, setCachedScript] = useState('');
  const [progress, setProgress] = useState(0);
  const [ttsMode, setTtsMode] = useState<TTSMode>('openai');
  const [errorMsg, setErrorMsg] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!canUsePrivateData) { setDisplayName(''); setCachedScript(''); return; }
    setDisplayName(loadProfileSettings().displayName || '');
    try {
      const cached = JSON.parse(localStorage.getItem(BRIEF_CACHE_KEY) || 'null') as BriefCache | null;
      if (cached?.date === todayKey() && cached.script) setCachedScript(cached.script);
    } catch { /* ignore */ }
  }, [canUsePrivateData]);

  function stopAll() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null; }
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
    if (utteranceRef.current && typeof window !== 'undefined') { window.speechSynthesis?.cancel(); utteranceRef.current = null; }
  }

  // ── Browser SpeechSynthesis fallback ──────────────────────────────────────
  async function playWithBrowserTTS(script: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        setErrorMsg('语音不可用，请配置 OpenAI TTS 或使用支持语音的浏览器');
        setPlayState('error');
        resolve();
        return;
      }
      setTtsMode('browser');
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(script);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.0;
      utterance.pitch = 1.05;

      // Pick Chinese voice if available
      const voices = window.speechSynthesis.getVoices();
      const cnVoice = voices.find((v) => v.lang.startsWith('zh') || v.lang.includes('CN'));
      if (cnVoice) utterance.voice = cnVoice;

      utteranceRef.current = utterance;

      utterance.onstart = () => {
        setPlayState('playing');
        // Simulate progress since SpeechSynthesis has no duration API
        let pct = 0;
        progressRef.current = setInterval(() => {
          pct = Math.min(pct + 1, 98);
          setProgress(pct);
        }, (script.length * 80) / 100); // rough estimate
      };
      utterance.onend = () => {
        setPlayState('done'); setProgress(100);
        if (progressRef.current) clearInterval(progressRef.current);
        resolve();
      };
      utterance.onerror = (e) => {
        if (e.error === 'interrupted') { resolve(); return; } // intentional stop
        setErrorMsg('浏览器语音播放失败');
        setPlayState('error');
        if (progressRef.current) clearInterval(progressRef.current);
        resolve();
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  // ── OpenAI TTS → fallback to browser ──────────────────────────────────────
  async function playScript(script: string) {
    setPlayState('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/portal/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script, voice: 'nova', speed: 1.05 }),
      });

      if (res.ok && res.headers.get('content-type')?.includes('audio')) {
        setTtsMode('openai');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onplay = () => {
          setPlayState('playing');
          progressRef.current = setInterval(() => {
            if (audio.duration) setProgress(Math.round((audio.currentTime / audio.duration) * 100));
          }, 300);
        };
        audio.onpause = () => { setPlayState('paused'); if (progressRef.current) clearInterval(progressRef.current); };
        audio.onended = () => {
          setPlayState('done'); setProgress(100);
          if (progressRef.current) clearInterval(progressRef.current);
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          // OpenAI audio failed mid-play — fall back to browser TTS
          void playWithBrowserTTS(script);
        };
        await audio.play();
        return;
      }

      // OpenAI TTS not available or returned error — use browser TTS
      await playWithBrowserTTS(script);
    } catch {
      await playWithBrowserTTS(script);
    }
  }

  async function generateAndPlay() {
    if (!canUsePrivateData) return;
    setPlayState('loading');
    setProgress(0);
    setErrorMsg('');

    const weather = readPortalCache<WeatherView>(PORTAL_CACHE_KEYS.weather);
    const events = getCalendarEvents();
    const emailHighlights = getEmailHighlights();
    const memoryNotes = getMemoryNotes();

    try {
      const res = await fetch('/api/portal/daily-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, weather, events, emailHighlights, memoryNotes }),
      });
      const data = await res.json() as { ok?: boolean; script?: string };
      if (!data.ok || !data.script) {
        setErrorMsg('简报生成失败，请重试');
        setPlayState('error');
        return;
      }
      const script = data.script;
      try { localStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({ date: todayKey(), script })); } catch { /* ignore */ }
      setCachedScript(script);
      await playScript(script);
    } catch {
      setErrorMsg('网络错误，请重试');
      setPlayState('error');
    }
  }

  function togglePause() {
    if (ttsMode === 'browser') {
      if (playState === 'playing') { window.speechSynthesis?.pause(); setPlayState('paused'); }
      else { window.speechSynthesis?.resume(); setPlayState('playing'); }
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (playState === 'playing') { audio.pause(); }
    else if (playState === 'paused') { audio.play(); setPlayState('playing'); }
  }

  function handlePlay() {
    if (!canUsePrivateData) { window.location.href = '/login'; return; }
    if (playState === 'playing') { togglePause(); return; }
    if (playState === 'paused') { togglePause(); return; }
    if (playState === 'error' || playState === 'done') {
      stopAll();
      setProgress(0);
      if (cachedScript) { void playScript(cachedScript); return; }
    }
    if (cachedScript && playState === 'idle') { stopAll(); setProgress(0); void playScript(cachedScript); return; }
    void generateAndPlay();
  }

  function handleRegenerate() {
    stopAll();
    setProgress(0);
    setCachedScript('');
    setErrorMsg('');
    try { localStorage.removeItem(BRIEF_CACHE_KEY); } catch { /* ignore */ }
    void generateAndPlay();
  }

  // ── Circular mode ──────────────────────────────────────────────────────────
  if (circular) {
    const isPlaying = playState === 'playing';
    const isLoading = playState === 'loading';
    const isPaused = playState === 'paused';
    const isError = playState === 'error';
    const isDone = playState === 'done';

    const icon = isPlaying
      ? <span className="nesio-brief-strip-wave nesio-brief-strip-wave--sm" aria-hidden>{Array.from({ length: 4 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}</span>
      : isLoading ? <span style={{ fontSize: '1rem' }}>⏳</span>
      : isError ? <span style={{ fontSize: '1rem' }}>⚠️</span>
      : isPaused ? <span style={{ fontSize: '1rem' }}>▶</span>
      : isDone ? <span style={{ fontSize: '1rem' }}>🔁</span>
      : <span style={{ fontSize: '1rem' }}>🔊</span>;

    const label = isPlaying ? '暂停'
      : isLoading ? '生成中'
      : isError ? '重试'
      : isPaused ? '继续'
      : isDone ? '重播'
      : '听简报';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
        <button
          type="button"
          className={`nesio-brief-circle${isPlaying ? ' nesio-brief-circle--playing' : ''}${isError ? ' nesio-brief-circle--error' : ''}`}
          onClick={handlePlay}
          aria-label="听今日简报"
          disabled={isLoading}
        >
          <span className="nesio-brief-circle-icon" aria-hidden>{icon}</span>
          <span className="nesio-brief-circle-label">{label}</span>
        </button>

        {isError && errorMsg && (
          <p style={{ fontSize: '0.6rem', color: 'var(--status-risk)', marginTop: 3, textAlign: 'center', maxWidth: 80, lineHeight: 1.3 }}>{errorMsg}</p>
        )}

        {(isPlaying || isPaused || isDone) && (
          <div style={{ width: 56, marginTop: 4 }}>
            <div style={{ width: '100%', height: 3, background: 'rgba(88,140,227,0.15)', borderRadius: 2 }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--portal-blue-deep, #588ce3)', borderRadius: 2, transition: 'width 0.3s linear' }} />
            </div>
          </div>
        )}

        {isDone && (
          <button type="button" onClick={handleRegenerate} style={{ marginTop: 2, fontSize: '0.58rem', color: 'var(--portal-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            重新生成
          </button>
        )}

        {ttsMode === 'browser' && (isPlaying || isDone) && (
          <p style={{ fontSize: '0.58rem', color: 'var(--portal-muted)', marginTop: 2 }}>系统语音</p>
        )}
      </div>
    );
  }

  // ── Strip mode ─────────────────────────────────────────────────────────────
  if (!canUsePrivateData) {
    return (
      <div className="nesio-brief-strip">
        <span className="nesio-brief-strip-label">🔊 每日简报</span>
        <a href="/login" className="nesio-brief-strip-btn">登录后生成</a>
      </div>
    );
  }

  return (
    <div className="nesio-brief-strip">
      <span className="nesio-brief-strip-label">
        {playState === 'playing' ? <><span className="nesio-brief-strip-wave" aria-hidden>{Array.from({ length: 4 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}</span>播放中</>
          : playState === 'done' ? '✓ 简报播放完毕'
          : playState === 'error' ? `⚠️ ${errorMsg || '语音暂不可用'}`
          : playState === 'paused' ? '⏸ 已暂停'
          : '🔊 听今日简报'}
      </span>
      {playState === 'playing' ? (
        <button type="button" className="nesio-brief-strip-btn nesio-brief-strip-btn--stop" onClick={togglePause}>暂停</button>
      ) : playState === 'paused' ? (
        <button type="button" className="nesio-brief-strip-btn" onClick={togglePause}>继续</button>
      ) : (
        <button type="button" className="nesio-brief-strip-btn" disabled={playState === 'loading'}
          onClick={playState === 'done' || playState === 'error' ? handleRegenerate : handlePlay}>
          {playState === 'loading' ? '生成中…' : playState === 'done' ? '重新生成' : cachedScript ? '播放' : '生成简报'}
        </button>
      )}
    </div>
  );
}
