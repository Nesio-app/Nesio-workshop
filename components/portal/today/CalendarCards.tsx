'use client';

/**
 * CalendarCards — 日历事件卡簇:置顶「绝不能错过」卡 + 折叠区日历项。
 * 从 FocusSection 拆出;共享 formatEventTime/calendarCountdown 时间助手,
 * 与任务卡状态机无耦合。
 */

import { useState, type ComponentType } from 'react';
import type { CalendarEvent } from '@/lib/portal/types';
import { EVENT_TYPE_LABEL, parseEventDate, type AttentionObject, type EventType } from '@/lib/platform/attention-engine';
import { safeExternalUrl } from './meeting-node';
import { t, L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale, type PortalLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconLink, IconMic, IconMapPin, IconFlag, IconHeartPulse, IconNote, IconClock, IconStar, IconCalendar } from '../icons';

// 批次 48:emoji 图标(📌✈️⏰…)违反图标纪律 → 线性 icon 映射
const EVENT_TYPE_LINEAR_ICON: Record<EventType, ComponentType<{ size?: number }>> = {
  flight: IconFlag, medical: IconHeartPulse, exam: IconNote, deadline: IconClock,
  birthday: IconStar, travel: IconMapPin, meeting: IconCalendar, other: IconCalendar,
};

