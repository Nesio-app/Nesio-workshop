'use client';

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
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
  type LifeNode,
} from '@/lib/portal/life-graph';
import { ALL_DOMAINS, DOMAINS, nodeDomain, type FrontDomain } from '@/lib/life-domain';
import { smartSearch, type SearchUnderstood } from '@/lib/portal/smart-search';
import MemoryNodeDetail from './MemoryNodeDetail';

const TYPE_ICON: Record<string, string> = {
  person: '👤', object: '📦', place: '📍', event: '📅',
  commitment: '🤝', health_state: '🩷', preference: '⭐',
};
const TYPE_BG: Record<string, string> = {
  person: '#e0e7ff', object: '#dbeafe', place: '#d1fae5',
  event: '#fef3c7', commitment: '#ede9fe', health_state: '#fce7f3', preference: '#f0fdf4',
};
const TYPE_LABEL: Record<string, string> = {
  person: '人物', object: '物品', place: '地点',
  event: '事件', commitment: '承诺', health_state: '健康', preference: '偏好',
};
// How many nodes of this domain to reach 100% understanding
const DOMAIN_THRESHOLDS: Record<string, number> = {
  life: 20, growth: 15, assets: 15, health: 10, energy: 10,
};
const TYPE_ORDER = ['person', 'object', 'place', 'event', 'commitment', 'health_state', 'preference'];

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
    domainOverview: 'Nesio 了解你',
    domainUnderstand: (pct: number) => `了解 ${pct}%`,
    allTypes: '全部',
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
    noResult: (query: string) => `No clues found for "${query}"`,
    noResultHint: 'Use the center button to save something first.',
    resultCount: (count: number) => `Results (${count})`,
    recent: 'Recent clues',
    collapse: 'Collapse',
    more: (count: number) => `More clues (${count})`,
    syncFailed: (count: number) => `${count} sync failed. Saved on this device.`,
    syncPending: (count: number) => `${count} waiting to sync. Saved locally.`,
    syncDone: (count: number) => `${count} synced`,
    addHint: 'Use the center button to put something in, then ask Nesio for it later.',
    domainOverview: 'Nesio knows you',
    domainUnderstand: (pct: number) => `${pct}% known`,
    allTypes: 'All',
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

function getNodeTypeMeta(node: LifeNode): { extra?: string; badge?: string; badgeColor?: string } {
  const a = node.attributes;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : '');
  switch (node.type) {
    case 'person': {
      const role = str(a.relation) || str(a.role) || str(a.company);
      return { extra: role };
    }
    case 'health_state': {
      const dateStr = str(a.date) || str(a.recordedAt);
      const dateLabel = dateStr
        ? new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
        : '';
      const status = str(a.status);
      const badgeColor = status.includes('恢复') ? '#10b981' : status.includes('注意') || status.includes('发作') ? '#f59e0b' : '#8b5cf6';
      return { extra: dateLabel, badge: status || undefined, badgeColor: status ? badgeColor : undefined };
    }
    case 'commitment': {
      const dueStr = str(a.dueDate) || str(a.due) || str(a.date);
      const dateLabel = dueStr
        ? new Date(dueStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
        : '';
      return { extra: dateLabel ? `截止 ${dateLabel}` : '' };
    }
    case 'object': {
      const loc = str(a.location) || str(a.where) || str(a.place) || str(a.storage);
      return { extra: loc ? `📍 ${loc}` : '' };
    }
    default:
      return {};
  }
}

function getPersonInitials(name: string): { initials: string; bg: string } {
  const char = name.slice(0, 1);
  const bgs = ['#c7d2fe', '#bfdbfe', '#a7f3d0', '#fbcfe8', '#fde68a', '#ddd6fe'];
  return { initials: char, bg: bgs[name.charCodeAt(0) % bgs.length] };
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

  const { extra, badge, badgeColor } = getNodeTypeMeta(node);
  const isPerson = node.type === 'person';
  const { initials, bg: avatarBg } = isPerson ? getPersonInitials(node.name) : { initials: '', bg: '' };
  const domain = nodeDomain(node);

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
      {/* Icon / Avatar */}
      {isPerson ? (
        <span className="nesio-memory-card-avatar" style={{ background: avatarBg }}>
          {initials}
        </span>
      ) : (
        <span className="nesio-memory-card-icon" style={{ background: TYPE_BG[node.type] || '#f0f4ff' }}>
          {TYPE_ICON[node.type] || '📌'}
        </span>
      )}

      {/* Title */}
      <span className="nesio-memory-card-title">{node.name}</span>

      {/* Type-specific extra info */}
      {extra && <span className="nesio-memory-card-extra">{extra}</span>}

      {/* Status badge */}
      {badge && (
        <span className="nesio-memory-card-status-badge" style={{ background: badgeColor }}>
          {badge}
        </span>
      )}

      {/* Default subtitle when no extra */}
      {!extra && !badge && (
        <span className="nesio-memory-card-sub">{cleanMemoryPreview(node)}</span>
      )}

      {/* Domain badge */}
      {domain ? (
        <span className="nesio-memory-card-domain">{DOMAINS[domain].icon} {DOMAINS[domain].label}</span>
      ) : null}
    </button>
  );
}

