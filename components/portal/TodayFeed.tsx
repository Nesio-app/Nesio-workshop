'use client';

import { useEffect, useRef, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { buildTodayViewModel, focusTimeHint, markFocusNodeDone, addCommitmentNode, addMeetingNotes, saveSubtasks, toggleSubtask, type FocusNode, type SubTask, type ProactiveContext } from '@/lib/platform/view-models/today-view-model';
import { type RecommendationCard } from '@/lib/portal/reasoning-engine';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { CalendarEvent } from '@/lib/portal/types';
import { cloudSignalRowsToSignals, type CloudSignalRow } from '@/lib/life-domain/signal-search';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import VoiceBrief from './VoiceBrief';
import DailyBriefCard from './DailyBriefCard';
import InsightsSheet from './InsightsSheet';

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

function inferSourceStatus(card: RecommendationCard): NonNullable<RecommendationCard['sourceStatus']> {
  if (card.sourceStatus) return card.sourceStatus;
  if (card.evidence.some((e) => /calendar|日历/i.test(e.source) || /calendar|日历/i.test(e.label))) return 'authorized_calendar';
  if (card.evidence.length > 0) return 'user_record';
  return 'needs_input';
}

function sourceStatusLabel(status: NonNullable<RecommendationCard['sourceStatus']>) {
  if (status === 'authorized_calendar') return '来自授权日历';
  if (status === 'user_record') return '来自你的记录';
  if (status === 'demo_example') return 'Demo 示例';
  return '从一件小事开始';
}

function confidenceText(confidence: number) {
  if (confidence >= 0.82) return '比较确定';
  if (confidence >= 0.58) return '可能相关';
  return '建议确认';
}

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

// ---- Recommendation cards (unchanged) ----

function AudioCard({ card, onFeedback }: { card: RecommendationCard; onFeedback: (f: RecommendationCard['feedback']) => void }) {
  const [briefOpen, setBriefOpen] = useState(false);
  return (
    <>
      <div className="nesio-today-card nesio-today-card--audio">
        <div className="nesio-today-card-header">
          <span className="nesio-today-card-domain">{card.domainLabel}</span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="nesio-today-card-duration">文字简报</span>
            <FeedbackMenu onFeedback={onFeedback} />
          </div>
        </div>
        <div className="nesio-today-card-row">
          <span className="nesio-today-card-icon-wrap" style={{ background: card.iconBg }}>{card.icon}</span>
          <div>
            <h3 className="nesio-today-card-title">{card.title}</h3>
            <p className="nesio-today-card-body">{card.body}</p>
          </div>
        </div>
        <div className="nesio-today-audio-player" style={{ cursor: 'pointer' }} onClick={() => setBriefOpen(true)}>
          <span className="nesio-today-audio-play">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5,3 19,12 5,21"/></svg>
          </span>
          <div className="nesio-today-audio-wave" aria-hidden>
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className="nesio-today-audio-bar"
                style={{ height: `${8 + Math.sin(i * 0.7) * 6}px` }} />
            ))}
          </div>
          <span className="nesio-today-audio-time">文字版</span>
        </div>
        <div className="nesio-today-card-actions">
          <button type="button" className="nesio-today-btn nesio-today-btn--primary" onClick={() => { setBriefOpen(true); onFeedback('useful'); }}>{card.primaryAction}</button>
          {card.secondaryAction && <button type="button" className="nesio-today-btn nesio-today-btn--ghost" onClick={() => onFeedback('not_now')}>{card.secondaryAction}</button>}
        </div>
      </div>
      <VoiceBrief
        open={briefOpen}
        onClose={() => setBriefOpen(false)}
        title={card.title}
        body={card.body}
        points={card.evidence.map((e) => `${e.label}：${e.value}`)}
      />
    </>
  );
}

