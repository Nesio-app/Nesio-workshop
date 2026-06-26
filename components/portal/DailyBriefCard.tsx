'use client';

/**
 * DailyBriefCard — always-present card in Today Feed.
 * Shows weather + calendar + email highlights.
 * "播客" button launches conversational TTS briefing.
 */

import { useEffect, useRef, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import { getRecentNodes } from '@/lib/portal/life-graph';
import type { CalendarEvent } from '@/lib/portal/types';

// View-model types owned by the Today surface (Platform Leak Check: Today must
// not import Integration DTOs — it consumes its own normalized view shapes).
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

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'done';

export default function DailyBriefCard() {
  const [weather, setWeather] = useState<WeatherView | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [segments, setSegments] = useState<BriefSegment[]>([]);
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [currentSeg, setCurrentSeg] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [generated, setGenerated] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const profile = loadProfileSettings();
    setDisplayName(profile.displayName || '');

    // Load cached brief for today
    try {
      const cached = JSON.parse(localStorage.getItem(BRIEF_CACHE_KEY) || 'null') as BriefCache | null;
      if (cached?.date === todayKey() && cached.segments?.length) {
        setSegments(cached.segments);
        setGenerated(true);
        return;
      }
    } catch { /* ignore */ }

    // Load signals
    const w = readPortalCache<WeatherView>(PORTAL_CACHE_KEYS.weather);
    setWeather(w);
    const cal = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
    setEvents(cal?.events?.filter((e) => new Date(e.start).getTime() > Date.now()).slice(0, 3) || []);

    const onUpdate = () => {
      setWeather(readPortalCache<WeatherView>(PORTAL_CACHE_KEYS.weather));
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
  }, []);

  async function generateBrief() {
    setPlayState('loading');
    const memoryNotes = getRecentNodes(5).map((n) => n.name);
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
        playSegments(data.segments, 0);
      } else {
        setPlayState('idle');
      }
    } catch { setPlayState('idle'); }
  }

  async function playSegments(segs: BriefSegment[], startIdx: number) {
    for (let i = startIdx; i < segs.length; i++) {
      setCurrentSeg(i);
      setPlayState('playing');
      await playSingleSegment(segs[i]);
      if (playState === 'idle') return; // stopped
    }
    setPlayState('done');
  }

  async function playSingleSegment(seg: BriefSegment): Promise<void> {
    return new Promise((resolve) => {
      // Try OpenAI TTS
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
            audio.onended = () => resolve();
            audio.onerror = () => { fallbackTTS(seg.text, resolve); };
            audio.play().catch(() => fallbackTTS(seg.text, resolve));
          } else {
            fallbackTTS(seg.text, resolve);
          }
        })
        .catch(() => fallbackTTS(seg.text, resolve));
    });
  }

  function fallbackTTS(text: string, done: () => void) {
    if (!window.speechSynthesis) { done(); return; }
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'zh-CN'; utt.rate = 1.0;
    utt.onend = done; utt.onerror = done;
    window.speechSynthesis.speak(utt);
  }

  function stopPlay() {
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    setPlayState('idle');
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';

  return (
    <div className="nesio-brief-card">
      {/* Header */}
      <div className="nesio-brief-card-header">
        <div>
          <p className="nesio-brief-kicker">每日概况</p>
          <h3 className="nesio-brief-title">{greeting}{displayName ? `，${displayName}` : ''}。</h3>
        </div>
        {playState === 'playing' ? (
          <button type="button" className="nesio-brief-podcast-btn nesio-brief-podcast-btn--active" onClick={stopPlay}>
            <span className="nesio-brief-wave" aria-hidden>
              {Array.from({ length: 4 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.1}s` }} />)}
            </span>
            停止
          </button>
        ) : (
          <button type="button" className="nesio-brief-podcast-btn"
            onClick={() => generated ? playSegments(segments, 0) : generateBrief()}
            disabled={playState === 'loading'}>
            {playState === 'loading' ? '生成中…' : '▶ 播客'}
          </button>
        )}
      </div>

      {/* Signals row */}
      <div className="nesio-brief-signals">
        {/* Weather */}
        {weather ? (
          <div className="nesio-brief-signal">
            <span className="nesio-brief-signal-icon">🌤</span>
            <div>
              <p className="nesio-brief-signal-val">{weather.temperatureC}° · {weather.condition}</p>
              {weather.forecastNote && <p className="nesio-brief-signal-note">{weather.forecastNote}</p>}
            </div>
          </div>
        ) : (
          <div className="nesio-brief-signal nesio-brief-signal--empty">
            <span className="nesio-brief-signal-icon">🌤</span>
            <p className="nesio-brief-signal-note">开启位置权限获取天气</p>
          </div>
        )}

        {/* Calendar */}
        <div className="nesio-brief-signal">
          <span className="nesio-brief-signal-icon">📅</span>
          <div>
            {events.length > 0 ? (
              <>
                <p className="nesio-brief-signal-val">{events.length} 个安排</p>
                <p className="nesio-brief-signal-note">
                  {new Date(events[0].start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} {events[0].title}
                </p>
              </>
            ) : (
              <>
                <p className="nesio-brief-signal-val">今天无安排</p>
                <p className="nesio-brief-signal-note">接入 Calendar 显示日程</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Playing indicator */}
      {playState === 'playing' && segments[currentSeg] && (
        <div className="nesio-brief-now-playing">
          <span>{segments[currentSeg].emoji}</span>
          <span className="nesio-brief-now-playing-text">{segments[currentSeg].text}</span>
        </div>
      )}

      {playState === 'done' && (
        <p style={{ fontSize: '0.72rem', color: '#10b981', textAlign: 'center', marginTop: '0.5rem' }}>
          播报完毕 ✓
        </p>
      )}
    </div>
  );
}
