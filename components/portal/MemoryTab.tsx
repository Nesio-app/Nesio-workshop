'use client';

import { useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { useEffect } from 'react';

interface MemoryNode {
  id: string;
  icon: string;
  iconBg: string;
  title: string;
  subtitle: string;
  wide?: boolean;
}

const RECENT_NODES: MemoryNode[] = [
  { id: 'gift', icon: '🎁', iconBg: '#d1fae5', title: 'Linda 礼物', subtitle: '娃娃 · 储物间蓝盒子' },
  { id: 'review', icon: '📅', iconBg: '#e0e7ff', title: 'Review 会议', subtitle: '昨天笔记 · 明早 9:30' },
  { id: 'health', icon: '🩷', iconBg: '#fce7f3', title: '感冒恢复', subtitle: '昨天记录 · 明天降温' },
  { id: 'tesla', icon: '🚗', iconBg: '#dbeafe', title: 'Tesla', subtitle: '电量与行程 · 即将接入' },
  { id: 'graph', icon: '⬡', iconBg: '#ede9fe', title: 'Life Graph', subtitle: '娃娃 → 储物间 → Linda → 生日，背后已经连好。', wide: true },
];

export default function MemoryTab() {
  const [query, setQuery] = useState('');
  const [displayName, setDisplayName] = useState('Jessy');

  useEffect(() => {
    const profile = loadProfileSettings();
    if (profile.displayName) setDisplayName(profile.displayName);
  }, []);

  const initials = displayName.trim().slice(0, 1) || 'J';

  return (
    <div className="nesio-memory-root">
      <header className="nesio-today-header">
        <div className="nesio-today-brand">
          <img src="/icons/treasurebox-pwa-192.png" alt="Nesio" className="nesio-today-brand-icon" />
          <span className="nesio-today-brand-name">Memory</span>
        </div>
        <a href="/settings" className="nesio-today-avatar" aria-label="我的设置">
          {initials}
        </a>
      </header>

      <div className="nesio-memory-scroll">
        <div className="nesio-memory-search-wrap">
          <span className="nesio-memory-search-icon" aria-hidden>🔍</span>
          <input
            className="nesio-memory-search"
            placeholder="找回娃娃、会议、药、Tesla…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索记忆"
          />
        </div>

        <div className="nesio-memory-hero">
          <h2 className="nesio-memory-hero-title">你的生活，连成一张图。</h2>
          <p className="nesio-memory-hero-sub">人、物、地点、会议、承诺，都能回头找到、彼此关联。</p>
        </div>

        <p className="nesio-memory-section-label">最近想起</p>
        <div className="nesio-memory-grid">
          {RECENT_NODES.filter(n => !query || n.title.includes(query) || n.subtitle.includes(query)).map((node) => (
            <button
              key={node.id}
              type="button"
              className={`nesio-memory-card${node.wide ? ' nesio-memory-card--wide' : ''}`}
            >
              <span className="nesio-memory-card-icon" style={{ background: node.iconBg }}>
                {node.icon}
              </span>
              <span className="nesio-memory-card-title">{node.title}</span>
              <span className="nesio-memory-card-sub">{node.subtitle}</span>
            </button>
          ))}
        </div>

        <div className="nesio-memory-add-wrap">
          <p className="nesio-memory-add-hint">用 Nesio 按钮随时记录，自动归入记忆图。</p>
        </div>
      </div>
    </div>
  );
}