export default function MemoryTab({ canUsePrivateData }: { canUsePrivateData: boolean }) {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<FrontDomain | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
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

  const visibleNodes = useMemo(() => {
    let result = byDomain(nodes);
    if (typeFilter) result = result.filter((n) => n.type === typeFilter);
    return result;
  }, [byDomain, nodes, typeFilter]);

  // Smart search: entity-boosted ranking. Domain filter is applied inside smartSearch.
  const { nodes: smartNodes, understood } = useMemo(
    () => (query.trim() ? smartSearch(query, domain) : { nodes: [], understood: { people: [], places: [], objects: [], domain: null } as SearchUnderstood }),
    [query, domain],
  );
  const results = query.trim()
    ? visibleMemoryNodes(smartNodes, canUsePrivateData).filter((n) => !typeFilter || n.type === typeFilter)
    : visibleNodes;
  const hasUnderstoodEntities =
    understood.people.length + understood.places.length + understood.objects.length > 0;
  const hasRealNodes = visibleNodes.length > 0 || nodes.length > 0;
  const sourceItems = query ? results : (hasRealNodes ? results : []);
  const visibleItems = showAll || query ? sourceItems : sourceItems.slice(0, 6);

  // Per-domain counts for the insight cards (from the full recent set).
  const domainCounts = nodes.reduce<Record<string, number>>((acc, node) => {
    const d = nodeDomain(node);
    if (d) acc[d] = (acc[d] || 0) + 1;
    return acc;
  }, {});

  // Per-type counts for type filter chips.
  const typeCounts = nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {});
  const hasTypedNodes = Object.keys(typeCounts).length > 0;

  // Domain insight data for the overview cards.
  const domainInsights = ALL_DOMAINS
    .filter((meta) => domainCounts[meta.id])
    .map((meta) => {
      const count = domainCounts[meta.id] || 0;
      const threshold = DOMAIN_THRESHOLDS[meta.id] || 15;
      const pct = Math.min(100, Math.round((count / threshold) * 100));
      const previews = nodes.filter((n) => nodeDomain(n) === meta.id).slice(0, 2).map((n) => n.name);
      return { ...meta, count, pct, previews };
    });

  const isFiltered = domain !== null || typeFilter !== null;

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

          {/* AI understood — show what entities the smart search extracted from the query. */}
          {query.trim() && hasUnderstoodEntities && (
            <div className="nesio-search-understood" aria-live="polite">
              <span className="nesio-search-understood-label">理解为</span>
              {understood.people.map((p) => (
                <span key={p} className="nesio-search-understood-chip">👤 {p}</span>
              ))}
              {understood.places.map((p) => (
                <span key={p} className="nesio-search-understood-chip">📍 {p}</span>
              ))}
              {understood.objects.map((o) => (
                <span key={o} className="nesio-search-understood-chip">📦 {o}</span>
              ))}
              {understood.domain && (
                <span className="nesio-search-understood-chip">
                  {DOMAINS[understood.domain].icon} {DOMAINS[understood.domain].label}
                </span>
              )}
            </div>
          )}

          {/* Domain insight cards — replaces old chip row */}
          {!query && domainInsights.length > 0 && (
            <div className="nesio-domain-insight-grid">
              {domainInsights.map((meta) => (
                <button
                  key={meta.id}
                  type="button"
                  className={`nesio-domain-insight${domain === meta.id ? ' is-active' : ''}`}
                  onClick={() => setDomain((d) => (d === meta.id ? null : meta.id))}
                  aria-pressed={domain === meta.id}
                >
                  <div className="nesio-domain-insight-head">
                    <span className="nesio-domain-insight-icon">{meta.icon}</span>
                    <span className="nesio-domain-insight-name">{meta.label}</span>
                    <span className="nesio-domain-insight-count">{meta.count}</span>
                  </div>
                  <div className="nesio-domain-insight-bar-track" role="progressbar" aria-valuenow={meta.pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="nesio-domain-insight-bar-fill" style={{ width: `${meta.pct}%` }} />
                  </div>
                  <div className="nesio-domain-insight-pct">{copy.domainUnderstand(meta.pct)}</div>
                  {meta.previews.length > 0 && (
                    <div className="nesio-domain-insight-previews">
                      {meta.previews.map((name) => (
                        <span key={name} className="nesio-domain-insight-preview-chip">{name}</span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Type filter bar */}
          {!query && hasTypedNodes && (
            <div className="nesio-memory-type-filter" role="group" aria-label="按类型筛选">
              <button
                type="button"
                className={`nesio-type-chip${typeFilter === null ? ' is-active' : ''}`}
                onClick={() => setTypeFilter(null)}
              >
                {copy.allTypes}
                <span className="nesio-type-chip-count">{nodes.length}</span>
              </button>
              {TYPE_ORDER.filter((t) => typeCounts[t]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`nesio-type-chip${typeFilter === t ? ' is-active' : ''}`}
                  onClick={() => setTypeFilter((prev) => (prev === t ? null : t))}
                >
                  {TYPE_ICON[t]} {TYPE_LABEL[t]}
                  <span className="nesio-type-chip-count">{typeCounts[t]}</span>
                </button>
              ))}
            </div>
          )}

          {/* Hero — only when empty */}
          {!query && !hasRealNodes && (
            <div className="nesio-memory-hero">
              <h2 className="nesio-memory-hero-title">{copy.heroTitle}</h2>
              <p className="nesio-memory-hero-sub">{copy.heroSub}</p>
            </div>
          )}

          {/* Active filter label */}
          {!query && isFiltered && (
            <div className="nesio-memory-filter-label">
              {domain && <span>{DOMAINS[domain].icon} {DOMAINS[domain].label}</span>}
              {typeFilter && <span>{TYPE_ICON[typeFilter]} {TYPE_LABEL[typeFilter]}</span>}
              <button
                type="button"
                className="nesio-memory-filter-clear"
                onClick={() => { setDomain(null); setTypeFilter(null); }}
              >
                清除筛选
              </button>
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
