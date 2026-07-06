'use client';

/**
 * TimeBlocksWidget — 今日时间块(批次 22,Toggl 式)。
 * 把当天的日历事件 + 地点足迹拼成一条时间线:每块显示时段 + 内容,
 * 事件走蓝调、到访走绿调;点击块可跳详情(留接口)。数据全本机。
 */

import { useEffect, useMemo, useState } from 'react';
import { getCachedCalendarEvents } from '@/lib/portal/environment';
import { loadPlaceTrail, displayLabel, PLACE_TRAIL_UPDATED_EVENT } from '@/lib/portal/place-trail';
import type { CalendarEvent } from '@/lib/portal/types';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

interface Block {
  start: number;   // ms
  end: number;
  label: string;
  kind: 'event' | 'place';
  sub?: string;
}

function isToday(ts: number, now: Date): boolean {
  const d = new Date(ts);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function fmt(ms: number, dict: string): string {
  return new Date(ms).toLocaleTimeString(dict === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function durMin(a: number, b: number): number {
  return Math.max(0, Math.round((b - a) / 60000));
}

export function TimeBlocksWidget({ canUsePrivateData }: { canUsePrivateData: boolean }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [trailTick, setTrailTick] = useState(0);

  useEffect(() => {
    const bump = () => setTrailTick((v) => v + 1);
    window.addEventListener(PLACE_TRAIL_UPDATED_EVENT, bump);
    window.addEventListener('nesio-calendar-updated', bump);
    return () => { window.removeEventListener(PLACE_TRAIL_UPDATED_EVENT, bump); window.removeEventListener('nesio-calendar-updated', bump); };
  }, []);

  const blocks = useMemo(() => {
    void trailTick;
    const now = new Date();
    const out: Block[] = [];

    if (canUsePrivateData) {
      const events: CalendarEvent[] = getCachedCalendarEvents();
      for (const e of events) {
        if (e.allDay) continue;
        const s = Date.parse(e.start);
        if (!Number.isFinite(s) || !isToday(s, now)) continue;
        const en = e.end ? Date.parse(e.end) : s + 3_600_000;
        out.push({ start: s, end: Number.isFinite(en) ? en : s + 3_600_000, label: e.title, kind: 'event', sub: e.location || e.calendarName });
      }
    }

    const trail = loadPlaceTrail().filter((v) => isToday(Date.parse(v.ts), now));
    // 足迹按时间升序,块结束=下一次到访(或到访 end,或 +30min)
    const sorted = [...trail].sort((a, b) => a.ts.localeCompare(b.ts));
    sorted.forEach((v, i) => {
      const s = Date.parse(v.ts);
      const explicitEnd = v.end ? Date.parse(v.end) : NaN;
      const nextStart = i + 1 < sorted.length ? Date.parse(sorted[i + 1].ts) : NaN;
      const end = Number.isFinite(explicitEnd) ? explicitEnd : Number.isFinite(nextStart) ? nextStart : s + 30 * 60000;
      // 套用用户改过的地点别名(和足迹/时间线其它 UI 一致),generic 占位也兜底。
      out.push({ start: s, end, label: displayLabel(v.label), kind: 'place' });
    });

    return out.sort((a, b) => a.start - b.start);
  }, [canUsePrivateData, trailTick]);

  if (blocks.length === 0) {
    return (
      <p className="nesio-insights-empty">
        {L(dict, '今天还没有时间块。连接日历、授权位置后,今天去过哪、做过什么会自动拼成时间线。', "No time blocks yet today. Connect calendar and grant location — where you went and what you did will line up automatically.")}
      </p>
    );
  }

  return (
    <div className="nesio-timeblocks">
      {blocks.map((b, i) => (
        <div key={i} className={`nesio-timeblock nesio-timeblock--${b.kind}`}>
          <div className="nesio-timeblock-time">
            <span>{fmt(b.start, dict)}</span>
            <span className="nesio-timeblock-dur">{durMin(b.start, b.end)}m</span>
          </div>
          <div className="nesio-timeblock-bar" aria-hidden />
          <div className="nesio-timeblock-body">
            <span className="nesio-timeblock-label">{b.label}</span>
            {b.sub && <span className="nesio-timeblock-sub">{b.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
