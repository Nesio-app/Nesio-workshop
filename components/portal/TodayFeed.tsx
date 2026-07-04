'use client';

import { useEffect, useRef, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { buildTodayViewModel, focusTimeHint, markFocusNodeDone, addCommitmentNode, addMeetingNotes, saveSubtasks, toggleSubtask, type FocusNode, type SubTask, type ProactiveContext, type ProactiveContextItem } from '@/lib/platform/view-models/today-view-model';
import { type RecommendationCard } from '@/lib/portal/reasoning-engine';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { CalendarEvent } from '@/lib/portal/types';
import { scoreCalendarEvents, selectPinned, EVENT_TYPE_ICON, EVENT_TYPE_LABEL, type AttentionObject } from '@/lib/platform/attention-engine';
import type { EmailSignal } from '@/lib/platform/email-signals';
import {
  loadDormantStore, evaluateDormancy, selectReviewCandidate, applyReviewAction,
  touchNode, getReviewTier,
  type DormantStore, type DormantCandidate,
} from '@/lib/platform/dormant-engine';
import { runGuidancePipeline } from '@/lib/platform/guidance-engine/guidance-pipeline';
import { getEnergyState } from '@/lib/platform/energy-state';
import { getBestInterruptionHours } from '@/lib/portal/mirror-profile';
import { loadCoolingStore, recordDismissed, saveCoolingStore } from '@/lib/platform/guidance-engine/cooling-store';
import {
  calendarEventsToGuidanceEvents,
  emailSignalsToGuidanceEvents,
  specialDaysToGuidanceEvents,
  focusNodesToGuidanceEvents,
  weatherToGuidanceEvents,
  healthNodesToGuidanceEvents,
  type WeatherSnapshot,
} from '@/lib/platform/guidance-engine/source-adapters';
import { cloudSignalRowsToSignals, type CloudSignalRow } from '@/lib/life-domain/signal-search';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import DailyBriefCard from './DailyBriefCard';
import dynamic from 'next/dynamic';
import { isMeetingNode, getMeetingTime, getMeetingUrl, safeExternalUrl } from './today/meeting-node';
import { FocusModeSheet, MeetingRecorderSheet } from './today/FocusModeSheet';

// 1143-line analytics sheet — load on open, not at boot
const InsightsSheet = dynamic(() => import('./InsightsSheet'), { ssr: false });
import MemoryFlashBanner, { useMemoryFlash } from './MemoryFlashBanner';
import WrappedCard, { useWrappedTrigger } from './WrappedCard';

// ---- Shared empty-state card ----

const EMPTY_SIGNAL_CARDS: RecommendationCard[] = [
  {
    id: 'needs-input-public',
    domain: 'home',
    domainLabel: '从一件小事开始',
    confidence: 0.6,
    urgency: 1,
    icon: '✦',
    iconBg: '#8b9cf6',
    title: '先放进来一件事就好',
    body: '说一句、拍一下，Nesio 会帮你留到以后找得到。',
    tags: ['本地优先 · 可确认'],
    evidence: [],
    primaryAction: '先记一件事',
    secondaryAction: '稍后',
    type: 'standard',
    expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
    sourceStatus: 'needs_input',
  },
];

// ---- Signal / card helpers ----

async function loadCloudSignals(canUsePrivateData: boolean) {
  if (!canUsePrivateData) return [];
  try {
    const response = await fetch('/api/cloud/signals?limit=80', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const data = await response.json() as { signals?: CloudSignalRow[] };
    return cloudSignalRowsToSignals(data.signals || []);
  } catch {
    return [];
  }
}

interface ProactiveAction {
  label: string;
  actionType: 'dismiss' | 'snooze' | 'done';
}

interface ProactiveCardData {
  id: string;
  title: string;
  body: string;
  confidence: number;
  sourceTags: string[];
  icon: string;
  priority: number;
  cardType?: string;
  nodeId?: string;
  actions?: ProactiveAction[];
  expiresAt?: string;  // ISO — card auto-hides after this time (Google Now lifecycle)
}

const EMAIL_SIGNALS_KEY = 'nesio-email-signals-cache';
const EMAIL_SIGNALS_TTL_MS = 20 * 60_000; // 20 minutes

async function loadEmailSignals(canUsePrivateData: boolean): Promise<EmailSignal[]> {
  if (!canUsePrivateData || typeof window === 'undefined') return [];
  try {
    const cached = localStorage.getItem(EMAIL_SIGNALS_KEY);
    if (cached) {
      const { ts, signals } = JSON.parse(cached) as { ts: number; signals: EmailSignal[] };
      if (Date.now() - ts < EMAIL_SIGNALS_TTL_MS) return signals;
    }
    const res = await fetch('/api/portal/gmail-quick', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json() as { ok?: boolean; signals?: EmailSignal[] };
    const signals = data.signals ?? [];
    localStorage.setItem(EMAIL_SIGNALS_KEY, JSON.stringify({ ts: Date.now(), signals }));
    return signals;
  } catch { return []; }
}

// Time-based fallback nudge — only shown when the guidance pipeline produces nothing
function buildTimeFallback(now: Date): ProactiveCardData | null {
  const dow = now.getDay();
  const hour = now.getHours();
  if (dow === 1 && hour < 11) {
    return { id: 'fallback-week-start', title: '新的一周从规划开始', body: '周一早上，把本周最重要的 3 件事先记下来。', confidence: 70, sourceTags: ['时间·周一'], icon: '🗓', priority: 5 };
  }
  if (dow === 5 && hour >= 15) {
    return { id: 'fallback-week-end', title: '本周还有什么没收尾？', body: '周五下午，快速过一遍本周待办，周末才能真正放松。', confidence: 70, sourceTags: ['时间·周五'], icon: '✅', priority: 5 };
  }
  if (hour >= 21) {
    return { id: 'fallback-evening', title: '今天有什么想记下来的？', body: '睡前花 30 秒，把今天的想法或待办存进来。', confidence: 65, sourceTags: ['时间·晚间'], icon: '🌙', priority: 4 };
  }
  return null;
}

const SNOOZE_KEY = 'nesio-snoozed-overdue';

function snoozeOverdue(nodeId: string, days: number) {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}');
    const until = new Date();
    until.setDate(until.getDate() + days);
    map[nodeId] = until.toISOString();
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

function ProactiveGuidanceCard({
  card, onDismiss, onMarkDone,
}: {
  card: ProactiveCardData;
  onDismiss: () => void;
  onMarkDone?: (nodeId: string) => void;
}) {
  const hasActions = card.actions && card.actions.length > 0;

  function handleAction(action: ProactiveAction) {
    if (action.actionType === 'dismiss') { onDismiss(); return; }
    if (action.actionType === 'snooze' && card.nodeId) {
      snoozeOverdue(card.nodeId, 7);
      onDismiss();
      return;
    }
    if (action.actionType === 'done' && card.nodeId) {
      onMarkDone?.(card.nodeId);
      onDismiss();
    }
  }

  return (
    <div className="nesio-proactive-card">
      <div className="nesio-proactive-card-inner">
        <span className="nesio-proactive-card-icon">{card.icon}</span>
        <div className="nesio-proactive-card-text">
          <p className="nesio-proactive-card-title">{card.title}</p>
          <p className="nesio-proactive-card-body">{card.body}</p>
          {card.sourceTags.length > 0 && (
            <div className="nesio-proactive-card-tags">
              {card.sourceTags.map((tag) => (
                <span key={tag} className="nesio-proactive-card-tag">{tag}</span>
              ))}
            </div>
          )}
          {hasActions && (
            <div className="nesio-proactive-card-actions">
              {card.actions!.map((a) => (
                <button
                  key={a.actionType}
                  type="button"
                  className={`nesio-proactive-action-btn nesio-proactive-action-btn--${a.actionType}`}
                  onClick={() => handleAction(a)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {!hasActions && (
          <button type="button" className="nesio-proactive-card-dismiss" onClick={onDismiss} aria-label="忽略">✕</button>
        )}
      </div>
    </div>
  );
}

const FOCUS_TYPE_LABEL: Record<string, string> = {
  commitment: '任务', event: '日程', object: '物品', person: '联系人',
  place: '地点', health_state: '健康', preference: '偏好',
};
const FOCUS_TYPE_ICON: Record<string, string> = {
  commitment: '📋', event: '📅', object: '📦', person: '👤',
  place: '📍', health_state: '🩷', preference: '⭐',
};

// ── Momentum Engine ── 3-action wave, auto-unlock, recursive drill ──────────

interface MomentumAction {
  id: string;
  name: string;
  emoji: string;
  done: boolean;
}

function FocusCardDetail({
  node,
  onSubtasksChange: _onSubtasksChange,
  onOpenRecorder,
}: {
  node: FocusNode;
  onSubtasksChange: (nodeId: string, subtasks: SubTask[]) => void;
  onOpenRecorder?: () => void;
}) {
  const [wave, setWave] = useState<MomentumAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [drillMap, setDrillMap] = useState<Map<string, MomentumAction[]>>(new Map());
  const [drillingId, setDrillingId] = useState<string | null>(null);
  const [completedActions, setCompletedActions] = useState<string[]>([]);
  const [waveIndex, setWaveIndex] = useState(0);
  const [unlocking, setUnlocking] = useState(false);

  const isMeeting = isMeetingNode(node);
  const meetingUrl = getMeetingUrl(node);
  const meetingTime = getMeetingTime(node);

  async function fetchWave(previousAction?: string, history: string[] = []) {
    setLoading(true);
    try {
      const res = await fetch('/api/portal/decompose-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskName: node.name,
          context: node.rawInput,
          previousAction,
          completedActions: history,
        }),
      });
      const data = await res.json() as { ok?: boolean; steps?: Array<{ name: string; emoji?: string }> };
      if (data.ok && data.steps?.length) {
        const actions: MomentumAction[] = data.steps.slice(0, 3).map((s, i) => ({
          id: `m-${Date.now()}-${i}`,
          name: s.name,
          emoji: s.emoji || '⚡',
          done: false,
        }));
        setWave(actions);
        setWaveIndex((w) => w + 1);
        setDrillMap(new Map());
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function handleDrill(action: MomentumAction) {
    setDrillingId(action.id);
    try {
      const res = await fetch('/api/portal/decompose-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskName: action.name, context: node.name, drill: true }),
      });
      const data = await res.json() as { ok?: boolean; steps?: Array<{ name: string; emoji?: string }> };
      if (data.ok && data.steps?.length) {
        const drills: MomentumAction[] = data.steps.slice(0, 3).map((s, i) => ({
          id: `d-${Date.now()}-${i}`,
          name: s.name,
          emoji: s.emoji || '▸',
          done: false,
        }));
        setDrillMap((prev) => new Map(prev).set(action.id, drills));
      }
    } catch { /* ignore */ }
    setDrillingId(null);
  }

  function toggleAction(actionId: string) {
    const next = wave.map((a) => a.id === actionId ? { ...a, done: !a.done } : a);
    setWave(next);
    if (next.every((a) => a.done)) {
      const lastDone = next[next.length - 1].name;
      const allHistory = [...completedActions, ...next.map((a) => a.name)];
      setCompletedActions(allHistory);
      setUnlocking(true);
      setTimeout(() => {
        setUnlocking(false);
        setWave([]);
        fetchWave(lastDone, allHistory);
      }, 700);
    }
  }

  function toggleDrill(actionId: string, drillId: string) {
    setDrillMap((prev) => {
      const drills = prev.get(actionId) ?? [];
      return new Map(prev).set(actionId, drills.map((d) => d.id === drillId ? { ...d, done: !d.done } : d));
    });
  }

  // Meeting view — unchanged
  if (isMeeting) {
    return (
      <div className="nesio-focus-detail nesio-focus-detail--meeting">
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
        </div>
        {meetingTime && <p className="nesio-focus-meeting-prep-hint">提前 5 分钟打开，检查静音和摄像头</p>}
      </div>
    );
  }

  const nodeUrl = Object.values(node.attributes).find(
    (v) => typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))
  ) as string | undefined;

  // Not started yet
  if (wave.length === 0 && !loading && !unlocking) {
    return (
      <div className="nesio-momentum-start">
        {nodeUrl && (
          <a href={safeExternalUrl(nodeUrl)} target="_blank" rel="noopener noreferrer" className="nesio-focus-meeting-link-btn">
            🔗 直达链接
          </a>
        )}
        <button type="button" className="nesio-momentum-ignite-btn" onClick={() => fetchWave()}>
          ⚡ 开始动量
        </button>
      </div>
    );
  }

  // Loading / unlocking state
  if (loading || unlocking || wave.length === 0) {
    return (
      <div className="nesio-momentum-loading">
        <span className="nesio-momentum-loading-dot" />
        <span className="nesio-momentum-loading-dot" />
        <span className="nesio-momentum-loading-dot" />
      </div>
    );
  }

  return (
    <div className="nesio-momentum">
      {waveIndex > 1 && (
        <div className="nesio-momentum-wave-badge">第 {waveIndex} 波</div>
      )}
      <ul className="nesio-momentum-list">
        {wave.map((a) => {
          const drills = drillMap.get(a.id);
          const isDrilling = drillingId === a.id;
          const allDrillsDone = drills ? drills.every((d) => d.done) : false;

          return (
            <li key={a.id} className={`nesio-momentum-item${a.done ? ' nesio-momentum-item--done' : ''}`}>
              <div className="nesio-momentum-row">
                <button
                  type="button"
                  className={`nesio-momentum-check${a.done ? ' nesio-momentum-check--done' : ''}`}
                  onClick={() => toggleAction(a.id)}
                  aria-label={a.done ? '取消' : '完成'}
                />
                <span className="nesio-momentum-emoji">{a.emoji}</span>
                <span className="nesio-momentum-name">{a.name}</span>
                {!a.done && !drills && !isDrilling && (
                  <button
                    type="button"
                    className="nesio-momentum-hard-btn"
                    onClick={() => handleDrill(a)}
                  >
                    太难
                  </button>
                )}
                {isDrilling && <span className="nesio-momentum-drilling">⋯</span>}
                {drills && !a.done && (
                  <span className={`nesio-momentum-drill-badge${allDrillsDone ? ' nesio-momentum-drill-badge--done' : ''}`}>
                    {drills.filter((d) => d.done).length}/{drills.length}
                  </span>
                )}
              </div>

              {drills && (
                <ul className="nesio-momentum-drill-list">
                  {drills.map((d) => (
                    <li
                      key={d.id}
                      className={`nesio-momentum-drill-item${d.done ? ' nesio-momentum-drill-item--done' : ''}`}
                    >
                      <button
                        type="button"
                        className={`nesio-momentum-drill-check${d.done ? ' nesio-momentum-drill-check--done' : ''}`}
                        onClick={() => toggleDrill(a.id, d.id)}
                        aria-label={d.done ? '取消' : '完成'}
                      />
                      <span className="nesio-momentum-drill-emoji">{d.emoji}</span>
                      <span className="nesio-momentum-drill-name">{d.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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

// ---- Proactive card dismiss helpers ----

const PROACTIVE_DISMISS_KEY = 'nesio-proactive-dismissed';

function dismissProactiveById(cardId: string) {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(PROACTIVE_DISMISS_KEY) || '{}');
    map[cardId] = new Date().toISOString().slice(0, 10);
    localStorage.setItem(PROACTIVE_DISMISS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

function isProactiveCardDismissed(cardId: string): boolean {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(PROACTIVE_DISMISS_KEY) || '{}');
    return map[cardId] === new Date().toISOString().slice(0, 10);
  } catch { return false; }
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

function TodayFocusSection({
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

function NightTimeline() {
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

// ---- Main TodayFeed component ----

export default function TodayFeed({
  canUsePrivateData,
  onOpenMemory,
}: {
  canUsePrivateData: boolean;
  onOpenMemory?: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [memoryCount, setMemoryCount] = useState(0);
  const [memoryNotes, setMemoryNotes] = useState<readonly string[]>([]);
  const [focusNodes, setFocusNodes] = useState<readonly FocusNode[]>([]);
  const [allNodes, setAllNodes] = useState<readonly FocusNode[]>([]);
  const [dormantStore, setDormantStore] = useState<DormantStore>({});
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [proactiveContext, setProactiveContext] = useState<ProactiveContext>({ upcomingSpecialDays: [], healthItems: [] });
  const [mirrorOpen, setMirrorOpen] = useState(false);

  // Proactive cards: up to 2, each independently dismissable
  const [proactiveCards, setProactiveCards] = useState<ProactiveCardData[]>([]);
  const [dismissedCardIds, setDismissedCardIds] = useState<Set<string>>(new Set());

  // Meeting recorder state
  const [meetingRecorderNode, setMeetingRecorderNode] = useState<FocusNode | null>(null);
  const [focusModeNode, setFocusModeNode] = useState<FocusNode | null>(null);

  useEffect(() => {
    if (canUsePrivateData) {
      const profile = loadProfileSettings();
      setDisplayName(profile.displayName || '');
    } else {
      setDisplayName('');
    }

    let cancelled = false;

    const applyViewModel = async () => {
      const cloudSignals = await loadCloudSignals(canUsePrivateData);
      const updated = buildTodayViewModel({ canUsePrivateData, fallbackCards: EMPTY_SIGNAL_CARDS, cloudSignals });
      if (cancelled) return;
      setMemoryCount(updated.memoryCount);
      setMemoryNotes(updated.memoryNotes);
      setFocusNodes(updated.focusNodes);
      setAllNodes(updated.allNodes);
      const store = loadDormantStore();
      const evaluated = evaluateDormancy(updated.allNodes, store);
      setDormantStore(evaluated);
      setProactiveContext(updated.proactiveContext);

      // Read calendar events from cache for the focus section
      const cal = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
      if (!cancelled) setCalendarEvents(cal?.events ?? []);

      // Build guidance cards (up to 2) and show independently
      if (canUsePrivateData) {
        const now = new Date();
        // Load email signals from quick scan (20min TTL cache)
        const latestEmailSignals = await loadEmailSignals(canUsePrivateData);

        // ── Guidance Engine pipeline ──────────────────────────────────────
        const calEvents = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar)?.events ?? [];
        const weather = readPortalCache<WeatherSnapshot>(PORTAL_CACHE_KEYS.weather);
        const scored = scoreCalendarEvents(calEvents, now);

        const guidanceEvents = [
          ...calendarEventsToGuidanceEvents(calEvents, now),
          ...emailSignalsToGuidanceEvents(latestEmailSignals),
          ...specialDaysToGuidanceEvents(updated.proactiveContext.upcomingSpecialDays, now),
          ...focusNodesToGuidanceEvents(updated.focusNodes, now),
          ...weatherToGuidanceEvents(weather),
          ...healthNodesToGuidanceEvents(updated.proactiveContext.healthItems),
        ];

        const guidanceCards = runGuidancePipeline({
          events: guidanceEvents,
          scoredCalendar: scored,
          now,
          energy: getEnergyState(now),
          goodHours: getBestInterruptionHours(),
        });
        const rawProactiveCards: ProactiveCardData[] = guidanceCards
          .map((card) => ({
            id: card.id,
            title: card.title,
            body: card.body,
            confidence: 90,
            sourceTags: [],
            icon: card.icon,
            priority: card.priority,
            cardType: card.type,
            nodeId: card.nodeId,
            actions: [{ label: card.action.cta, actionType: card.action.actionType }],
            expiresAt: card.expiresAt?.toISOString(),
          }))
          .filter((c) => !isProactiveCardDismissed(c.id))
          .filter((c) => !c.expiresAt || new Date(c.expiresAt).getTime() > now.getTime());

        // AI Language Generation (Layer 7) — enhance copy if cards exist.
        // Cached per card-set per day: the same cards used to trigger a fresh
        // AI rewrite on every app open (pipeline runs on load + 4 events +
        // 20-min poll), burning quota for identical output.
        let newProactiveCards = rawProactiveCards;
        if (rawProactiveCards.length > 0) {
          const LANG_CACHE_KEY = 'nesio-guidance-lang-cache-v1';
          const cacheSig = `${new Date().toISOString().slice(0, 10)}|${rawProactiveCards.map((c) => c.id + c.title).join('§')}`;
          let cachedCopy: Array<{ id: string; title: string; body: string }> | null = null;
          try {
            const raw = JSON.parse(localStorage.getItem(LANG_CACHE_KEY) || 'null') as { sig: string; cards: Array<{ id: string; title: string; body: string }> } | null;
            if (raw?.sig === cacheSig) cachedCopy = raw.cards;
          } catch { /* ignore */ }

          if (!cachedCopy) {
            try {
              const langRes = await fetch('/api/portal/guidance-language', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  cards: guidanceCards.map((c) => ({
                    id: c.id, type: c.type, icon: c.icon,
                    title: c.title, body: c.body, priority: c.priority,
                    action: c.action, expiresAt: c.expiresAt?.toISOString(), nodeId: c.nodeId,
                  })),
                  userName: displayName || undefined,
                }),
              });
              if (langRes.ok) {
                const langData = await langRes.json() as { ok: boolean; cards: Array<{ id: string; title: string; body: string }> };
                if (langData.ok && langData.cards.length === rawProactiveCards.length) {
                  cachedCopy = langData.cards;
                  try { localStorage.setItem(LANG_CACHE_KEY, JSON.stringify({ sig: cacheSig, cards: cachedCopy })); } catch { /* ignore */ }
                }
              }
            } catch { /* fall back to rule-generated copy */ }
          }

          if (cachedCopy && cachedCopy.length === rawProactiveCards.length) {
            newProactiveCards = rawProactiveCards.map((card, i) => ({
              ...card,
              title: cachedCopy![i]?.title || card.title,
              body: cachedCopy![i]?.body || card.body,
            }));
          }
        }

        if (!cancelled && newProactiveCards.length > 0) setProactiveCards(newProactiveCards);

        // Fallback time-based nudge when pipeline produces nothing
        if (!cancelled && newProactiveCards.length === 0) {
          const fallback = buildTimeFallback(now);
          if (fallback && !isProactiveCardDismissed(fallback.id)) setProactiveCards([fallback]);
        }
      }
    };
    void applyViewModel();

    // Email quick scan: re-poll every 20 minutes while the page is open.
    // Re-runs the full guidance pipeline so new email signals pass through
    // cooling/budget gates like everything else (no side-channel cards).
    const emailPollInterval = canUsePrivateData
      ? setInterval(() => { void applyViewModel(); }, 20 * 60_000)
      : null;

    // Background Gmail full sync — at most once every 6h, non-blocking
    if (canUsePrivateData && typeof window !== 'undefined') {
      const GMAIL_SYNC_KEY = 'nesio-gmail-last-sync';
      const lastSync = parseInt(localStorage.getItem(GMAIL_SYNC_KEY) || '0', 10);
      if (Date.now() - lastSync > 6 * 3_600_000) {
        localStorage.setItem(GMAIL_SYNC_KEY, String(Date.now()));
        fetch('/api/portal/gmail?includeBody=true&analyze=true')
          .then((r) => r.json())
          .then((d: { ok?: boolean; nodes?: Array<Record<string, unknown>> }) => {
            if (d.ok && d.nodes && d.nodes.length > 0) {
              import('@/lib/portal/life-graph').then(({ addLifeNode }) => {
                d.nodes!.forEach((n) => addLifeNode(n as Parameters<typeof addLifeNode>[0]));
                window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
              });
            }
          })
          .catch(() => {});
      }
    }

    const refresh = () => { void applyViewModel(); };
    window.addEventListener('nesio-life-graph-updated', refresh);
    window.addEventListener('nesio-connectors-refreshed', refresh);
    window.addEventListener('nesio-weather-updated', refresh);
    window.addEventListener('nesio-calendar-updated', refresh);

    return () => {
      cancelled = true;
      if (emailPollInterval) clearInterval(emailPollInterval);
      window.removeEventListener('nesio-life-graph-updated', refresh);
      window.removeEventListener('nesio-connectors-refreshed', refresh);
      window.removeEventListener('nesio-weather-updated', refresh);
      window.removeEventListener('nesio-calendar-updated', refresh);
    };
  }, [canUsePrivateData]);

  const initials = canUsePrivateData ? (displayName.trim().slice(0, 1) || '我') : '我';
  const { shouldShow: showWrapped, dismiss: dismissWrapped } = useWrappedTrigger();

  // All proactive cards come from the guidance pipeline (email included) —
  // single path so cooling-store and attention-budget always apply.
  const activeProactiveCards = proactiveCards.filter((c) => !dismissedCardIds.has(c.id)).slice(0, 2);

  return (
    <div className="nesio-today-root">
      <header className="nesio-today-header">
        <button
          type="button"
          className="nesio-today-brand"
          aria-label="打开 Nesio 洞察"
          onClick={() => setMirrorOpen(true)}
        >
          <img src="/icons/treasurebox.svg" alt="Nesio" className="nesio-today-brand-icon" />
        </button>
        <a href="/settings" className="nesio-today-avatar" aria-label="我的设置">{initials}</a>
      </header>

      <div className="nesio-today-scroll">
        {/* 季度 Wrapped 卡片 */}
        {showWrapped && <WrappedCard onDismiss={dismissWrapped} />}

        {/* 顶部双圆按钮：听简报 + 此刻 */}
        <div className="nesio-today-top-row">
          <DailyBriefCard
            circular
            canUsePrivateData={canUsePrivateData}
            memoryCount={memoryCount}
            memoryNotes={memoryNotes}
          />
          <button
            type="button"
            className="nesio-mood-circle"
            onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-mood'))}
            aria-label="记录此刻感受"
          >
            <span className="nesio-mood-circle-icon" aria-hidden>🌡</span>
            <span className="nesio-mood-circle-label">此刻</span>
          </button>
        </div>

        {/* 未来引导卡 — up to 2, each independently dismissable */}
        {activeProactiveCards.map((card) => (
          <ProactiveGuidanceCard
            key={card.id}
            card={card}
            onDismiss={() => {
              dismissProactiveById(card.id);
              // Record in cooling store so adaptive cooldown can kick in after repeated ignores
              if (card.cardType) {
                saveCoolingStore(recordDismissed(card.cardType, loadCoolingStore()));
              }
              setDismissedCardIds((prev) => { const next = new Set(prev); next.add(card.id); return next; });
            }}
            onMarkDone={(nodeId) => markFocusNodeDone(nodeId)}
          />
        ))}

        {/* 今日焦点 — 重要安排 / 重要日子 / 重要提醒 */}
        <TodayFocusSection
          focusNodes={focusNodes}
          calendarEvents={calendarEvents}
          specialDays={proactiveContext.upcomingSpecialDays}
          allNodes={allNodes}
          dormantStore={dormantStore}
          onSetDormantStore={setDormantStore}
          onOpenMemory={onOpenMemory}
          onOpenRecorder={(node) => setMeetingRecorderNode(node)}
          onFocusMode={(node) => setFocusModeNode(node)}
        />
      </div>

      {/* 聚焦模式 */}
      <FocusModeSheet
        node={focusModeNode}
        onClose={() => setFocusModeNode(null)}
        onDone={(node) => { markFocusNodeDone(node.id); setFocusModeNode(null); }}
      />

      {/* 会议记录 sheet */}
      <MeetingRecorderSheet
        open={meetingRecorderNode !== null}
        meetingNode={meetingRecorderNode}
        onClose={() => setMeetingRecorderNode(null)}
      />

      {/* Insights mirror */}
      {mirrorOpen && (
        <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label="Nesio 的洞察">
          <button type="button" className="nesio-settings-sheet-backdrop" onClick={() => setMirrorOpen(false)} aria-label="关闭" />
          <div className="nesio-settings-sheet-card nesio-insights-sheet-card">
            <div className="nesio-sheet-handle" aria-hidden />
            <InsightsSheet onClose={() => setMirrorOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
