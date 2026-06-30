'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import {
  PROFILE_UPDATED_EVENT,
  loadProfileSettings,
  portalLocaleToDictionaryLocale,
  type PortalLocale,
} from '@/lib/portal/profile';
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
import { ALL_DOMAINS, DOMAINS, nodeDomain, type FrontDomain } from '@/lib/life-domain';
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

const MEMORY_COPY = {
  zh: {
    searchPlaceholder: '问宝盒：娃娃在哪、上次买的药…',
    searchAria: '搜索记忆',
    clear: '清除',
    heroTitle: '散落的线索，回头找得到。',
    heroSub: '人、物、地点、会议、承诺，先由你放进来，再由你确认关联。',
    emptyPrimary: '这里会放你以后想找回的东西。',
    emptySecondary: '比如：娃娃在蓝盒子里、上次买的药、Jim 的会议提醒。',
    firstThing: '放进来第一件',
    loginSync: '登录同步',
    noResult: (query: string) => `没有找到「${query}」`,
    noResultHint: '用 Nesio 按钮说一句「记住…」就会出现在这里',
    resultCount: (count: number) => `搜索结果（${count}）`,
    recent: '最近想起',
    collapse: '收起线索',
    more: (count: number) => `更多线索（${count}）`,
    syncFailed: (count: number) => `同步失败 ${count} 条，已保存在本机`,
    syncPending: (count: number) => `等待同步 ${count} 条，本机已保存`,
    syncDone: (count: number) => `已同步 ${count} 条`,
    addHint: '点中间按钮把东西放进来，需要时再向宝盒要回线索。',
  },
  en: {
    searchPlaceholder: 'Ask Nesio: doll, last medicine...',
    searchAria: 'Search memory',
    clear: 'Clear',
    heroTitle: 'Scattered clues, easy to find later.',
    heroSub: 'People, objects, places, meetings, and promises go in first. You confirm the links.',
    emptyPrimary: 'Things you want to find later will live here.',
    emptySecondary: 'For example: doll in the blue box, last medicine, Jim meeting reminder.',
    firstThing: 'Add the first thing',
    loginSync: 'Sign in to sync',
    noResult: (query: string) => `No clues found for “${query}”`,
    noResultHint: 'Use the center button to save something first.',
    resultCount: (count: number) => `Results (${count})`,
    recent: 'Recent clues',
    collapse: 'Collapse',
    more: (count: number) => `More clues (${count})`,
    syncFailed: (count: number) => `${count} sync failed. Saved on this device.`,
    syncPending: (count: number) => `${count} waiting to sync. Saved locally.`,
    syncDone: (count: number) => `${count} synced`,
    addHint: 'Use the center button to put something in, then ask Nesio for it later.',
  },
} as const;

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
      {(() => {
        const d = nodeDomain(node);
        return d ? (
          <span className="nesio-memory-card-domain">{DOMAINS[d].icon} {DOMAINS[d].label}</span>
        ) : null;
      })()}
    </button>
  );
}

