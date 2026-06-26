'use client';

import { useEffect, useState } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { getRecentNodes, searchLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import MemoryNodeDetail from './MemoryNodeDetail';

const TYPE_ICON: Record<string, string> = {
  person: '👤', object: '📦', place: '📍', event: '📅',
  commitment: '🤝', health_state: '🩷', preference: '⭐',
};
const TYPE_BG: Record<string, string> = {
  person: '#e0e7ff', object: '#dbeafe', place: '#d1fae5',
  event: '#fef3c7', commitment: '#ede9fe', health_state: '#fce7f3', preference: '#f0fdf4',
};

const SEED_NODES = [
  { id: 's1', icon: '🎁', iconBg: '#d1fae5', title: 'Linda 礼物', subtitle: '娃娃 · 储物间蓝盒子' },
  { id: 's2', icon: '📅', iconBg: '#e0e7ff', title: 'Review 会议', subtitle: '昨天笔记 · 明早 9:30' },
  { id: 's3', icon: '🩷', iconBg: '#fce7f3', title: '感冒恢复', subtitle: '昨天记录 · 明天降温' },
  { id: 's4', icon: '🚗', iconBg: '#dbeafe', title: 'Tesla', subtitle: '电量与行程 · 即将接入' },
  { id: 'sg', icon: '⬡', iconBg: '#ede9fe', title: 'Life Graph', subtitle: '娃娃 → 储物间 → Linda → 生日，背后已经连好。', wide: true },
];

export default function MemoryTab() {
  const [query, setQuery] = useState('');
  const [displayName, setDisplayName] = useState('Jessy');
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<LifeNode | null>(null);

  useEffect(() => {
    const profile = loadProfileSettings();
    if (profile.displayName) setDisplayName(profile.displayName);
    setNodes(getRecentNodes(30));

    const onUpdate = () => setNodes(getRecentNodes(30));
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    return () => window.removeEventListener('nesio-life-graph-updated', onUpdate);
  }, []);

  const results = query.trim() ? searchLifeGraph(query) : nodes;
  const initials = displayName.trim().slice(0, 1) || 'J';
  const hasRealNodes = nodes.length > 0;

  return (
    <>
      <div className="nesio-memory-root">
        <header className="nesio-today-header">
          <div className="nesio-today-brand">
            <img src="/icons/treasurebox-pwa-192.png" alt="Nesio" className="nesio-today-brand-icon" />
            <span className="nesio-today-brand-name">Memory</span>
          </div>
          <a href="/settings" className="nesio-today-avatar" aria-label="我的设置">{initials}</a>
        </header>

        <div className="nesio-memory-scroll">
          {/* Search */}
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
              <button type="button" onClick={() => setQuery('')} style={{ color: 'var(--portal-muted)', fontSize: '0.85rem' }} aria-label="清除">✕</button>
            )}
          </div>

          {!query && (
            <div className="nesio-memory-hero">
              <h2 className="nesio-memory-hero-title">你的生活，连成一张图。</h2>
              <p className="nesio-memory-hero-sub">人、物、地点、会议、承诺，都能回头找到、彼此关联。</p>
            </div>
          )}

          {/* Results or empty */}
          {query && results.length === 0 ? (
            <div className="nesio-memory-empty">
              <p>没有找到「{query}」</p>
              <p style={{ fontSize: '0.78rem', marginTop: '0.4rem' }}>用 Nesio 按钮说一句「记住…」就会出现在这里</p>
            </div>
          ) : (
            <>
              <p className="nesio-memory-section-label">{query ? `搜索结果（${results.length}）` : '最近想起'}</p>
              <div className="nesio-memory-grid">
                {/* Real nodes */}
                {(query ? results : (hasRealNodes ? results : [])).map((node) => (
                  <button key={node.id} type="button"
                    className="nesio-memory-card"
                    onClick={() => setSelectedNode(node)}>
                    <span className="nesio-memory-card-icon" style={{ background: TYPE_BG[node.type] || '#f0f4ff' }}>
                      {TYPE_ICON[node.type] || '📌'}
                    </span>
                    <span className="nesio-memory-card-title">{node.name}</span>
                    <span className="nesio-memory-card-sub">{node.rawInput?.slice(0, 40) || Object.values(node.attributes).join(' · ').slice(0, 40)}</span>
                  </button>
                ))}

                {/* Seed cards when no real nodes */}
                {!query && !hasRealNodes && SEED_NODES.map((n) => (
                  <button key={n.id} type="button"
                    className={`nesio-memory-card${n.wide ? ' nesio-memory-card--wide' : ''}`}
                    onClick={() => {}}>
                    <span className="nesio-memory-card-icon" style={{ background: n.iconBg }}>{n.icon}</span>
                    <span className="nesio-memory-card-title">{n.title}</span>
                    <span className="nesio-memory-card-sub">{n.subtitle}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Gmail connect hint */}
          <div className="nesio-memory-connector-hint">
            <div className="nesio-memory-connector-row">
              <span style={{ fontSize: '1.1rem' }}>📧</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--portal-ink)' }}>接入 Gmail</p>
                <p style={{ fontSize: '0.72rem', color: 'var(--portal-muted)' }}>自动从邮件中抽取人、时间、承诺存入 Memory</p>
              </div>
              <a href="/settings" className="nesio-settings-toggle-btn" style={{ whiteSpace: 'nowrap' }}>设置</a>
            </div>
          </div>

          <div className="nesio-memory-add-wrap">
            <p className="nesio-memory-add-hint">用 Nesio 按钮随时记录，自动归入记忆图。</p>
          </div>
        </div>
      </div>

      <MemoryNodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />
    </>
  );
}
