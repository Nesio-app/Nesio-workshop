import { generateTodayCards } from '../../intelligence';
import type { Signal } from '../../life-domain/signal';
import { addLifeNode, getLifeGraph, getRecentNodes, updateLifeNode, type LifeNode } from '../../portal/life-graph';
import type { RecommendationCard } from '../../portal/reasoning-engine';

export interface SubTask {
  id: string;
  name: string;
  emoji?: string;
  durationMin?: number;
  done: boolean;
}

/** Slimmed-down shape the Today surface needs for focus cards (no raw LifeNode exposure). */
export interface FocusNode {
  id: string;
  name: string;
  type: string;
  rawInput?: string;
  createdAt: string;
  attributes: Record<string, string | number | boolean | null>;
  subtasks?: SubTask[];
}

function parseSubtasks(attrs: Record<string, string | number | boolean | null>): SubTask[] | undefined {
  const raw = attrs.subtasksJson;
  if (typeof raw !== 'string') return undefined;
  try { return JSON.parse(raw) as SubTask[]; } catch { return undefined; }
}

export function saveSubtasks(nodeId: string, subtasks: SubTask[]): void {
  const node = getLifeGraph().find((n) => n.id === nodeId);
  if (!node) return;
  updateLifeNode(nodeId, { attributes: { ...node.attributes, subtasksJson: JSON.stringify(subtasks) } });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
}

export function toggleSubtask(nodeId: string, subtaskId: string): void {
  const node = getLifeGraph().find((n) => n.id === nodeId);
  if (!node) return;
  const subtasks = parseSubtasks(node.attributes) ?? [];
  const next = subtasks.map((s) => s.id === subtaskId ? { ...s, done: !s.done } : s);
  updateLifeNode(nodeId, { attributes: { ...node.attributes, subtasksJson: JSON.stringify(next) } });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
}

// ---- Focus node detection — "everything that deserves attention today" ----

const FOCUS_TIME_WORDS = [
  // Time references
  '今天', '今日', '明天', '明日', '后天', '本周', '这周', '本月', '这个月',
  // Meetings & work
  '会议', '开会', '例会', '周会', '月会', '汇报', '演示', '演讲', 'demo',
  '发布', '上线', '评审', '面试', '面谈', '1on1', 'standup',
  // Deadlines & tasks
  '截止', '到期', '提醒', '别忘', '记得', '不要忘', '最后期限', 'deadline',
  // Appointments & health
  '复诊', '复查', '体检', '检查', '看诊', '医院', '医生', '挂号',
  '手术', '取药', '配药', '打针', '疫苗', '牙医', '产检',
  // Important dates
  '生日', '纪念日', '周年', '忌日', 'birthday', 'anniversary',
  // Travel & logistics
  '出发', '航班', '机票', '火车', '高铁', '出差', '登机',
  // Finance
  '还款', '缴费', '账单', '保险', '交税',
  // Keywords from other languages
  'meeting', 'appointment', 'birthday', 'reminder',
];

// All node types that are inherently action/attention items
const FOCUS_TYPES = new Set(['commitment', 'event', 'health_state']);

/** Extract nearest future or past-due date from a node's attributes */
function extractNearestDate(node: LifeNode): Date | null {
  let nearest: Date | null = null;
  const DATE_KEYS = ['start', 'end', 'date', 'dueDate', 'due', 'deadline', 'datetime', 'scheduledAt', 'remindAt'];
  // Check known date keys first (highest priority)
  for (const key of DATE_KEYS) {
    const v = node.attributes[key];
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        if (!nearest || Math.abs(d.getTime() - Date.now()) < Math.abs(nearest.getTime() - Date.now())) {
          nearest = d;
        }
      }
    }
  }
  // Scan all attributes for any ISO date string
  for (const v of Object.values(node.attributes)) {
    if (typeof v === 'string' && v.length >= 10) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2020) {
        if (!nearest || Math.abs(d.getTime() - Date.now()) < Math.abs(nearest.getTime() - Date.now())) {
          nearest = d;
        }
      }
    }
  }
  return nearest;
}

/** Urgency score: lower = more urgent. Used for sorting. */
function urgencyScore(node: LifeNode): number {
  const now = Date.now();
  const d = extractNearestDate(node);
  if (d) {
    const diff = d.getTime() - now;
    // Overdue but not done — highest priority
    if (diff < 0) return diff; // negative = very high priority
    // Due within 48h
    if (diff < 2 * 86_400_000) return diff;
    // Due within 7 days
    if (diff < 7 * 86_400_000) return diff;
    return diff;
  }
  // No date — rank by recency (recently added commitment = relevant)
  return Date.now() - new Date(node.createdAt).getTime() + 30 * 86_400_000;
}

