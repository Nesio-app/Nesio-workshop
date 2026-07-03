'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { DOMAINS, nodeDomain, type FrontDomain } from '@/lib/life-domain';
import { smartSearch, type SearchUnderstood } from '@/lib/portal/smart-search';
import {
  getProjects,
  createProject,
  deleteProject,
  type Project,
} from '@/lib/portal/project';
import { buildNarratorCards, type NarratorCard } from '@/lib/portal/memory-narrator';
import MemoryNodeDetail from './MemoryNodeDetail';

// ── Constants ─────────────────────────────────────────────────────────────────

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
const TYPE_ORDER = ['person', 'object', 'place', 'event', 'commitment', 'health_state', 'preference'];

const PROJECT_EMOJIS = ['📁', '🏠', '✈️', '🎯', '📚', '💪', '🎂', '🛠️', '🌱', '💡'];

const COPY = {
  zh: {
    searchPlaceholder: '问宝盒：娃娃在哪、上次买的药…',
    searchAria: '搜索记忆',
    clear: '清除',
    heroTitle: '散落的线索，回头找得到。',
    heroSub: '人、物、地点、承诺，由你放进来，由你随时找回。',
    noResult: (q: string) => `没有找到「${q}」`,
    noResultHint: '用中间按钮说一句「记住…」就会出现在这里',
    resultCount: (n: number) => `搜索结果（${n}）`,
    recent: '最近存的',
    more: (n: number) => `查看更多（${n}）`,
    syncFailed: (n: number) => `同步失败 ${n} 条，已保存在本机`,
    syncPending: (n: number) => `等待同步 ${n} 条`,
    syncDone: (n: number) => `已同步 ${n} 条`,
    allTypes: '全部',
    myProjects: '我的项目',
    newProject: '+ 新建',
    projectEmpty: '还没有记录。在记忆卡片里长按可以加入项目。',
    projectCount: (n: number) => `${n} 条记录`,
    createProjectTitle: '新建项目',
    createProjectPlaceholder: '项目名称，比如"装修"、"妈妈生日"…',
    createProjectConfirm: '创建',
    createProjectCancel: '取消',
  },
  en: {
    searchPlaceholder: 'Ask Nesio: doll, medicine...',
    searchAria: 'Search memory',
    clear: 'Clear',
    heroTitle: 'Scattered clues, easy to find later.',
    heroSub: 'People, objects, places, promises. Put them in, find them anytime.',
    noResult: (q: string) => `Nothing found for "${q}"`,
    noResultHint: 'Use the center button to save something first.',
    resultCount: (n: number) => `Results (${n})`,
    recent: 'Recent',
    more: (n: number) => `Show more (${n})`,
    syncFailed: (n: number) => `${n} sync failed. Saved locally.`,
    syncPending: (n: number) => `${n} waiting to sync.`,
    syncDone: (n: number) => `${n} synced`,
    allTypes: 'All',
    myProjects: 'My Projects',
    newProject: '+ New',
    projectEmpty: 'No items yet. Long-press a memory card to add.',
    projectCount: (n: number) => `${n} items`,
    createProjectTitle: 'New Project',
    createProjectPlaceholder: 'Name, e.g. "Renovation", "Mom\'s birthday"…',
    createProjectConfirm: 'Create',
    createProjectCancel: 'Cancel',
  },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractKeywords(text: string): string[] {
  const matches = text.match(/[一-鿿]{2,}|[a-zA-Z0-9]{3,}/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of matches) {
    const lw = w.toLowerCase();
    if (!seen.has(lw)) { seen.add(lw); out.push(lw); }
  }
  return out;
}

function findRelatedNodes(target: LifeNode, allNodes: LifeNode[]): LifeNode[] {
  const targetWords = extractKeywords(`${target.name} ${target.rawInput || ''}`);
  const targetTags = new Set(target.tags || []);
  return allNodes
    .filter((n) => n.id !== target.id)
    .map((node) => {
      let score = 0;
      if (target.relations.some((r) => r.targetId === node.id)) score += 10;
      if (node.relations.some((r) => r.targetId === target.id)) score += 10;
      score += (node.tags || []).filter((t) => targetTags.has(t)).length * 3;
      const nodeWords = extractKeywords(`${node.name} ${node.rawInput || ''}`);
      score += targetWords.filter((w) => nodeWords.includes(w)).length * 2;
      if (node.type === target.type) score += 1;
      const daysDiff = Math.abs(new Date(node.createdAt).getTime() - new Date(target.createdAt).getTime()) / 86_400_000;
      if (daysDiff <= 1) score += 2;
      else if (daysDiff <= 7) score += 1;
      return { node, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.node);
}

function findOnThisDayNodes(nodes: LifeNode[]): LifeNode[] {
  const today = new Date();
  return nodes.filter((n) => {
    const d = new Date(n.createdAt);
    return d.getMonth() === today.getMonth() && d.getDate() === today.getDate() && d.getFullYear() < today.getFullYear();
  });
}

function cleanMemoryPreview(node: LifeNode): string {
  const raw = node.rawInput || Object.values(node.attributes).join(' · ');
  return raw
    .replace(node.name, '')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, (v) => {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    })
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：·,-]+/, '')
    .trim()
    .slice(0, 44) || '来自你的记录';
}