export default function MemoryTab({ canUsePrivateData }: { canUsePrivateData: boolean }) {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<FrontDomain | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [locale, setLocale] = useState<PortalLocale>(() => loadProfileSettings().locale);
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<LifeNode | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [cloudSyncSummary, setCloudSyncSummary] = useState(getLifeGraphCloudSyncSummary());
  const cloudSyncRecordCount =
    cloudSyncSummary.pendingCount + cloudSyncSummary.syncedCount + cloudSyncSummary.failedCount;
  const dictionaryLocale = portalLocaleToDictionaryLocale(locale);
  const copy = MEMORY_COPY[dictionaryLocale];

  const readRecentVisibleNodes = useCallback(() => {
    return visibleMemoryNodes(getRecentNodes(30), canUsePrivateData);
  }, [canUsePrivateData]);

  useEffect(() => {
    let cancelled = false;
    const profile = loadProfileSettings();
    setLocale(profile.locale);
    if (canUsePrivateData) {
      setDisplayName(profile.displayName || '');
    } else {
      setDisplayName('');
    }
    setNodes(readRecentVisibleNodes());

    async function hydrateCloudMemory() {
      if (!canUsePrivateData) return;
      try {
        const client = createAppApiClient();
        const snapshot = await client.fetchCloudMemorySnapshot();
        if (cancelled || !snapshot.ok) return;
        mergeCloudMemorySnapshot({ nodes: snapshot.nodes || [], assets: snapshot.assets || [] });
        void retryLifeGraphCloudSync();
        void backfillLocalLifeGraphToCloud({ limit: 200 });
        if (!cancelled) setNodes(readRecentVisibleNodes());
      } catch {
        // cloud hydration is best-effort; local Memory must keep working offline.
      }
    }

    void hydrateCloudMemory();

    const onUpdate = () => setNodes(readRecentVisibleNodes());
    function onCloudSyncUpdate() {
      setCloudSyncSummary(getLifeGraphCloudSyncSummary());
    }
    function onProfileUpdate() {
      const updatedProfile = loadProfileSettings();
      setLocale(updatedProfile.locale);
      setDisplayName(canUsePrivateData ? updatedProfile.displayName || '' : '');
    }
    function retryCloudSync() {
      if (!canUsePrivateData) return;
      void retryLifeGraphCloudSync();
    }
    window.addEventListener('nesio-life-graph-updated', onUpdate);
    window.addEventListener('nesio-life-graph-cloud-sync-updated', onCloudSyncUpdate);
    window.addEventListener(PROFILE_UPDATED_EVENT, onProfileUpdate);
    window.addEventListener('online', retryCloudSync);
    return () => {
      cancelled = true;
      window.removeEventListener('nesio-life-graph-updated', onUpdate);
      window.removeEventListener('nesio-life-graph-cloud-sync-updated', onCloudSyncUpdate);
      window.removeEventListener(PROFILE_UPDATED_EVENT, onProfileUpdate);
      window.removeEventListener('online', retryCloudSync);
    };
  }, [canUsePrivateData, readRecentVisibleNodes]);

  useEffect(() => {
    if (!canUsePrivateData && selectedNode && isPrivateExternalNode(selectedNode)) {
      setSelectedNode(null);
    }
  }, [canUsePrivateData, selectedNode]);

  const byDomain = useCallback(
    (list: LifeNode[]) => (domain ? list.filter((node) => nodeDomain(node) === domain) : list),
    [domain],
  );
  const visibleNodes = byDomain(nodes);
  const results = query.trim()
    ? byDomain(visibleMemoryNodes(searchLifeGraph(query), canUsePrivateData))
    : visibleNodes;
  const hasRealNodes = visibleNodes.length > 0;
  const sourceItems = query ? results : (hasRealNodes ? results : []);
  const visibleItems = showAll || query ? sourceItems : sourceItems.slice(0, 6);

  // Per-domain counts for the filter chips (from the full recent set).
  const domainCounts = nodes.reduce<Record<string, number>>((acc, node) => {
    const d = nodeDomain(node);
    if (d) acc[d] = (acc[d] || 0) + 1;
    return acc;
  }, {});
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
              placeholder={copy.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={copy.searchAria}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} style={{ color: 'var(--portal-muted)', fontSize: '0.85rem' }} aria-label={copy.clear}>✕</button>
            )}
          </div>

          {/* Domain filter — front-stage scenes (生活/成长/财物/健康/能量). */}
          {nodes.length > 0 && (
            <div className="nesio-memory-domains" role="tablist" aria-label="按领域筛选">
              <button
                type="button"
                role="tab"
                aria-selected={domain === null}
                className={`nesio-memory-domain-chip${domain === null ? ' is-active' : ''}`}
                onClick={() => setDomain(null)}
              >
                全部
              </button>
              {ALL_DOMAINS.filter((meta) => domainCounts[meta.id]).map((meta) => (
                <button
                  key={meta.id}
                  type="button"
                  role="tab"
                  aria-selected={domain === meta.id}
                  className={`nesio-memory-domain-chip${domain === meta.id ? ' is-active' : ''}`}
                  onClick={() => setDomain((current) => (current === meta.id ? null : meta.id))}
                >
                  {meta.icon} {meta.label}
                  <span className="nesio-memory-domain-count">{domainCounts[meta.id]}</span>
                </button>
              ))}
            </div>
          )}

          {!query && (
            <div className="nesio-memory-hero">
              <h2 className="nesio-memory-hero-title">{copy.heroTitle}</h2>
              <p className="nesio-memory-hero-sub">{copy.heroSub}</p>
            </div>
          )}

          {/* Results or empty */}
          {!query && !hasRealNodes ? (
            <div className="nesio-memory-empty">
              <p>{copy.emptyPrimary}</p>
              <p style={{ fontSize: '0.78rem', marginTop: '0.4rem' }}>
                {copy.emptySecondary}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="nesio-settings-toggle-btn"
                  onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-tell'))}
                >
                  {copy.firstThing}
                </button>
                <a href="/login" className="nesio-settings-toggle-btn" style={{ textDecoration: 'none' }}>{copy.loginSync}</a>
              </div>
            </div>
          ) : query && results.length === 0 ? (
            <div className="nesio-memory-empty">
              <p>{copy.noResult(query)}</p>
              <p style={{ fontSize: '0.78rem', marginTop: '0.4rem' }}>{copy.noResultHint}</p>
            </div>
          ) : (
            <>
              <p className="nesio-memory-section-label">{query ? copy.resultCount(results.length) : copy.recent}</p>
              <div className="nesio-memory-grid">
                {/* Real nodes */}
                {visibleItems.map((node) => (
                  <MemoryCard
                    key={node.id}
                    node={node}
                    onOpen={() => setSelectedNode(node)}
                    onDeleted={() => setNodes(readRecentVisibleNodes())}
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
              {!query && sourceItems.length > 6 && (
                <button
                  type="button"
                  className="nesio-memory-more-btn"
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll ? copy.collapse : copy.more(Math.max(0, sourceItems.length - 6))}
                </button>
              )}
            </>
          )}

          <div className="nesio-memory-add-wrap">
            {canUsePrivateData && cloudSyncRecordCount > 0 && (
              <p className="nesio-memory-sync-status" aria-live="polite">
                {cloudSyncSummary.failedCount > 0
                  ? copy.syncFailed(cloudSyncSummary.failedCount)
                  : cloudSyncSummary.pendingCount > 0
                    ? copy.syncPending(cloudSyncSummary.pendingCount)
                    : copy.syncDone(cloudSyncSummary.syncedCount)}
              </p>
            )}
            <p className="nesio-memory-add-hint">{copy.addHint}</p>
          </div>
        </div>
      </div>

      <MemoryNodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />
    </>
  );
}
