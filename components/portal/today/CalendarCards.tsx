'use client';

/**
 * CalendarCards — 日历事件卡簇:置顶「绝不能错过」卡 + 折叠区日历项。
 * 从 FocusSection 拆出;共享 formatEventTime/calendarCountdown 时间助手,
 * 与任务卡状态机无耦合。
 */

import { useState } from 'react';
import type { CalendarEvent } from '@/lib/portal/types';
import { EVENT_TYPE_ICON, EVENT_TYPE_LABEL, type AttentionObject } from '@/lib/platform/attention-engine';
import { safeExternalUrl } from './meeting-node';

function formatEventTime(dateStr: string, allDay?: boolean): string {
  if (allDay) return '全天';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function calendarCountdown(startDate: Date, allDay?: boolean): string {
  if (allDay) return '';
  const diffMs = startDate.getTime() - Date.now();
  if (diffMs < 0 && diffMs > -120 * 60_000) {
    return `进行中 +${Math.round(-diffMs / 60_000)}min`;
  }
  if (diffMs > 0 && diffMs < 48 * 3600_000) {
    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 60) return `${diffMin}分钟后`;
    const hh = Math.floor(diffMin / 60);
    const mm = diffMin % 60;
    return `${hh}h${mm > 0 ? mm + 'm' : ''}后`;
  }
  return '';
}

// ── Pinned card for a single must-not-miss calendar event ────────────────────

export function PinnedAttentionCard({
  obj,
  onOpenRecorder,
}: {
  obj: AttentionObject;
  onOpenRecorder: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const typeIcon = EVENT_TYPE_ICON[obj.eventType];
  const typeLabel = EVENT_TYPE_LABEL[obj.eventType];
  const timeStr = formatEventTime(obj.event.start, obj.event.allDay);
  const countdown = calendarCountdown(new Date(obj.event.start), obj.event.allDay);
  const isNow = countdown.startsWith('进行中');
  const meetingUrl = obj.event.url ? safeExternalUrl(obj.event.url) : null;

  return (
    <div className={`nesio-pinned-card${isNow ? ' nesio-pinned-card--now' : ''}`}>
      {/* ── badge row ── */}
      <div className="nesio-pinned-badge-row">
        <span className="nesio-pinned-badge">⭐ 绝不能错过</span>
        <span className="nesio-pinned-type-label">{typeIcon} {typeLabel}</span>
      </div>

      {/* ── main row ── */}
      <button
        type="button"
        className="nesio-pinned-main"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="nesio-pinned-title">{obj.title}</span>
        <span className="nesio-pinned-meta">
          {!obj.event.allDay && <span className="nesio-pinned-time">{timeStr}</span>}
          {countdown && (
            <span className={`nesio-pinned-countdown${isNow ? ' nesio-pinned-countdown--now' : ''}`}>
              {countdown}
            </span>
          )}
          <span className="nesio-pinned-chevron">{expanded ? '▴' : '▾'}</span>
        </span>
      </button>

      {/* ── expanded detail ── */}
      {expanded && (
        <div className="nesio-pinned-detail">
          {obj.event.description && (
            <p className="nesio-pinned-desc">{obj.event.description.slice(0, 120)}{obj.event.description.length > 120 ? '…' : ''}</p>
          )}
          {obj.event.location && (
            <p className="nesio-pinned-location">📍 {obj.event.location}</p>
          )}
          <div className="nesio-pinned-actions">
            {meetingUrl && (
              <a href={meetingUrl} target="_blank" rel="noopener noreferrer" className="nesio-pinned-action-btn nesio-pinned-action-btn--primary">
                🔗 进入会议
              </a>
            )}
            <button type="button" className="nesio-pinned-action-btn" onClick={onOpenRecorder}>
              🎙 记录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Collapsed list item ───────────────────────────────────────────────────────

export function CollapsedCalItem({ obj, onOpenRecorder }: { obj: AttentionObject; onOpenRecorder: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const timeStr = obj.event.allDay ? '全天' : formatEventTime(obj.event.start, false);
  const countdown = calendarCountdown(new Date(obj.event.start), obj.event.allDay);
  const dayTag = obj.isTomorrow ? '明天' : null;

  return (
    <li className="nesio-collapsed-item">
      <button type="button" className="nesio-collapsed-row" onClick={() => setExpanded((v) => !v)}>
        <span className="nesio-collapsed-icon">{EVENT_TYPE_ICON[obj.eventType]}</span>
        <span className="nesio-collapsed-title">{obj.title}</span>
        <span className="nesio-collapsed-meta">
          {dayTag && <span className="nesio-collapsed-day-tag">{dayTag}</span>}
          <span className="nesio-collapsed-time">{timeStr}</span>
          {countdown && !obj.isTomorrow && <span className="nesio-collapsed-countdown">{countdown}</span>}
        </span>
      </button>
      {expanded && (
        <div className="nesio-collapsed-detail">
          {obj.event.description && <p className="nesio-collapsed-desc">{obj.event.description.slice(0, 80)}{obj.event.description.length > 80 ? '…' : ''}</p>}
          {obj.event.location && <p className="nesio-collapsed-loc">📍 {obj.event.location}</p>}
          {obj.event.url && (
            <a href={safeExternalUrl(obj.event.url)} target="_blank" rel="noopener noreferrer" className="nesio-collapsed-link">🔗 链接</a>
          )}
          <button type="button" className="nesio-collapsed-record-btn" onClick={onOpenRecorder}>🎙 记录</button>
        </div>
      )}
    </li>
  );
}