function FeedbackMenu({ onFeedback }: { onFeedback: (f: RecommendationCard['feedback']) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" style={{ fontSize: '1rem', color: 'var(--portal-muted)', padding: '0 0.2rem' }} onClick={() => setOpen(!open)} aria-label="反馈">···</button>
      {open && (
        <>
          <button type="button" className="nesio-today-feedback-scrim" aria-label="关闭反馈" onClick={() => setOpen(false)} />
          <div className="nesio-today-feedback-menu" role="menu">
            {[
              { key: 'useful', label: '✓ 有帮助' },
              { key: 'wrong', label: '✗ 不准确' },
              { key: 'not_now', label: '稍后' },
              { key: 'too_much', label: '不要再提' },
            ].map((item) => (
              <button key={item.key} type="button" role="menuitem"
                onClick={() => { onFeedback(item.key as RecommendationCard['feedback']); setOpen(false); }}>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const EVIDENCE_CHAR_CAP = 45;
function capEvidence(text: string): string {
  return text.length > EVIDENCE_CHAR_CAP ? text.slice(0, EVIDENCE_CHAR_CAP - 1) + '…' : text;
}

function StandardCard({ card, onFeedback }: { card: RecommendationCard; onFeedback: (f: RecommendationCard['feedback']) => void }) {
  const [done, setDone] = useState(false);
  const [why, setWhy] = useState(false);
  const needsInput = inferSourceStatus(card) === 'needs_input';
  if (done) return null;

  return (
    <div className="nesio-today-card nesio-today-card--collapse">
      <div className="nesio-today-card-row">
        <span className="nesio-today-card-icon-wrap" style={{ background: card.iconBg }}>{card.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="nesio-today-card-domain">{sourceStatusLabel(inferSourceStatus(card))}</span>
          <h3 className="nesio-today-card-title">{card.title}</h3>
        </div>
        <FeedbackMenu onFeedback={onFeedback} />
      </div>

      <div className="nesio-today-card-actions">
        <button type="button" className="nesio-today-btn nesio-today-btn--primary"
          onClick={() => {
            if (needsInput) {
              window.dispatchEvent(new CustomEvent('nesio-open-tell'));
              return;
            }
            setDone(true);
            onFeedback('useful');
          }}>{card.primaryAction}</button>
        <button type="button" className="nesio-today-why-btn"
          onClick={() => setWhy((v) => !v)} aria-expanded={why}>
          为什么
        </button>
      </div>

      {why && (
        <div className="nesio-today-evidence">
          <p className="nesio-today-evidence-text">{capEvidence(card.body)}</p>
          {card.evidence.length > 0 && (
            <div className="nesio-today-evidence-refs">
              {card.evidence.slice(0, 3).map((e, i) => (
                <span key={i} className="nesio-today-evidence-chip" title={e.signalId || ''}>
                  {e.label}：{e.value.length > 16 ? e.value.slice(0, 15) + '…' : e.value}
                </span>
              ))}
              <span className="nesio-today-evidence-conf">{confidenceText(card.confidence)}</span>
            </div>
          )}
          {card.secondaryAction && (
            <button type="button" className="nesio-today-btn nesio-today-btn--ghost"
              style={{ marginTop: '0.6rem' }} onClick={() => onFeedback('not_now')}>{card.secondaryAction}</button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Proactive guidance card ----

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
}

type ProactiveTrigger = {
  type: string;
  data: Record<string, string | number | boolean | null>;
  fallback: Omit<ProactiveCardData, 'id'>;
};

interface WeatherCache {
  temperatureC: number;
  condition: string;
  forecastNote?: string;
  placeLabel?: string;
}

function buildProactiveTriggers(
  focusNodes: readonly FocusNode[],
  context: ProactiveContext,
): ProactiveTrigger[] {
  const triggers: ProactiveTrigger[] = [];
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay(); // 0=Sun, 1=Mon ... 5=Fri, 6=Sat

  // ── 1. Weather triggers ──
  const weather = readPortalCache<WeatherCache>(PORTAL_CACHE_KEYS.weather);
  if (weather) {
    const cold = weather.temperatureC < 10;
    const veryCold = weather.temperatureC < 4;
    const rainHint = /雨|rain|shower|drizzle/i.test(weather.condition + (weather.forecastNote || ''));
    if (veryCold) {
      triggers.push({
        type: 'weather_very_cold',
        data: { tempC: weather.temperatureC, condition: weather.condition },
        fallback: { title: '今天很冷，多穿一件', body: `气温 ${Math.round(weather.temperatureC)}°C，出门加件厚外套。`, confidence: 90, sourceTags: ['天气·寒冷'], icon: '🧥', priority: 9 },
      });
    } else if (cold) {
      triggers.push({
        type: 'weather_cold',
        data: { tempC: weather.temperatureC, condition: weather.condition },
        fallback: { title: '温度偏低，注意保暖', body: `${Math.round(weather.temperatureC)}°C，适合加一层。`, confidence: 85, sourceTags: ['天气·偏凉'], icon: '🌡', priority: 7 },
      });
    }
    if (rainHint) {
      triggers.push({
        type: 'weather_rain',
        data: { condition: weather.condition, forecastNote: weather.forecastNote ?? '' },
        fallback: { title: '出门记得带伞', body: `今天${weather.condition}，随手带把伞备用。`, confidence: 88, sourceTags: ['天气·降雨'], icon: '☂️', priority: 8 },
      });
    }
  }

  // ── 2. Calendar: tomorrow's events ──
  const cal = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
  const calEvents: CalendarEvent[] = cal?.events ?? [];
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0,0,0,0);
  const dayAfter  = new Date(tomorrow); dayAfter.setDate(dayAfter.getDate() + 1);
  const tomorrowEvents = calEvents.filter((e) => {
    const d = new Date(e.start);
    return d >= tomorrow && d < dayAfter;
  });
  if (tomorrowEvents.length > 0) {
    const names = tomorrowEvents.map((e) => e.title).slice(0, 2).join('、');
    triggers.push({
      type: 'event_tomorrow',
      data: { count: tomorrowEvents.length, names },
      fallback: { title: '明天有重要安排', body: `${names} — 今晚可以提前做点准备。`, confidence: 88, sourceTags: ['日历·明日'], icon: '📋', priority: 8 },
    });
  }

  // ── 3. Focus node triggers ──
  for (const node of focusNodes) {
    // Meeting within 2h
    const meetingTime = getMeetingTime(node);
    if (meetingTime) {
      const diffMin = Math.round((meetingTime.getTime() - now.getTime()) / 60_000);
      if (diffMin > 0 && diffMin <= 120) {
        triggers.push({
          type: 'meeting_soon',
          data: { name: node.name, minutesUntil: diffMin },
          fallback: { title: `${diffMin} 分钟后开会`, body: `"${node.name}" 即将开始，提前进入状态。`, confidence: 95, sourceTags: ['日历·即将开始'], icon: '🎙', priority: 10 },
        });
      }
    }

    // Task due today or tomorrow
    for (const v of Object.values(node.attributes)) {
      if (typeof v !== 'string') continue;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) continue;
      const daysUntil = Math.round((d.getTime() - now.getTime()) / 86_400_000);
      if (daysUntil === 0) {
        triggers.push({
          type: 'due_today',
          data: { name: node.name },
          fallback: { title: '今天到期', body: `"${node.name}" 今天截止，先做第一步。`, confidence: 92, sourceTags: ['任务·截止'], icon: '⏰', priority: 9 },
        });
      } else if (daysUntil === 1) {
        triggers.push({
          type: 'due_tomorrow',
          data: { name: node.name },
          fallback: { title: '明天截止', body: `"${node.name}" 明天到期，今天可以推进一下。`, confidence: 85, sourceTags: ['任务·明日截止'], icon: '📌', priority: 7 },
        });
      }
    }
  }

  // ── 4. Overdue items — soft ADHD-friendly nudge, one at a time, snooze-aware ──
  for (const item of context.overdueItems.slice(0, 3)) {
    if (isOverdueSnoozed(item.nodeId)) continue;
    triggers.push({
      type: 'overdue',
      data: { name: item.name, nodeId: item.nodeId, daysAgo: Math.abs(item.daysUntil) },
      fallback: {
        title: `"${item.name.length > 18 ? item.name.slice(0, 18) + '…' : item.name}"`,
        body: '这件事还有机会继续吗？没关系，选一个就好。',
        confidence: 80,
        sourceTags: [],
        icon: '🌱',
        priority: 6,
        cardType: 'overdue',
        nodeId: item.nodeId,
        actions: [
          { label: '继续做', actionType: 'dismiss' },
          { label: '不需要了', actionType: 'done' },
          { label: '下周再说', actionType: 'snooze' },
        ],
      },
    });
    break; // only one overdue at a time
  }

  // ── 5. Special days: birthday / anniversary (from context) ──
  for (const item of context.upcomingSpecialDays.slice(0, 1)) {
    const label = item.daysUntil === 0 ? '就是今天' : item.daysUntil === 1 ? '明天' : `${item.daysUntil} 天后`;
    triggers.push({
      type: 'special_day',
      data: { name: item.name, daysUntil: item.daysUntil },
      fallback: { title: `重要日子 · ${label}`, body: `"${item.name}" ${label}，要不要提前准备点什么？`, confidence: 88, sourceTags: ['重要日子'], icon: '🎂', priority: 8 },
    });
  }

  // ── 6. Recent signals (booking / email context) ──
  for (const name of context.recentSignals.slice(0, 1)) {
    triggers.push({
      type: 'recent_signal',
      data: { name },
      fallback: { title: '记录到一条新信息', body: `"${name}" — 要根据这条记录做点准备吗？`, confidence: 78, sourceTags: ['记录·新信号'], icon: '📩', priority: 6 },
    });
  }

  // ── 7. Health items nudge ──
  if (context.healthItems.length > 0 && hour >= 7 && hour <= 10) {
    triggers.push({
      type: 'health_morning',
      data: { items: context.healthItems.slice(0, 2).join('、') },
      fallback: { title: '今天的健康打卡', body: `${context.healthItems[0]} — 今天记得执行。`, confidence: 75, sourceTags: ['健康·习惯'], icon: '💪', priority: 6 },
    });
  }

  // ── 8. Time-based nudges (only when nothing else fires) ──
  if (triggers.length === 0) {
    if (dow === 1 && hour < 11) {
      triggers.push({
        type: 'week_start',
        data: {},
        fallback: { title: '新的一周从规划开始', body: '周一早上，把本周最重要的 3 件事先记下来。', confidence: 70, sourceTags: ['时间·周一'], icon: '🗓', priority: 5 },
      });
    } else if (dow === 5 && hour >= 15) {
      triggers.push({
        type: 'week_end',
        data: {},
        fallback: { title: '本周还有什么没收尾？', body: '周五下午，快速过一遍本周待办，周末才能真正放松。', confidence: 70, sourceTags: ['时间·周五'], icon: '✅', priority: 5 },
      });
    } else if (hour >= 21) {
      triggers.push({
        type: 'evening_recap',
        data: {},
        fallback: { title: '今天有什么想记下来的？', body: '睡前花 30 秒，把今天的想法或待办存进来。', confidence: 65, sourceTags: ['时间·晚间'], icon: '🌙', priority: 4 },
      });
    }
  }

  // Sort by priority desc, deduplicate by type, cap at 3
  const seen = new Set<string>();
  return triggers
    .sort((a, b) => (b.fallback.priority ?? 0) - (a.fallback.priority ?? 0))
    .filter((t) => { if (seen.has(t.type)) return false; seen.add(t.type); return true; })
    .slice(0, 3);
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

function isOverdueSnoozed(nodeId: string): boolean {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}');
    const until = map[nodeId];
    if (!until) return false;
    return new Date(until).getTime() > Date.now();
  } catch { return false; }
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

// ---- Meeting helpers ----

const MEETING_KEYWORDS = ['会议', 'meeting', '视频会', '电话会', '面试', 'standup', '周会', '月会', '汇报', '面谈', '1on1', '同步'];

function isMeetingNode(node: FocusNode): boolean {
  if (node.type === 'event') return true;
  const text = [node.name, node.rawInput || ''].join(' ').toLowerCase();
  return MEETING_KEYWORDS.some((kw) => text.includes(kw));
}

function getMeetingTime(node: FocusNode): Date | null {
  for (const v of Object.values(node.attributes)) {
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function getMeetingUrl(node: FocusNode): string | null {
  const urlLike = Object.values(node.attributes).find(
    (v) => typeof v === 'string' && (v.startsWith('http') || v.startsWith('zoom') || v.includes('meet.'))
  );
  return typeof urlLike === 'string' ? urlLike : null;
}

// ---- Meeting countdown ----

function MeetingCountdown({ startTime }: { startTime: Date }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  const diffMs = startTime.getTime() - now.getTime();
  const timeStr = startTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (diffMs < -120 * 60_000) return null;

  if (diffMs < 0) {
    const pastMin = Math.round(-diffMs / 60_000);
    return <span className="nesio-focus-meeting-badge nesio-focus-meeting-badge--now">{timeStr} · 进行中 +{pastMin}min</span>;
  }

  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin <= 15) return <span className="nesio-focus-meeting-badge nesio-focus-meeting-badge--soon">{timeStr} · {diffMin}分钟后</span>;
  const hh = Math.floor(diffMin / 60);
  const mm = diffMin % 60;
  const countdown = hh > 0 ? `${hh}h${mm}m后` : `${mm}分钟后`;
  return <span className="nesio-focus-meeting-badge">{timeStr} · {countdown}</span>;
}

// ---- Focus Mode Sheet ----

const FOCUS_DURATIONS = [
  { label: '25 分钟', value: 25 },
  { label: '50 分钟', value: 50 },
  { label: '5 分钟', value: 5 },
];

function FocusModeSheet({ node, onClose, onDone }: {
  node: FocusNode | null;
  onClose: () => void;
  onDone: (node: FocusNode) => void;
}) {
  const [durMin, setDurMin] = useState(25);
  const [secsLeft, setSecsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!node) { setRunning(false); setFinished(false); return; }
    setSecsLeft(durMin * 60);
    setRunning(false);
    setFinished(false);
  }, [node, durMin]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSecsLeft((s) => {
          if (s <= 1) {
            clearInterval(intervalRef.current!);
            setRunning(false);
            setFinished(true);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  if (!node) return null;

  const totalSecs = durMin * 60;
  const progress = (totalSecs - secsLeft) / totalSecs;
  const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
  const ss = String(secsLeft % 60).padStart(2, '0');
  const hint = focusTimeHint(node);

  function handleDurationChange(v: number) {
    setDurMin(v);
    setSecsLeft(v * 60);
    setRunning(false);
    setFinished(false);
  }

  return (
    <div className="nesio-focus-mode-overlay" role="dialog" aria-modal aria-label="聚焦模式">
      <div className="nesio-focus-mode-backdrop" onClick={onClose} />
      <div className="nesio-focus-mode-sheet">
        <button type="button" className="nesio-focus-mode-close" onClick={onClose} aria-label="退出聚焦">✕</button>

        <p className="nesio-focus-mode-label">现在专注于</p>
        <h2 className="nesio-focus-mode-title">{node.name}</h2>
        {hint && <p className="nesio-focus-mode-hint">{hint}</p>}

        {/* Circular timer */}
        <div className="nesio-focus-mode-timer-wrap">
          <svg viewBox="0 0 120 120" className="nesio-focus-mode-ring">
            <circle cx="60" cy="60" r="54" fill="none" stroke="var(--portal-border, rgba(0,0,0,.08))" strokeWidth="8" />
            <circle
              cx="60" cy="60" r="54"
              fill="none"
              stroke={finished ? '#74c69d' : 'var(--portal-accent, #4a90d9)'}
              strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 54}`}
              strokeDashoffset={`${2 * Math.PI * 54 * (1 - progress)}`}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <div className="nesio-focus-mode-time">
            {finished ? '🎉' : `${mm}:${ss}`}
          </div>
        </div>

        {/* Duration picker */}
        {!running && !finished && (
          <div className="nesio-focus-mode-durations">
            {FOCUS_DURATIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                className={`nesio-focus-mode-dur-btn${durMin === d.value ? ' nesio-focus-mode-dur-btn--active' : ''}`}
                onClick={() => handleDurationChange(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}

        {finished ? (
          <p className="nesio-focus-mode-done-msg">时间到！要标记完成吗？</p>
        ) : (
          <button
            type="button"
            className="nesio-focus-mode-play-btn"
            onClick={() => setRunning((r) => !r)}
          >
            {running ? '⏸ 暂停' : secsLeft < totalSecs ? '▶ 继续' : '▶ 开始'}
          </button>
        )}

        <div className="nesio-focus-mode-actions">
          <button type="button" className="nesio-focus-mode-done-btn" onClick={() => { onDone(node); onClose(); }}>
            ✓ 完成了
          </button>
          <button type="button" className="nesio-focus-mode-later-btn" onClick={onClose}>
            稍后再说
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Meeting Recorder Sheet ----

type SpeechRecAPI = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  start(): void;
  stop(): void;
};

function MeetingRecorderSheet({ open, meetingNode, onClose }: {
  open: boolean;
  meetingNode: FocusNode | null;
  onClose: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [saved, setSaved] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recognitionRef = useRef<SpeechRecAPI | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      setRecording(false);
      setTranscript('');
      setSaved(false);
      setSeconds(0);
      if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }, [open]);

  function startRecording() {
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);

    try {
      const win = window as unknown as Record<string, unknown>;
      const SpeechRec = (win.webkitSpeechRecognition || win.SpeechRecognition) as (new () => SpeechRecAPI) | undefined;
      if (SpeechRec) {
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'zh-CN';
        rec.onresult = (e) => {
          const text = Array.from(e.results).map((r) => r[0].transcript).join('');
          setTranscript(text);
        };
        rec.start();
        recognitionRef.current = rec;
      }
    } catch {
      // SpeechRecognition not available — manual input still works
    }
  }

  function stopRecording() {
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
  }

  function saveNotes() {
    const finalText = transcript.trim() || '（无内容）';
    const nowStr = new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    addMeetingNotes(meetingNode?.id || '', meetingNode?.name || nowStr, finalText);
    setSaved(true);
    setTimeout(() => onClose(), 1800);
  }

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  if (!open) return null;

  return (
    <div className="nesio-recorder-overlay" role="dialog" aria-modal aria-label="会议记录">
      <div className="nesio-recorder-backdrop" onClick={onClose} />
      <div className="nesio-recorder-sheet">
        <div className="nesio-sheet-handle" aria-hidden />

        {saved ? (
          <div className="nesio-recorder-saved">
            <span className="nesio-recorder-saved-icon">📝</span>
            <p className="nesio-recorder-saved-title">会议记录已保存</p>
            <p className="nesio-recorder-saved-hint">已存入记忆，和会议条目关联</p>
          </div>
        ) : (
          <>
            <div className="nesio-recorder-header">
              <p className="nesio-recorder-title">🎙 会议记录</p>
              {meetingNode && <p className="nesio-recorder-meeting-name">{meetingNode.name}</p>}
            </div>

            <div className="nesio-recorder-body">
              <div className="nesio-recorder-viz">
                {recording ? (
                  <>
                    <div className="nesio-recorder-wave">
                      {Array.from({ length: 20 }, (_, i) => (
                        <span key={i} className="nesio-recorder-wave-bar" style={{ animationDelay: `${i * 0.06}s` }} />
                      ))}
                    </div>
                    <span className="nesio-recorder-timer">{formatTime(seconds)}</span>
                  </>
                ) : (
                  <span className="nesio-recorder-mic-icon">🎙</span>
                )}
              </div>

              {transcript ? (
                <div className="nesio-recorder-transcript">
                  <p className="nesio-recorder-transcript-label">转写内容</p>
                  <p className="nesio-recorder-transcript-text">{transcript}</p>
                </div>
              ) : (
                !recording && <p className="nesio-recorder-hint">点击录音，自动转写中文语音</p>
              )}
            </div>

            <div className="nesio-recorder-actions">
              {!recording ? (
                <button type="button" className="nesio-recorder-start-btn" onClick={startRecording}>开始录音</button>
              ) : (
                <button type="button" className="nesio-recorder-stop-btn" onClick={stopRecording}>停止录音</button>
              )}

              {!recording && (
                <textarea
                  className="nesio-recorder-notes-input"
                  placeholder="或直接输入会议笔记…"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={3}
                />
              )}

              <button
                type="button"
                className={`nesio-recorder-save-btn${transcript.trim() ? ' nesio-recorder-save-btn--ready' : ''}`}
                onClick={saveNotes}
                disabled={recording || !transcript.trim()}
              >
                {transcript.trim() ? '保存会议记录' : '先录音或输入笔记'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Focus card constants ----

const FOCUS_TYPE_LABEL: Record<string, string> = {
  commitment: '任务', event: '日程', object: '物品', person: '联系人',
  place: '地点', health_state: '健康', preference: '偏好',
};
const FOCUS_TYPE_ICON: Record<string, string> = {
  commitment: '📋', event: '📅', object: '📦', person: '👤',
  place: '📍', health_state: '🩷', preference: '⭐',
};

// ---- Enhanced FocusCardDetail — 2-level decompose + meeting actions ----

interface SubStep {
  id: string;
  name: string;
  emoji: string;
  durationMin: number;
  done: boolean;
}

function FocusCardDetail({
  node,
  onSubtasksChange,
  onOpenRecorder,
}: {
  node: FocusNode;
  onSubtasksChange: (nodeId: string, subtasks: SubTask[]) => void;
  onOpenRecorder?: () => void;
}) {
  const [subtasks, setSubtasks] = useState<SubTask[]>(node.subtasks ?? []);
  const [decomposing, setDecomposing] = useState(false);
  const [subStepsMap, setSubStepsMap] = useState<Map<string, SubStep[]>>(new Map());
  const [drillingId, setDrillingId] = useState<string | null>(null);

  const isMeeting = isMeetingNode(node);
  const meetingUrl = getMeetingUrl(node);
  const meetingTime = getMeetingTime(node);

  async function handleDecompose() {
    setDecomposing(true);
    try {
      const res = await fetch('/api/portal/decompose-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskName: node.name, context: node.rawInput }),
      });
      const data = await res.json() as { ok?: boolean; steps?: Array<{ name: string; emoji?: string; durationMin?: number }> };
      if (data.ok && data.steps?.length) {
        const newSubtasks: SubTask[] = data.steps.map((s, i) => ({
          id: `st-${Date.now()}-${i}`,
          name: s.name,
          emoji: s.emoji,
          durationMin: s.durationMin,
          done: false,
        }));
        setSubtasks(newSubtasks);
        saveSubtasks(node.id, newSubtasks);
        onSubtasksChange(node.id, newSubtasks);
      }
    } catch { /* ignore */ }
    setDecomposing(false);
  }

  async function handleDrill(subtask: SubTask) {
    setDrillingId(subtask.id);
    try {
      const res = await fetch('/api/portal/decompose-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskName: subtask.name, context: node.name, drill: true }),
      });
      const data = await res.json() as { ok?: boolean; steps?: Array<{ name: string; emoji: string; durationMin: number }> };
      if (data.ok && data.steps?.length) {
        const steps: SubStep[] = data.steps.map((s, i) => ({
          id: `ss-${Date.now()}-${i}`,
          name: s.name,
          emoji: s.emoji || '▸',
          durationMin: s.durationMin || 1,
          done: false,
        }));
        setSubStepsMap((prev) => new Map(prev).set(subtask.id, steps));
      }
    } catch { /* ignore */ }
    setDrillingId(null);
  }

  function toggleSubStep(subtaskId: string, stepId: string) {
    setSubStepsMap((prev) => {
      const steps = prev.get(subtaskId) ?? [];
      const updated = steps.map((s) => s.id === stepId ? { ...s, done: !s.done } : s);
      return new Map(prev).set(subtaskId, updated);
    });
  }

  function handleToggle(subtaskId: string) {
    const next = subtasks.map((s) => s.id === subtaskId ? { ...s, done: !s.done } : s);
    setSubtasks(next);
    toggleSubtask(node.id, subtaskId);
    onSubtasksChange(node.id, next);
  }

  const doneCount = subtasks.filter((s) => s.done).length;
  const totalMin = subtasks.reduce((acc, s) => acc + (s.durationMin ?? 0), 0);

  // Meeting view
  if (isMeeting) {
    return (
      <div className="nesio-focus-detail nesio-focus-detail--meeting">
        <div className="nesio-focus-meeting-actions">
          {meetingUrl && (
            <a
              href={meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="nesio-focus-meeting-link-btn"
            >
              🔗 进入会议
            </a>
          )}
          {onOpenRecorder && (
            <button type="button" className="nesio-focus-meeting-record-btn" onClick={onOpenRecorder}>
              🎙 会议记录
            </button>
          )}
        </div>
        {meetingTime && (
          <p className="nesio-focus-meeting-prep-hint">提前 5 分钟打开，检查静音和摄像头</p>
        )}
      </div>
    );
  }

  // Task view with 2-level decompose
  const nodeUrl = Object.values(node.attributes).find(
    (v) => typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))
  ) as string | undefined;

  return (
    <div className="nesio-focus-detail">
      {nodeUrl && (
        <div className="nesio-focus-meeting-actions">
          <a href={nodeUrl} target="_blank" rel="noopener noreferrer" className="nesio-focus-meeting-link-btn">
            🔗 直达链接
          </a>
        </div>
      )}
      {subtasks.length > 0 ? (
        <>
          <div className="nesio-focus-detail-progress">
            <span className="nesio-focus-detail-progress-label">{doneCount}/{subtasks.length} 步完成</span>
            {totalMin > 0 && <span className="nesio-focus-detail-progress-time">共 {totalMin} 分钟</span>}
            <div className="nesio-focus-detail-progress-bar">
              <div
                className="nesio-focus-detail-progress-fill"
                style={{ width: `${subtasks.length ? (doneCount / subtasks.length) * 100 : 0}%` }}
              />
            </div>
          </div>

          <ul className="nesio-focus-subtask-list">
            {subtasks.map((s) => {
              const subSteps = subStepsMap.get(s.id);
              const isDrilling = drillingId === s.id;
              const subDoneCount = subSteps?.filter((ss) => ss.done).length ?? 0;

              return (
                <li key={s.id} className={`nesio-focus-subtask${s.done ? ' nesio-focus-subtask--done' : ''}`}>
                  <div className="nesio-focus-subtask-row">
                    <button
                      type="button"
                      className={`nesio-focus-subtask-check${s.done ? ' nesio-focus-subtask-check--checked' : ''}`}
                      onClick={() => handleToggle(s.id)}
                      aria-label={s.done ? '取消完成' : '标记完成'}
                    >
                      {s.done ? '✓' : '○'}
                    </button>
                    <span className="nesio-focus-subtask-emoji">{s.emoji || '▸'}</span>
                    <span className="nesio-focus-subtask-name">{s.name}</span>
                    {s.durationMin ? <span className="nesio-focus-subtask-time">{s.durationMin}m</span> : null}
                    {!subSteps && !isDrilling && !s.done && (
                      <button
                        type="button"
                        className="nesio-focus-drill-btn"
                        onClick={() => handleDrill(s)}
                      >
                        再拆
                      </button>
                    )}
                    {isDrilling && <span className="nesio-focus-drill-loading">…</span>}
                    {subSteps && (
                      <span className="nesio-focus-drill-badge">{subDoneCount}/{subSteps.length}</span>
                    )}
                  </div>

                  {subSteps && (
                    <ul className="nesio-focus-substep-list">
                      {subSteps.map((ss) => (
                        <li
                          key={ss.id}
                          className={`nesio-focus-substep${ss.done ? ' nesio-focus-substep--done' : ''}`}
                        >
                          <button
                            type="button"
                            className={`nesio-focus-substep-check${ss.done ? ' nesio-focus-substep-check--checked' : ''}`}
                            onClick={() => toggleSubStep(s.id, ss.id)}
                          >
                            {ss.done ? '✓' : '·'}
                          </button>
                          <span className="nesio-focus-substep-emoji">{ss.emoji}</span>
                          <span className="nesio-focus-substep-name">{ss.name}</span>
                          <span className="nesio-focus-substep-time">{ss.durationMin}m</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="nesio-focus-decompose-btn nesio-focus-decompose-btn--rerun"
            onClick={handleDecompose}
            disabled={decomposing}
          >
            {decomposing ? '重新拆解中…' : '↺ 重新拆解'}
          </button>
        </>
      ) : (
        <button type="button" className="nesio-focus-decompose-btn" onClick={handleDecompose} disabled={decomposing}>
          {decomposing ? (
            <><span className="nesio-focus-decompose-spinner" />拆解中…</>
          ) : (
            <>✦ 拆解任务</>
          )}
        </button>
      )}
    </div>
  );
}

// ---- Enhanced TodayFocusSection — max 2 visible + collapse ----

function TodayFocusSection({
  focusNodes,
  onOpenMemory,
  onOpenRecorder,
  onFocusMode,
}: {
  focusNodes: readonly FocusNode[];
  onOpenMemory?: () => void;
  onOpenRecorder?: (node: FocusNode) => void;
  onFocusMode?: (node: FocusNode) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState('');
  const [localNodes, setLocalNodes] = useState<FocusNode[]>([]);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const allNodes = [...localNodes, ...focusNodes.filter((n) => !localNodes.some((l) => l.id === n.id))];
  const visible = allNodes.filter((n) => !dismissed.has(n.id));
  const displayNodes = showAll ? visible : visible.slice(0, 2);
  const hiddenCount = visible.length - displayNodes.length;

  function handleDone(node: FocusNode) {
    setDoneIds((prev) => { const next = new Set(prev); next.add(node.id); return next; });
    setTimeout(() => {
      markFocusNodeDone(node.id);
      setDismissed((prev) => { const next = new Set(prev); next.add(node.id); return next; });
      if (expandedId === node.id) setExpandedId(null);
    }, 600);
  }

  function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = quickAdd.trim();
    if (!name) return;
    const node = addCommitmentNode(name);
    setLocalNodes((prev) => [node, ...prev]);
    setQuickAdd('');
    setExpandedId(node.id);
    inputRef.current?.blur();
  }

  function handleSubtasksChange(nodeId: string, subtasks: SubTask[]) {
    setLocalNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, subtasks } : n));
  }

  const doneToday = doneIds.size;

  return (
    <div className="nesio-focus-section">
      <div className="nesio-focus-header">
        <h2 className="nesio-focus-title">今日聚焦</h2>
        <div className="nesio-focus-header-right">
          {doneToday > 0 && (
            <span className="nesio-focus-done-badge">✓ 完成了 {doneToday} 件</span>
          )}
          {onOpenMemory && (
            <button type="button" className="nesio-focus-all-btn" onClick={onOpenMemory}>全部 ›</button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="nesio-focus-empty">
          <p>今天暂无聚焦事项</p>
          <p className="nesio-focus-empty-hint">{'说一句带时间的话（比如"周五有会议"），就会出现在这里。'}</p>
        </div>
      ) : (
        <>
          <div className="nesio-focus-cards">
            {displayNodes.map((node) => {
              const hint = focusTimeHint(node);
              const isDone = doneIds.has(node.id);
              const isExpanded = expandedId === node.id;
              const isMeeting = isMeetingNode(node);
              const meetingTime = isMeeting ? getMeetingTime(node) : null;
              const subtasks = node.subtasks ?? [];
              const doneSubtasks = subtasks.filter((s) => s.done).length;
              const typeIcon = isMeeting ? '📅' : (FOCUS_TYPE_ICON[node.type] || '📋');
              const typeLabel = isMeeting ? '会议' : (FOCUS_TYPE_LABEL[node.type] || '记录');

              return (
                <div
                  key={node.id}
                  className={`nesio-focus-card${isDone ? ' nesio-focus-card--done' : ''}${isExpanded ? ' nesio-focus-card--expanded' : ''}`}
                >
                  <div className="nesio-focus-card-row">
                    <button
                      type="button"
                      className={`nesio-focus-card-check${isDone ? ' nesio-focus-card-check--checked' : ''}`}
                      aria-label="完成"
                      onClick={() => handleDone(node)}
                    >
                      {isDone ? '✓' : '○'}
                    </button>
                    <button
                      type="button"
                      className="nesio-focus-card-body nesio-focus-card-body--tap"
                      onClick={() => setExpandedId(isExpanded ? null : node.id)}
                    >
                      <p className="nesio-focus-card-title">
                        <span className="nesio-focus-card-type-icon">{typeIcon}</span>
                        {node.name}
                      </p>
                      <p className="nesio-focus-card-meta">
                        <span className="nesio-focus-card-type">{typeLabel}</span>
                        {meetingTime && <MeetingCountdown startTime={meetingTime} />}
                        {!meetingTime && hint && <span className="nesio-focus-card-hint">{hint}</span>}
                        {subtasks.length > 0 && (
                          <span className="nesio-focus-card-subtask-badge">{doneSubtasks}/{subtasks.length} 步</span>
                        )}
                      </p>
                    </button>
                    {onFocusMode && !isDone && (
                      <button
                        type="button"
                        className="nesio-focus-card-focus-btn"
                        aria-label="进入聚焦模式"
                        onClick={() => onFocusMode(node)}
                        title="聚焦此事"
                      >
                        ◎
                      </button>
                    )}
                    <button
                      type="button"
                      className="nesio-focus-card-dismiss"
                      aria-label="暂时忽略"
                      onClick={() => setDismissed((prev) => { const next = new Set(prev); next.add(node.id); return next; })}
                    >
                      ✕
                    </button>
                  </div>

                  {isExpanded && (
                    <FocusCardDetail
                      node={node}
                      onSubtasksChange={handleSubtasksChange}
                      onOpenRecorder={isMeeting && onOpenRecorder ? () => onOpenRecorder(node) : undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {hiddenCount > 0 && (
            <button type="button" className="nesio-focus-show-more-btn" onClick={() => setShowAll(true)}>
              还有 {hiddenCount} 条 ↓
            </button>
          )}
          {showAll && visible.length > 2 && (
            <button type="button" className="nesio-focus-show-less-btn" onClick={() => setShowAll(false)}>
              收起 ↑
            </button>
          )}
        </>
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
  const [mirrorOpen, setMirrorOpen] = useState(false);

  // Proactive card state
  const [proactiveCards, setProactiveCards] = useState<ProactiveCardData[]>([]);
  const [proactiveDismissedDate, setProactiveDismissedDate] = useState<string>('');

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

      // Build triggers from all data sources and fire proactive card
      if (canUsePrivateData) {
        const triggers = buildProactiveTriggers(updated.focusNodes, updated.proactiveContext);
        if (triggers.length > 0) {
          // Show fallback cards immediately (no API wait)
          const fallbackCards: ProactiveCardData[] = triggers.slice(0, 1).map((t, i) => ({
            id: `fb${i}`,
            ...t.fallback,
          }));
          if (!cancelled) setProactiveCards(fallbackCards);

          // Then upgrade with Claude-polished version async
          fetch('/api/portal/proactive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ triggers }),
          })
            .then((r) => r.json())
            .then((d: { cards?: ProactiveCardData[] }) => {
              if (!cancelled && d.cards?.length) setProactiveCards(d.cards);
            })
            .catch(() => {}); // keep fallback on error
        }
      }
    };
    void applyViewModel();

    // Background Gmail sync — at most once every 6h, non-blocking
    if (canUsePrivateData && typeof window !== 'undefined') {
      const GMAIL_SYNC_KEY = 'nesio-gmail-last-sync';
      const lastSync = parseInt(localStorage.getItem(GMAIL_SYNC_KEY) || '0', 10);
      if (Date.now() - lastSync > 6 * 3_600_000) {
        localStorage.setItem(GMAIL_SYNC_KEY, String(Date.now()));
        fetch('/api/portal/gmail?includeBody=true&analyze=true')
          .then((r) => r.json())
          .then((d: { ok?: boolean; nodes?: unknown[] }) => {
            if (d.ok && d.nodes && d.nodes.length > 0) {
              window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
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
      window.removeEventListener('nesio-life-graph-updated', refresh);
      window.removeEventListener('nesio-connectors-refreshed', refresh);
      window.removeEventListener('nesio-weather-updated', refresh);
      window.removeEventListener('nesio-calendar-updated', refresh);
    };
  }, [canUsePrivateData]);

  const initials = canUsePrivateData ? (displayName.trim().slice(0, 1) || '我') : '我';
  const todayStr = new Date().toISOString().slice(0, 10);
  const showProactive = proactiveDismissedDate !== todayStr && proactiveCards.length > 0;

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

        {/* 未来引导卡片 — shows only when triggered */}
        {showProactive && (
          <ProactiveGuidanceCard
            card={proactiveCards[0]}
            onDismiss={() => setProactiveDismissedDate(new Date().toISOString().slice(0, 10))}
            onMarkDone={(nodeId) => markFocusNodeDone(nodeId)}
          />
        )}

        {/* 今日聚焦 — 会议 + 任务，max 2 visible */}
        <TodayFocusSection
          focusNodes={focusNodes}
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
