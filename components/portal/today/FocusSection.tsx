'use client';

/**
 * TodayFocusSection — 今日聚焦区编排:Attention Engine 评分、置顶卡、
 * 折叠列表、快速添加。卡型组件在同目录:CalendarCards(日历簇)、
 * DormantReviewCard(休眠复访)、NightTimeline(夜间空状态)。
 */

import { useRef, useState } from 'react';
import { focusTimeHint, markFocusNodeDone, addCommitmentNode, type FocusNode, type ProactiveContextItem } from '@/lib/platform/view-models/today-view-model';
import type { CalendarEvent } from '@/lib/portal/types';
import { scoreCalendarEvents, selectPinned } from '@/lib/platform/attention-engine';
import {
  selectReviewCandidate, applyReviewAction, touchNode,
  type DormantStore, type DormantCandidate,
} from '@/lib/platform/dormant-engine';
import { DormantReviewCard } from './DormantReviewCard';
import { PinnedAttentionCard, CollapsedCalItem } from './CalendarCards';
import { isMeetingNode } from './meeting-node';
import { FocusCardDetail, FOCUS_TYPE_ICON } from './FocusCardDetail';
import { MeetingRecorderSheet } from './MeetingRecorderSheet';
import MemoryFlashBanner, { useMemoryFlash } from '../MemoryFlashBanner';
import { t } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconCalendar, IconGift, IconNote } from '../icons';

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
  const locale = usePortalLocale();
  const [expanded, setExpanded] = useState(false);
  const isDone = doneIds.has(node.id);
  const isMeeting = isMeetingNode(node);
  const hint = focusTimeHint(node, portalLocaleToDictionaryLocale(locale));

  return (
    <li className={`nesio-collapsed-item${isDone ? ' nesio-collapsed-item--done' : ''}`}>
      <div className="nesio-collapsed-row">
        <button
          type="button"
          className={`nesio-collapsed-check${isDone ? ' nesio-collapsed-check--done' : ''}`}
          onClick={() => onDone(node)}
          aria-label={t(locale, 'todayDoneAria')}
        />
        <button type="button" className="nesio-collapsed-task-body" onClick={() => { setExpanded((v) => !v); touchNode(node.id); }}>
          {/* 批次 13:类型小图标(旗子等)按用户要求移除,行内只留标题 */}
          <span className="nesio-collapsed-title">{node.name}</span>
          {hint && <span className="nesio-collapsed-time">{hint}</span>}
        </button>
        <button type="button" className="nesio-collapsed-dismiss" onClick={() => onDismiss(node.id)} aria-label={t(locale, 'todayDismissAria')}>✕</button>
      </div>
      {expanded && (
        <div className="nesio-collapsed-detail">
          <FocusCardDetail
            node={node}
            onSubtasksChange={() => {}}
            onOpenRecorder={isMeeting && onOpenRecorder ? onOpenRecorder : undefined}
            onFocusMode={onFocusMode}
            focusModeLabel={t(locale, 'todayFocusModeBtn')}
          />
        </div>
      )}
    </li>
  );
}

// 批次 29:消除的焦点项要留得住 —— 之前 dismissed 只在内存,重新挂载/刷新就全回来了。
// 按当天持久化;次日自然复活(焦点本就是每日的)。
const FOCUS_DISMISS_KEY = 'nesio-focus-dismissed-v1';
function todayStr() { return new Date().toISOString().slice(0, 10); }
function loadDismissedToday(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const d = JSON.parse(localStorage.getItem(FOCUS_DISMISS_KEY) || '{}') as { date?: string; ids?: string[] };
    return d.date === todayStr() && Array.isArray(d.ids) ? new Set(d.ids) : new Set();
  } catch { return new Set(); }
}
function persistDismissed(ids: Set<string>) {
  try { localStorage.setItem(FOCUS_DISMISS_KEY, JSON.stringify({ date: todayStr(), ids: [...ids] })); } catch { /* ignore */ }
}

