'use client';

import { useRef, useState, useEffect } from 'react';
import { loadProfileSettings } from '@/lib/portal/profile';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import {
  backfillLocalLifeGraphToCloud,
  deleteLifeNode,
  getLifeGraphCloudSyncSummary,
  getRecentNodes,
  isPrivateExternalNode,
  mergeCloudMemorySnapshot,
  retryLifeGraphCloudSync,
  searchLifeGraph,
  type LifeNode,
} from '@/lib/portal/life-graph';
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
  { id: 'sg', icon: '⬡', iconBg: '#ede9fe', title: '线索已经连上', subtitle: '娃娃、储物间、Linda、生日，都能回头找得到。', wide: true },
];

function cleanMemoryPreview(node: LifeNode): string {
  const raw = node.rawInput || Object.values(node.attributes).join(' · ');
  return raw
    .replace(node.name, '')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, (value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    })
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：·,-]+/, '')
    .trim()
    .slice(0, 44) || '来自你的记录';
}

function visibleMemoryNodes(nodes: LifeNode[], canUsePrivateData: boolean): LifeNode[] {
  return canUsePrivateData ? nodes : nodes.filter((node) => !isPrivateExternalNode(node));
}

function shareTextForNode(node: LifeNode): string {
  const tags = node.tags?.length ? `\n标签：${node.tags.map((tag) => `#${tag}`).join(' ')}` : '';
  const preview = cleanMemoryPreview(node);
  return `${node.name}\n${preview}${tags}\n来自 Nesio Memory`;
}