function isFocusNode(node: LifeNode): boolean {
  if (node.attributes.done) return false;
  const now = Date.now();
  const d = extractNearestDate(node);
  if (d) {
    const diff = d.getTime() - now;
    // Today (0 → 48h) or tomorrow (48h window)
    if (diff >= 0 && diff < 48 * 3_600_000) return true;
  }
  // Explicit "今天/今日" in name or rawInput even without a date attribute
  const text = [node.name, node.rawInput || ''].join(' ');
  if (text.includes('今天') || text.includes('今日')) return true;
  return false;
}

export function markFocusNodeDone(id: string): void {
  const node = getLifeGraph().find((n) => n.id === id);
  if (!node) return;
  updateLifeNode(id, { attributes: { ...node.attributes, done: true, doneAt: new Date().toISOString() } });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  }
}

export function addMeetingNotes(meetingNodeId: string, meetingName: string, notes: string): void {
  addLifeNode({
    name: `会议记录 · ${meetingName}`,
    type: 'commitment',
    tags: ['会议记录', 'meeting-notes'],
    attributes: {
      meetingNodeId,
      notes,
      recordedAt: new Date().toISOString(),
    },
    rawInput: notes,
    confidence: 1,
    source: 'voice',
    relations: [],
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  }
}

export function addCommitmentNode(name: string): FocusNode {
  const node = addLifeNode({ name, type: 'commitment', source: 'manual', confidence: 1, tags: [], attributes: {}, relations: [] });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  }
  return { id: node.id, name: node.name, type: node.type, rawInput: node.rawInput, createdAt: node.createdAt, attributes: node.attributes };
}

export function focusTimeHint(node: FocusNode): string {
  const now = new Date();
  const DATE_KEYS = ['start', 'end', 'date', 'dueDate', 'due', 'deadline', 'datetime', 'scheduledAt', 'remindAt'];

  function formatTimeHint(d: Date): string {
    const diffMs = d.getTime() - now.getTime();
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    const timeStr = hasTime
      ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : '';
    if (diffMs < 0) return '已过期';
    if (hasTime && diffMs < 60 * 60_000) {
      const mins = Math.round(diffMs / 60_000);
      return `${timeStr} · 还有 ${mins} 分钟`;
    }
    if (hasTime && diffMs < 8 * 3_600_000) {
      const hrs = Math.floor(diffMs / 3_600_000);
      const mins = Math.round((diffMs % 3_600_000) / 60_000);
      return `${timeStr} · 还有 ${hrs > 0 ? `${hrs}h` : ''}${mins > 0 ? `${mins}m` : ''}`;
    }
    const diffDays = Math.round(diffMs / 86_400_000);
    if (diffDays === 0) return hasTime ? `今天 ${timeStr}` : '今天';
    if (diffDays === 1) return hasTime ? `明天 ${timeStr}` : '明天';
    if (diffDays <= 7) return `${diffDays} 天后`;
    return `约 ${Math.round(diffDays / 7)} 周后`;
  }

  for (const key of DATE_KEYS) {
    const v = node.attributes[key];
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return formatTimeHint(d);
    }
  }
  for (const v of Object.values(node.attributes)) {
    if (typeof v === 'string' && v.length >= 10) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2020) return formatTimeHint(d);
    }
  }
  const text = [node.name, node.rawInput || ''].join(' ').toLowerCase();
  if (text.includes('今天') || text.includes('今日')) return '今天';
  if (text.includes('明天') || text.includes('明日')) return '明天';
  const ageHours = (now.getTime() - new Date(node.createdAt).getTime()) / 3_600_000;
  if (ageHours < 24) return '刚记录';
  return '';
}

// ---- Proactive context (exposed to Today surface via view-model) ----

export interface ProactiveContextItem {
  nodeId: string;
  name: string;
  daysUntil: number;
  subtype: string;
}

export interface ProactiveContext {
  /** Birthdays / anniversaries within 10 days */
  upcomingSpecialDays: ProactiveContextItem[];
  /** Tasks/commitments already past due (up to 7 days ago, not marked done) */
  overdueItems: ProactiveContextItem[];
  /** Active health-state or health-commitment nodes */
  healthItems: string[];
  /** Any node created in the last 3 days that looks like an email/booking signal */
  recentSignals: string[];
}

