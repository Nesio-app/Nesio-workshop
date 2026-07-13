import { generateTodayCards } from '../../intelligence';
import { ingestLifeNode } from '../../life-domain/ingest-node';
import type { Signal } from '../../life-domain/signal';
import { getLifeGraph, getRecentNodes, updateLifeNode, isBulkImported, type LifeNode } from '../../portal/life-graph';
import type { RecommendationCard } from '../../portal/reasoning-engine';
import { nearestNodeDate, nodeExpiryDate } from '../node-dates';
import { LEXICON } from '../keyword-lexicon';
import { scheduleHint } from '../../portal/time-labels';


// 架构审查 #9(读写分离):写操作已迁 today-commands.ts,这里 re-export 保调用方兼容。
// 本文件此后是纯查询侧(view-model 只读),新写操作一律加在 today-commands。
export { saveSubtasks, toggleSubtask, markFocusNodeDone, deleteFocusNode, addMeetingNotes, addCommitmentNode, ingestGranolaMeeting } from './today-commands';
export type { MeetingExtraction, GranolaMeetingInput } from './today-commands';
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
  return nearestNodeDate(node.attributes);
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

/** 批次 72:今日面定位回记忆详情的正门 —— Today 组件不许直连 life-graph(泄漏门禁)。 */
export type LiveMemoryNode = LifeNode;
export function getLiveMemoryNode(id: string): LiveMemoryNode | null {
  return getLifeGraph().find((n) => n.id === id) ?? null;
}

/** 批次 74:聚焦卡直采关联清单 —— 「打包收拾行李」连着「旅行打包清单」时,
 *  粉碎任务直接用清单条目当步骤,勾选写回清单本体(一份数据两处见)。 */
export function getLinkedChecklist(nodeId: string): { nodeId: string; subtasks: SubTask[] } | null {
  const g = getLifeGraph();
  const n = g.find((x) => x.id === nodeId);
  if (!n) return null;
  const LINK_RELS = new Set(['has_checklist', 'related_plan', 'user_linked']);
  for (const r of n.relations || []) {
    if (!LINK_RELS.has(r.relation)) continue;
    const t = g.find((x) => x.id === r.targetId);
    const raw = t?.attributes?.subtasksJson;
    if (typeof raw !== 'string') continue;
    try {
      const subtasks = JSON.parse(raw) as SubTask[];
      if (Array.isArray(subtasks) && subtasks.length > 0) return { nodeId: t!.id, subtasks };
    } catch { /* 坏 JSON 跳过 */ }
  }
  return null;
}

/** 本地日键(YYYY-MM-DD)—— 「加入今日焦点」的准入凭据按本地日自然过期 */
export function localDayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isFocusNode(node: LifeNode): boolean {
  if (node.attributes.done) return false;
  // 批次 50:记忆页长按「加入今日焦点」钉进来的,今天无条件在场(明天自然过期)
  if (node.attributes.focusPinnedOn === localDayKey()) return true;
  // 批次 37:手动/语音亲手添加的待办,当天就进焦点 —— 用户主动放进来的事,
  // 今天就是它的日子(此前无日期待办被拒之门外,「刚记的去哪了」)。
  if (node.type === 'commitment' && (node.source === 'manual' || node.source === 'voice')) {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    if (new Date(node.createdAt).getTime() >= dayStart.getTime()) {
      // 批次 73:带**明确过去日期**的不硬塞进今天(年份写错/补录旧事,
      // 「已过期」出现在今日聚焦不合理 —— 逾期归尘封回顾管)。
      const d0 = extractNearestDate(node);
      if (!d0 || d0.getTime() >= dayStart.getTime()) return true;
    }
  }
  const now = Date.now();
  // 批次 65:有效期按"到当天结束"判定(纯日期零点解析会让今天到期的东西白天就消失)
  const exp = nodeExpiryDate(node.attributes);
  if (exp) {
    const diff = exp.getTime() - now;
    if (diff >= 0 && diff < 48 * 3_600_000) return true;
  }
  const d = extractNearestDate(node);
  if (d) {
    const diff = d.getTime() - now;
    // 批次 66(用户修正定案):48h 窗口保留(今天+明天都可进焦点),
    // 「不该早早出现」管的是倒计时文字 —— 超 12h 不显示倒计时(CalendarCards)。
    if (diff >= 0 && diff < 48 * 3_600_000) return true;
  }
  // Explicit "今天/今日" in name or rawInput even without a date attribute
  const text = [node.name, node.rawInput || ''].join(' ');
  if (text.includes('今天') || text.includes('今日')) return true;
  return false;
}




