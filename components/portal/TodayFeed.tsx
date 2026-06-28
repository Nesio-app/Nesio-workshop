'use client';

import { useEffect, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { recordCardFeedback, type RecommendationCard } from '@/lib/portal/reasoning-engine';
import { generateTodayCards } from '@/lib/intelligence';
import { getRecentNodes } from '@/lib/portal/life-graph';
import { learnFromFeedback } from '@/lib/portal/mirror-profile';
import VoiceBrief from './VoiceBrief';
import DailyBriefCard from './DailyBriefCard';
import LifeStateCard from './LifeStateCard';

// Public fallback card: never implies Nesio knows private facts before consent/input.
const EMPTY_SIGNAL_CARDS: RecommendationCard[] = [
  {
    id: 'needs-input-public',
    domain: 'home',
    domainLabel: '需要你的记录',
    confidence: 0.6,
    urgency: 1,
    icon: '✦',
    iconBg: '#8b9cf6',
    title: '还没有足够记忆',
    body: '告诉 Nesio 一件事，明天这里会出现带来源的建议。',
    tags: ['来源 · 需要输入'],
    evidence: [],
    primaryAction: '告诉 Nesio',
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
  return '需要你的输入';
}

function confidenceText(confidence: number) {
  if (confidence >= 0.82) return '比较确定';
  if (confidence >= 0.58) return '可能相关';
  return '建议确认';
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
          为什么{why ? ' ↑' : ' ↓'}
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

function NightTimeline() {
  return (
    <div className="nesio-today-night">
      <div className="nesio-today-night-hero">
        <p className="nesio-today-night-kicker">此刻 · 把你带回今天</p>
        <h2 className="nesio-today-night-title">还没有足够记忆<br />生成夜间建议</h2>
        <p className="nesio-today-night-sub">告诉 Nesio 一件事，夜间路径会开始显示带来源的轻提醒。</p>
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
  const [displayName, setDisplayName] = useState('Jessy');
  const [isNight, setIsNight] = useState(false);
  const [cards, setCards] = useState<RecommendationCard[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);

  useEffect(() => {
    const profile = loadProfileSettings();
    if (profile.displayName) setDisplayName(profile.displayName);

    const theme = document.documentElement.getAttribute('data-portal-theme');
    setIsNight(theme === 'night');
    const observer = new MutationObserver(() => {
      setIsNight(document.documentElement.getAttribute('data-portal-theme') === 'night');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-portal-theme'] });

    // Load initial cards. Public fallback must not imply private knowledge.
    // Note: connector collection + pruning are driven by the platform shell
    // (Portal.tsx), not the Experience layer — Today only consumes results.
    if (!canUsePrivateData) {
      setCards(EMPTY_SIGNAL_CARDS);
      setMemoryCount(0);
      return () => observer.disconnect();
    }

    const real = generateTodayCards();
    setCards(real.length > 0 ? real : EMPTY_SIGNAL_CARDS);
    setMemoryCount(getRecentNodes().length);

    const refresh = () => {
      const updated = generateTodayCards();
      setCards(updated.length > 0 ? updated : EMPTY_SIGNAL_CARDS);
      setMemoryCount(getRecentNodes().length);
    };

    window.addEventListener('nesio-life-graph-updated', refresh);
    window.addEventListener('nesio-connectors-refreshed', refresh);
    window.addEventListener('nesio-weather-updated', refresh);
    window.addEventListener('nesio-calendar-updated', refresh);

    return () => {
      observer.disconnect();
      window.removeEventListener('nesio-life-graph-updated', refresh);
      window.removeEventListener('nesio-connectors-refreshed', refresh);
      window.removeEventListener('nesio-weather-updated', refresh);
      window.removeEventListener('nesio-calendar-updated', refresh);
    };
  }, [canUsePrivateData]);

  function handleFeedback(cardId: string, feedback: RecommendationCard['feedback']) {
    const card = cards.find((c) => c.id === cardId);
    recordCardFeedback(cardId, feedback);
    if (card) learnFromFeedback(card.domain, feedback);
    if (feedback === 'too_much' || feedback === 'useful') {
      setCards((prev) => prev.filter((c) => c.id !== cardId));
    }
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const initials = displayName.trim().slice(0, 1) || 'J';

  return (
    <div className="nesio-today-root">
      <header className="nesio-today-header">
        <div className="nesio-today-brand">
          <img src="/icons/treasurebox-pwa-192.png" alt="Nesio" className="nesio-today-brand-icon" />
          <span className="nesio-today-brand-name">Nesio</span>
        </div>
        <a href="/settings" className="nesio-today-avatar" aria-label="我的设置">{initials}</a>
      </header>

      <div className="nesio-today-scroll">
        {isNight ? (
          <NightTimeline />
        ) : (
          <>
            {/* Always-present daily overview card */}
            <DailyBriefCard canUsePrivateData={canUsePrivateData} />

            {/* Cross-signal Life State (Signal → Life State pipeline output) */}
            <LifeStateCard canUsePrivateData={canUsePrivateData} />

            <div className="nesio-today-greeting">
              <h1 className="nesio-today-greeting-title">{greeting}，{displayName}。</h1>
              <p className="nesio-today-greeting-sub">
                {cards.length > 0
                  ? `今天，${cards.length} 件事想轻轻让你看见。`
                  : '今天暂时没有新建议，保持稳定就是好状态。'}
              </p>
            </div>

            {cards.length > 0 ? (
              <div className="nesio-today-cards">
                {cards.map((card) =>
                  card.type === 'audio' ? (
                    <AudioCard key={card.id} card={card} onFeedback={(f) => handleFeedback(card.id, f)} />
                  ) : (
                    <StandardCard key={card.id} card={card} onFeedback={(f) => handleFeedback(card.id, f)} />
                  )
                )}
              </div>
            ) : (
              <div className="nesio-today-empty">
                <div className="nesio-today-empty-icon" aria-hidden>✦</div>
                <h3 className="nesio-today-empty-title">今天的事都处理好了</h3>
                <p className="nesio-today-empty-sub">Nesio 持续关注你的日历、天气和记忆。有新动态会第一时间出现在这里。</p>
                <div className="nesio-today-empty-actions">
                  <button type="button" className="nesio-today-empty-action" onClick={onOpenMemory}>
                    <span>🗂</span> 看看 Memory
                  </button>
                  <button type="button" className="nesio-today-empty-action"
                    onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-tell'))}>
                    <span>✦</span> 告诉 Nesio 新事情
                  </button>
                </div>
                <p className="nesio-today-empty-hint">
                  提示：说「记住 xxx」或拍一下物品，明天 Today 会基于这些记忆生成建议。
                </p>
              </div>
            )}

            <button type="button" className="nesio-today-memory-link" onClick={onOpenMemory}>
              在 Memory 里看 {memoryCount > 0 ? `（${memoryCount} 条）` : ''} ›
            </button>
          </>
        )}
      </div>
    </div>
  );
}