// ── Today Focus Section — Attention Engine v1 ─────────────────────────────────

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
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissedToday());
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(true);
  const [quickAdd, setQuickAdd] = useState('');
  const [localNodes, setLocalNodes] = useState<FocusNode[]>([]);
  const [calRecorderEvent, setCalRecorderEvent] = useState<CalendarEvent | null>(null);
  const locale = usePortalLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const { flashNodes, triggerFlash, dismiss: dismissFlash } = useMemoryFlash();

  // ── Attention Engine: score calendar events ──
  const now = new Date();
  const scored = scoreCalendarEvents(calendarEvents, now);
  const pinned = selectPinned(scored);
  const rest = scored.filter((o) => o.id !== pinned?.id);

  // ── Dormant: one review card per day(先选,任务列表要据此排重)──
  const [dormantDismissed, setDormantDismissed] = useState<Set<string>>(new Set());
  const dormantCandidate: DormantCandidate | null = selectReviewCandidate(allNodesProp, dormantStoreProp);

  // ── Task nodes ──
  // 架构审查 D4:单门防重出现 —— 进了复访卡的节点不再同时出现在任务列表
  //(四套选择系统交汇处的唯一 presence 守卫)。
  const allNodes = [...localNodes, ...focusNodes.filter((n) => !localNodes.some((l) => l.id === n.id))];
  const taskNodes = allNodes.filter((n) => !dismissed.has(n.id) && n.type !== 'event' && !doneIds.has(n.id) && n.id !== dormantCandidate?.node.id);

  // ── Special days (today / tomorrow) ──
  const nearSpecialDays = specialDays.filter((d) => d.daysUntil <= 1);

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

  // 批次 32:今日聚焦「至多显示一个」—— 有置顶卡时它就是那一个,折叠区全收进「还有 N 项」;
  // 没置顶卡时露出最靠前的一条(至少一个、至多一个),其余折叠。
  const collapsedNodes: React.ReactNode[] = [
    ...rest.map((obj) => (
      <CollapsedCalItem key={obj.id} obj={obj} onOpenRecorder={() => setCalRecorderEvent(obj.event)} />
    )),
    ...nearSpecialDays.map((item) => (
      <li key={item.nodeId} className="nesio-collapsed-item">
        <div className="nesio-collapsed-row">
          <span className="nesio-collapsed-icon"><IconGift size={15} /></span>
          <span className="nesio-collapsed-title">{item.name}</span>
          <span className="nesio-collapsed-day-tag">{item.daysUntil === 0 ? t(locale, 'todayLabelToday') : t(locale, 'todayLabelTomorrow')}</span>
        </div>
      </li>
    )),
    ...taskNodes.map((node) => (
      <CollapsedTaskItem
        key={node.id}
        node={node}
        doneIds={doneIds}
        onDone={handleDone}
        onDismiss={(id) => setDismissed((prev) => { const next = new Set(prev); next.add(id); persistDismissed(next); return next; })}
        onOpenRecorder={onOpenRecorder ? () => onOpenRecorder(node) : undefined}
        onFocusMode={onFocusMode ? () => onFocusMode(node) : undefined}
      />
    )),
    ...(showDormant && dormantCandidate && dormantNodeId ? [(
      <DormantReviewCard
        key="dormant"
        candidate={dormantCandidate}
        onDo={() => { const next = applyReviewAction(dormantNodeId, 'do'); onSetDormantStore(next); setDormantDismissed((p) => { const n = new Set(p); n.add(dormantNodeId); return n; }); if (dormantCandidate.kind !== 'soft-archive') onFocusMode?.(dormantCandidate.node); }}
        onSnooze={() => { const next = applyReviewAction(dormantNodeId, 'snooze'); onSetDormantStore(next); setDormantDismissed((p) => { const n = new Set(p); n.add(dormantNodeId); return n; }); }}
        onArchive={() => { const next = applyReviewAction(dormantNodeId, 'archive'); onSetDormantStore(next); setDormantDismissed((p) => { const n = new Set(p); n.add(dormantNodeId); return n; }); }}
        onFinalize={() => { const next = applyReviewAction(dormantNodeId, 'finalize'); onSetDormantStore(next); setDormantDismissed((p) => { const n = new Set(p); n.add(dormantNodeId); return n; }); }}
      />
    )] : []),
  ];
  const peekN = pinned ? 0 : 1;
  const peeked = collapsedNodes.slice(0, peekN);
  const hiddenNodes = collapsedNodes.slice(peekN);

  return (
    <div className="nesio-focus-section">
      <MemoryFlashBanner nodes={flashNodes} onDismiss={dismissFlash} />

      <div className="nesio-focus-header">
        <h2 className="nesio-focus-title">{t(locale, 'todayFocusTitle')}</h2>
        <div className="nesio-focus-header-right">
          {doneToday > 0 && <span className="nesio-focus-done-badge">✓ {doneToday}</span>}
          {onOpenMemory && (
            <button type="button" className="nesio-focus-all-btn" onClick={onOpenMemory}>{t(locale, 'todayFocusAll')}</button>
          )}
        </div>
      </div>

      {isEmpty ? (
        <div className="nesio-focus-empty">
          <p>{t(locale, 'todayFocusEmpty')}</p>
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

          {/* ── Slot 2: 折叠区(批次 32:至多露一条,其余收进「还有 N 项」)── */}
          {collapsedNodes.length > 0 && (
            <div className="nesio-collapsed-section">
              {peeked.length > 0 && <ul className="nesio-collapsed-list">{peeked}</ul>}
              {hiddenNodes.length > 0 && (
                <>
                  <button
                    type="button"
                    className="nesio-collapsed-toggle"
                    onClick={() => setCollapsed((v) => !v)}
                    aria-expanded={!collapsed}
                  >
                    <span className="nesio-collapsed-toggle-label">
                      {collapsed ? t(locale, 'todayCollapsedMoreTemplate', { count: hiddenNodes.length }) : t(locale, 'todayCollapse')}
                    </span>
                    <span className="nesio-collapsed-toggle-chevron">{collapsed ? '▾' : '▴'}</span>
                  </button>
                  {!collapsed && <ul className="nesio-collapsed-list">{hiddenNodes}</ul>}
                </>
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
          placeholder={t(locale, 'todayQuickAddPlaceholder')}
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
        />
        {quickAdd.trim() && (
          <button type="submit" className="nesio-focus-quick-btn">{t(locale, 'todayQuickAddSubmit')}</button>
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


