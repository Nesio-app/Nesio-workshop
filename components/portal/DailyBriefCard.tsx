'use client';

/**
 * DailyBriefCard — slim button strip.
 * "听今日简报" triggers TTS generation; while playing shows an inline waveform.
 * The briefing content (calendar + memory highlights) is audio-only — not a card section.
 */

import { useEffect, useRef, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { CalendarEvent } from '@/lib/portal/types';

interface BriefSegment {
  id: string;
  type: 'greeting' | 'weather' | 'calendar' | 'email' | 'memory' | 'closing';
  text: string;
  voice: 'nova' | 'alloy' | 'echo';
  emoji: string;
}
interface WeatherView {
  temperatureC: number;
  condition: string;
  forecastNote?: string;
  placeLabel?: string;
}

const BRIEF_CACHE_KEY = 'nesio-daily-brief-cache';
interface BriefCache { date: string; segments: BriefSegment[]; script: string; }

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error';

export default function DailyBriefCard({
  canUsePrivateData,
  memoryCount,
  memoryNotes,
}: {
  canUsePrivateData: boolean;
  memoryCount: number;
  memoryNotes: readonly string[];
}) {
  const [weather, setWeather] = useState<WeatherView | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [segments, setSegments] = useState<BriefSegment[]>([]);
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [currentSeg, setCurrentSeg] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [generated, setGenerated] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (canUsePrivateData) {
      setDisplayName(loadProfileSettings().displayName || '');
    } else {
      setDisplayName('');
      setEvents([]);
      setSegments([]);
      setGenerated(false);
    }

    if (canUsePrivateData) {
      try {
        const cached = JSON.parse(localStorage.getItem(BRIEF_CACHE_KEY) || 'null') as BriefCache | null;
        if (cached?.date === todayKey() && cached.segments?.length) {
          setSegments(cached.segments);
          setGenerated(true);
          return;
        }
      } catch { /* ignore */ }
    }

    const w = readPortalCache<WeatherView>(PORTAL_CACHE_KEYS.weather);
    setWeather(w);
    if (canUsePrivateData) {
      const cal = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
      setEvents(cal?.events?.filter((e) => new Date(e.start).getTime() > Date.now()).slice(0, 3) || []);
    }

    const onUpdate = () => {
      setWeather(readPortalCache<WeatherView>(PORTAL_CACHE_KEYS.weather));
      if (!canUsePrivateData) { setEvents([]); return; }
      const c = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
      setEvents(c?.events?.filter((e) => new Date(e.start).getTime() > Date.now()).slice(0, 3) || []);
    };
    window.addEventListener('nesio-connectors-refreshed', onUpdate);
    window.addEventListener('nesio-weather-updated', onUpdate);
    window.addEventListener('nesio-calendar-updated', onUpdate);
    return () => {
      window.removeEventListener('nesio-connectors-refreshed', onUpdate);
      window.removeEventListener('nesio-weather-updated', onUpdate);
      window.removeEventListener('nesio-calendar-updated', onUpdate);
    };
  }, [canUsePrivateData]);

  async function generateBrief() {
    if (!canUsePrivateData) return;
    setPlayState('loading');
    try {
      const res = await fetch('/api/portal/daily-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, weather, events, memoryNotes }),
      });
      const data = await res.json() as { ok?: boolean; segments?: BriefSegment[] };
      if (data.ok && data.segments?.length) {
        setSegments(data.segments);
        setGenerated(true);
        try {
          localStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({
            date: todayKey(), segments: data.segments, script: data.segments.map((s) => s.text).join(' '),
          }));
        } catch { /* ignore */ }
        void playSegments(data.segments, 0);
      } else {
        setPlayState('idle');
      }
    } catch { setPlayState('idle'); }
  }

  async function playSegments(segs: BriefSegment[], startIdx: number) {
    for (let i = startIdx; i < segs.length; i++) {
      setCurrentSeg(i);
      setPlayState('playing');
      const ok = await playSingleSegment(segs[i]);
      if (!ok) return;
    }
    setPlayState('done');
  }

  async function playSingleSegment(seg: BriefSegment): Promise<boolean> {
    return new Promise((resolve) => {
      fetch('/api/portal/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: seg.text, voice: seg.voice || 'nova', speed: 1.0 }),
      })
        .then(async (res) => {
          if (res.ok && res.headers.get('content-type')?.includes('audio')) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => resolve(true);
            audio.onerror = () => { setPlayState('error'); resolve(false); };
            audio.play().catch(() => { setPlayState('error'); resolve(false); });
          } else {
            setPlayState('error');
            resolve(false);
          }
        })
        .catch(() => { setPlayState('error'); resolve(false); });
    });
  }

  function stopPlay() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayState('idle');
  }

  // Slim strip — just a button row, not a full card.
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
        {playState === 'playing' && segments[currentSeg]
          ? <><span className="nesio-brief-strip-wave" aria-hidden>{Array.from({ length: 4 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}</span>{segments[currentSeg].emoji} {segments[currentSeg].text.slice(0, 30)}{segments[currentSeg].text.length > 30 ? '…' : ''}</>
          : playState === 'done' ? '✓ 简报播放完毕'
          : playState === 'error' ? '语音暂不可用'
          : '🔊 听今日简报'}
      </span>
      {playState === 'playing' ? (
        <button type="button" className="nesio-brief-strip-btn nesio-brief-strip-btn--stop" onClick={stopPlay}>停止</button>
      ) : (
        <button
          type="button"
          className="nesio-brief-strip-btn"
          disabled={playState === 'loading'}
          onClick={() => (generated ? void playSegments(segments, 0) : void generateBrief())}
        >
          {playState === 'loading' ? '生成中…' : generated ? '重新播放' : '生成简报'}
        </button>
      )}
    </div>
  );
}
