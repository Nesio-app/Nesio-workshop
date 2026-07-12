'use client';

/**
 * TodayFocusSection — 今日聚焦区编排:Attention Engine 评分、置顶卡、
 * 折叠列表、快速添加。卡型组件在同目录:CalendarCards(日历簇)、
 * DormantReviewCard(休眠复访)、NightTimeline(夜间空状态)。
 */

import { arbitrateTodayPresence } from '@/lib/platform/today-arbiter';
import { useEffect, useState, type RefObject } from 'react';
import { focusTimeHint, localDayKey, markFocusNodeDone, type FocusNode, type ProactiveContextItem } from '@/lib/platform/view-models/today-view-model';
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
import MoodBeat from '../MoodBeat';
import { t, L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconCalendar, IconGift, IconNote, IconMic } from '../icons';

function CollapsedTaskItem({
  node,
  doneIds,
  onDone,
  onDismiss,
  onDeleteNode,
  onOpenRecorder,
  onFocusMode,
}: {
  node: FocusNode;
  doneIds: Set<string>;
  onDone: (node: FocusNode) => void;
  onDismiss: (id: string) => void;
  onDeleteNode?: (id: string) => void;
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
          {/* 批次 107→108:时间线节点 —— 时标作 kicker 在标题上方(现在/今晚/稍后) */}
          {hint && <span className="nesio-collapsed-kicker">{hint}</span>}
          <span className="nesio-collapsed-title">{node.name}</span>
        </button>
        {/* 批次 39:✕ 撤除(用户指令)—— 完成圈/左滑已够 */}
      </div>
      {expanded && (
        <div className="nesio-collapsed-detail">
          <FocusCardDetail
            node={node}
            onSubtasksChange={() => {}}
            onOpenRecorder={isMeeting && onOpenRecorder ? onOpenRecorder : undefined}
            onFocusMode={onFocusMode}
            focusModeLabel={t(locale, 'todayFocusModeBtn')}
            onDelete={onDeleteNode ? () => { setExpanded(false); onDeleteNode(node.id); } : undefined}
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
  guidanceNodeIds,
  onPinnedResolved,
  onSetDormantStore,
  onOpenMemory,
  onOpenRecorder,
  onFocusMode,
  onDeleteNode,
  capture,
}: {
  focusNodes: readonly FocusNode[];
  calendarEvents: CalendarEvent[];
  specialDays: ProactiveContextItem[];
  allNodes: readonly FocusNode[];
  dormantStore: DormantStore;
  /** 引导卡认领的节点 id(统一仲裁用) */
  guidanceNodeIds?: readonly string[];
  /** 置顶裁决回传(TodayFeed 据此隐藏被抢占的引导卡) */
  onPinnedResolved?: (id: string | null) => void;
  onSetDormantStore: (s: DormantStore) => void;
  onOpenMemory?: () => void;
  onOpenRecorder?: (node: FocusNode) => void;
  onFocusMode?: (node: FocusNode) => void;
  /** 真·删除焦点节点(经命令层 deleteFocusNode);今日表面不直连 life-graph。 */
  onDeleteNode?: (id: string) => void;
  /** 批次 132:记一笔·话筒节点内联输入(逻辑在 TodayFeed,这里只渲染)。删了底部输入栏。 */
  capture?: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    onMic: () => void;
    recording: boolean;
    inputRef: RefObject<HTMLInputElement | null>;
  };
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissedToday());
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(true);
  const [localNodes, setLocalNodes] = useState<FocusNode[]>([]);
  const [calRecorderEvent, setCalRecorderEvent] = useState<CalendarEvent | null>(null);
  const locale = usePortalLocale();
  const { flashNodes, dismiss: dismissFlash } = useMemoryFlash();

  // ── Attention Engine: score calendar events ──
  const now = new Date();
  const scored = scoreCalendarEvents(calendarEvents, now);
  const pinned = selectPinned(scored);
  const rest = scored.filter((o) => o.id !== pinned?.id);

  // ── Dormant: one review card per day(先选,交给统一仲裁器排重)──
  const [dormantDismissed, setDormantDismissed] = useState<Set<string>>(new Set());
  const dormantCandidate: DormantCandidate | null = selectReviewCandidate(allNodesProp, dormantStoreProp);

  // ── 统一仲裁(架构审查 #2):同一节点只在一个槽位出现,优先级 置顶>复访>引导卡>列表 ──
  const allNodes = [...localNodes, ...focusNodes.filter((n) => !localNodes.some((l) => l.id === n.id))];
  // 批次 51:event 型此前整类排除(日历事件走 CalendarCards 渠道)—— 但邮件/照片/
  // 日历生成的记忆多是 event 型,长按「加入今日焦点」钉进来的必须放行,
  // 否则只有文字 note(commitment 型)钉得进来(用户实测抓出)。
  const rawTaskNodes = allNodes.filter((n) =>
    !dismissed.has(n.id) && !doneIds.has(n.id)
    && (n.type !== 'event' || n.attributes.focusPinnedOn === localDayKey()));
  const verdict = arbitrateTodayPresence({
    pinnedId: pinned?.id ?? null,
    dormantCandidateId: dormantCandidate?.node.id ?? null,
    taskIds: rawTaskNodes.map((n) => n.id),
    guidanceClaims: guidanceNodeIds ?? [],
  });
  const taskNodes = rawTaskNodes.filter((n) => verdict.taskIds.includes(n.id));

  // 置顶结果回传组合根(TodayFeed 隐藏被置顶抢占的引导卡)
  const pinnedIdForReport = pinned?.id ?? null;
  useEffect(() => { onPinnedResolved?.(pinnedIdForReport); }, [pinnedIdForReport, onPinnedResolved]);

  // ── Special days (today / tomorrow) ──
  const nearSpecialDays = specialDays.filter((d) => d.daysUntil <= 1);

  const showDormant = verdict.showDormant && dormantCandidate && !dormantDismissed.has(dormantCandidate.node.id);

  const collapsedCount = rest.length + taskNodes.length + nearSpecialDays.length + (showDormant ? 1 : 0);
  const dormantNodeId = dormantCandidate?.node.id;
  const isEmpty = !pinned && collapsedCount === 0;

  const doneToday = doneIds.size;

  function handleDone(node: FocusNode) {
    setDoneIds((prev) => { const next = new Set(prev); next.add(node.id); return next; });
    setTimeout(() => markFocusNodeDone(node.id), 600);
  }

  // 批次 32:今日聚焦「至多显示一个」—— 有置顶卡时它就是那一个,折叠区全收进「还有 N 项」;
  // 没置顶卡时露出最靠前的一条(至少一个、至多一个),其余折叠。
  const collapsedNodes: React.ReactNode[] = [
    ...rest.map((obj) => (
      <CollapsedCalItem key={obj.id} obj={obj} onOpenRecorder={() => setCalRecorderEvent(obj.event)} />
    )),
    ...nearSpecialDays.map((item) => (
      <li key={item.nodeId} className="nesio-collapsed-item">
        {/* 批次 111:纪念日也做成时间线节点(圆点在轨上 + 日期 kicker) */}
        <div className="nesio-collapsed-row">
          {/* 批次 129:纪念日节点圆内嵌礼物符号 */}
          <span className="nesio-collapsed-dot nesio-collapsed-dot--clock" aria-hidden><IconGift size={13} /></span>
          <span className="nesio-collapsed-task-body">
            <span className="nesio-collapsed-kicker">{item.daysUntil === 0 ? t(locale, 'todayLabelToday') : t(locale, 'todayLabelTomorrow')}</span>
            <span className="nesio-collapsed-title">{item.name}</span>
          </span>
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
        onDeleteNode={onDeleteNode}
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
  // 批次 117(用户定「除心情最多显示 2 个」):时间线心情 + 至多 2 个要紧事,
  // 置顶卡算 1 个(有置顶卡则折叠区只露 1)。多出来的收成「稍后 · 还有 N 件」+ 号节点。
  const CAP = pinned ? 1 : 2;
  const shownNodes = collapsedNodes.slice(0, CAP);
  const restCount = collapsedNodes.length - shownNodes.length;
  const dict = portalLocaleToDictionaryLocale(locale);

  return (
    <div className="nesio-focus-section">
      <MemoryFlashBanner nodes={flashNodes} onDismiss={dismissFlash} />

      <div className="nesio-focus-header">
        <h2 className="nesio-focus-title">
          {t(locale, 'todayFocusTitle')}
          <span className="nesio-focus-subtitle"> · {t(locale, 'todayFocusSubtitle')}</span>
        </h2>
        <div className="nesio-focus-header-right">
          {doneToday > 0 && <span className="nesio-focus-done-badge">✓ {doneToday}</span>}
          {onOpenMemory && (
            <button type="button" className="nesio-focus-all-btn" onClick={onOpenMemory}>{t(locale, 'todayFocusAll')}</button>
          )}
        </div>
      </div>

      {/* 批次 107:时间线 —— 心情作「现在」第一拍 + 竖轨串起下面的要紧事(设计规范今天页) */}
      <div className="nesio-focus-timeline">
        <MoodBeat />
        {isEmpty ? (
          <div className="nesio-focus-empty nesio-focus-empty--tl">
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

          {/* ── Slot 2: 时间线要紧事 —— 批次 139:「还有 N 件小事」就地展开/收起(复活折叠事件,
                此前 onClick 跳记忆页、collapsed state 成孤儿,点了没有折叠反应)。去记忆页仍走顶部「全部」。 */}
          {collapsedNodes.length > 0 && (
            <div className="nesio-collapsed-section">
              <ul className="nesio-collapsed-list">{collapsed ? shownNodes : collapsedNodes}</ul>
              {restCount > 0 && (
                <button
                  type="button"
                  className="nesio-collapsed-row nesio-tl-more"
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsed((v) => !v)}
                >
                  <span className="nesio-collapsed-dot nesio-tl-more-plus" aria-hidden>{collapsed ? '…' : '−'}</span>
                  <span className="nesio-collapsed-task-body">
                    <span className="nesio-collapsed-kicker">{collapsed ? L(dict, '稍后', 'Later') : L(dict, '摊开了', 'Expanded')}</span>
                    <span className="nesio-collapsed-title">{collapsed ? L(dict, `还有 ${restCount} 件小事`, `${restCount} more small things`) : L(dict, '收起', 'Collapse')}</span>
                    <span className="nesio-tl-more-sub">{collapsed ? L(dict, '点开看看,我先替你收着 ›', "Tap to see them — I've kept them ›") : L(dict, '收回折叠', 'Fold back')}</span>
                  </span>
                </button>
              )}
            </div>
          )}

        </div>
        )}

        {/* 批次 128→132·记一笔·话筒常驻末节点(虚线草稿位)= 唯一极简输入入口(底部输入栏已删)。
            点话筒=原地录音(实时转文字写进这里)、点文字直接打字,都内联不跳页。回车 → 生成一条实线节点。 */}
        {capture && (
          <div className={`nesio-tl-capture${capture.recording ? ' nesio-tl-capture--rec' : ''}`}>
            <button
              type="button"
              className="nesio-tl-capture-mic"
              aria-label={capture.recording ? L(dict, '说完了,点击保存', 'Done — tap to save') : L(dict, '说一句', 'Say something')}
              onClick={capture.onMic}
            >
              <IconMic size={13} />
            </button>
            <form
              className="nesio-tl-capture-form"
              onSubmit={(e) => { e.preventDefault(); capture.onSubmit(); }}
            >
              <input
                ref={capture.inputRef}
                className="nesio-tl-capture-input"
                type="text"
                value={capture.value}
                onChange={(e) => capture.onChange(e.target.value)}
                placeholder={L(dict, '点话筒说一句,或记一下…', 'Tap the mic to speak, or jot…')}
              />
            </form>
          </div>
        )}
      </div>

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