function MemoryCard({
  node,
  onOpen,
  onDeleted,
}: {
  node: LifeNode;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const startX = useRef(0);
  const startY = useRef(0);
  const swiped = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  async function shareNode() {
    swiped.current = true;
    clearTimer();
    const text = shareTextForNode(node);
    try {
      if (navigator.share) {
        await navigator.share({ title: node.name, text });
      } else {
        await navigator.clipboard?.writeText(text);
      }
    } catch {
      /* user cancelled or clipboard unavailable */
    }
  }

  return (
    <button
      type="button"
      className="nesio-memory-card"
      onClick={() => {
        if (swiped.current) {
          swiped.current = false;
          return;
        }
        onOpen();
      }}
      onPointerDown={(event) => {
        swiped.current = false;
        startX.current = event.clientX;
        startY.current = event.clientY;
        clearTimer();
        longPressTimer.current = setTimeout(shareNode, 620);
      }}
      onPointerMove={(event) => {
        const dx = event.clientX - startX.current;
        const dy = event.clientY - startY.current;
        if (Math.abs(dx) > 14 || Math.abs(dy) > 14) clearTimer();
        if (dx < -64 && Math.abs(dy) < 32) {
          swiped.current = true;
          clearTimer();
          if (deleteLifeNode(node.id)) onDeleted();
        }
      }}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
      onContextMenu={(event) => {
        event.preventDefault();
        shareNode();
      }}
      aria-label={`${node.name}，左滑删除，长按分享`}
    >
      <span className="nesio-memory-card-icon" style={{ background: TYPE_BG[node.type] || '#f0f4ff' }}>
        {TYPE_ICON[node.type] || '📌'}
      </span>
      <span className="nesio-memory-card-title">{node.name}</span>
      <span className="nesio-memory-card-sub">{cleanMemoryPreview(node)}</span>
    </button>
  );
}

export default function MemoryTab({ canUsePrivateData }: { canUsePrivateData: boolean }) {
  const [query, setQuery] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<LifeNode | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [cloudSyncSummary, setCloudSyncSummary] = useState(getLifeGraphCloudSyncSummary());
  const cloudSyncRecordCount =
    cloudSyncSummary.pendingCount + cloudSyncSummary.syncedCount + cloudSyncSummary.failedCount;

  useEffect(() => {
    let cancelled = false;
    if (canUsePrivateData) {
      const profile = loadProfileSettings();
      setDisplayName(profile.displayName || '');
    } else {
      setDisplayName('');
    }
    setNodes(getRecentNodes(30));

    async function hydrateCloudMemory() {
      if (!canUsePrivateData) return;
      try {
        const client = createAppApiClient();
        const snapshot = await client.fetchCloudMemorySnapshot();
        if (cancelled || !snapshot.ok) return;
        mergeCloudMemorySnapshot({ nodes: snapshot.nodes || [], assets: snapshot.assets || [] });
        void retryLifeGraphCloudSync();
        void backfillLocalLifeGraphToCloud({ limit: 200 });
        if (!cancelled) setNodes(getRecentNodes(30));
      } catch {
        // cloud hydration is best-effort; local Memory must keep working offline.
      }
    }

    void hydrateCloudMemory();

    const onUpdate = () => setNodes(getRecentNodes(30));
    function onCloudSyncUpdate() {
      setCloudSyncSummary(getLifeGraphCloudSyncSummary());
    }
    function retryCloudSync() {
      if (!canUsePrivateData) return;
      void retryLifeGraphCloudSync();
    }
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    window.addEventListener('nesio-life-graph-cloud-sync-updated', onCloudSyncUpdate);
    window.addEventListener('online', retryCloudSync);
    return () => {
      cancelled = true;
      window.removeEventListener('nesio-life-graph-updated', onUpdate);
      window.removeEventListener('nesio-life-graph-cloud-sync-updated', onCloudSyncUpdate);
      window.removeEventListener('online', retryCloudSync);
    };
  }, [canUsePrivateData]);

  const visibleNodes = visibleMemoryNodes(nodes, canUsePrivateData);
  const results = query.trim()
    ? visibleMemoryNodes(searchLifeGraph(query), canUsePrivateData)
    : visibleNodes;
  const hasRealNodes = visibleNodes.length > 0;
  const sourceItems = query ? results : (hasRealNodes ? results : []);
  const visibleItems = showAll || query ? sourceItems : sourceItems.slice(0, 6);
  return (
    <>
      <div className="nesio-memory-root">
        <div className="nesio-memory-scroll">
          {/* Search */}
          <div className="nesio-memory-search-wrap">
            <svg className="nesio-memory-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" aria-hidden>
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              className="nesio-memory-search"
              placeholder="问宝盒：娃娃在哪、上次买的药…"
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
              <h2 className="nesio-memory-hero-title">散落的线索，回头找得到。</h2>
              <p className="nesio-memory-hero-sub">人、物、地点、会议、承诺，先由你放进来，再由你确认关联。</p>
            </div>
          )}

          {/* Results or empty */}
          {!query && !hasRealNodes ? (
            <div className="nesio-memory-empty">
              <p>这里会放你以后想找回的东西。</p>
              <p style={{ fontSize: '0.78rem', marginTop: '0.4rem' }}>
                比如：娃娃在蓝盒子里、上次买的药、Jim 的会议提醒。
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="nesio-settings-toggle-btn"
                  onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-tell'))}
                >
                  放进来第一件
                </button>
                <a href="/login" className="nesio-settings-toggle-btn" style={{ textDecoration: 'none' }}>登录同步</a>
              </div>
            </div>
          ) : query && results.length === 0 ? (
            <div className="nesio-memory-empty">
              <p>没有找到「{query}」</p>
              <p style={{ fontSize: '0.78rem', marginTop: '0.4rem' }}>用 Nesio 按钮说一句「记住…」就会出现在这里</p>
            </div>
          ) : (
            <>
              <p className="nesio-memory-section-label">{query ? `搜索结果（${results.length}）` : '最近想起'}</p>
              <div className="nesio-memory-grid">
                {/* Real nodes */}
                {visibleItems.map((node) => (
                  <MemoryCard
                    key={node.id}
                    node={node}
                    onOpen={() => setSelectedNode(node)}
                    onDeleted={() => setNodes(getRecentNodes(30))}
                  />
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
              {!query && sourceItems.length > 3 && (
                <button
                  type="button"
                  className="nesio-memory-more-btn"
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll ? '收起线索' : `更多线索（${sourceItems.length - 6}）`}
                </button>
              )}
            </>
          )}

          <div className="nesio-memory-add-wrap">
            {canUsePrivateData && cloudSyncRecordCount > 0 && (
              <p className="nesio-memory-sync-status" aria-live="polite">
                {cloudSyncSummary.failedCount > 0
                  ? `同步失败 ${cloudSyncSummary.failedCount} 条，已保存在本机`
                  : cloudSyncSummary.pendingCount > 0
                    ? `等待同步 ${cloudSyncSummary.pendingCount} 条，本机已保存`
                    : `已同步 ${cloudSyncSummary.syncedCount} 条`}
              </p>
            )}
            <p className="nesio-memory-add-hint">点中间按钮把东西放进来，需要时再向宝盒要回线索。</p>
          </div>
        </div>
      </div>

      <MemoryNodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />
    </>
  );
}