function getNodeTypeMeta(node: LifeNode) {
  const a = node.attributes;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : '');
  switch (node.type) {
    case 'person': return { extra: str(a.relation) || str(a.role) || str(a.company) };
    case 'health_state': {
      const dateStr = str(a.date) || str(a.recordedAt);
      const dateLabel = dateStr ? new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '';
      const status = str(a.status);
      const badgeColor = status.includes('恢复') ? '#10b981' : status.includes('注意') ? '#f59e0b' : '#8b5cf6';
      return { extra: dateLabel, badge: status || undefined, badgeColor: status ? badgeColor : undefined };
    }
    case 'commitment': {
      const dueStr = str(a.dueDate) || str(a.due) || str(a.date);
      return { extra: dueStr ? `截止 ${new Date(dueStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}` : '' };
    }
    case 'object': {
      const loc = str(a.location) || str(a.where) || str(a.place) || str(a.storage);
      return { extra: loc ? `📍 ${loc}` : '' };
    }
    default: return {};
  }
}

function getPersonInitials(name: string) {
  const bgs = ['#c7d2fe', '#bfdbfe', '#a7f3d0', '#fbcfe8', '#fde68a', '#ddd6fe'];
  return { initials: name.slice(0, 1), bg: bgs[name.charCodeAt(0) % bgs.length] };
}

function visibleMemoryNodes(nodes: LifeNode[], canUse: boolean): LifeNode[] {
  return canUse ? nodes : nodes.filter((n) => !isPrivateExternalNode(n));
}

