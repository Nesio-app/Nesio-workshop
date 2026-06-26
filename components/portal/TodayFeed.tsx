'use client';

import { useEffect, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';

interface RecommendationCard {
  id: string;
  domain: string;
  domainLabel: string;
  confidence: number;
  icon: string;
  iconBg: string;
  title: string;
  body: string;
  tags?: string[];
  primaryAction: string;
  secondaryAction?: string;
  type?: 'standard' | 'audio' | 'compact';
}

const MOCK_CARDS: RecommendationCard[] = [
  {
    id: 'coat',
    domain: 'weather',
    domainLabel: '未来引导',
    confidence: 92,
    icon: '🌧',
    iconBg: '#f59e0b',
    title: '把灰色外套放到门口',
    body: '明天午后会降温，你昨天记到嗓子还没全好。',
    tags: ['天气 · 降温', '健康 · 感冒记录'],
    primaryAction: '好的，放门口',
    secondaryAction: '稍后',
    type: 'standard',
  },
  {
    id: 'meeting',
    domain: 'work',
    domainLabel: '语音简报',
    confidence: 90,
    icon: '🎙',
    iconBg: '#6366f1',
    title: '明早的会，不用翻笔记',
    body: '昨天的会我整理成了 3 个音频重点，明早 9:10 提醒你。',
    primaryAction: '播放',
    secondaryAction: '改时间',
    type: 'audio',
  },
  {
    id: 'gift',
    domain: 'family',
    domainLabel: '家庭未来',
    confidence: 96,
    icon: '🎁',
    iconBg: '#10b981',
    title: 'Linda 的礼物已经有了',
    body: '储物间蓝盒子 · 生日还有 3 天，需要包装。',
    primaryAction: '好的',
    secondaryAction: '去 Memory 看',
    type: 'standard',
  },
];

function AudioCard({ card }: { card: RecommendationCard }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="nesio-today-card nesio-today-card--audio">
      <div className="nesio-today-card-header">
        <span className="nesio-today-card-domain">{card.domainLabel}</span>
        <span className="nesio-today-card-duration">90 秒</span>
      </div>
      <div className="nesio-today-card-row">
        <span className="nesio-today-card-icon-wrap" style={{ background: card.iconBg }}>
          {card.icon}
        </span>
        <div>
          <h3 className="nesio-today-card-title">{card.title}</h3>
          <p className="nesio-today-card-body">{card.body}</p>
        </div>
      </div>
      <div className="nesio-today-audio-player">
        <button
          type="button"
          className="nesio-today-audio-play"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <div className="nesio-today-audio-wave" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i} className={`nesio-today-audio-bar${playing ? ' nesio-today-audio-bar--active' : ''}`}
              style={{ height: `${8 + Math.sin(i * 0.7) * 6}px`, animationDelay: `${i * 0.05}s` }} />
          ))}
        </div>
        <span className="nesio-today-audio-time">1:30</span>
      </div>
      <div className="nesio-today-card-actions">
        <button type="button" className="nesio-today-btn nesio-today-btn--primary"
          onClick={() => setPlaying(true)}>{card.primaryAction}</button>
        {card.secondaryAction && (
          <button type="button" className="nesio-today-btn nesio-today-btn--ghost">{card.secondaryAction}</button>
        )}
      </div>
    </div>
  );
}

function StandardCard({ card }: { card: RecommendationCard }) {
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <div className="nesio-today-card">
      <div className="nesio-today-card-header">
        <span className="nesio-today-card-domain">{card.domainLabel}</span>
        <span className="nesio-today-card-conf">
          <span className="nesio-today-card-conf-dot" />
          {card.confidence}% 把握
        </span>
      </div>
      <div className="nesio-today-card-row">
        <span className="nesio-today-card-icon-wrap" style={{ background: card.iconBg }}>
          {card.icon}
        </span>
        <div>
          <h3 className="nesio-today-card-title">{card.title}</h3>
          <p className="nesio-today-card-body">{card.body}</p>
        </div>
      </div>
      {card.tags && (
        <div className="nesio-today-card-tags">
          {card.tags.map((tag) => (
            <span key={tag} className="nesio-today-card-tag">{tag}</span>
          ))}
        </div>
      )}
      <div className="nesio-today-card-actions">
        <button type="button" className="nesio-today-btn nesio-today-btn--primary"
          onClick={() => setDone(true)}>{card.primaryAction}</button>
        {card.secondaryAction && (
          <button type="button" className="nesio-today-btn nesio-today-btn--ghost">{card.secondaryAction}</button>
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

  useEffect(() => {
    const profile = loadProfileSettings();
    if (profile.displayName) setDisplayName(profile.displayName);
    const theme = document.documentElement.getAttribute('data-portal-theme');
    setIsNight(theme === 'night');
    const observer = new MutationObserver(() => {
      setIsNight(document.documentElement.getAttribute('data-portal-theme') === 'night');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-portal-theme'] });
    return () => observer.disconnect();
  }, []);

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
        <a href="/settings" className="nesio-today-avatar" aria-label="我的设置">
          {initials}
        </a>
      </header>

      <div className="nesio-today-scroll">
        {isNight ? (
          <NightTimeline />
        ) : (
          <>
            <div className="nesio-today-greeting">
              <h1 className="nesio-today-greeting-title">{greeting}，{displayName}。</h1>
              <p className="nesio-today-greeting-sub">今天，三件事想轻轻让你看见。</p>
            </div>

            <div className="nesio-today-cards">
              {MOCK_CARDS.map((card) =>
                card.type === 'audio' ? (
                  <AudioCard key={card.id} card={card} />
                ) : (
                  <StandardCard key={card.id} card={card} />
                )
              )}
            </div>

            <button
              type="button"
              className="nesio-today-memory-link"
              onClick={onOpenMemory}
            >
              在 Memory 里看 &rsaquo;
            </button>
          </>
        )}
      </div>
    </div>
  );
}
