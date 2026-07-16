'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  getLifeGraph,
  getLifeGraphCloudSyncSummary,
  isBulkImported,
  isPrivateExternalNode,
  mergeCloudMemorySnapshot,
  retryLifeGraphCloudSync,
  updateLifeNode,
  type LifeNode,
} from '@/lib/portal/life-graph';
import { pinNodeToTodayFocus } from '@/lib/platform/view-models/today-commands';
import { DOMAINS } from '@/lib/life-domain';
import { isFeatureEnabled } from '@/lib/portal/module-overrides';
import { smartSearch, type SearchUnderstood } from '@/lib/portal/smart-search';
import { isNodeUncertain } from '@/lib/portal/node-provenance';
import { semanticRerank } from '@/lib/portal/semantic-rerank';
import { DEMO_SEED_NODES, isDemoNode } from '@/lib/portal/demo-seed';
import { seedSampleData, clearSampleData, hasSampleData } from '@/lib/portal/sample-data';
import {
  getProjects,
  createProject,
  deleteProject,
  updateProject,
  addNodeToProject,
  type Project,
  type ProjectStatus,
} from '@/lib/portal/project';
import { buildNarratorCards, type NarratorCard } from '@/lib/portal/memory-narrator';
import dynamic from 'next/dynamic';

// Detail/graph views load on first open, not with the tab
const MemoryNodeDetail = dynamic(() => import('./MemoryNodeDetail'), { ssr: false });
const RelationGraph = dynamic(() => import('./RelationGraph'), { ssr: false });
import type { GNode, GEdge } from '@/lib/platform/graph-engine';
import { DomainIcon, IconBox, IconBookmark, IconCalendar, IconCamera, IconCheckSquare, IconFolder, IconMail, IconMapPin, IconMic, IconNote, IconStar, IconUser, NodeTypeIcon, IconMap } from './icons';
import { L, type DictLocale } from '@/lib/portal/i18n';
import { relativePastLabel } from '@/lib/portal/time-labels';
import { displayNodeName } from '@/lib/portal/node-display';
import { isPinned, loadPins, PINS_UPDATED_EVENT, togglePin, isCore, toggleCore, loadCore, CORE_UPDATED_EVENT } from '@/lib/portal/pins';
import { listInventoryItems, inventoryStats } from '@/lib/portal/inventory';
import { usePortalLocale } from './use-portal-locale';

/** 组件内取字典语言(批次 9 全量双语的局部 hook)。 */
function useDict(): DictLocale {
  return portalLocaleToDictionaryLocale(usePortalLocale());
}

// ── Object Map (物品地图) ────────────────────────────────────────────────────

interface LocationTree {
  place: string;
  rooms: { room: string; subRooms: { sub: string; items: LifeNode[] }[] }[];
  unroomed: LifeNode[];
}

function parseLocation(loc: string): { place: string; room: string; sub: string } {
  const parts = loc.split(' · ');
  return { place: parts[0] ?? '', room: parts[1] ?? '', sub: parts[2] ?? '' };
}

function buildLocationTree(objectNodes: LifeNode[]): { tree: LocationTree[]; unlocated: LifeNode[] } {
  const placeMap = new Map<string, { rooms: Map<string, Map<string, LifeNode[]>>; unroomed: LifeNode[] }>();
  const unlocated: LifeNode[] = [];

  for (const n of objectNodes) {
    const locRaw = typeof n.attributes?.location === 'string' ? n.attributes.location : '';
    if (!locRaw) { unlocated.push(n); continue; }
    const { place, room, sub } = parseLocation(locRaw);
    if (!place) { unlocated.push(n); continue; }

    if (!placeMap.has(place)) placeMap.set(place, { rooms: new Map(), unroomed: [] });
    const placeEntry = placeMap.get(place)!;

    if (!room) { placeEntry.unroomed.push(n); continue; }
    if (!placeEntry.rooms.has(room)) placeEntry.rooms.set(room, new Map());
    const roomMap = placeEntry.rooms.get(room)!;
    const subKey = sub || '__none__';
    if (!roomMap.has(subKey)) roomMap.set(subKey, []);
    roomMap.get(subKey)!.push(n);
  }

  const tree: LocationTree[] = Array.from(placeMap.entries()).map(([place, { rooms, unroomed }]) => ({
    place,
    rooms: Array.from(rooms.entries()).map(([room, subMap]) => ({
      room,
      subRooms: Array.from(subMap.entries()).map(([sub, items]) => ({ sub: sub === '__none__' ? '' : sub, items })),
    })),
    unroomed,
  }));

  return { tree, unlocated };
}

