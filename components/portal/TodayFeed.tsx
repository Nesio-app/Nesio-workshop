'use client';

import { useEffect, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { recordCardFeedback, type RecommendationCard } from '@/lib/portal/reasoning-engine';
import { generateTodayCards } from '@/lib/intelligence';
import { getRecentNodes } from '@/lib/portal/life-graph';
import { learnFromFeedback } from '@/lib/portal/mirror-profile';
import { runConnectors } from '@/lib/portal/connectors';
import VoiceBrief from './VoiceBrief';
import DailyBriefCard from './DailyBriefCard';
import LifeStateCard from './LifeStateCard';

// Fallback mock cards shown before real signals load
const MOCK_CARDS: RecommendationCard[] = [
  {
    id: 'coat-demo',
    domain: 'weather',
    domainLabel: '未来引导',
    confidence: 0.92,
    urgency: 3,
    icon: '🌧',
    iconBg: '#f59e0b',
    title: '把灰色外套放到门口',
    body: '明天午后会降温，你昨天记到嗓子还没全好。',
    tags: ['天气 · 降温', '健康 · 感冒记录'],
    evidence: [],
    primaryAction: '好的，放门口',
    secondaryAction: '稍后',
    type: 'standard',
    expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
  },
  {
    id: 'meeting-demo',
    domain: 'work',
    domainLabel: '语音简报',
    confidence: 0.88,
    urgency: 4,
    icon: '🎙',
    iconBg: '#6366f1',
    title: '明早的会，不用翻笔记',
    body: '昨天的会我整理成了 3 个音频重点，明早 9:10 提醒你。',
    evidence: [],
    primaryAction: '播放',
    secondaryAction: '改时间',
    type: 'audio',
    expiresAt: new Date(Date.now() + 12 * 3600000).toISOString(),
  },
  {
    id: 'gift-demo',
    domain: 'family',
    domainLabel: '家庭未来',
    confidence: 0.96,
    urgency: 3,
    icon: '🎁',
    iconBg: '#10b981',
    title: 'Linda 的礼物已经有了',
    body: '储物间蓝盒子 · 生日还有 3 天，需要包装。',
    evidence: [],
    primaryAction: '好的',
    secondaryAction: '去 Memory 看',
    type: 'standard',
    expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
  },
];

function AudioCard({ card, onFeedback }: { card: RecommendationCard; onFeedback: (f: RecommendationCard['feedback']) => void }) {
  const [briefOpen, setBriefOpen] = useState(false);
  return (
    <>
      <div className="nesio-today-card nesio-today-card--audio">
        <div className="nesio-today-card-header">
          <span className="nesio-today-card-domain">{card.domainLabel}</span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="nesio-today-card-duration">90 秒</span>
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
          <span className="nesio-today-audio-time">~90s</span>
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

function StandardCard({ card, onFeedback }: { card: RecommendationCard; onFeedback: (f: RecommendationCard['feedback']) => void }) {
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <div className="nesio-today-card">
      <div className="nesio-today-card-header">
        <span className="nesio-today-card-domain">{card.domainLabel}</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="nesio-today-card-conf">
            <span className="nesio-today-card-conf-dot" />
            {Math.round(card.confidence * 100)}% 把握
          </span>
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
      {card.tags && (
        <div className="nesio-today-card-tags">
          {card.tags.map((tag) => <span key={tag} className="nesio-today-card-tag">{tag}</span>)}
        </div>
      )}
      <div className="nesio-today-card-actions">
        <button type="button" className="nesio-today-btn nesio-today-btn--primary"
          onClick={() => { setDone(true); onFeedback('useful'); }}>{card.primaryAction}</button>
        {card.secondaryAction && (
          <button type="button" className="nesio-today-btn nesio-today-btn--ghost"
            onClick={() => onFeedback('not_now')}>{card.secondaryAction}</button>
        )}
      </div>
    </div>
  );
}

function NightTimeline() {
  return (
    <div className="nesio-today-night">
      <div className="nesio-today-night-hero">
        <p className="nesio-today-night-kicker">此刻 · 把你带回今天</p>
        <h2 className="nesio-today-night-title">把灰色外套<br />放到门口</h2>
        <p className="nesio-today-night-sub">明天午后降温，你的嗓子还在恢复。一个 30 秒的小动作。</p>
        <div className="nesio-today-night-actions">
          <span className="nesio-today-night-conf">● 92% 把握</span>
          <button type="button" className="nesio-today-btn nesio-today-btn--night">好的</button>
        </div>
      </div>
      <div className="nesio-today-night-timeline">
        <p className="nesio-today-night-timeline-label">今晚的路径</p>
        <ol className="nesio-today-night-steps">
          {[
            { time: '现在', label: '外套放门口', active: true },
            { time: '明早 9:10', label: '会议语音简报 · 90 秒', active: false },
            { time: '明晚', label: '包装 Linda 的礼物', active: false },
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

export default function TodayFeed({ onOpenMemory }: { onOpenMemory?: () => void }) {
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

    // Load initial cards (may be mock or cached-signal cards)
    const real = generateTodayCards();
    setCards(real.length > 0 ? real : MOCK_CARDS);
    setMemoryCount(getRecentNodes().length);

    // Run connectors (weather + calendar) — updates cache then fires events
    runConnectors().catch(() => undefined);

    const refresh = () => {
      const updated = generateTodayCards();
      setCards(updated.length > 0 ? updated : MOCK_CARDS);
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
  }, []);

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
            <DailyBriefCard />

            {/* Cross-signal Life State (Signal → Life State pipeline output) */}
            <LifeStateCard />

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