function shareTextForNode(node: LifeNode): string {
  const tags = node.tags?.length ? `\n标签：${node.tags.map((t) => `#${t}`).join(' ')}` : '';
  return `${node.name}\n${cleanMemoryPreview(node)}${tags}\n来自 Nesio Memory`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OnThisDayStrip({ nodes, onOpen }: { nodes: LifeNode[]; onOpen: (n: LifeNode) => void }) {
  const label = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  return (
    <div className="nesio-otd-wrap">
      <div className="nesio-otd-header">
        <span className="nesio-otd-icon">🗓</span>
        <span className="nesio-otd-label">历史上的今天 · {label}</span>
      </div>
      <div className="nesio-otd-scroll">
        {nodes.map((n) => (
          <button key={n.id} type="button" className="nesio-otd-card" onClick={() => onOpen(n)}>
            <span className="nesio-otd-card-year">{new Date(n.createdAt).getFullYear()} 年</span>
            <span className="nesio-otd-card-name">{n.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function NarratorCardView({ card, onOpen }: { card: NarratorCard; onOpen: (n: LifeNode) => void }) {
  const colorMap: Record<string, string> = {
    remember: 'var(--portal-accent)',
    commitment: '#f59e0b',
    activity: '#10b981',
  };
  const accent = colorMap[card.type] ?? 'var(--portal-accent)';
  return (
    <div className={`nesio-narrator-card nesio-narrator-card--${card.type}`} style={{ '--narrator-accent': accent } as React.CSSProperties}>
      <div className="nesio-narrator-title">{card.title}</div>
      <div className="nesio-narrator-body">{card.body}</div>
      {card.sub && <div className="nesio-narrator-sub">{card.sub}</div>}
      {card.nodes.length > 0 && (
        <button
          type="button"
          className="nesio-narrator-link"
          onClick={() => onOpen(card.nodes[0])}
        >
          查看详情 →
        </button>
      )}
    </div>
  );
}

function MemoryCard({ node, onOpen, onDeleted }: { node: LifeNode; onOpen: () => void; onDeleted: () => void }) {
  const startX = useRef(0);
  const startY = useRef(0);
  const swiped = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  async function shareNode() {
    swiped.current = true;
    clearTimer();
    const text = shareTextForNode(node);
    try {
      if (navigator.share) await navigator.share({ title: node.name, text });
      else await navigator.clipboard?.writeText(text);
    } catch { /* user cancelled */ }
  }

  const { extra, badge, badgeColor } = getNodeTypeMeta(node);
  const isPerson = node.type === 'person';
  const { initials, bg: avatarBg } = isPerson ? getPersonInitials(node.name) : { initials: '', bg: '' };
  const domain = nodeDomain(node);

  return (
    <button
      type="button"
      className="nesio-memory-card"
      onClick={() => { if (swiped.current) { swiped.current = false; return; } onOpen(); }}
      onPointerDown={(e) => {
        swiped.current = false;
        startX.current = e.clientX;
        startY.current = e.clientY;
        clearTimer();
        longPressTimer.current = setTimeout(shareNode, 620);
      }}
      onPointerMove={(e) => {
        const dx = e.clientX - startX.current;
        const dy = e.clientY - startY.current;
        if (Math.abs(dx) > 14 || Math.abs(dy) > 14) clearTimer();
        if (dx < -64 && Math.abs(dy) < 32) { swiped.current = true; clearTimer(); if (deleteLifeNode(node.id)) onDeleted(); }
      }}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
      onContextMenu={(e) => { e.preventDefault(); shareNode(); }}
      aria-label={`${node.name}，左滑删除，长按分享`}
    >
      {isPerson ? (
        <span className="nesio-memory-card-avatar" style={{ background: avatarBg }}>{initials}</span>
      ) : (
        <span className="nesio-memory-card-icon" style={{ background: TYPE_BG[node.type] || '#f0f4ff' }}>
          {TYPE_ICON[node.type] || '📌'}
        </span>
      )}
      <span className="nesio-memory-card-title">{node.name}</span>
      {extra && <span className="nesio-memory-card-extra">{extra}</span>}
      {badge && <span className="nesio-memory-card-status-badge" style={{ background: badgeColor }}>{badge}</span>}
      {!extra && !badge && <span className="nesio-memory-card-sub">{cleanMemoryPreview(node)}</span>}
      {domain ? <span className="nesio-memory-card-domain">{DOMAINS[domain].icon} {DOMAINS[domain].label}</span> : null}
    </button>
  );
}

function ProjectCard({ project, allNodes, onClick }: { project: Project; allNodes: LifeNode[]; onClick: () => void }) {
  const count = project.nodeIds.filter((id) => allNodes.some((n) => n.id === id)).length;
  return (
    <button type="button" className="nesio-project-card" onClick={onClick}>
      <span className="nesio-project-card-emoji">{project.emoji}</span>
      <span className="nesio-project-card-name">{project.name}</span>
      <span className="nesio-project-card-count">{count} 条</span>
    </button>
  );
}

function ProjectDetailSheet({
  project,
  allNodes,
  onClose,
  onDelete,
  onOpenNode,
}: {
  project: Project;
  allNodes: LifeNode[];
  onClose: () => void;
  onDelete: () => void;
  onOpenNode: (n: LifeNode) => void;
}) {
  const nodes = allNodes.filter((n) => project.nodeIds.includes(n.id));

  return (
    <>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-project-detail-sheet">
        <div className="nesio-project-detail-header">
          <span className="nesio-project-detail-emoji">{project.emoji}</span>
          <span className="nesio-project-detail-name">{project.name}</span>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        <div className="nesio-project-detail-stats">
          <span>{nodes.length} 条记录</span>
          <span>·</span>
          <span>{nodes.filter((n) => n.type === 'commitment').length} 个承诺</span>
        </div>
        {nodes.length === 0 ? (
          <p className="nesio-project-detail-empty">还没有记录。在记忆卡片里长按可以加入项目。</p>
        ) : (
          <div className="nesio-memory-grid" style={{ padding: '0 1rem 1rem' }}>
            {nodes.map((n) => (
              <MemoryCard key={n.id} node={n} onOpen={() => onOpenNode(n)} onDeleted={() => {}} />
            ))}
          </div>
        )}
        <div style={{ padding: '0 1rem 1.5rem' }}>
          <button
            type="button"
            className="nesio-project-delete-btn"
            onClick={() => { onDelete(); onClose(); }}
          >
            删除项目
          </button>
        </div>
      </div>
    </>
  );
}

function CreateProjectSheet({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, emoji: string) => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📁');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  return (
    <>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-create-project-sheet">
        <div className="nesio-create-project-header">
          <span>新建项目</span>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        <div className="nesio-create-project-emoji-row">
          {PROJECT_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className={`nesio-create-project-emoji-btn${emoji === e ? ' is-selected' : ''}`}
              onClick={() => setEmoji(e)}
            >
              {e}
            </button>
          ))}
        </div>
        <input
          ref={inputRef}
          className="nesio-create-project-input"
          placeholder='项目名称，比如"装修"、"妈妈生日"…'
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onCreate(name.trim(), emoji); onClose(); } }}
        />
        <button
          type="button"
          className="nesio-create-project-confirm"
          disabled={!name.trim()}
          onClick={() => { if (name.trim()) { onCreate(name.trim(), emoji); onClose(); } }}
        >
          创建
        </button>
      </div>
    </>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MemoryTab({ canUsePrivateData }: { canUsePrivateData: boolean }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [locale, setLocale] = useState<PortalLocale>(() => loadProfileSettings().locale);
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<LifeNode | null>(null);
  const [relatedNodes, setRelatedNodes] = useState<LifeNode[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [cloudSyncSummary, setCloudSyncSummary] = useState(getLifeGraphCloudSyncSummary());
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);

  const copy = COPY[portalLocaleToDictionaryLocale(locale)];

  const readNodes = useCallback(
    () => visibleMemoryNodes(getRecentNodes(30), canUsePrivateData),
    [canUsePrivateData],
  );

  useEffect(() => {
    const profile = loadProfileSettings();
    setLocale(profile.locale);
    setNodes(readNodes());
    setProjects(getProjects());

    let cancelled = false;

    async function hydrateCloud() {
      if (!canUsePrivateData) return;
      try {
        const client = createAppApiClient();
        const snapshot = await client.fetchCloudMemorySnapshot();
        if (cancelled || !snapshot.ok) return;
        mergeCloudMemorySnapshot({ nodes: snapshot.nodes || [], assets: snapshot.assets || [] });
        void retryLifeGraphCloudSync();
        void backfillLocalLifeGraphToCloud({ limit: 200 });
        if (!cancelled) setNodes(readNodes());
      } catch { /* best-effort */ }
    }
    void hydrateCloud();

    const onUpdate = () => setNodes(readNodes());
    const onSyncUpdate = () => setCloudSyncSummary(getLifeGraphCloudSyncSummary());
    const onProfileUpdate = () => {
      const p = loadProfileSettings();
      setLocale(p.locale);
    };
    const onProjectsUpdate = () => setProjects(getProjects());
    const retrySync = () => { if (canUsePrivateData) void retryLifeGraphCloudSync(); };

    window.addEventListener('nesio-life-graph-updated', onUpdate);
    window.addEventListener('nesio-life-graph-cloud-sync-updated', onSyncUpdate);
    window.addEventListener(PROFILE_UPDATED_EVENT, onProfileUpdate);
    window.addEventListener('nesio-projects-updated', onProjectsUpdate);
    window.addEventListener('online', retrySync);
    return () => {
      cancelled = true;
      window.removeEventListener('nesio-life-graph-updated', onUpdate);
      window.removeEventListener('nesio-life-graph-cloud-sync-updated', onSyncUpdate);
      window.removeEventListener(PROFILE_UPDATED_EVENT, onProfileUpdate);
      window.removeEventListener('nesio-projects-updated', onProjectsUpdate);
      window.removeEventListener('online', retrySync);
    };
  }, [canUsePrivateData, readNodes]);

  useEffect(() => {
    if (!canUsePrivateData && selectedNode && isPrivateExternalNode(selectedNode)) {
      setSelectedNode(null);
    }
  }, [canUsePrivateData, selectedNode]);

  // Narrator cards
  const narratorCards = useMemo(() => buildNarratorCards(nodes), [nodes]);

  // Smart search
  const { nodes: smartNodes, understood } = useMemo(
    () => query.trim()
      ? smartSearch(query, null)
      : { nodes: [], understood: { people: [], places: [], objects: [], domain: null } as SearchUnderstood },
    [query],
  );

  const hasUnderstoodEntities = understood.people.length + understood.places.length + understood.objects.length > 0;

  // Filtered nodes for browse mode
  const visibleNodes = useMemo(() => {
    let result = nodes;
    if (typeFilter) result = result.filter((n) => n.type === typeFilter);
    return result;
  }, [nodes, typeFilter]);

  const results = query.trim()
    ? visibleMemoryNodes(smartNodes, canUsePrivateData).filter((n) => !typeFilter || n.type === typeFilter)
    : visibleNodes;

  const visibleItems = showAll || query ? results : results.slice(0, 6);

  const typeCounts = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});

  const cloudSyncTotal = cloudSyncSummary.pendingCount + cloudSyncSummary.syncedCount + cloudSyncSummary.failedCount;

  const onThisDayNodes = useMemo(() => findOnThisDayNodes(nodes), [nodes]);

  function openNodeDetail(node: LifeNode) {
    setSelectedNode(node);
    setRelatedNodes(findRelatedNodes(node, nodes));
  }

  const isSearching = Boolean(query.trim());
  const hasNodes = nodes.length > 0;

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

          {/* AI understood */}
          {isSearching && hasUnderstoodEntities && (
            <div className="nesio-search-understood" aria-live="polite">
              <span className="nesio-search-understood-label">理解为</span>
              {understood.people.map((p) => <span key={p} className="nesio-search-understood-chip">👤 {p}</span>)}
              {understood.places.map((p) => <span key={p} className="nesio-search-understood-chip">📍 {p}</span>)}
              {understood.objects.map((o) => <span key={o} className="nesio-search-understood-chip">📦 {o}</span>)}
              {understood.domain && (
                <span className="nesio-search-understood-chip">{DOMAINS[understood.domain].icon} {DOMAINS[understood.domain].label}</span>
              )}
            </div>
          )}

          {/* ── Browse mode (not searching) ─────────────────────────────── */}
          {!isSearching && (
            <>
              {/* Narrator cards */}
              {narratorCards.length > 0 && (
                <div className="nesio-narrator-section">
                  {narratorCards.map((card) => (
                    <NarratorCardView key={card.type} card={card} onOpen={openNodeDetail} />
                  ))}
                </div>
              )}

              {/* On this day */}
              {onThisDayNodes.length > 0 && (
                <OnThisDayStrip nodes={onThisDayNodes} onOpen={openNodeDetail} />
              )}

              {/* My Projects */}
              <div className="nesio-projects-section">
                <div className="nesio-section-header">
                  <span className="nesio-section-title">{copy.myProjects}</span>
                  <button
                    type="button"
                    className="nesio-section-action"
                    onClick={() => setShowCreateProject(true)}
                  >
                    {copy.newProject}
                  </button>
                </div>
                {projects.length > 0 ? (
                  <div className="nesio-projects-row">
                    {projects.filter((p) => p.status === 'active').map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        allNodes={nodes}
                        onClick={() => setActiveProject(p)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="nesio-projects-empty">创建项目，把相关记录聚在一起</p>
                )}
              </div>

              {/* Recent memories */}
              {hasNodes && (
                <>
                  <div className="nesio-section-header" style={{ marginTop: '0.25rem' }}>
                    <span className="nesio-section-title">{copy.recent}</span>
                    {typeFilter && (
                      <button type="button" className="nesio-section-action" onClick={() => setTypeFilter(null)}>
                        清除筛选
                      </button>
                    )}
                  </div>

                  {/* Type filter — secondary, below header */}
                  <div className="nesio-memory-type-filter" role="group" aria-label="按类型筛选">
                    <button
                      type="button"
                      className={`nesio-type-chip${!typeFilter ? ' is-active' : ''}`}
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
                </>
              )}

              {/* Hero — empty state */}
              {!hasNodes && (
                <div className="nesio-memory-hero">
                  <h2 className="nesio-memory-hero-title">{copy.heroTitle}</h2>
                  <p className="nesio-memory-hero-sub">{copy.heroSub}</p>
                </div>
              )}
            </>
          )}

          {/* ── Search results header ───────────────────────────────────── */}
          {isSearching && results.length > 0 && (
            <div className="nesio-memory-section-label">{copy.resultCount(results.length)}</div>
          )}

          {/* Memory grid */}
          {results.length > 0 ? (
            <div className="nesio-memory-grid">
              {visibleItems.map((node) => (
                <MemoryCard
                  key={node.id}
                  node={node}
                  onOpen={() => openNodeDetail(node)}
                  onDeleted={() => setNodes(readNodes())}
                />
              ))}
            </div>
          ) : isSearching ? (
            <div className="nesio-memory-hero">
              <h2 className="nesio-memory-hero-title">{copy.noResult(query)}</h2>
              <p className="nesio-memory-hero-sub">{copy.noResultHint}</p>
            </div>
          ) : null}

          {/* Show more */}
          {!showAll && results.length > 6 && (
            <button
              type="button"
              className="nesio-memory-more-btn"
              onClick={() => setShowAll(true)}
            >
              {copy.more(results.length - 6)}
            </button>
          )}

          {/* Cloud sync status */}
          {cloudSyncTotal > 0 && (
            <div className="nesio-memory-sync-status">
              {cloudSyncSummary.failedCount > 0
                ? copy.syncFailed(cloudSyncSummary.failedCount)
                : cloudSyncSummary.pendingCount > 0
                  ? copy.syncPending(cloudSyncSummary.pendingCount)
                  : copy.syncDone(cloudSyncSummary.syncedCount)}
            </div>
          )}

          <div style={{ height: '5rem' }} />
        </div>
      </div>

      {/* Node detail sheet */}
      {selectedNode && (
        <MemoryNodeDetail
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          relatedNodes={relatedNodes}
          onOpenNode={(n) => { setSelectedNode(n); setRelatedNodes(findRelatedNodes(n, nodes)); }}
        />
      )}

      {/* Project detail sheet */}
      {activeProject && (
        <ProjectDetailSheet
          project={activeProject}
          allNodes={nodes}
          onClose={() => setActiveProject(null)}
          onDelete={() => deleteProject(activeProject.id)}
          onOpenNode={(n) => { setActiveProject(null); openNodeDetail(n); }}
        />
      )}

      {/* Create project sheet */}
      {showCreateProject && (
        <CreateProjectSheet
          onClose={() => setShowCreateProject(false)}
          onCreate={(name, emoji) => {
            createProject(name, emoji);
            setProjects(getProjects());
          }}
        />
      )}
    </>
  );
}