function ObjectMap({ nodes, onOpenNode }: { nodes: LifeNode[]; onOpenNode: (n: LifeNode) => void }) {
  const dict = useDict();
  const objectNodes = nodes.filter((n) => n.type === 'object');
  const [expandedPlaces, setExpandedPlaces] = useState<Set<string>>(new Set());
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());

  const { tree, unlocated } = useMemo(() => buildLocationTree(objectNodes), [objectNodes]);

  function togglePlace(p: string) {
    setExpandedPlaces((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }
  function toggleRoom(key: string) {
    setExpandedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (objectNodes.length === 0) {
    return <p className="nesio-insights-empty" style={{ marginTop: '1rem' }}>{L(dict, '暂无物品记录。拍照时选择存放位置，就能在这里看到。', 'No items yet. Pick a storage spot when you snap a photo and it shows up here.')}</p>;
  }

  const allCount = objectNodes.length;

  return (
    <div className="nesio-object-map">
      <p className="nesio-object-map-summary">{L(dict, `共 ${allCount} 件物品`, `${allCount} items in total`)}</p>
      {tree.map(({ place, rooms, unroomed }) => {
        const total = rooms.reduce((s, r) => s + r.subRooms.reduce((a, sr) => a + sr.items.length, 0), 0) + unroomed.length;
        const isOpen = expandedPlaces.has(place);
        return (
          <div key={place} className="nesio-object-map-place">
            <button type="button" className="nesio-object-map-row nesio-object-map-row--place" onClick={() => togglePlace(place)}>
              <span className="nesio-object-map-label">{place}</span>
              <span className="nesio-object-map-count">{total}{L(dict, '件', '')}</span>
              <span className="nesio-object-map-chevron">{isOpen ? '▴' : '▾'}</span>
            </button>
            {isOpen && (
              <div className="nesio-object-map-children">
                {rooms.map(({ room, subRooms }) => {
                  const roomKey = `${place}::${room}`;
                  const roomCount = subRooms.reduce((a, sr) => a + sr.items.length, 0);
                  const isRoomOpen = expandedRooms.has(roomKey);
                  return (
                    <div key={room} className="nesio-object-map-room">
                      <button type="button" className="nesio-object-map-row nesio-object-map-row--room" onClick={() => toggleRoom(roomKey)}>
                        <span className="nesio-object-map-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconFolder size={13} /> {room}</span>
                        <span className="nesio-object-map-count">{roomCount}{L(dict, '件', '')}</span>
                        <span className="nesio-object-map-chevron">{isRoomOpen ? '▴' : '▾'}</span>
                      </button>
                      {isRoomOpen && (
                        <div className="nesio-object-map-children">
                          {subRooms.map(({ sub, items }) => (
                            <div key={sub || 'direct'}>
                              {sub && <p className="nesio-object-map-sub-label">· {sub}</p>}
                              {items.map((n) => (
                                <button key={n.id} type="button" className="nesio-object-map-item" onClick={() => onOpenNode(n)}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconBox size={13} /> {n.name}</span>
                                  {n.tags?.[0] && <span className="nesio-object-map-item-tag">{n.tags[0]}</span>}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {unroomed.map((n) => (
                  <button key={n.id} type="button" className="nesio-object-map-item" onClick={() => onOpenNode(n)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconBox size={13} /> {n.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {unlocated.length > 0 && (
        <div className="nesio-object-map-place">
          <button type="button" className="nesio-object-map-row nesio-object-map-row--place" onClick={() => togglePlace('__unlocated__')}>
            <span className="nesio-object-map-label" style={{ color: 'var(--portal-muted)' }}>{L(dict, '未定位', 'Unplaced')}</span>
            <span className="nesio-object-map-count">{unlocated.length}{L(dict, '件', '')}</span>
            <span className="nesio-object-map-chevron">{expandedPlaces.has('__unlocated__') ? '▴' : '▾'}</span>
          </button>
          {expandedPlaces.has('__unlocated__') && (
            <div className="nesio-object-map-children">
              {unlocated.map((n) => (
                <button key={n.id} type="button" className="nesio-object-map-item" onClick={() => onOpenNode(n)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconBox size={13} /> {n.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_BG: Record<string, string> = {
  person: 'var(--chip-indigo)', object: 'var(--chip-blue)', place: 'var(--chip-green)',
  event: 'var(--chip-amber)', commitment: 'var(--chip-violet)', health_state: 'var(--chip-pink)', preference: 'var(--chip-mint)',
  note: 'var(--chip-lemon)', // 批次 143
};
const TYPE_LABEL_ZH: Record<string, string> = {
  person: '人物', object: '物品', place: '地点',
  event: '事件', commitment: '承诺', health_state: '健康', preference: '偏好', note: '笔记',
};
const TYPE_LABEL_EN: Record<string, string> = {
  person: 'People', object: 'Items', place: 'Places',
  event: 'Events', commitment: 'Promises', health_state: 'Health', preference: 'Preferences', note: 'Notes',
};
function typeLabel(t: string, dict: DictLocale): string {
  return (dict === 'en' ? TYPE_LABEL_EN : TYPE_LABEL_ZH)[t] ?? t;
}
// 批次 174:'place' 从类型筛选芯片移除(退役 —— 无真实数据源)。老 place 节点仍在「全部」里渲染,清除样例即消失。
const TYPE_ORDER = ['person', 'object', 'event', 'commitment', 'health_state', 'preference', 'note'];


const COPY = {
  zh: {
    searchPlaceholder: '搜记忆',
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
    searchPlaceholder: 'Search memory',
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

/** 相关记忆只认真实信号(批次 30 QA:「洗衣服」的相关记忆里出现四个通讯录联系人)。
 *  旧算法把「同一天创建 +2 / 同类型 +1」当关联,阈值 >0 —— 通讯录当天批量导入
 *  127 人,人人都和当天任何记录"相关"。规则改为:
 *  真实信号 = 显式 relations / 共享主题标签(系统标不算)/ 内容关键词重合;
 *  批量导入的节点只有显式关系才算相关;一个真实信号都没有 → 不显示,不硬凑。 */
const RELATED_SYSTEM_TAGS = new Set(['联系人', '手动记录', '月报', 'Voice', '手写']);

function findRelatedNodes(target: LifeNode, allNodes: LifeNode[]): LifeNode[] {
  const targetWords = extractKeywords(`${target.name} ${target.rawInput || ''}`);
  const targetTags = new Set((target.tags || []).filter((t) => !RELATED_SYSTEM_TAGS.has(t)));
  return allNodes
    .filter((n) => n.id !== target.id && !isWeatherNode(n))
    .map((node) => {
      let score = 0;
      const explicit = Boolean(
        target.relations?.some((r) => r.targetId === node.id) ||
        node.relations?.some((r) => r.targetId === target.id),
      );
      if (explicit) score += 10;
      score += (node.tags || []).filter((t) => targetTags.has(t)).length * 3;
      const nodeWords = extractKeywords(`${node.name} ${node.rawInput || ''}`);
      score += targetWords.filter((w) => nodeWords.includes(w)).length * 2;
      if (!explicit && isBulkImported(node)) score = 0;
      return { node, score };
    })
    .filter((s) => s.score >= 2)
    // 批次 53:同分(循环日历的每一次 Sprint 计划分数一样)按日期升序,读起来是时间线
    .sort((a, b) => b.score - a.score
      || String(a.node.attributes?.start ?? a.node.createdAt).localeCompare(String(b.node.attributes?.start ?? b.node.createdAt)))
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

/** 情绪/日记内容属于最私密层 — 列表预览默认遮罩,点开详情才见全文。 */
function isIntimateNode(node: LifeNode): boolean {
  const tags = node.tags || [];
  return tags.includes('moment') || tags.includes('journal') || tags.includes('feeling');
}

function cleanMemoryPreview(node: LifeNode, dict: DictLocale = 'zh'): string {
  if (isIntimateNode(node)) {
    const d = new Date(node.createdAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric' });
    return L(dict, `一段 ${d} 的心情记录 · 点开查看`, `A mood entry from ${d} · tap to view`);
  }
  // 批次 59:属性兜底改走可见名单 —— 位置戳/信号基建/内部字段绝不上卡片面
  // (此前 Object.values 全量拼接,capturedLat/Lon 裸坐标直接糊在卡片上)。
  const PREVIEW_HIDDEN = /^(capturedLat|capturedLon|capturedPlace|lat|lon|signalId|signalSource|signalType|signalVersion|occurredAt|capturedAt|externalId|calendarId|calendarName|subtasksJson|done|doneAt|focusPinnedOn|retentionPolicy|sensitivity|schemaVersion|sourceNodeId|emailId|messageId|htmlLink|context|userTags|status)$/;
  const attrPreview = Object.entries(node.attributes)
    .filter(([k, v]) => !PREVIEW_HIDDEN.test(k) && typeof v === 'string' && v.trim())
    .map(([, v]) => v as string)
    .join(' · ');
  const raw = node.rawInput || attrPreview;
  const cleaned = raw
    .replace(node.name, '')
    // 批次 24:剥掉链接与裸 URL 片段(flomo/导入节点常把 memo_id、模板路径
    // 之类当预览显示,如 m/mine/?memo_id=、s/x_xxx、ft.cn/template/xxx、d=xxx)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\b[\w.-]+\.(?:com|cn|org|net|io|app)\/\S*/gi, '')
    .replace(/\b[a-z]\/[\w%?=&_-]{6,}/gi, '')
    .replace(/\b(?:memo_id|template|d|id)=[\w%-]+/gi, '')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, (v) => {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' });
    })
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：·,\-—、]+/, '')
    .trim();
  return cleaned.slice(0, 44) || L(dict, '来自你的记录', 'From your notes');
}

function getNodeTypeMeta(node: LifeNode, dict: DictLocale = 'zh') {
  const a = node.attributes;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : '');
  switch (node.type) {
    case 'person': return { extra: str(a.relation) || str(a.role) || str(a.company) };
    case 'health_state': {
      const dateStr = str(a.date) || str(a.recordedAt);
      const dateLabel = dateStr ? new Date(dateStr).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' }) : '';
      const status = str(a.status);
      const badgeColor = status.includes('恢复') ? 'var(--status-go)' : status.includes('注意') ? 'var(--status-gentle)' : 'var(--portal-cool-accent)';
      return { extra: dateLabel, badge: status || undefined, badgeColor: status ? badgeColor : undefined };
    }
    case 'commitment': {
      const dueStr = str(a.dueDate) || str(a.due) || str(a.date);
      return { extra: dueStr ? L(dict, `截止 ${new Date(dueStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`, `Due ${new Date(dueStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`) : '' };
    }
    case 'object': {
      const loc = str(a.location) || str(a.where) || str(a.place) || str(a.storage);
      return { extra: loc };
    }
    default: return {};
  }
}

/** 来源徽章 · 6 种(批次 122·设计「来源徽章·6 种·左下角固定」):图标 + 名。
 *  设计里手记(自己记的)也标「手记」,不再隐藏。位置类记忆标「位置」。 */
function sourceMeta(node: LifeNode, dict: DictLocale): { label: string; icon: ReactNode } {
  const tags = node.tags || [];
  const sz = 11;
  if (tags.includes('notion')) return { label: 'Notion', icon: <IconNote size={sz} /> };
  if (tags.includes('keep')) return { label: 'Keep', icon: <IconNote size={sz} /> };
  if (node.type === 'place') return { label: L(dict, '位置', 'Place'), icon: <IconMapPin size={sz} /> };
  switch (node.source) {
    case 'email': return { label: L(dict, '邮件', 'Email'), icon: <IconMail size={sz} /> };
    case 'calendar': return { label: L(dict, '日历', 'Calendar'), icon: <IconCalendar size={sz} /> };
    case 'photo': return { label: L(dict, '拍照', 'Photo'), icon: <IconCamera size={sz} /> };
    case 'voice': return { label: L(dict, '语音', 'Voice'), icon: <IconMic size={sz} /> };
    case 'system': return { label: L(dict, '系统', 'System'), icon: <IconNote size={sz} /> };
    default: return { label: L(dict, '手记', 'Note'), icon: <IconNote size={sz} /> };
  }
}

/** 卡片分类名(设计:分类图标 + 分类名领头)。心情记录 → 情绪(不是「健康」)。 */
function categoryLabelForCard(node: LifeNode, dict: DictLocale): string {
  if (node.type === 'health_state') {
    const tags = node.tags || [];
    if (tags.includes('feeling') || tags.includes('moment')) return L(dict, '情绪', 'Mood');
  }
  return typeLabel(node.type, dict);
}

/** isNodeUncertain 已抽到 lib/portal/node-provenance.ts 当单一真源(批次210),供记忆徽章 + guidance 共用。 */

/** 卡片标题智能截断:整段原文取首个分句,一眼读完(批次 4)。 */
function smartCardTitle(name: string): string {
  // 显示层剥 emoji:批次 3 前的旧记录名字里带表情(如「Journal · 😊满足」)
  let clean = name.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s{2,}/g, ' ').trim();
  // 批次 24:标题里的裸 URL/前缀清掉(「关联自:https://v.flom…」「来自 https://…」)
  clean = clean
    .replace(/^(?:关联自|来自|转自|via|from)\s*[:：]?\s*/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\b[\w.-]+\.(?:com|cn|org|net|io|app)\/\S*/gi, '')
    .replace(/^[\s:：·,\-—、]+/, '')
    .trim();
  if (!clean) return name.slice(0, 24); // 全是 URL:退回原名截断,至少不空
  if (clean.length <= 24) return clean;
  const clause = clean.split(/[。！？!?；;，,\n]/)[0];
  return `${clause.length > 24 ? clause.slice(0, 24) : clause}…`;
}

function getPersonInitials(name: string) {
  const bgs = ['var(--avatar-indigo)', 'var(--avatar-blue)', 'var(--avatar-mint)', 'var(--avatar-pink)', 'var(--avatar-amber)', 'var(--avatar-violet)'];
  return { initials: name.slice(0, 1), bg: bgs[name.charCodeAt(0) % bgs.length] };
}

/** 天气快照是环境信号,进 Memory 只会制造噪音(用户反馈「存在意义不明」)。 */
function isWeatherNode(n: LifeNode): boolean {
  const tags = n.tags || [];
  return tags.includes('weather') || tags.includes('weather.forecast') || /天气信号$|^天气$/.test(n.name);
}

function visibleMemoryNodes(nodes: LifeNode[], canUse: boolean): LifeNode[] {
  const base = nodes.filter((n) => !isWeatherNode(n));
  return canUse ? base : base.filter((n) => !isPrivateExternalNode(n));
}

function shareTextForNode(node: LifeNode, dict: DictLocale): string {
  const tags = node.tags?.length ? `\n${L(dict, '标签：', 'Tags: ')}${node.tags.map((t) => `#${t}`).join(' ')}` : '';
  return `${node.name}\n${cleanMemoryPreview(node)}${tags}\n${L(dict, '来自 Nesio Memory', 'From Nesio Memory')}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OnThisDayStrip({ nodes, onOpen }: { nodes: LifeNode[]; onOpen: (n: LifeNode) => void }) {
  const dict = useDict();
  const label = new Date().toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'long', day: 'numeric' });
  return (
    <div className="nesio-otd-wrap">
      <div className="nesio-otd-header">
        <span className="nesio-otd-icon"><IconCalendar size={14} /></span>
        <span className="nesio-otd-label">{L(dict, '历史上的今天', 'On this day')} · {label}</span>
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
  const dict = useDict();
  const colorMap: Record<string, string> = {
    remember: 'var(--portal-accent)',
    commitment: 'var(--status-gentle)',
    activity: 'var(--status-go)',
  };
  const accent = colorMap[card.type] ?? 'var(--portal-accent)';
  // 批次 13:整卡可点直接进详情,去掉「查看详情」文字,卡片做正方形
  void dict;
  return (
    <button
      type="button"
      className={`nesio-narrator-card nesio-narrator-card--${card.type}`}
      style={{ '--narrator-accent': accent } as React.CSSProperties}
      onClick={() => { if (card.nodes.length > 0) onOpen(card.nodes[0]); }}
    >
      <div className="nesio-narrator-title">{card.title}</div>
      <div className="nesio-narrator-body">{card.body.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')}</div>
      {card.sub && <div className="nesio-narrator-sub">{card.sub}</div>}
    </button>
  );
}

function LongPressSheet({
  node,
  projects,
  onAddToProject,
  onShare,
  onClose,
}: {
  node: LifeNode;
  projects: Project[];
  onAddToProject: (projectId: string) => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const dict = useDict();
  const activeProjects = projects.filter((p) => p.status === 'active');
  const [showProj, setShowProj] = useState(false);
  // 批次 171:收纳 = 把这条记忆变成 object 节点 + 「收纳」域标(收纳就是 object 节点投影)
  const addToInventory = () => {
    const live = getLifeGraph().find((x) => x.id === node.id);
    const tags = live?.tags || [];
    updateLifeNode(node.id, { type: 'object', tags: tags.includes('收纳') ? tags : [...tags, '收纳'] });
    onClose();
  };
  // 批次 171(用户实锤·对标微信长按):竖排文字按钮 → 图标横排 + 下方小字。
  // 4 个动作:今日/收藏夹/收纳/项目;去掉「标为核心」(核心已撤)和「分享/复制」。
  return (
    <>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-longpress-sheet">
        <div className="nesio-longpress-node-name">{node.name}</div>
        <div className="nesio-lp-actions">
          <button type="button" className="nesio-lp-action" onClick={() => { pinNodeToTodayFocus(node.id); onClose(); }}>
            <span className="nesio-lp-icon"><IconCalendar size={20} /></span>
            <span className="nesio-lp-label">{L(dict, '今日', 'Today')}</span>
          </button>
          <button type="button" className="nesio-lp-action" onClick={() => { togglePin(node.id); onClose(); }}>
            <span className={`nesio-lp-icon${isPinned(node.id) ? ' nesio-lp-icon--on' : ''}`}><IconBookmark size={20} /></span>
            <span className="nesio-lp-label">{isPinned(node.id) ? L(dict, '已收藏', 'Saved') : L(dict, '收藏夹', 'Save')}</span>
          </button>
          <button type="button" className="nesio-lp-action" onClick={addToInventory}>
            <span className="nesio-lp-icon"><IconBox size={20} /></span>
            <span className="nesio-lp-label">{L(dict, '收纳', 'Storage')}</span>
          </button>
          <button type="button" className="nesio-lp-action" onClick={() => setShowProj((v) => !v)}>
            <span className={`nesio-lp-icon${showProj ? ' nesio-lp-icon--on' : ''}`}><IconFolder size={20} /></span>
            <span className="nesio-lp-label">{L(dict, '项目', 'Project')}</span>
          </button>
        </div>
        {showProj && (
          <div className="nesio-lp-projects">
            {activeProjects.length > 0 ? activeProjects.map((p) => (
              <button key={p.id} type="button" className="nesio-longpress-project-btn" onClick={() => { onAddToProject(p.id); onClose(); }}>
                <IconFolder size={14} /> {p.name}
              </button>
            )) : (
              <p className="nesio-longpress-no-projects">{L(dict, '还没有项目,先去项目球新建一个', 'No projects yet — create one from the Projects tab')}</p>
            )}
          </div>
        )}
        <button type="button" className="nesio-longpress-cancel-btn" onClick={onClose}>{L(dict, '取消', 'Cancel')}</button>
      </div>
    </>
  );
}

function MemoryCard({ node, onOpen, onDeleted, onLongPress }: { node: LifeNode; onOpen: () => void; onDeleted: () => void; onLongPress?: () => void }) {
  const dict = useDict();
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
    const text = shareTextForNode(node, dict);
    try {
      if (navigator.share) await navigator.share({ title: node.name, text });
      else await navigator.clipboard?.writeText(text);
    } catch { /* user cancelled */ }
  }

  const { extra, badge, badgeColor } = getNodeTypeMeta(node, dict);
  const isPerson = node.type === 'person';
  const { initials, bg: avatarBg } = isPerson ? getPersonInitials(node.name) : { initials: '', bg: '' };
  const srcMeta = sourceMeta(node, dict);
  const catLabel = categoryLabelForCard(node, dict);
  const uncertain = isNodeUncertain(node);

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
        longPressTimer.current = setTimeout(() => {
          swiped.current = true;
          clearTimer();
          if (onLongPress) onLongPress();
          else void shareNode();
        }, 620);
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
      aria-label={`${node.name}${L(dict, ',左滑删除,长按分享', ' — swipe left to delete, long-press to share')}`}
    >
      {/* 批次 121→122·设计统一卡片模板:分类图标(辅助色)+ 分类名领头 —— 标明「这是什么」,
          分类为主。人物用头像。每卡恰好 1 个 type 图标(批次 13 双图标已废)。 */}
      <span className="nesio-memory-card-cat">
        {isPerson ? (
          <span className="nesio-memory-card-lead nesio-memory-card-avatar" style={{ background: avatarBg }}>{initials}</span>
        ) : (
          <span className="nesio-memory-card-lead nesio-memory-card-icon" style={{ background: TYPE_BG[node.type] || 'var(--portal-accent-soft)' }}>
            <NodeTypeIcon type={node.type} size={14} />
          </span>
        )}
        <span className="nesio-memory-card-cat-label">{catLabel}</span>
      </span>
      <span className="nesio-memory-card-title" title={node.name}>{smartCardTitle(displayNodeName(node.name, dict))}</span>
      {extra && <span className="nesio-memory-card-extra">{extra}</span>}
      {badge && <span className="nesio-memory-card-status-badge" style={{ background: badgeColor }}>{badge}</span>}
      {!extra && !badge && <span className="nesio-memory-card-sub">{cleanMemoryPreview(node, dict)}</span>}
      {/* 来源徽章(图标 + 名,6 种,左下固定)· 待确认 · 时间(来源为辅) */}
      <span className="nesio-memory-card-meta-row">
        <span className="nesio-memory-card-source">{srcMeta.icon}{srcMeta.label}</span>
        {uncertain && <span className="nesio-memory-card-pending">{L(dict, '待确认', 'Unconfirmed')}</span>}
        {(() => {
          // 标签三层 §3.3:列表卡带相对时间(今天/昨天/N 天前),数据的"新鲜度"一眼可辨
          const t = new Date(node.createdAt);
          const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
          const label = t >= dayStart
            ? L(dict, '今天', 'Today')
            : t >= new Date(dayStart.getTime() - 86_400_000)
              ? L(dict, '昨天', 'Yesterday')
              : relativePastLabel(t, Date.now(), dict);
          return <span className="nesio-memory-card-time">{label}</span>;
        })()}
      </span>
    </button>
  );
}

// 批次 185(用户实锤):项目状态三选项 进行中/计划中/归档(原「已完成」→「归档」)。
const PROJ_STATUSES: Array<[ProjectStatus, string, string]> = [
  ['active', '进行中', 'Active'], ['planned', '计划中', 'Planned'], ['archived', '归档', 'Archived'],
];
function ProjectCard({ project, allNodes, onClick, onSetStatus }: { project: Project; allNodes: LifeNode[]; onClick: () => void; onSetStatus: (s: ProjectStatus) => void }) {
  const dict = useDict();
  const count = project.nodeIds.filter((id) => allNodes.some((n) => n.id === id)).length;
  // 批次 185:已存在项目只显示当前状态一个按钮,点一下展开三选项改;选完收起。
  const [statusOpen, setStatusOpen] = useState(false);
  const cur = project.status || 'active';
  const curMeta = PROJ_STATUSES.find(([k]) => k === cur) || PROJ_STATUSES[0];
  return (
    <div className="nesio-project-card">
      <button type="button" className="nesio-project-card-open" onClick={onClick}>
        <span className="nesio-project-card-name">{project.name}</span>
        <span className="nesio-project-card-meta">
          <span className="nesio-project-card-emoji"><IconFolder size={14} /></span>
          <span className="nesio-project-card-count">{count} {L(dict, '条', 'items')}</span>
        </span>
      </button>
      <div className="nesio-proj-card-status">
        {statusOpen ? (
          PROJ_STATUSES.map(([k, zh, en]) => (
            <button key={k} type="button" className={`nesio-proj-card-statbtn${cur === k ? ' nesio-proj-card-statbtn--on' : ''}`} onClick={() => { onSetStatus(k); setStatusOpen(false); }}>
              {L(dict, zh, en)}
            </button>
          ))
        ) : (
          <button type="button" className="nesio-proj-card-statbtn nesio-proj-card-statbtn--on" onClick={() => setStatusOpen(true)}>
            {L(dict, curMeta[1], curMeta[2])} ▾
          </button>
        )}
      </div>
    </div>
  );
}

// 批次 185:收藏夹改按真实 tag 筛选,原固定维度 favDimensionOf/FavDim 已删。

// 批次 168:收藏夹独立页 —— 手动收藏的记忆 + 维度 filter(全部/价值/习惯/节律/关系)。
function FavoritesSheet({ pinnedNodes, onClose, onOpenNode, onLongPressNode }: {
  pinnedNodes: LifeNode[];
  onClose: () => void;
  onOpenNode: (n: LifeNode) => void;
  onLongPressNode?: (n: LifeNode) => void;
}) {
  const dict = useDict();
  // 批次 185(用户实锤):收藏夹筛选按**真实 tag**,不用固定维度(价值/习惯/节律/关系)。
  // 取收藏项里真实出现的标签,按频次排序;滤掉内部/系统标签(domain:/facet:/天气/心情等)。
  const [tag, setTag] = useState<string | null>(null);
  const HIDE_TAG = /^(domain:|facet:|weather|天气|moment|feeling|energy|calm|mid|demo|分享)/i;
  const tagCounts = new Map<string, number>();
  for (const n of pinnedNodes) for (const t of (n.tags || [])) {
    const tt = t.trim();
    if (!tt || HIDE_TAG.test(tt)) continue;
    tagCounts.set(tt, (tagCounts.get(tt) || 0) + 1);
  }
  const tags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12);
  const shown = tag ? pinnedNodes.filter((n) => (n.tags || []).some((t) => t.trim() === tag)) : pinnedNodes;
  return (
    <>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-project-detail-sheet nesio-fav-sheet">
        <div className="nesio-project-detail-header">
          <span className="nesio-project-detail-emoji"><IconBookmark size={16} /></span>
          <span className="nesio-project-detail-name">{L(dict, '收藏夹', 'Saved')}</span>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        {tags.length > 0 && (
          <div className="nesio-fav-filter">
            <button type="button" className={`nesio-fav-chip${!tag ? ' nesio-fav-chip--on' : ''}`} onClick={() => setTag(null)}>
              {L(dict, '全部', 'All')}
            </button>
            {tags.map((t) => (
              <button key={t} type="button" className={`nesio-fav-chip${tag === t ? ' nesio-fav-chip--on' : ''}`} onClick={() => setTag((prev) => (prev === t ? null : t))}>
                {t}
              </button>
            ))}
          </div>
        )}
        {shown.length === 0 ? (
          <p className="nesio-project-detail-empty">
            {!tag
              ? L(dict, '还没有收藏。长按记忆卡 → 收藏到首页。', 'Nothing saved yet. Long-press a card → Save.')
              : L(dict, '这个标签下还没有收藏', 'Nothing under this tag yet')}
          </p>
        ) : (
          <div className="nesio-memory-grid" style={{ padding: '0 1rem 1rem' }}>
            {shown.map((n) => (
              <MemoryCard key={n.id} node={n} onOpen={() => onOpenNode(n)} onDeleted={() => {}} onLongPress={onLongPressNode ? () => onLongPressNode(n) : undefined} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// 批次 168:项目独立页 —— 进行中项目列表,点开进项目详情。
function ProjectsSheet({ projects, allNodes, onClose, onOpenProject, onCreate, onSetStatus }: {
  projects: Project[];
  allNodes: LifeNode[];
  onClose: () => void;
  onOpenProject: (p: Project) => void;
  onCreate: () => void;
  onSetStatus: (projectId: string, status: ProjectStatus) => void;
}) {
  const dict = useDict();
  const activeCount = projects.filter((p) => p.status === 'active' || !p.status).length;
  // 批次 178:项目页顶部三统计框改为 进行中/计划中/已完成(数字=各状态项目数)
  const plannedCount = projects.filter((p) => p.status === 'planned').length;
  // 批次 185:第三格「已完成」→「归档」(与卡片状态三选项一致)
  const archivedCount = projects.filter((p) => p.status === 'archived').length;
  // 批次 180:列表显示全部项目(进行中→计划中→已完成排序),改状态后卡不消失,状态可回切
  const order: Record<string, number> = { active: 0, planned: 1, completed: 2, archived: 3 };
  const sorted = [...projects].sort((a, b) => (order[a.status || 'active'] ?? 0) - (order[b.status || 'active'] ?? 0));
  return (
    <>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-project-detail-sheet">
        <div className="nesio-project-detail-header">
          <span className="nesio-project-detail-emoji"><IconFolder size={16} /></span>
          <span className="nesio-project-detail-name">{L(dict, '项目', 'Projects')}</span>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        <div className="nesio-proj-stats">
          <span className="nesio-proj-stat"><b>{activeCount}</b> {L(dict, '进行中', 'Active')}</span>
          <span className="nesio-proj-stat"><b>{plannedCount}</b> {L(dict, '计划中', 'Planned')}</span>
          <span className="nesio-proj-stat"><b>{archivedCount}</b> {L(dict, '归档', 'Archived')}</span>
        </div>
        {sorted.length > 0 ? (
          <div className="nesio-memory-grid nesio-fav-expanded" style={{ padding: '0 1rem 0.5rem' }}>
            {sorted.map((p) => (
              <ProjectCard key={p.id} project={p} allNodes={allNodes} onClick={() => onOpenProject(p)} onSetStatus={(s) => onSetStatus(p.id, s)} />
            ))}
          </div>
        ) : (
          <p className="nesio-project-detail-empty">{L(dict, '还没有项目,创建一个把相关记录聚在一起', 'No projects yet — create one to group related notes')}</p>
        )}
        <button type="button" className="nesio-mem-jar-create" style={{ margin: '0 1rem 1rem' }} onClick={onCreate}>
          {L(dict, '新建项目', 'New project')}
        </button>
      </div>
    </>
  );
}

function ProjectDetailSheet({
  project,
  allNodes,
  onClose,
  onDelete,
  onOpenNode,
  onLongPressNode,
}: {
  project: Project;
  allNodes: LifeNode[];
  onClose: () => void;
  onDelete: () => void;
  onOpenNode: (n: LifeNode) => void;
  onLongPressNode?: (n: LifeNode) => void;
}) {
  const nodes = allNodes.filter((n) => project.nodeIds.includes(n.id));
  const dict = useDict();
  // 批次 178:单项目详情不再放状态选择器(用户实锤「单个项目文件夹不要这三个状态」);
  // 状态改在项目聚合页(进行中/计划中/已完成)语义上体现。

  return (
    <>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-project-detail-sheet">
        <div className="nesio-project-detail-header">
          <span className="nesio-project-detail-emoji"><IconFolder size={16} /></span>
          <span className="nesio-project-detail-name">{project.name}</span>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        <div className="nesio-project-detail-stats">
          <span>{nodes.length} {L(dict, '条记录', 'entries')}</span>
          <span>·</span>
          <span>{nodes.filter((n) => n.type === 'commitment').length} {L(dict, '个承诺', 'promises')}</span>
        </div>
        {nodes.length === 0 ? (
          <p className="nesio-project-detail-empty">{L(dict, '还没有记录。在记忆卡片里长按可以加入项目。', 'Nothing here yet. Long-press a memory card to add it.')}</p>
        ) : (
          <div className="nesio-memory-grid" style={{ padding: '0 1rem 1rem' }}>
            {nodes.map((n) => (
              <MemoryCard key={n.id} node={n} onOpen={() => onOpenNode(n)} onDeleted={() => {}} onLongPress={onLongPressNode ? () => onLongPressNode(n) : undefined} />
            ))}
          </div>
        )}
        <div style={{ padding: '0 1rem 1.5rem' }}>
          <button
            type="button"
            className="nesio-project-delete-btn"
            onClick={() => { onDelete(); onClose(); }}
          >
            {L(dict, '删除项目', 'Delete project')}
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
  onCreate: (name: string, emoji: string, status: ProjectStatus) => void;
}) {
  const dict = useDict();
  const [name, setName] = useState('');
  // 批次 185(用户实锤):新建项目选状态 —— 进行中 / 计划中(默认进行中)
  const [status, setStatus] = useState<ProjectStatus>('active');
  const emoji = '📁'; // 数据层保留字段(旧项目兼容),显示层一律线性图标
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  return (
    <>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-create-project-sheet">
        <div className="nesio-create-project-header">
          <span>{L(dict, '新建项目', 'New project')}</span>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        <input
          ref={inputRef}
          className="nesio-create-project-input"
          placeholder={L(dict, '项目名称，比如"装修"、"妈妈生日"…', 'Project name, e.g. "Renovation", "Mom\'s birthday"…')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onCreate(name.trim(), emoji, status); onClose(); } }}
        />
        <div className="nesio-proj-card-status" style={{ margin: '0.6rem 0 0.2rem' }}>
          {([['active', '进行中', 'Active'], ['planned', '计划中', 'Planned']] as Array<[ProjectStatus, string, string]>).map(([k, zh, en]) => (
            <button key={k} type="button" className={`nesio-proj-card-statbtn${status === k ? ' nesio-proj-card-statbtn--on' : ''}`} onClick={() => setStatus(k)}>
              {L(dict, zh, en)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="nesio-create-project-confirm"
          disabled={!name.trim()}
          onClick={() => { if (name.trim()) { onCreate(name.trim(), emoji, status); onClose(); } }}
        >
          {L(dict, '创建', 'Create')}
        </button>
      </div>
    </>
  );
}

// ── Memory Relation Graph builders ───────────────────────────────────────────

const MEM_NODE_COLOR: Record<string, string> = {
  person:       'var(--portal-accent)',
  object:       'var(--status-calm)',
  place:        'var(--status-go)',
  event:        'var(--status-gentle)',
  commitment:   'var(--portal-cool-accent)',
  health_state: 'var(--status-risk)',
  preference:   'var(--portal-muted)',
};

function buildMemGraphNodes(nodes: LifeNode[]): GNode[] {
  const connected = nodes.filter(n => (n.relations?.length ?? 0) > 0 || nodes.some(o => o.relations?.some(r => r.targetId === n.id)));
  if (connected.length === 0) return nodes.slice(0, 15).map(n => ({
    id: n.id, label: n.name, type: n.type, weight: n.confidence,
    color: MEM_NODE_COLOR[n.type] ?? 'var(--portal-accent)',
  }));
  const maxRel = Math.max(1, ...connected.map(n => n.relations?.length ?? 0));
  return connected.slice(0, 30).map(n => ({
    id: n.id, label: n.name, type: n.type,
    weight: 0.3 + ((n.relations?.length ?? 0) / maxRel) * 0.7,
    color: MEM_NODE_COLOR[n.type] ?? 'var(--portal-accent)',
  }));
}

function buildMemGraphEdges(nodes: LifeNode[]): GEdge[] {
  const idSet = new Set(nodes.map(n => n.id));
  const seen = new Set<string>();
  const edges: GEdge[] = [];
  for (const node of nodes) {
    if (!node.relations?.length) continue;
    for (const rel of node.relations) {
      if (!idSet.has(rel.targetId)) continue;
      const key = [node.id, rel.targetId].sort().join('|');
      if (!seen.has(key)) { seen.add(key); edges.push({ source: node.id, target: rel.targetId, label: rel.relation }); }
    }
  }
  return edges;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MemoryTab({ canUsePrivateData }: { canUsePrivateData: boolean }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showObjectMap, setShowObjectMap] = useState(false);
  const [showRelationGraph, setShowRelationGraph] = useState(false);
  const [locale, setLocale] = useState<PortalLocale>(() => loadProfileSettings().locale);
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<LifeNode | null>(null);
  const [relatedNodes, setRelatedNodes] = useState<LifeNode[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(6);
  const [cloudSyncSummary, setCloudSyncSummary] = useState(getLifeGraphCloudSyncSummary());
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  // 标签三层重构 L3:详情页的「主题门」点击后跳回记忆页搜该主题
  useEffect(() => {
    const onSearch = (e: Event) => {
      const q = (e as CustomEvent).detail?.query;
      if (typeof q === 'string' && q) { setSelectedNode(null); setQuery(q); }
    };
    window.addEventListener('nesio-memory-search', onSearch);
    return () => window.removeEventListener('nesio-memory-search', onSearch);
  }, []);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [longPressNode, setLongPressNode] = useState<LifeNode | null>(null);
  // 下拉刷新 = 全源同步(日历/邮件/Flomo/银行,核心在 connector-sync,与设置页各同步按钮同一实现)
  const [pullSync, setPullSync] = useState<'idle' | 'syncing' | 'done'>('idle');
  const [pullSummary, setPullSummary] = useState('');
  const pullStartY = useRef<number | null>(null);
  const runPullSync = useCallback(async () => {
    if (pullSync === 'syncing') return;
    setPullSync('syncing');
    setPullSummary('');
    try {
      const { syncAllConnectors } = await import('@/lib/portal/connector-sync');
      const outcomes = await syncAllConnectors();
      const en = locale === 'en';
      setPullSummary(outcomes.map((o) => (en ? o.detail[1] : o.detail[0])).join(' · '));
      setNodes(getLifeGraph());
    } catch {
      setPullSummary(locale === 'en' ? 'Sync failed — check network and retry' : '同步失败,检查网络后重试');
    }
    setPullSync('done');
    setTimeout(() => setPullSync('idle'), 6000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullSync, locale]);
  const onPullStart = useCallback((e: React.TouchEvent) => {
    const el = e.currentTarget as HTMLElement;
    pullStartY.current = el.scrollTop <= 0 ? e.touches[0].clientY : null;
  }, []);
  const onPullEnd = useCallback((e: React.TouchEvent) => {
    if (pullStartY.current !== null && e.changedTouches[0].clientY - pullStartY.current > 70) void runPullSync();
    pullStartY.current = null;
  }, [runPullSync]);
  // 收藏夹(批次 20):pin 列表,事件驱动刷新
  const [pinIds, setPinIds] = useState<string[]>([]);
  useEffect(() => {
    const read = () => setPinIds(loadPins());
    read();
    window.addEventListener(PINS_UPDATED_EVENT, read);
    return () => window.removeEventListener(PINS_UPDATED_EVENT, read);
  }, []);
  const pinnedNodes = pinIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is LifeNode => Boolean(n));
  // 核心记忆(批次 114):与收藏平行的更高一档,记忆罐第一颗球
  const [coreIds, setCoreIds] = useState<string[]>([]);
  useEffect(() => {
    const read = () => setCoreIds(loadCore());
    read();
    window.addEventListener(CORE_UPDATED_EVENT, read);
    return () => window.removeEventListener(CORE_UPDATED_EVENT, read);
  }, []);
  const coreNodes = coreIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is LifeNode => Boolean(n));
  // 批次 168(用户定案):三球各自开独立页(不再就地展开)。收藏夹=手动收藏+维度 filter,
  // 物品收纳=中间球开收纳,项目=项目页。去掉核心记忆球。
  const [favPageOpen, setFavPageOpen] = useState(false);
  const [projPageOpen, setProjPageOpen] = useState(false);

  const dict = portalLocaleToDictionaryLocale(locale);
  const copy = COPY[dict];

  const readNodes = useCallback(
    () => {
      const visible = visibleMemoryNodes(
        getLifeGraph().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        canUsePrivateData,
      );
      // 演示模式:未登录且没有任何本地记录 → 展示只读种子数据,
      // 让游客 30 秒看懂「扔进来→找得到」;任何写路径拒绝 demo 节点
      if (!canUsePrivateData && visible.length === 0) return [...DEMO_SEED_NODES];
      return visible;
    },
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
  const narratorCards = useMemo(() => buildNarratorCards(nodes, dict), [nodes, dict]);

  // Smart search (text/entity rank, synchronous)
  const { nodes: textRankedNodes, understood } = useMemo(
    () => query.trim()
      ? smartSearch(query, null)
      : { nodes: [], understood: { people: [], places: [], objects: [], domain: null } as SearchUnderstood },
    [query],
  );

  // Semantic re-rank (async embedding blend): text order shows immediately,
  // refines when vectors arrive; falls back silently if endpoint unavailable
  const [smartNodes, setSmartNodes] = useState<LifeNode[]>([]);
  useEffect(() => {
    setSmartNodes(textRankedNodes);
    if (!query.trim() || textRankedNodes.length < 3) return;
    let cancelled = false;
    void semanticRerank(query, textRankedNodes).then((reranked) => {
      if (!cancelled) setSmartNodes(reranked);
    });
    return () => { cancelled = true; };
  }, [query, textRankedNodes]);

  const hasUnderstoodEntities = understood.people.length + understood.places.length + understood.objects.length > 0;

  // 批次 88:计划/清单是属性派生的「虚拟分类」(facet:plan / facet:list)——
  // 零 schema 迁移(全下游按真 type 过滤不动),有内容才在筛选栏露面。
  const matchesFilter = (n: LifeNode, filter: string): boolean => {
    if (filter === 'facet:plan') return Boolean(n.attributes?.planContainer || n.attributes?.planImported);
    if (filter === 'facet:list') return Boolean(n.attributes?.checklist);
    return n.type === filter;
  };

  // Filtered nodes for browse mode
  const visibleNodes = useMemo(() => {
    let result = nodes;
    if (typeFilter) result = result.filter((n) => matchesFilter(n, typeFilter));
    return result;
  }, [nodes, typeFilter]);

  const results = query.trim()
    ? visibleMemoryNodes(smartNodes, canUsePrivateData).filter((n) => !typeFilter || matchesFilter(n, typeFilter))
    : visibleNodes;

  const visibleItems = showAll || query ? results : results.slice(0, displayLimit);

  const typeCounts = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  const facetCounts = {
    'facet:plan': nodes.filter((n) => n.attributes?.planContainer || n.attributes?.planImported).length,
    'facet:list': nodes.filter((n) => n.attributes?.checklist).length,
  };


  const onThisDayNodes = useMemo(() => findOnThisDayNodes(nodes), [nodes]);
  // 批次 113:收纳卡真数据(空间/未归位/件数/估值),随节点变化重算
  const invStats = useMemo(() => {
    const items = listInventoryItems();
    return { ...inventoryStats(items), unfiled: items.filter((i) => !i.space).length };
  }, [nodes]);

  function openNodeDetail(node: LifeNode) {
    setSelectedNode(node);
    setRelatedNodes(findRelatedNodes(node, nodes));
  }

  const isSearching = Boolean(query.trim());
  const hasNodes = nodes.length > 0;

  return (
    <>
      <div className="nesio-memory-root">
        <div className="nesio-memory-scroll" onTouchStart={onPullStart} onTouchEnd={onPullEnd}>
          {pullSync !== 'idle' && (
            <p className="nesio-settings-option-hint" style={{ textAlign: 'center', margin: '0 0 0.5rem' }}>
              {pullSync === 'syncing'
                ? L(dict, '正在同步日历 / 邮件 / Flomo / 银行…', 'Syncing calendar / mail / flomo / bank…')
                : pullSummary}
            </p>
          )}
          {nodes.some(isDemoNode) && (
            <div style={{ background: 'var(--portal-accent-soft, rgba(88,140,227,0.1))', borderRadius: 12, padding: '0.55rem 0.9rem', margin: '0 0 0.6rem', fontSize: '0.72rem', color: 'var(--portal-blue-deep)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{L(dict, '这些是示例数据,让你看看 Nesio 记东西的样子。', 'Sample data to show how Nesio remembers. ')}<a href="/login" style={{ color: 'inherit', fontWeight: 600 }}>{L(dict, '登录', 'Sign in')}</a>{L(dict, '或直接开始记录,就会换成你自己的。', ' or just start noting — it becomes yours.')}</span>
            </div>
          )}
          {/* 登录后灌入的样例数据(可一键清)—— 与游客只读 demo 分家 */}
          {canUsePrivateData && hasSampleData(nodes) && (
            <div style={{ background: 'var(--portal-accent-soft, rgba(88,140,227,0.1))', borderRadius: 12, padding: '0.55rem 0.9rem', margin: '0 0 0.6rem', fontSize: '0.72rem', color: 'var(--portal-blue-deep)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>{L(dict, '这些是样例,帮你先看看各功能的样子。', 'These are samples — a peek at what each feature looks like.')}</span>
              <button
                type="button"
                onClick={() => { clearSampleData(); setNodes(readNodes()); }}
                style={{ flexShrink: 0, color: 'var(--portal-blue-deep)', fontWeight: 600, textDecoration: 'underline' }}
              >
                {L(dict, '清除样例', 'Clear samples')}
              </button>
            </div>
          )}

          {/* Search(批次 34:空库时藏起 —— 没东西可搜) */}
          {hasNodes && (
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
          )}

          {/* AI understood */}
          {isSearching && hasUnderstoodEntities && (
            <div className="nesio-search-understood" aria-live="polite">
              <span className="nesio-search-understood-label">{L(dict, '理解为', 'Understood as')}</span>
              {understood.people.map((p) => <span key={p} className="nesio-search-understood-chip"><IconUser size={11} /> {p}</span>)}
              {understood.places.map((p) => <span key={p} className="nesio-search-understood-chip"><IconMapPin size={11} /> {p}</span>)}
              {understood.objects.map((o) => <span key={o} className="nesio-search-understood-chip"><IconBox size={11} /> {o}</span>)}
              {understood.domain && (
                <span className="nesio-search-understood-chip"><DomainIcon domain={understood.domain} size={11} /> {DOMAINS[understood.domain].label}</span>
              )}
            </div>
          )}

          {/* ── Browse mode (not searching) ─────────────────────────────── */}
          {!isSearching && (
            <>
              {/* 批次 110→114:记忆罐 —— 核心记忆/收藏夹/项目 三颗水晶球(设计规范记忆页 hero)。
                  核心记忆(定义你,长按记忆卡「标为核心」)= 第一颗;全部记忆挪到下方区块。 */}
              {hasNodes && (
                <div className="nesio-mem-jars">
                  {/* 批次 168:收藏夹(手动收藏)→ 独立页 + 维度 filter */}
                  <button type="button" className="nesio-mem-jar" onClick={() => setFavPageOpen(true)}>
                    <span className="nesio-mem-jar-ball" data-halo="fav" aria-hidden><IconBookmark size={24} /></span>
                    <span className="nesio-mem-jar-name">{L(dict, '收藏夹', 'Saved')}</span>
                    <span className="nesio-mem-jar-sub">{L(dict, `手动收 · ${pinnedNodes.length}`, `saved · ${pinnedNodes.length}`)}</span>
                  </button>
                  {/* 批次 168:物品收纳放中间 → 开收纳 */}
                  <button type="button" className="nesio-mem-jar" onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-inventory'))}>
                    <span className="nesio-mem-jar-ball" data-halo="storage" aria-hidden><IconBox size={24} /></span>
                    <span className="nesio-mem-jar-name">{L(dict, '收纳', 'Storage')}</span>
                    <span className="nesio-mem-jar-sub">{L(dict, `${invStats.count} 件`, `${invStats.count} items`)}</span>
                  </button>
                  {/* 批次 168:项目 → 独立页 */}
                  <button type="button" className="nesio-mem-jar" onClick={() => setProjPageOpen(true)}>
                    <span className="nesio-mem-jar-ball" data-halo="project" aria-hidden><IconFolder size={24} /></span>
                    <span className="nesio-mem-jar-name">{L(dict, '项目', 'Projects')}</span>
                    <span className="nesio-mem-jar-sub">{L(dict, `进行 · ${projects.filter((p) => p.status === 'active').length}`, `active · ${projects.filter((p) => p.status === 'active').length}`)}</span>
                  </button>
                </div>
              )}

              {/* 批次 168:核心/项目就地展开区已删 —— 改成点球开独立页(FavoritesSheet / ProjectsSheet) */}

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

              {/* 批次 168:收纳段 + 收藏夹就地展开区已删 —— 物品收纳=中间球开收纳,收藏夹=球开独立页 */}


              {/* 批次 123:「我的项目」独立 section 已删 —— 项目挪进记忆罐「项目」球(点球内联展开) */}

              {/* Recent memories */}
              {hasNodes && (
                <>
                  <div className="nesio-section-header" style={{ marginTop: '0.25rem' }}>
                    {/* 批次 112:对齐 mockup —— 「全部记忆 · N 条 · 可搜」 */}
                    <span className="nesio-section-title">
                      {L(dict, '全部记忆', 'All memories')}
                      <span className="nesio-section-title-sub"> · {L(dict, `${nodes.length} 条 · 可搜`, `${nodes.length} · search`)}</span>
                    </span>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      {typeFilter && (
                        <button type="button" className="nesio-section-action" onClick={() => setTypeFilter(null)}>
                          {L(dict, '清除筛选', 'Clear filter')}
                        </button>
                      )}

                    </div>
                  </div>

                  {/* 批次 88:类型筛选栏 —— 只放「是什么」的分类(真类型 + 属性派生的
                      计划/清单虚拟分类);地图/关联图是「怎么看」,已移到下方视图切换。 */}
                  <div className="nesio-memory-type-filter" role="group" aria-label={L(dict, '按类型筛选', 'Filter by type')}>
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
                        <NodeTypeIcon type={t} size={12} /> {typeLabel(t, dict)}
                        <span className="nesio-type-chip-count">{typeCounts[t]}</span>
                      </button>
                    ))}
                    {/* 批次 182(用户实锤):「计划」筛选取消,与「项目」合并(项目球即入口) */}
                    {facetCounts['facet:list'] > 0 && (
                      <button
                        type="button"
                        className={`nesio-type-chip${typeFilter === 'facet:list' ? ' is-active' : ''}`}
                        onClick={() => setTypeFilter((prev) => (prev === 'facet:list' ? null : 'facet:list'))}
                      >
                        <IconCheckSquare size={12} /> {L(dict, '清单', 'Lists')}
                        <span className="nesio-type-chip-count">{facetCounts['facet:list']}</span>
                      </button>
                    )}
                  </div>

                  {/* 批次 183/186(用户实锤):地图、关联图视图均删除 —— 记忆页只保留列表。 */}
                </>
              )}

              {/* 批次 34 空态重设计(用户设计稿):居中大话筒邀请卡,替代文字堆砌 */}
              {!hasNodes && (
                <div className="nesio-memory-invite">
                  <button
                    type="button"
                    className="nesio-memory-invite-mic"
                    aria-label={L(dict, '说一句', 'Say it')}
                    onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-voice'))}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="28" height="28" aria-hidden>
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0" />
                      <line x1="12" y1="18" x2="12" y2="21" />
                    </svg>
                  </button>
                  <p className="nesio-memory-invite-title">{L(dict, '试试说一句', 'Try saying something')}</p>
                  <p className="nesio-memory-invite-sub">
                    {L(dict, '比如「备用钥匙放在门厅抽屉」', 'e.g. "Spare keys are in the hallway drawer"')}
                    <br />
                    {L(dict, '记下之后,你就可以放心忘了', "Once it's noted, you can safely forget it")}
                  </p>
                  {canUsePrivateData && (
                    <button
                      type="button"
                      className="nesio-memory-sample-seed"
                      onClick={() => { seedSampleData(); setNodes(readNodes()); }}
                    >
                      {L(dict, '先看看样例', 'Peek at samples')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Search results header ───────────────────────────────────── */}
          {isSearching && results.length > 0 && (
            <div className="nesio-memory-section-label">{copy.resultCount(results.length)}</div>
          )}

          {/* Object map view */}
          {showObjectMap && !isSearching && (
            <ObjectMap nodes={nodes} onOpenNode={openNodeDetail} />
          )}

          {/* Relation graph view */}
          {showRelationGraph && !isSearching && (
            /* 批次 150(QA #4):底部留出导航栏高度,关联图下缘不被固定「今天/记忆」栏遮挡 */
            <div style={{ padding: '0.5rem 0 calc(5.5rem + env(safe-area-inset-bottom))' }}>
              <RelationGraph
                nodes={buildMemGraphNodes(nodes)}
                edges={buildMemGraphEdges(nodes)}
                height={360}
                onNodeClick={(id) => {
                  const n = nodes.find(x => x.id === id);
                  if (n) openNodeDetail(n);
                }}
                emptyText={L(dict, '暂无记忆节点', 'No memory nodes yet')}
              />
            </div>
          )}

          {/* Memory grid */}
          {!showObjectMap && results.length > 0 ? (
            <div className="nesio-memory-grid">
              {visibleItems.map((node) => (
                <MemoryCard
                  key={node.id}
                  node={node}
                  onOpen={() => openNodeDetail(node)}
                  onDeleted={() => setNodes(readNodes())}
                  onLongPress={() => setLongPressNode(node)}
                />
              ))}
            </div>
          ) : !showObjectMap && isSearching ? (
            <div className="nesio-memory-hero">
              <h2 className="nesio-memory-hero-title">{copy.noResult(query)}</h2>
              <p className="nesio-memory-hero-sub">{copy.noResultHint}</p>
            </div>
          ) : null}

          {/* Show more — incremental: +20 each tap, final tap shows all */}
          {!showAll && results.length > displayLimit && (
            <button
              type="button"
              className="nesio-memory-more-btn"
              onClick={() => {
                const next = displayLimit + 20;
                if (next >= results.length) setShowAll(true);
                else setDisplayLimit(next);
              }}
            >
              {copy.more(results.length - displayLimit)}
            </button>
          )}

          {/* Cloud sync status —— 只对已登录用户显示,且默认安心措辞、绝不暴露裸计数。
              匿名用户没有账号,同步不适用 → 什么都不显示(否则「N 待同步」吓人 + 暴露内部计数)。 */}
          {canUsePrivateData && cloudSyncSummary.failedCount > 0 && (
            <div className="nesio-memory-sync-status">
              {L(dict, '部分记录还没同步到云端,联网后会自动重试。', "Some records aren't in the cloud yet — they'll retry automatically when you're online.")}
            </div>
          )}
          {canUsePrivateData && cloudSyncSummary.failedCount === 0 && cloudSyncSummary.pendingCount > 0 && (
            <div className="nesio-memory-sync-status">
              {L(dict, '✓ 已保存在本机,联网后自动同步。', '✓ Saved on this device, syncs when online.')}
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
          onLongPressNode={(n) => setLongPressNode(n)}
        />
      )}

      {/* 批次 168:收藏夹独立页(维度 filter + 手动收藏卡) */}
      {favPageOpen && (
        <FavoritesSheet
          pinnedNodes={pinnedNodes}
          onClose={() => setFavPageOpen(false)}
          onOpenNode={(n) => { setFavPageOpen(false); openNodeDetail(n); }}
          onLongPressNode={(n) => setLongPressNode(n)}
        />
      )}

      {/* 批次 168:项目独立页 */}
      {projPageOpen && (
        <ProjectsSheet
          projects={projects}
          allNodes={nodes}
          onClose={() => setProjPageOpen(false)}
          onOpenProject={(p) => { setProjPageOpen(false); setActiveProject(p); }}
          onCreate={() => { setProjPageOpen(false); setShowCreateProject(true); }}
          onSetStatus={(projectId, status) => { updateProject(projectId, { status }); setProjects(getProjects()); }}
        />
      )}

      {/* Create project sheet */}
      {showCreateProject && (
        <CreateProjectSheet
          onClose={() => setShowCreateProject(false)}
          onCreate={(name, emoji, status) => {
            const p = createProject(name, emoji);
            if (status !== 'active') updateProject(p.id, { status });
            setProjects(getProjects());
          }}
        />
      )}

      {/* Long press action sheet */}
      {longPressNode && (
        <LongPressSheet
          node={longPressNode}
          projects={projects}
          onAddToProject={(projectId) => {
            addNodeToProject(projectId, longPressNode.id);
            setProjects(getProjects());
          }}
          onShare={() => {
            const text = shareTextForNode(longPressNode, dict);
            if (navigator.share) void navigator.share({ title: longPressNode.name, text });
            else void navigator.clipboard?.writeText(text);
          }}
          onClose={() => setLongPressNode(null)}
        />
      )}
    </>
  );
}
