'use client';

/**
 * TodayFocusSection — 今日聚焦区:Attention Engine 排序的日历/任务卡、
 * 置顶卡、折叠列表、休眠复访卡、夜间时间线。从 TodayFeed 拆出。
 *
 * 行数说明(工程 PRD >300 需解释):本文件 ~670 行,是聚焦区强耦合簇
 * (Section 编排 + 5 种卡型共享 expand/done/snooze 状态机)。下一步拆分
 * 方向:DormantReviewCard 与 NightTimeline 可独立(各自无共享状态)。
 */

import { useEffect, useRef, useState } from 'react';
import { focusTimeHint, markFocusNodeDone, addCommitmentNode, addMeetingNotes, saveSubtasks, toggleSubtask, type FocusNode, type SubTask, type ProactiveContextItem } from '@/lib/platform/view-models/today-view-model';
import type { CalendarEvent } from '@/lib/portal/types';
import { scoreCalendarEvents, selectPinned, EVENT_TYPE_ICON, EVENT_TYPE_LABEL, type AttentionObject } from '@/lib/platform/attention-engine';
import {
  loadDormantStore, evaluateDormancy, selectReviewCandidate, applyReviewAction,
  touchNode, getReviewTier,
  type DormantStore, type DormantCandidate,
} from '@/lib/platform/dormant-engine';
import { isMeetingNode, getMeetingTime, safeExternalUrl } from './meeting-node';
import { FocusCardDetail, FOCUS_TYPE_ICON } from './FocusCardDetail';
import { MeetingRecorderSheet } from './FocusModeSheet';
import MemoryFlashBanner, { useMemoryFlash } from '../MemoryFlashBanner';

// ---- Calendar item helpers ----

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

function isDayToday(dateStr: string): boolean {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const d = new Date(dateStr);
  return d >= today && d < tomorrow;
}

function isDayTomorrow(dateStr: string): boolean {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dayAfter = new Date(tomorrow); dayAfter.setDate(tomorrow.getDate() + 1);
  const d = new Date(dateStr);
  return d >= tomorrow && d < dayAfter;
}