function formatEventTime(locale: PortalLocale, dateStr: string, allDay?: boolean): string {
  if (allDay) return t(locale, 'todayAllDay');
  const d = parseEventDate(dateStr);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 事件是否正在进行(2 小时窗口)— 与文案解耦,i18n 后不能再用字符串判断 */
function eventIsNow(startDate: Date, allDay?: boolean): boolean {
  if (allDay) return false;
  const diffMs = startDate.getTime() - Date.now();
  return diffMs < 0 && diffMs > -120 * 60_000;
}

function calendarCountdown(locale: PortalLocale, startDate: Date, allDay?: boolean): string {
  if (allDay) return '';
  const diffMs = startDate.getTime() - Date.now();
  if (diffMs < 0 && diffMs > -120 * 60_000) {
    return t(locale, 'todayInProgressTemplate', { mins: Math.round(-diffMs / 60_000) });
  }
  // 批次 66(用户定案):倒计时文字最多提前 12h 出现 ——「43h40m后」这种
  // 数字没有行动意义,超过 12h 只显示「明天 + 时间」,不显示倒计时。
  if (diffMs > 0 && diffMs <= 12 * 3600_000) {
    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 60) return t(locale, 'todayMinutesLaterTemplate', { mins: diffMin });
    const hh = Math.floor(diffMin / 60);
    const mm = diffMin % 60;
    return t(locale, 'todayHoursLaterTemplate', { hm: `${hh}h${mm > 0 ? mm + 'm' : ''}` });
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
  const locale = usePortalLocale();
  const [expanded, setExpanded] = useState(false);
  const typeLabel = EVENT_TYPE_LABEL[obj.eventType];
  const timeStr = formatEventTime(locale, obj.event.start, obj.event.allDay);
  const countdown = calendarCountdown(locale, parseEventDate(obj.event.start), obj.event.allDay);
  const isNow = eventIsNow(parseEventDate(obj.event.start), obj.event.allDay);
  const meetingUrl = obj.event.url ? safeExternalUrl(obj.event.url) : null;

  // 批次 117(用户「白色框去掉」):置顶卡不再是白卡,做成时间线裸节点 ——
  // 实心 accent 圆点坐轨上 + kicker(绝不能错过小旗 · 类型 · 时间)+ 标题 + 倒计时副行,
  // 与折叠区节点同构、同轨。展开细节沿用 .nesio-collapsed-detail。
  return (
    <div className={`nesio-collapsed-item nesio-pinned-node${isNow ? ' nesio-pinned-node--now' : ''}`}>
      <button
        type="button"
        className="nesio-collapsed-row"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="nesio-collapsed-dot nesio-collapsed-dot--pinned" aria-hidden><IconStar size={13} /></span>
        <span className="nesio-collapsed-task-body">
          <span className="nesio-collapsed-kicker">
            <span className="nesio-pinned-flag">{t(locale, 'todayPinnedBadge')}</span>
            {` · ${typeLabel}`}{!obj.event.allDay ? ` · ${timeStr}` : ''}
          </span>
          <span className="nesio-collapsed-title">{obj.title}</span>
          {countdown && (
            <span className={`nesio-collapsed-sub${isNow ? ' nesio-collapsed-sub--now' : ''}`}>{countdown}</span>
          )}
        </span>
      </button>

      {/* ── expanded detail(裸节点缩进,复用折叠区细节样式)── */}
      {expanded && (
        <div className="nesio-collapsed-detail">
          {obj.event.description && (
            <p className="nesio-collapsed-desc">{obj.event.description.slice(0, 120)}{obj.event.description.length > 120 ? '…' : ''}</p>
          )}
          {obj.event.location && (
            <p className="nesio-collapsed-loc"><IconMapPin size={13} /> {obj.event.location}</p>
          )}
          <div className="nesio-collapsed-actions">
            {meetingUrl && (
              <a href={meetingUrl} target="_blank" rel="noopener noreferrer" className="nesio-collapsed-act-btn">
                <IconLink size={13} /> {t(locale, 'todayLinkLabel')}
              </a>
            )}
            <button type="button" className="nesio-collapsed-act-btn" onClick={onOpenRecorder}>
              <IconMic size={13} /> {t(locale, 'todayRecordBtn')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Collapsed list item ───────────────────────────────────────────────────────

export function CollapsedCalItem({ obj, onOpenRecorder, onRemove }: { obj: AttentionObject; onOpenRecorder: () => void; onRemove?: (id: string) => void }) {
  const locale = usePortalLocale();
  const [expanded, setExpanded] = useState(false);
  const TypeIcon = EVENT_TYPE_LINEAR_ICON[obj.eventType];
  const timeStr = obj.event.allDay ? t(locale, 'todayAllDay') : formatEventTime(locale, obj.event.start, false);
  const countdown = calendarCountdown(locale, parseEventDate(obj.event.start), obj.event.allDay);
  const dayTag = obj.isTomorrow ? t(locale, 'todayLabelTomorrow') : null;

  return (
    <li className="nesio-collapsed-item">
      {/* 批次 111:日历项也做成时间线节点 —— 空心圆点在轨上 + 时标 kicker + 标题(去掉旧的图标+右侧 meta)
          2026-08-01 修位置错:外层原来是 <button> 包住圆点+标题,✕ 挂在它外面的 <li> 下,
          没有 flex 容器兜着,挤到下一行去了。仿 FocusSection.tsx 的 CollapsedTaskItem:
          外层改 <div className="nesio-collapsed-row">,圆点+标题挪进内层按钮,✕ 跟内层按钮
          做同级 flex 子项,才会贴在标题右侧。 */}
      <div className="nesio-collapsed-row">
        <button type="button" className="nesio-collapsed-cal-body" onClick={() => setExpanded((v) => !v)}>
          {/* 批次 129·定时·钟:有具体时间的日历项圆内嵌钟;全天事件用素圆 */}
          <span className={`nesio-collapsed-dot${obj.event.allDay ? '' : ' nesio-collapsed-dot--clock'}`} aria-hidden>
            {!obj.event.allDay && <IconClock size={13} />}
          </span>
          <span className="nesio-collapsed-task-body" style={{ cursor: 'inherit' }}>
            <span className="nesio-collapsed-kicker">{[dayTag, timeStr, countdown].filter(Boolean).join(' · ')}</span>
            <span className="nesio-collapsed-title">{obj.title}</span>
          </span>
        </button>
        {/* 用户要求(2026-07-30):时间线**每一条**后面都要有 ✕ 能移走 —— 日历行此前没有,
            于是一场不想看的会只能一直挂在那。移走 = 只从今天的时间线拿掉,
            日历本身不动(我们没有权利替用户删他日历上的事)。 */}
        {onRemove && (
          <button
            type="button"
            className="nesio-tl-x"
            onClick={(e) => { e.stopPropagation(); onRemove(obj.id); }}
            aria-label={L(portalLocaleToDictionaryLocale(locale), '从今天移走这条', 'Remove from today')}
            title={L(portalLocaleToDictionaryLocale(locale), '从今天移走', 'Remove from today')}
          >✕</button>
        )}
      </div>
      {expanded && (
        <div className="nesio-collapsed-detail">
          {obj.event.description && <p className="nesio-collapsed-desc">{obj.event.description.slice(0, 80)}{obj.event.description.length > 80 ? '…' : ''}</p>}
          {obj.event.location && <p className="nesio-collapsed-loc"><IconMapPin size={12} /> {obj.event.location}</p>}
          {/* 批次 48:两个小按钮并排(此前链接是通栏胶囊、记录另起一行) */}
          <div className="nesio-collapsed-actions">
            {obj.event.url && (
              <a href={safeExternalUrl(obj.event.url)} target="_blank" rel="noopener noreferrer" className="nesio-collapsed-act-btn">
                <IconLink size={13} /> {t(locale, 'todayLinkLabel')}
              </a>
            )}
            <button type="button" className="nesio-collapsed-act-btn" onClick={onOpenRecorder}>
              <IconMic size={13} /> {t(locale, 'todayRecordBtn')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

