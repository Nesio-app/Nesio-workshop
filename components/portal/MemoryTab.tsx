'use client';

import { useEffect, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { getRecentNodes, searchLifeGraph, type LifeNode } from '@/lib/portal/life-graph';

const TYPE_ICON: Record<string, string> = {
  person: '👤', object: '📦', place: '📍', event: '📅',
  commitment: '🤝', health_state: '🩷', preference: '⭐',
};
const TYPE_BG: Record<string, string> = {
  person: '#e0e7ff', object: '#dbeafe', place: '#d1fae5',
  event: '#fef3c7', commitment: '#ede9fe', health_state: '#fce7f3', preference: '#f0fdf4',
};

const SEED_NODES: Array<{ icon: string; iconBg: string; title: string; subtitle: string; wide?: boolean }> = [
  { icon: '🎁', iconBg: '#d1fae5', title: 'Linda 礼物', subtitle: '娃娃 · 储物间蓝盒子' },
  { icon: '📅', iconBg: '#e0e7ff', title: 'Review 会议', subtitle: '昨天笔记 · 明早 9:30' },
  { icon: '🩷', iconBg: '#fce7f3', title: '感冒恢复', subtitle: '昨天记录 · 明天降温' },
  { icon: '🚗', iconBg: '#dbeafe', title: 'Tesla', subtitle: '电量与行程 · 即将接入' },
  { icon: '⬡', iconBg: '#ede9fe', title: 'Life Graph', subtitle: '娃娃 → 储物间 → Linda → 生日，背后已经连好。', wide: true },
];

function NodeCard({ node, wide }: { node: LifeNode; wide?: boolean }) {
  return (
    <button
      type="button"
      className={`nesio-memory-card${wide ? ' nesio-memory-card--wide' : ''}`}
    >
      <span className="nesio-memory-card-icon" style={{ background: TYPE_BG[node.type] || '#f0f4ff' }}>
        {TYPE_ICON[node.type] || '📌'}
      </span>
      <span className="nesio-memory-card-title">{node.name}</span>
      <span className="nesio-memory-card-sub">
        {node.rawInput
          ? node.rawInput.slice(0, 40)
          : Object.entries(node.attributes).map(([k, v]) => `${v}`).join(' · ').slice(0, 40)}
      </span>
    </button>
  );
}

export default function MemoryTab() {
  const [query, setQuery] = useState('');
  const [displayName, setDisplayName] = useState('Jessy');
  const [nodes, setNodes] = useState<LifeNode[]>([]);

  useEffect(() => {
    const profile = loadProfileSettings();
    if (profile.displayName) setDisplayName(profile.displayName);

    setNodes(getRecentNodes(20));

    const onUpdate = () => setNodes(getRecentNodes(20));
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    return () => window.removeEventListener('nesio-life-graph-updated', onUpdate);
  }, []);

  const results = query.trim() ? searchLifeGraph(query) : nodes;
  const initials = displayName.trim().slice(0, 1) || 'J';

  return (
    <div className="nesio-memory-root">
      <header className="nesio-today-header">
        <div className="nesio-today-brand">
          <img src="/icons/treasurebox-pwa-192.png" alt="Nesio" className="nesio-today-brand-icon" />
          <span className="nesio-today-brand-name">Memory</span>
        </div>
        <a href="/settings" className="nesio-today-avatar" aria-label="我的设置">{initials}</a>
      </header>

      <div className="nesio-memory-scroll">
        <div className="nesio-memory-search-wrap">
          <svg className="nesio-memory-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" aria-hidden>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            className="nesio-memory-search"
            placeholder="找回娃娃、会议、药、Tesla…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索记忆"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} style={{ color: 'var(--portal-muted)', fontSize: '0.9rem' }} aria-label="清除">✕</button>
          )}
        </div>

        {!query && (
          <div className="nesio-memory-hero">
            <h2 className="nesio-memory-hero-title">你的生活，连成一张图。</h2>
            <p className="nesio-memory-hero-sub">人、物、地点、会议、承诺，都能回头找到、彼此关联。</p>
          </div>
        )}

        {results.length > 0 ? (
          <>
            <p className="nesio-memory-section-label">{query ? `搜索结果（${results.length}）` : '最近想起'}</p>
            <div className="nesio-memory-grid">
              {results.map((node) => <NodeCard key={node.id} node={node} />)}
            </div>
          </>
        ) : query ? (
          <div className="nesio-memory-empty">
            <p>没有找到「{query}」</p>
            <p style={{ fontSize: '0.78rem', marginTop: '0.4rem', color: 'var(--portal-muted)' }}>用 Nesio 按钮记录后会出现在这里</p>
          </div>
        ) : (
          <>
            <p className="nesio-memory-section-label">最近想起</p>
            <div className="nesio-memory-grid">
              {SEED_NODES.map((n) => (
                <button key={n.title} type="button" className={`nesio-memory-card${n.wide ? ' nesio-memory-card--wide' : ''}`}>
                  <span className="nesio-memory-card-icon" style={{ background: n.iconBg }}>{n.icon}</span>
                  <span className="nesio-memory-card-title">{n.title}</span>
                  <span className="nesio-memory-card-sub">{n.subtitle}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="nesio-memory-add-wrap">
          <p className="nesio-memory-add-hint">用 Nesio 按钮随时记录，自动归入记忆图。</p>
        </div>
      </div>
    </div>
  );
}