const BIRTHDAY_WORDS = ['生日', '纪念日', '周年', '忌日', 'birthday', 'anniversary'];
const HEALTH_TYPES = new Set(['health_state']);
const HEALTH_WORDS = ['健康', '健身', '运动', '睡眠', '饮食', '减肥', '体重', '跑步', '锻炼', '复诊', '体检', '用药', '打卡'];
const SIGNAL_WORDS = ['机票', '酒店', '预订', '订单', '行程', '快递', '外卖', '邮件', 'email', 'order', 'booking', 'flight', 'hotel', 'ticket'];

function buildProactiveContext(allNodes: LifeNode[]): ProactiveContext {
  const now = Date.now();
  const upcomingSpecialDays: ProactiveContextItem[] = [];
  const overdueItems: ProactiveContextItem[] = [];
  const healthItems: string[] = [];
  const recentSignals: string[] = [];

  for (const n of allNodes) {
    if (n.attributes.done) continue;
    const text = [n.name, n.rawInput || ''].join(' ').toLowerCase();

    // Birthdays / special days
    if (BIRTHDAY_WORDS.some((w) => text.includes(w))) {
      const d = extractNearestDate(n);
      if (d) {
        const daysUntil = Math.round((d.getTime() - now) / 86_400_000);
        if (daysUntil >= 0 && daysUntil <= 10) {
          upcomingSpecialDays.push({ nodeId: n.id, name: n.name, daysUntil, subtype: 'special_day' });
        }
      } else {
        upcomingSpecialDays.push({ nodeId: n.id, name: n.name, daysUntil: 0, subtype: 'special_day' });
      }
    }

    // Overdue items
    const d = extractNearestDate(n);
    if (d) {
      const diffMs = d.getTime() - now;
      if (diffMs < 0 && diffMs > -7 * 86_400_000) {
        overdueItems.push({ nodeId: n.id, name: n.name, daysUntil: Math.round(diffMs / 86_400_000), subtype: n.type });
      }
    }

    // Health items
    if (HEALTH_TYPES.has(n.type) || HEALTH_WORDS.some((w) => text.includes(w))) {
      healthItems.push(n.name);
    }

    // Recent signals (email-like or booking-like)
    const ageMs = now - new Date(n.createdAt).getTime();
    if (ageMs < 3 * 86_400_000 && SIGNAL_WORDS.some((w) => text.includes(w))) {
      recentSignals.push(n.name);
    }
  }

  return { upcomingSpecialDays, overdueItems, healthItems, recentSignals };
}

export interface TodayViewModel {
  readonly cards: RecommendationCard[];
  readonly memoryCount: number;
  readonly memoryNotes: readonly string[];
  readonly focusNodes: readonly FocusNode[];
  readonly proactiveContext: ProactiveContext;
}

export function buildTodayViewModel(input: {
  canUsePrivateData: boolean;
  fallbackCards: readonly RecommendationCard[];
  cloudSignals?: readonly Signal[];
}): TodayViewModel {
  const emptyContext: ProactiveContext = {
    upcomingSpecialDays: [], overdueItems: [], healthItems: [], recentSignals: [],
  };

  if (!input.canUsePrivateData) {
    return {
      cards: [...input.fallbackCards],
      memoryCount: 0,
      memoryNotes: [],
      focusNodes: [],
      proactiveContext: emptyContext,
    };
  }

  const cloudSignals = input.cloudSignals?.length ? [...input.cloudSignals] : [];
  const cards = generateTodayCards(cloudSignals.length ? { signals: cloudSignals } : undefined);
  const nodes = getRecentNodes(5);
  const allNodes = getLifeGraph();

  const focusNodes: FocusNode[] = allNodes
    .filter(isFocusNode)
    .sort((a, b) => urgencyScore(a) - urgencyScore(b))
    .slice(0, 10)
    .map((n) => ({ id: n.id, name: n.name, type: n.type, rawInput: n.rawInput, createdAt: n.createdAt, attributes: n.attributes, subtasks: parseSubtasks(n.attributes) }));

  return {
    cards: cards.length > 0 ? cards : [...input.fallbackCards],
    memoryCount: cloudSignals.length || getRecentNodes().length,
    memoryNotes: cloudSignals.length ? cloudSignals.slice(0, 5).map((s) => s.title) : nodes.map((n) => n.name),
    focusNodes,
    proactiveContext: buildProactiveContext(allNodes),
  };
}
