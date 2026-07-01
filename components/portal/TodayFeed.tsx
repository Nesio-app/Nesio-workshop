'use client';

import { useEffect, useRef, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { recordCardFeedback, type RecommendationCard } from '@/lib/portal/reasoning-engine';
import { buildTodayViewModel, focusTimeHint, markFocusNodeDone, addCommitmentNode, saveSubtasks, toggleSubtask, type FocusNode, type SubTask } from '@/lib/platform/view-models/today-view-model';
import { learnFromFeedback } from '@/lib/portal/mirror-profile';
import { recordSignalFeedback } from '@/lib/life-domain/signal-feedback';
import { cloudSignalRowsToSignals, type CloudSignalRow } from '@/lib/life-domain/signal-search';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import VoiceBrief from './VoiceBrief';
import DailyBriefCard from './DailyBriefCard';
import LifeStateCard from './LifeStateCard';
import MirrorProfileCard from './MirrorProfileCard';

// Public fallback card: never implies Nesio knows private facts before consent/input.
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
        {/* Waveform teaser */}
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

/** 45-char physical fuse (PRD §5.1): the causal explanation in the evidence
 *  drawer is hard-capped so scan-reading never causes second-order fatigue. */
const EVIDENCE_CHAR_CAP = 45;
function capEvidence(text: string): string {
  return text.length > EVIDENCE_CHAR_CAP ? text.slice(0, EVIDENCE_CHAR_CAP - 1) + '…' : text;
}

/**
 * Progressive Collapse card (PRD §5.1). Default state = "0 explanation burden":
 * one high-precision line + primary action. Evidence/reasoning stay hidden
 * until the user actively asks「为什么」, then a ≤45-char drawer slides out.
 */
function StandardCard({ card, onFeedback }: { card: RecommendationCard; onFeedback: (f: RecommendationCard['feedback']) => void }) {
  const [done, setDone] = useState(false);
  const [why, setWhy] = useState(false);
  const needsInput = inferSourceStatus(card) === 'needs_input';
  if (done) return null;

  return (
    <div className="nesio-today-card nesio-today-card--collapse">
      {/* Always-visible: one-line suggestion + actions */}
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

      {/* Evidence drawer — only on demand, ≤45 chars */}
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

// --- Today Focus display constants ---

const FOCUS_TYPE_LABEL: Record<string, string> = {
  commitment: '承诺', event: '日程', object: '物品', person: '联系人',
  place: '地点', health_state: '健康', preference: '偏好',
};
const FOCUS_TYPE_ICON: Record<string, string> = {
  commitment: '🤝', event: '📅', object: '📦', person: '👤',
  place: '📍', health_state: '🩷', preference: '⭐',
};
const FOCUS_TYPE_BG: Record<string, string> = {
  commitment: '#ede9fe', event: '#fef3c7', object: '#dbeafe',
  person: '#e0e7ff', place: '#d1fae5', health_state: '#fce7f3', preference: '#f0fdf4',
};

function FocusCardDetail({
  node,
  onSubtasksChange,
}: {
  node: FocusNode;
  onSubtasksChange: (nodeId: string, subtasks: SubTask[]) => void;
}) {
  const [subtasks, setSubtasks] = useState<SubTask[]>(node.subtasks ?? []);
  const [decomposing, setDecomposing] = useState(false);

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

  function handleToggle(subtaskId: string) {
    const next = subtasks.map((s) => s.id === subtaskId ? { ...s, done: !s.done } : s);
    setSubtasks(next);
    toggleSubtask(node.id, subtaskId);
    onSubtasksChange(node.id, next);
  }

  const doneCount = subtasks.filter((s) => s.done).length;
  const totalMin = subtasks.reduce((acc, s) => acc + (s.durationMin ?? 0), 0);

  return (
    <div className="nesio-focus-detail">
      {subtasks.length > 0 ? (
        <>
          <div className="nesio-focus-detail-progress">
            <span className="nesio-focus-detail-progress-label">{doneCount}/{subtasks.length} 步完成</span>
            {totalMin > 0 && <span className="nesio-focus-detail-progress-time">共 {totalMin} 分钟</span>}
            <div className="nesio-focus-detail-progress-bar">
              <div className="nesio-focus-detail-progress-fill" style={{ width: `${subtasks.length ? (doneCount / subtasks.length) * 100 : 0}%` }} />
            </div>
          </div>
          <ul className="nesio-focus-subtask-list">
            {subtasks.map((s) => (
              <li key={s.id} className={`nesio-focus-subtask${s.done ? ' nesio-focus-subtask--done' : ''}`}>
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
                {s.durationMin && <span className="nesio-focus-subtask-time">{s.durationMin} min.</span>}
              </li>
            ))}
          </ul>
          <button type="button" className="nesio-focus-decompose-btn nesio-focus-decompose-btn--rerun" onClick={handleDecompose} disabled={decomposing}>
            {decomposing ? '重新拆解中…' : '↺ 重新拆解'}
          </button>
        </>
      ) : (
        <button type="button" className="nesio-focus-decompose-btn" onClick={handleDecompose} disabled={decomposing}>
          {decomposing ? (
            <><span className="nesio-focus-decompose-spinner" />AI 拆解中…</>
          ) : (
            <>✦ AI 拆解步骤</>
          )}
        </button>
      )}
    </div>
  );
}

function TodayFocusSection({
  focusNodes,
  onOpenMemory,
}: {
  focusNodes: readonly FocusNode[];
  onOpenMemory?: () => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState('');
  const [localNodes, setLocalNodes] = useState<FocusNode[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const allNodes = [...localNodes, ...focusNodes.filter((n) => !localNodes.some((l) => l.id === n.id))];
  const visible = allNodes.filter((n) => !dismissed.has(n.id));

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
        <h2 className="nesio-focus-title">今日焦点</h2>
        <div className="nesio-focus-header-right">
          {doneToday > 0 && (
            <span className="nesio-focus-done-badge">✓ 今天完成了 {doneToday} 件</span>
          )}
          {onOpenMemory && (
            <button type="button" className="nesio-focus-all-btn" onClick={onOpenMemory}>全部 ›</button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="nesio-focus-empty">
          <p>今天暂无焦点事项</p>
          <p className="nesio-focus-empty-hint">{'说一句带时间的话（比如"生日在周五"），就会出现在这里。'}</p>
        </div>
      ) : (
        <div className="nesio-focus-cards">
          {visible.map((node) => {
            const hint = focusTimeHint(node);
            const isDone = doneIds.has(node.id);
            const isExpanded = expandedId === node.id;
            const subtasks = node.subtasks ?? [];
            const doneSubtasks = subtasks.filter((s) => s.done).length;

            return (
              <div key={node.id} className={`nesio-focus-card${isDone ? ' nesio-focus-card--done' : ''}${isExpanded ? ' nesio-focus-card--expanded' : ''}`}>
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
                    <p className="nesio-focus-card-title">{node.name}</p>
                    <p className="nesio-focus-card-meta">
                      <span className="nesio-focus-card-type">{FOCUS_TYPE_LABEL[node.type] || '记录'}</span>
                      {hint && <span className="nesio-focus-card-hint">{hint}</span>}
                      {subtasks.length > 0 && (
                        <span className="nesio-focus-card-subtask-badge">{doneSubtasks}/{subtasks.length} 步</span>
                      )}
                    </p>
                  </button>
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
                  <FocusCardDetail node={node} onSubtasksChange={handleSubtasksChange} />
                )}
              </div>
            );
          })}
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
    </div>
  );
}

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

export default function TodayFeed({
  canUsePrivateData,
  onOpenMemory,
}: {
  canUsePrivateData: boolean;
  onOpenMemory?: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [cards, setCards] = useState<RecommendationCard[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);
  const [memoryNotes, setMemoryNotes] = useState<readonly string[]>([]);
  const [focusNodes, setFocusNodes] = useState<readonly FocusNode[]>([]);
  const [showMoreCards, setShowMoreCards] = useState(false);
  const [mirrorOpen, setMirrorOpen] = useState(false);

  useEffect(() => {
    if (canUsePrivateData) {
      const profile = loadProfileSettings();
      setDisplayName(profile.displayName || '');
    } else {
      setDisplayName('');
    }


    let cancelled = false;

    // Load cards through the Experience view-model. Cloud Signals are preferred
    // for signed-in users, with local projections kept as compatibility fallback.
    const applyViewModel = async () => {
      const cloudSignals = await loadCloudSignals(canUsePrivateData);
      const updated = buildTodayViewModel({ canUsePrivateData, fallbackCards: EMPTY_SIGNAL_CARDS, cloudSignals });
      if (cancelled) return;
      setCards(updated.cards);
      setMemoryCount(updated.memoryCount);
      setMemoryNotes(updated.memoryNotes);
      setFocusNodes(updated.focusNodes);
    };
    void applyViewModel();

    const refresh = () => {
      void applyViewModel();
    };

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

  function handleFeedback(cardId: string, feedback: RecommendationCard['feedback']) {
    const card = cards.find((c) => c.id === cardId);
    recordCardFeedback(cardId, feedback);
    if (card) {
      const evidenceSignalIds = Array.from(new Set([
        ...(card.evidenceSignalIds || []),
        ...card.evidence.map((entry) => entry.signalId).filter((id): id is string => Boolean(id)),
      ]));
      recordSignalFeedback(card, feedback);
      learnFromFeedback(card.domain, feedback);
      if (canUsePrivateData) {
        void createAppApiClient().recordCloudProductEvent({
          eventType: 'today.card.feedback',
          source: 'today-feed',
          targetType: card.type,
          targetId: cardId,
          feedback,
          payload: {
            domain: card.domain,
            evidenceSignalIds,
            sourceStatus: inferSourceStatus(card),
          },
        }).catch(() => {});
      }
    }
    if (feedback === 'too_much' || feedback === 'useful' || feedback === 'not_now') {
      setCards((prev) => prev.filter((c) => c.id !== cardId));
    }
  }

  const initials = canUsePrivateData ? (displayName.trim().slice(0, 1) || '我') : '我';

  return (
    <div className="nesio-today-root">
      <header className="nesio-today-header">
        <button
          type="button"
          className="nesio-today-brand"
          aria-label="打开 Nesio 整理出的线索"
          onClick={() => setMirrorOpen(true)}
        >
          <img src="/icons/treasurebox.svg" alt="Nesio" className="nesio-today-brand-icon" />
        </button>
        <a href="/settings" className="nesio-today-avatar" aria-label="我的设置">{initials}</a>
      </header>

      <div className="nesio-today-scroll">
        <>
            {/* 🔊 Slim briefing strip — just a button, not a card section */}
            <DailyBriefCard canUsePrivateData={canUsePrivateData} memoryCount={memoryCount} memoryNotes={memoryNotes} />

            {/* 今日焦点 — time-relevant Memory nodes surfaced via TodayViewModel */}
            <TodayFocusSection focusNodes={focusNodes} onOpenMemory={onOpenMemory} />

            {/* 今日状态 — health/energy only; hidden when no real signal data */}
            <LifeStateCard canUsePrivateData={canUsePrivateData} />

            {/* Secondary: AI recommendation cards (shown below fold) */}
            {cards.length > 0 && (
              <div className="nesio-today-cards">
                {(showMoreCards ? cards : cards.slice(0, 1)).map((card) =>
                  card.type === 'audio' ? (
                    <AudioCard key={card.id} card={card} onFeedback={(f) => handleFeedback(card.id, f)} />
                  ) : (
                    <StandardCard key={card.id} card={card} onFeedback={(f) => handleFeedback(card.id, f)} />
                  )
                )}
                {cards.length > 1 && (
                  <button
                    type="button"
                    className="nesio-today-more-btn"
                    onClick={() => setShowMoreCards((value) => !value)}
                  >
                    {showMoreCards ? '收起' : `更多（${cards.length - 1}）`}
                  </button>
                )}
              </div>
            )}
        </>
      </div>
      {mirrorOpen && (
        <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label="Nesio 整理出的线索">
          <button type="button" className="nesio-settings-sheet-backdrop" onClick={() => setMirrorOpen(false)} aria-label="关闭" />
          <div className="nesio-settings-sheet-card">
            <div className="nesio-sheet-handle" aria-hidden />
            <div className="nesio-settings-sheet-header">
              <h2 className="nesio-settings-sheet-title">整理出的线索</h2>
              <button type="button" className="nesio-settings-sheet-close" onClick={() => setMirrorOpen(false)} aria-label="关闭">✕</button>
            </div>
            <div className="nesio-settings-sheet-body">
              <MirrorProfileCard embedded />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
