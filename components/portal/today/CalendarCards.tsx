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

/**
 * 这条 description 值不值得占一行(2026-07-31,用户实测 图4:
 * 「第二个显示的一串网址内容没有意义」)。
 *
 * 从待办类应用(滴答清单等)同步过来的日历项,description 常常**整条就是一个深链** ——
 * 一串 `https://dida365.com/webapp#p/inbox/tasks/68f…` 铺在那儿:
 * 读不出任何信息、还把行撑破。而同一块里旁边就有一颗「链接」按钮 —— 那才是它该有的样子。
 *
 * 判据是「去掉链接之后还剩不剩下人话」,不是「以 http 开头就砍」:
 * 「地址 https://… 记得带表」这种是有内容的,砍掉就把用户真写的字弄丢了。
 */
export function meaningfulDesc(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const rest = s.replace(/https?:\/\/\S+/gi, '').replace(/[\s·|,、。;:\-—_]+/g, '');
  // 剩下不到两个字 = 这条正文的全部内容就是那个链接。
  return rest.length >= 2 ? s : '';
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
      {/*
       * 2026-07-31(用户实测 图2「x 位置应该在对应条目后,并且现在不管用」):
       * 这一行原来**整行是一个 button 元素**,而 ✕ 又不能嵌在按钮里(嵌套按钮),
       * (⚠️ 这句话刻意不写那个尖括号标签的字面写法:portal-no-inert-buttons 那条契约
       *  用正则扫源码、**不剥注释**,注释里出现它会被当成真标签,一路匹配到后面的
       *  自闭合斜杠,然后报一个根本不存在的「惰性按钮」。我写第一版时正是这么误报的。)
       * 于是它被放到了 <li> 底下 —— <li> 是块级流,✕ 就掉到了条目**下面一行、贴最左**,
       * 看起来像浮在两条中间的一个孤零零的叉。点不动则是因为它跟上面那个
       * width:100% 的行按钮在同一条流里互相压着。
       *
       * 改成和 CollapsedTaskItem 同一副骨架:外层 div 作行容器,里面
       * 「点标题展开」是一个 button、✕ 是它的**兄弟** —— 两个按钮平级,不再嵌套,
       * ✕ 也就回到了它该在的位置:这一条的末尾。
       */}
      <div className="nesio-collapsed-row">
        {/* 批次 129·定时·钟:有具体时间的日历项圆内嵌钟;全天事件用素圆 */}
        <span className={`nesio-collapsed-dot${obj.event.allDay ? '' : ' nesio-collapsed-dot--clock'}`} aria-hidden>
          {!obj.event.allDay && <IconClock size={13} />}
        </span>
        <button type="button" className="nesio-collapsed-task-body" onClick={() => setExpanded((v) => !v)}>
          <span className="nesio-collapsed-kicker">{[dayTag, timeStr, countdown].filter(Boolean).join(' · ')}</span>
          <span className="nesio-collapsed-title">{obj.title}</span>
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
          {(() => {
            const desc = meaningfulDesc(obj.event.description);
            return desc ? <p className="nesio-collapsed-desc">{desc.slice(0, 80)}{desc.length > 80 ? '…' : ''}</p> : null;
          })()}
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

