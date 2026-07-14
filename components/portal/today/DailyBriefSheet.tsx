'use client';

/**
 * DailyBriefSheet — 今日文字简报(批次 30)。
 *
 * 「收听」按钮曾 dispatch 'nesio-play-brief' 但全站无监听 = 死按钮(QA 实锤)。
 * 用户定案:收听(TTS)取消,改为文字简报 —— 点开即读,不用等语音;
 * 属 AI 例程(ai_routine),Pro 整功能(试用期内可用)。
 */

import { useCallback, useEffect, useState } from 'react';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { CalendarEvent } from '@/lib/portal/types';
import { recentBriefMemoryNotes } from '@/lib/platform/view-models/today-view-model';
import { loadProfileSettings, portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { L } from '@/lib/portal/i18n';
import { usePortalLocale } from '../use-portal-locale';
import { useSheetDrag } from '../use-sheet-drag';

interface WeatherCache { temperatureC?: number; condition?: string; forecastNote?: string; placeLabel?: string; tempMaxC?: number; tempMinC?: number; precipProb?: number }

export function DailyBriefSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'auth' | 'network' | null>(null);
  const { handleProps, cardStyle, expanded } = useSheetDrag(onClose);

  const fetchBrief = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = loadProfileSettings();
      const weather = readPortalCache<WeatherCache>(PORTAL_CACHE_KEYS.weather);
      const events = (readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar)?.events ?? [])
        .filter((e) => {
          const t = new Date(e.start);
          const d = new Date(); d.setHours(0, 0, 0, 0);
          return t >= d && t < new Date(d.getTime() + 86_400_000);
        })
        .slice(0, 6)
        .map((e) => ({ title: e.title, start: e.start, end: e.end, location: e.location, calendarName: e.calendarName }));
      const memoryNotes = recentBriefMemoryNotes(3);
      const res = await fetch('/api/portal/daily-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: profile.displayName,
          coachStyle: profile.coachStyle,
          uiLocale: dict,
          weather: weather ?? undefined,
          location: weather?.placeLabel,
          events,
          memoryNotes,
        }),
      });
      if (res.status === 401) { setError('auth'); return; }
      const data = await res.json() as { ok?: boolean; script?: string };
      if (data.ok && data.script) setScript(data.script);
      else setError('network');
    } catch {
      setError('network');
    } finally {
      setLoading(false);
    }
  }, [dict]);

  useEffect(() => {
    if (open && !script && !loading) void fetchBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开时取一次,重取走「换个说法」按钮
  }, [open]);

  if (!open) return null;
  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '今日简报', "Today's brief")}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className={`nesio-settings-sheet-card${expanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle}>
        <div className="nesio-sheet-handle" {...handleProps} />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, '今日简报', "Today's brief")}</h2>
        </div>
        <div className="nesio-settings-sheet-body">
          {loading && <p className="nesio-mirror-writing">{L(dict, 'Nesio 正在整理今天…', 'Nesio is putting today together…')}</p>}
          {!loading && script && (
            <>
              <p className="nesio-daily-brief-text nesio-serif-voice">{script}</p>
              <button type="button" className="nesio-lm-perspective-btn" style={{ marginTop: '0.8rem' }} onClick={() => void fetchBrief()}>
                {L(dict, '换个说法', 'Say it differently')}
              </button>
            </>
          )}
          {!loading && !script && error && (
            <>
              <p className="nesio-mirror-error">
                {error === 'auth'
                  ? L(dict, '登录后就能看每日简报。', 'Sign in to get your daily brief.')
                  : L(dict, '这次没生成出来,点重试。', 'Did not generate this time — tap retry.')}
              </p>
              {error !== 'auth' && (
                <button type="button" className="nesio-lm-perspective-btn" onClick={() => void fetchBrief()}>
                  {L(dict, '重试', 'Retry')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