function CalendarItemCard({
  event,
  onOpenRecorder,
}: {
  event: CalendarEvent;
  onOpenRecorder?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const startDate = new Date(event.start);
  const timeStr = formatEventTime(event.start, event.allDay);
  const countdown = calendarCountdown(startDate, event.allDay);
  const dayLabel = isDayToday(event.start) ? '今天' : isDayTomorrow(event.start) ? '明天' : null;
  const meetingUrl = event.url ? safeExternalUrl(event.url) : null;
  const isNow = countdown.startsWith('进行中');

  function handleGenerateNote() {
    const body = [
      `📅 ${event.title}`,
      `时间：${timeStr}${dayLabel ? ' · ' + dayLabel : ''}`,
      event.location ? `地点：${event.location}` : '',
      event.description ? `\n简介：${event.description}` : '',
    ].filter(Boolean).join('\n');
    addMeetingNotes(event.id, event.title, body);
  }

  return (
    <div className={`nesio-focus-card${expanded ? ' nesio-focus-card--expanded' : ''}${isNow ? ' nesio-focus-card--now' : ''}`}>
      <button
        type="button"
        className="nesio-focus-card-body nesio-focus-card-body--tap"
        onClick={() => setExpanded((v) => !v)}
      >
        <p className="nesio-focus-card-title">
          <span className="nesio-focus-card-type-icon">📅</span>
          {event.title}
        </p>
        <p className="nesio-focus-card-meta">
          {dayLabel && <span className="nesio-focus-day-label">{dayLabel}</span>}
          {timeStr !== '全天' && <span>{timeStr}</span>}
          {countdown && (
            <span className={`nesio-focus-meeting-badge${isNow ? ' nesio-focus-meeting-badge--now' : ''}`}>
              {countdown}
            </span>
          )}
        </p>
      </button>

      {expanded && (
        <div className="nesio-focus-detail nesio-focus-detail--meeting">
          {event.description && (
            <p className="nesio-focus-cal-desc">{event.description}</p>
          )}
          {event.location && (
            <p className="nesio-focus-cal-location">📍 {event.location}</p>
          )}
          <div className="nesio-focus-meeting-actions">
            {meetingUrl && (
              <a href={meetingUrl} target="_blank" rel="noopener noreferrer" className="nesio-focus-meeting-link-btn">
                🔗 进入会议
              </a>
            )}
            {onOpenRecorder && (
              <button type="button" className="nesio-focus-meeting-record-btn" onClick={onOpenRecorder}>
                🎙 会议记录
              </button>
            )}
            <button type="button" className="nesio-focus-meeting-record-btn" onClick={handleGenerateNote}>
              📝 生成笔记
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TomorrowEventsGroup({
  events,
  onOpenRecorder,
}: {
  events: CalendarEvent[];
  onOpenRecorder: (e: CalendarEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="nesio-focus-tomorrow-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        明天 · {events.length} 项{expanded ? '  ↑' : '  ↓'}
      </button>
      {expanded && events.map((event) => (
        <CalendarItemCard
          key={event.id}
          event={event}
          onOpenRecorder={() => onOpenRecorder(event)}
        />
      ))}
    </div>
  );
}

// ── Pinned card for a single must-not-miss calendar event ────────────────────

function PinnedAttentionCard({
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

function CollapsedCalItem({ obj, onOpenRecorder }: { obj: AttentionObject; onOpenRecorder: () => void }) {
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

function CollapsedTaskItem({
  node,
  doneIds,
  onDone,
  onDismiss,
  onOpenRecorder,
  onFocusMode,
}: {
  node: FocusNode;
  doneIds: Set<string>;
  onDone: (node: FocusNode) => void;
  onDismiss: (id: string) => void;
  onOpenRecorder?: () => void;
  onFocusMode?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDone = doneIds.has(node.id);
  const isMeeting = isMeetingNode(node);
  const typeIcon = isMeeting ? '📅' : (FOCUS_TYPE_ICON[node.type] || '📋');
  const hint = focusTimeHint(node);

  return (
    <li className={`nesio-collapsed-item${isDone ? ' nesio-collapsed-item--done' : ''}`}>
      <div className="nesio-collapsed-row">
        <button
          type="button"
          className={`nesio-collapsed-check${isDone ? ' nesio-collapsed-check--done' : ''}`}
          onClick={() => onDone(node)}
          aria-label="完成"
        />
        <button type="button" className="nesio-collapsed-task-body" onClick={() => { setExpanded((v) => !v); touchNode(node.id); }}>
          <span className="nesio-collapsed-icon">{typeIcon}</span>
          <span className="nesio-collapsed-title">{node.name}</span>
          {hint && <span className="nesio-collapsed-time">{hint}</span>}
        </button>
        <button type="button" className="nesio-collapsed-dismiss" onClick={() => onDismiss(node.id)} aria-label="忽略">✕</button>
      </div>
      {expanded && (
        <div className="nesio-collapsed-detail">
          <FocusCardDetail
            node={node}
            onSubtasksChange={() => {}}
            onOpenRecorder={isMeeting && onOpenRecorder ? onOpenRecorder : undefined}
          />
          {onFocusMode && (
            <button type="button" className="nesio-collapsed-focus-btn" onClick={onFocusMode}>◎ 聚焦</button>
          )}
        </div>
      )}
    </li>
  );
}

// ── Today Focus Section — Attention Engine v1 ─────────────────────────────────

function DormantReviewCard({
  candidate,
  onDo,
  onSnooze,
  onArchive,
  onFinalize,
}: {
  candidate: DormantCandidate;
  onDo: () => void;
  onSnooze: () => void;
  onArchive: () => void;
  onFinalize: () => void;
}) {
  const { node, kind, rec } = candidate;
  const name = node.name.length > 22 ? node.name.slice(0, 22) + '…' : node.name;
  const tier = getReviewTier(rec.snoozeCount);

  // ── 软归档复活 ──────────────────────────────────────────────────────────────
  if (kind === 'soft-archive') {
    return (
      <li className="nesio-collapsed-item nesio-dormant-card nesio-dormant-card--soft-archive">
        <div className="nesio-collapsed-row">
          <span className="nesio-collapsed-icon">🕊️</span>
          <div className="nesio-dormant-content">
            <span className="nesio-dormant-question">你曾经放下了这件事</span>
            <span className="nesio-collapsed-title">{name}</span>
          </div>
        </div>
        <div className="nesio-collapsed-overdue-actions">
          <button type="button" onClick={onDo}>重新拾起</button>
          <button type="button" className="nesio-dormant-btn--primary" onClick={onFinalize}>彻底告别</button>
        </div>
      </li>
    );
  }

  // ── 过期有日期任务 ───────────────────────────────────────────────────────────
  if (kind === 'overdue') {
    const dueDateStr = rec.originalDueDate
      ? new Date(rec.originalDueDate).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
      : null;
    return (
      <li className="nesio-collapsed-item nesio-dormant-card nesio-dormant-card--overdue">
        <div className="nesio-collapsed-row">
          <span className="nesio-collapsed-icon">⏰</span>
          <div className="nesio-dormant-content">
            <span className="nesio-dormant-question">
              {dueDateStr ? `截止日（${dueDateStr}）已过，还想继续吗？` : '截止日期已过，还想继续吗？'}
            </span>
            <span className="nesio-collapsed-title">{name}</span>
          </div>
        </div>
        <div className="nesio-collapsed-overdue-actions">
          <button type="button" onClick={onDo}>还是要做</button>
          <button type="button" onClick={onSnooze}>以后再说</button>
          <button type="button" onClick={onArchive}>放下</button>
        </div>
      </li>
    );
  }

  // ── 普通休眠任务（带升级提示） ───────────────────────────────────────────────
  const question =
    tier === 'letting-go'   ? `已经搁置 ${rec.snoozeCount} 次了，建议为它做个决定` :
    tier === 'gentle-nudge' ? `已经搁置 ${rec.snoozeCount} 次了，这件事还是你的吗？` :
                              '这个还属于你吗？';

  return (
    <li className={`nesio-collapsed-item nesio-dormant-card${tier === 'letting-go' ? ' nesio-dormant-card--letting-go' : ''}`}>
      <div className="nesio-collapsed-row">
        <span className="nesio-collapsed-icon">🌿</span>
        <div className="nesio-dormant-content">
          <span className="nesio-dormant-question">{question}</span>
          <span className="nesio-collapsed-title">{name}</span>
        </div>
      </div>
      <div className="nesio-collapsed-overdue-actions">
        {tier === 'letting-go' ? (
          // 5次以上：放下变主按钮
          <>
            <button type="button" className="nesio-dormant-btn--primary" onClick={onArchive}>放下</button>
            <button type="button" onClick={onSnooze}>再等等</button>
            <button type="button" onClick={onDo}>现在做</button>
          </>
        ) : (
          <>
            <button type="button" onClick={onDo}>现在做</button>
            <button type="button" onClick={onSnooze}>以后再说</button>
            <button type="button" onClick={onArchive}>放下</button>
          </>
        )}
      </div>
    </li>
  );
}

export function TodayFocusSection({
  focusNodes,
  calendarEvents,
  specialDays,
  allNodes: allNodesProp,
  dormantStore: dormantStoreProp,
  onSetDormantStore,
  onOpenMemory,
  onOpenRecorder,
  onFocusMode,
}: {
  focusNodes: readonly FocusNode[];
  calendarEvents: CalendarEvent[];
  specialDays: ProactiveContextItem[];
  allNodes: readonly FocusNode[];
  dormantStore: DormantStore;
  onSetDormantStore: (s: DormantStore) => void;
  onOpenMemory?: () => void;
  onOpenRecorder?: (node: FocusNode) => void;
  onFocusMode?: (node: FocusNode) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(true);
  const [quickAdd, setQuickAdd] = useState('');
  const [localNodes, setLocalNodes] = useState<FocusNode[]>([]);
  const [calRecorderEvent, setCalRecorderEvent] = useState<CalendarEvent | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { flashNodes, triggerFlash, dismiss: dismissFlash } = useMemoryFlash();

  // ── Attention Engine: score calendar events ──
  const now = new Date();
  const scored = scoreCalendarEvents(calendarEvents, now);
  const pinned = selectPinned(scored);
  const rest = scored.filter((o) => o.id !== pinned?.id);

  // ── Task nodes ──
  const allNodes = [...localNodes, ...focusNodes.filter((n) => !localNodes.some((l) => l.id === n.id))];
  const taskNodes = allNodes.filter((n) => !dismissed.has(n.id) && n.type !== 'event' && !doneIds.has(n.id));

  // ── Special days (today / tomorrow) ──
  const nearSpecialDays = specialDays.filter((d) => d.daysUntil <= 1);

  // ── Dormant: one review card per day ──
  const [dormantDismissed, setDormantDismissed] = useState<Set<string>>(new Set());
  const dormantCandidate: DormantCandidate | null = selectReviewCandidate(allNodesProp, dormantStoreProp);
  const showDormant = dormantCandidate && !dormantDismissed.has(dormantCandidate.node.id);

  const collapsedCount = rest.length + taskNodes.length + nearSpecialDays.length + (showDormant ? 1 : 0);
  const dormantNodeId = dormantCandidate?.node.id;
  const isEmpty = !pinned && collapsedCount === 0;

  const doneToday = doneIds.size;

  function handleDone(node: FocusNode) {
    setDoneIds((prev) => { const next = new Set(prev); next.add(node.id); return next; });
    setTimeout(() => markFocusNodeDone(node.id), 600);
  }

  function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = quickAdd.trim();
    if (!name) return;
    const node = addCommitmentNode(name);
    setLocalNodes((prev) => [node, ...prev]);
    setQuickAdd('');
    setCollapsed(false);
    inputRef.current?.blur();
    triggerFlash({ id: node.id, name: node.name });
  }

  return (
    <div className="nesio-focus-section">
      <MemoryFlashBanner nodes={flashNodes} onDismiss={dismissFlash} />

      <div className="nesio-focus-header">
        <h2 className="nesio-focus-title">今日焦点</h2>
        <div className="nesio-focus-header-right">
          {doneToday > 0 && <span className="nesio-focus-done-badge">✓ {doneToday}</span>}
          {onOpenMemory && (
            <button type="button" className="nesio-focus-all-btn" onClick={onOpenMemory}>全部 ›</button>
          )}
        </div>
      </div>

      {isEmpty ? (
        <div className="nesio-focus-empty">
          <p>今天暂无聚焦事项</p>
          <p className="nesio-focus-empty-hint">{'说一句带时间的话（比如"周五有会议"），就会出现在这里。'}</p>
        </div>
      ) : (
        <div className="nesio-attention-layout">

          {/* ── Slot 1: Must Not Miss ── */}
          {pinned && (
            <PinnedAttentionCard
              obj={pinned}
              onOpenRecorder={() => setCalRecorderEvent(pinned.event)}
            />
          )}

          {/* ── Slot 2: 折叠区 ── */}
          {collapsedCount > 0 && (
            <div className="nesio-collapsed-section">
              <button
                type="button"
                className="nesio-collapsed-toggle"
                onClick={() => setCollapsed((v) => !v)}
                aria-expanded={!collapsed}
              >
                <span className="nesio-collapsed-toggle-label">
                  {collapsed ? `还有 ${collapsedCount} 项` : '收起'}
                </span>
                <span className="nesio-collapsed-toggle-chevron">{collapsed ? '▾' : '▴'}</span>
              </button>

              {!collapsed && (
                <ul className="nesio-collapsed-list">
                  {/* Calendar events (non-pinned) */}
                  {rest.map((obj) => (
                    <CollapsedCalItem
                      key={obj.id}
                      obj={obj}
                      onOpenRecorder={() => setCalRecorderEvent(obj.event)}
                    />
                  ))}

                  {/* Special days */}
                  {nearSpecialDays.map((item) => (
                    <li key={item.nodeId} className="nesio-collapsed-item">
                      <div className="nesio-collapsed-row">
                        <span className="nesio-collapsed-icon">🎂</span>
                        <span className="nesio-collapsed-title">{item.name}</span>
                        <span className="nesio-collapsed-day-tag">{item.daysUntil === 0 ? '今天' : '明天'}</span>
                      </div>
                    </li>
                  ))}

                  {/* Task nodes */}
                  {taskNodes.map((node) => (
                    <CollapsedTaskItem
                      key={node.id}
                      node={node}
                      doneIds={doneIds}
                      onDone={handleDone}
                      onDismiss={(id) => setDismissed((prev) => { const next = new Set(prev); next.add(id); return next; })}
                      onOpenRecorder={onOpenRecorder ? () => onOpenRecorder(node) : undefined}
                      onFocusMode={onFocusMode ? () => onFocusMode(node) : undefined}
                    />
                  ))}

                  {/* Dormant 任务判断卡 */}
                  {showDormant && dormantCandidate && dormantNodeId && (
                    <DormantReviewCard
                      candidate={dormantCandidate}
                      onDo={() => {
                        const next = applyReviewAction(dormantNodeId, 'do');
                        onSetDormantStore(next);
                        setDormantDismissed((p) => { const n = new Set(p); n.add(dormantNodeId); return n; });
                        if (dormantCandidate.kind !== 'soft-archive') {
                          onFocusMode?.(dormantCandidate.node);
                        }
                      }}
                      onSnooze={() => {
                        const next = applyReviewAction(dormantNodeId, 'snooze');
                        onSetDormantStore(next);
                        setDormantDismissed((p) => { const n = new Set(p); n.add(dormantNodeId); return n; });
                      }}
                      onArchive={() => {
                        const next = applyReviewAction(dormantNodeId, 'archive');
                        onSetDormantStore(next);
                        setDormantDismissed((p) => { const n = new Set(p); n.add(dormantNodeId); return n; });
                      }}
                      onFinalize={() => {
                        const next = applyReviewAction(dormantNodeId, 'finalize');
                        onSetDormantStore(next);
                        setDormantDismissed((p) => { const n = new Set(p); n.add(dormantNodeId); return n; });
                      }}
                    />
                  )}
                </ul>
              )}
            </div>
          )}

        </div>
      )}

      <form className="nesio-focus-quick-add" onSubmit={handleQuickAdd}>
        <input
          ref={inputRef}
          className="nesio-focus-quick-input"
          type="text"
          placeholder="今天要做…"
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
        />
        {quickAdd.trim() && (
          <button type="submit" className="nesio-focus-quick-btn">记下</button>
        )}
      </form>

      {/* Calendar event meeting recorder */}
      <MeetingRecorderSheet
        open={calRecorderEvent !== null}
        meetingNode={calRecorderEvent ? {
          id: calRecorderEvent.id,
          name: calRecorderEvent.title,
          type: 'event',
          attributes: {},
          subtasks: [],
          createdAt: calRecorderEvent.start,
        } : null}
        onClose={() => setCalRecorderEvent(null)}
      />
    </div>
  );
}

// ---- Night timeline ----

export function NightTimeline() {
  return (
    <div className="nesio-today-night">
      <div className="nesio-today-night-hero">
        <p className="nesio-today-night-kicker">此刻 · 把你带回今天</p>
        <h2 className="nesio-today-night-title">先放进来一件事<br />以后就找得到</h2>
        <p className="nesio-today-night-sub">说一句、拍一下，Nesio 会帮你留到以后找得到。</p>
        <div className="nesio-today-night-actions">
          <span className="nesio-today-night-conf">● 建议确认</span>
          <button type="button" className="nesio-today-btn nesio-today-btn--night">好的</button>
        </div>
      </div>
      <div className="nesio-today-night-timeline">
        <p className="nesio-today-night-timeline-label">今晚的路径</p>
        <ol className="nesio-today-night-steps">
          {[
            { time: '现在', label: '记录一件真实小事', active: true },
            { time: '明早', label: '基于记录生成提醒', active: false },
            { time: '之后', label: '你反馈后逐步调整', active: false },
          ].map((step, i) => (
            <li key={i} className={`nesio-today-night-step${step.active ? ' nesio-today-night-step--active' : ''}`}>
              <span className="nesio-today-night-step-dot" />
              <span className="nesio-today-night-step-time">{step.time}</span>
              <span className="nesio-today-night-step-label">{step.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

