'use client';

/**
 * DailyBriefCard — always-present card in Today Feed.
 * Shows weather + calendar + email highlights.
 * "听简报" button launches conversational TTS briefing.
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

type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error';

function buildDailyOverview(canUsePrivateData: boolean, eventCount: number, memoryCount: number) {
  if (!canUsePrivateData || memoryCount === 0) {
    return {
      title: '先放进来一件事就好',
      subtitle: '说一句、拍一下，Nesio 会帮你留到以后找得到。',
    };
  }
  if (eventCount >= 2) {
    return {
      title: '今天有点多，先看最重要的一件。',
      subtitle: `有 ${eventCount} 个安排，我把最该看的放前面。`,
    };
  }
  if (eventCount === 1) {
    return {
      title: '今天先看这一件事。',
      subtitle: '还有别的线索可以晚点处理。',
    };
  }
  return {
    title: memoryCount >= 3 ? '今天适合整理一下线索。' : '今天很轻，可以补一条 Memory。',
    subtitle: memoryCount >= 3 ? '你已经放进来一些内容，可以回头找得到。' : '从一件小事开始就够了。',
  };
}

export default function DailyBriefCard({ canUsePrivateData }: { canUsePrivateData: boolean }) {
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
      const profile = loadProfileSettings();
      setDisplayName(profile.displayName || '');
    } else {
      setDisplayName('');
    }

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
    if (canUsePrivateData) {
      const cal = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
      setEvents(cal?.events?.filter((e) => new Date(e.start).getTime() > Date.now()).slice(0, 3) || []);
    } else {
      setEvents([]);
    }

    const onUpdate = () => {
      setWeather(readPortalCache<WeatherView>(PORTAL_CACHE_KEYS.weather));
      if (!canUsePrivateData) {
        setEvents([]);
        return;
      }
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
      const ok = await playSingleSegment(segs[i]);
      if (!ok) return;
      if (playState === 'idle') return; // stopped
    }
    setPlayState('done');
  }

  async function playSingleSegment(seg: BriefSegment): Promise<boolean> {
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
            audio.onended = () => resolve(true);
            audio.onerror = () => { setPlayState('error'); resolve(false); };
            audio.play().catch(() => { setPlayState('error'); resolve(false); });
          } else {
            setPlayState('error');
            resolve(false);
          }
        })
        .catch(() => {
          setPlayState('error');
          resolve(false);
        });
    });
  }

  function stopPlay() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayState('idle');
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const memoryCount = canUsePrivateData ? getRecentNodes().length : 0;
  const overview = buildDailyOverview(canUsePrivateData, events.length, memoryCount);

  return (
    <div className="nesio-brief-card">
      {/* Header */}
      <div className="nesio-brief-card-header">
        <div>
          <p className="nesio-brief-kicker">每日概况</p>
          <h3 className="nesio-brief-title">{greeting}{displayName ? `，${displayName}` : ''}。</h3>
          <p className="nesio-brief-overview-title">{overview.title}</p>
          <p className="nesio-brief-overview-sub">{overview.subtitle}</p>
        </div>
        {playState === 'playing' ? (
          <button type="button" className="nesio-brief-podcast-btn nesio-brief-podcast-btn--active" onClick={stopPlay}>
            <span className="nesio-brief-wave" aria-hidden>
              {Array.from({ length: 4 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.1}s` }} />)}
            </span>
            停止
          </button>
        ) : canUsePrivateData ? (
          <button type="button" className="nesio-brief-podcast-btn"
            onClick={() => generated ? playSegments(segments, 0) : generateBrief()}
            disabled={playState === 'loading'}>
            {playState === 'loading' ? '生成中…' : '听简报'}
          </button>
        ) : (
          <a href="/login" className="nesio-brief-podcast-btn" style={{ textDecoration: 'none' }}>
            登录后生成
          </a>
        )}
      </div>

      {/* Signals row: calendar only. Weather stays out of the first-launch overview. */}
      <div className="nesio-brief-signals">
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
                <p className="nesio-brief-signal-val">{canUsePrivateData ? '今天无安排' : '登录后显示日程'}</p>
                <p className="nesio-brief-signal-note">{canUsePrivateData ? '接入 Calendar 显示日程' : '不会在公开状态加载日历'}</p>
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
      {playState === 'error' && (
        <p style={{ fontSize: '0.72rem', color: '#ef4444', textAlign: 'center', marginTop: '0.5rem' }}>
          真人语音暂不可用，请稍后再试。
        </p>
      )}
    </div>
  );
}