export function focusTimeHint(node: FocusNode, locale: string = 'zh'): string {
  const now = new Date();
  const en = locale === 'en';
  // 批次 65:有效期驱动的条目要把话说明白 ——「明天」不如「明天到期」
  // (用户实测:牛奶行只有 title + 明天,看不出是快过期了)。
  const exp = nodeExpiryDate(node.attributes);
  if (exp) {
    const diffH = (exp.getTime() - now.getTime()) / 3_600_000;
    if (diffH >= 0 && diffH < 24) return en ? 'expires today' : '今天到期';
    if (diffH >= 24 && diffH < 48) return en ? 'expires tomorrow' : '明天到期';
    if (diffH < 0) return en ? 'expired' : '已过期';
  }
  const d = nearestNodeDate(node.attributes, now.getTime());
  if (d) return scheduleHint(d, now, locale);
  const text = [node.name, node.rawInput || ''].join(' ').toLowerCase();
  if (text.includes('今天') || text.includes('今日')) return en ? 'today' : '今天';
  if (text.includes('明天') || text.includes('明日')) return en ? 'tomorrow' : '明天';
  const ageHours = (now.getTime() - new Date(node.createdAt).getTime()) / 3_600_000;
  if (ageHours < 24) return en ? 'just noted' : '刚记录';
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
  /** Active health-state or health-commitment nodes */
  healthItems: string[];
}

const HEALTH_TYPES = new Set(['health_state']);

function buildProactiveContext(allNodes: LifeNode[]): ProactiveContext {
  const now = Date.now();
  const upcomingSpecialDays: ProactiveContextItem[] = [];
  const healthItems: string[] = [];

  for (const n of allNodes) {
    if (n.attributes.done) continue;
    const text = [n.name, n.rawInput || ''].join(' ').toLowerCase();

    // Birthdays / special days
    if (LEXICON.birthday.test(text) || LEXICON.anniversary.test(text)) {
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

    // Health items
    if (HEALTH_TYPES.has(n.type) || LEXICON.health.test(text)) {
      healthItems.push(n.name);
    }
  }

  return { upcomingSpecialDays, healthItems };
}

/** §1 ①收据首行的输入:纯本机计数(批量导入不计入)—— 绝不是同步/信号计数。 */
export interface TodayReceipt {
  readonly realTotal: number;
  readonly todayCount: number;
  readonly yesterdayCount: number;
}

function computeReceipt(nodes: readonly LifeNode[]): TodayReceipt {
  const real = nodes.filter((n) => !isBulkImported(n));
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const yStart = new Date(dayStart.getTime() - 86_400_000);
  let todayCount = 0, yesterdayCount = 0;
  for (const n of real) {
    const t = new Date(n.createdAt);
    if (t >= dayStart) todayCount++;
    else if (t >= yStart) yesterdayCount++;
  }
  return { realTotal: real.length, todayCount, yesterdayCount };
}

/** 文字简报的记忆素材(批次 30):近 N 条亲手记的(批量导入不计入)。 */
export function recentBriefMemoryNotes(limit = 3): string[] {
  return getLifeGraph()
    .filter((n) => !isBulkImported(n))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((n) => n.name)
    .filter(Boolean);
}

export interface TodayViewModel {
  readonly cards: RecommendationCard[];
  readonly memoryCount: number;
  readonly memoryNotes: readonly string[];
  readonly focusNodes: readonly FocusNode[];
  /** All undone nodes — for dormant engine and other platform consumers. */
  readonly allNodes: readonly FocusNode[];
  readonly proactiveContext: ProactiveContext;
  readonly receipt: TodayReceipt;
}

export function buildTodayViewModel(input: {
  canUsePrivateData: boolean;
  fallbackCards: readonly RecommendationCard[];
  cloudSignals?: readonly Signal[];
}): TodayViewModel {
  const emptyContext: ProactiveContext = { upcomingSpecialDays: [], healthItems: [] };

  if (!input.canUsePrivateData) {
    return {
      cards: [...input.fallbackCards],
      memoryCount: 0,
      memoryNotes: [],
      focusNodes: [],
      allNodes: [],
      proactiveContext: emptyContext,
      // 收据是本机数据的承诺(「都记着呢」),与私有云数据门无关 —— 匿名也要兑现
      receipt: computeReceipt(getLifeGraph()),
    };
  }

  const cloudSignals = input.cloudSignals?.length ? [...input.cloudSignals] : [];
  const cards = generateTodayCards(cloudSignals.length ? { signals: cloudSignals } : undefined);
  const nodes = getRecentNodes(5);
  const lifeGraphNodes = getLifeGraph();

  const toFocusNode = (n: LifeNode): FocusNode => ({
    id: n.id, name: n.name, type: n.type, rawInput: n.rawInput,
    createdAt: n.createdAt, attributes: n.attributes, subtasks: parseSubtasks(n.attributes),
  });

  const focusNodes: FocusNode[] = lifeGraphNodes
    .filter(isFocusNode)
    .sort((a, b) => urgencyScore(a) - urgencyScore(b))
    .slice(0, 10)
    .map(toFocusNode);

  // All undone nodes — for dormant engine and other platform consumers
  const allNodes: FocusNode[] = lifeGraphNodes
    .filter((n) => !n.attributes.done)
    .map(toFocusNode);

  return {
    cards: cards.length > 0 ? cards : [...input.fallbackCards],
    memoryCount: cloudSignals.length || getRecentNodes().length,
    memoryNotes: cloudSignals.length ? cloudSignals.slice(0, 5).map((s) => s.title) : nodes.map((n) => n.name),
    focusNodes,
    allNodes,
    proactiveContext: buildProactiveContext(lifeGraphNodes),
    receipt: computeReceipt(lifeGraphNodes),
  };
}
