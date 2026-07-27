import { getLifeGraph } from './life-graph';
import { hasHealthData } from './health-store';
import { hasBankTxData } from './bank-tx';

export type BaohePersonalizationStage = 'first_use' | 'day_34';

export interface BaoheDataDepthItem {
  id: string;
  name: string;
  value: string;
  progress: number;
  tone: 'blue' | 'purple' | 'green' | 'amber' | 'red' | 'muted';
  icon: string;
  unlockHint?: string;
}

export interface BaoheMemoryInsight {
  id: string;
  category: string;
  text: string;
  confidence: number;
  evidenceCount: number;
  strength: 1 | 2 | 3;
  userVerified: boolean | null;
}

export interface BaohePendingInsight {
  id: string;
  type: 'pattern' | 'milestone' | 'correlation' | 'recommendation';
  content: string;
  source: string;
  confidence: number;
  priority: 'high' | 'normal';
  relatedMemoryId?: string;
}

export interface BaohePersonalizationSlots {
  greeting: string;
  quote: string;
  remindBarText: string;
  energyNote: string;
  actionCardText: string;
  moodDotColor: string;
  dayBadge: string | null;
}

export interface BaohePersonalizationProfile {
  stage: BaohePersonalizationStage;
  daysSinceStart: number;
  summary: string;
  memoryCount: number;
  memoryProgress: number;
  memoryProgressLabel: string;
  insightVisible: boolean;
  insightBody?: string;
  insightSource?: string;
  pendingInsight?: BaohePendingInsight;
  slots: BaohePersonalizationSlots;
  dayBadge?: string;
  dataDepth: BaoheDataDepthItem[];
  memories: BaoheMemoryInsight[];
  preferences: {
    pace: '从容' | '高效';
    pushTime: string;
    observationPushEnabled: boolean;
  };
}

export const PERSONALIZATION_STAGE_KEY = 'treasurebox-personalization-demo-stage'; // 死壳:stage 切换已退役,勿再写
const INSIGHT_SHOWN_DAY_KEY = 'treasurebox-personalization-insight-shown-day';
const INSIGHT_SUPPRESSED_PREFIX = 'treasurebox-personalization-insight-suppressed-until:';

/** 退役:demo stage 不再驱动 UI;恒按真实图深度算。 */
export function readBaohePersonalizationStage(): BaohePersonalizationStage {
  return 'day_34';
}

export function saveBaohePersonalizationStage(_stage: BaohePersonalizationStage) {
  void _stage;
  // 退役:不再写 demo stage key
}

const FIRST_USE_PROFILE: BaohePersonalizationProfile = {
  stage: 'first_use',
  daysSinceStart: 1,
  summary: 'Nesio 正在了解你',
  memoryCount: 0,
  memoryProgress: 4,
  memoryProgressLabel: 'Nesio 正在了解你 · 再用几天就会有发现',
  insightVisible: false,
  slots: {
    greeting: '早上好，婧',
    quote: '慢一点，深一点，稳一点。',
    remindBarText: '今天先从一件小事开始',
    energyNote: 'Nesio 正在了解你的节奏',
    actionCardText: '先把最小的一步放下来，之后再慢慢整理。',
    moodDotColor: 'var(--status-gentle)',
    dayBadge: null,
  },
  dataDepth: [
    { id: 'home_items', name: '家居物品', value: '0 件物品', progress: 5, tone: 'blue', icon: '⌂' },
    { id: 'contacts', name: '联系人', value: '0 人', progress: 0, tone: 'purple', icon: '○', unlockHint: '添加重要的人' },
    { id: 'tasks', name: '任务清单', value: '今日 0 件', progress: 0, tone: 'green', icon: '≡', unlockHint: '创建待办' },
    { id: 'spending', name: '消费记录', value: '未接入', progress: 0, tone: 'amber', icon: '▣', unlockHint: '接入支出记录' },
    { id: 'habits', name: '习惯追踪', value: '0 个习惯', progress: 0, tone: 'blue', icon: '◔', unlockHint: '记录 5 次习惯' },
    { id: 'health', name: '健康数据', value: '未接入', progress: 0, tone: 'red', icon: '+', unlockHint: '接入健康数据' },
  ],
  memories: [],
  preferences: {
    pace: '从容',
    pushTime: '22:00',
    observationPushEnabled: true,
  },
};

// ── 批次 55:去剧本 —— dataDepth 从真实数据算,不再用两套写死的 profile ──
// 冷启动原理:第一天就是真实的(多为 0/未接入,诚实),数据长起来自动变丰富。
function safeGraph(): Array<{ type: string; createdAt: string }> {
  try { return getLifeGraph() as Array<{ type: string; createdAt: string }>; } catch { return []; }
}
// 情绪点颜色用 warm-coach 状态 token:数据攒起来偏平稳(calm),初期温和(gentle)。
const MOOD_DOT = { gentle: 'var(--status-gentle)', calm: 'var(--status-calm)' } as const;

function computeDataDepth(g: Array<{ type: string }>): BaoheDataDepthItem[] {
  const c = (t: string) => g.filter((x) => x.type === t).length;
  const pct = (n: number, cap: number) => Math.min(100, Math.round((n / cap) * 100));
  const objectN = c('object'), personN = c('person'), taskN = c('commitment');
  const habitN = c('health_habit') + c('preference');
  // health/bank 已迁 IDB → 用 store 的 has-data(不再直读已迁走的 localStorage key)。
  const spend = hasBankTxData(), health = hasHealthData();
  return [
    { id: 'home_items', name: '家居物品', value: `${objectN} 件物品`, progress: pct(objectN, 40), tone: 'blue', icon: '⌂', ...(objectN ? {} : { unlockHint: '拍一下记录物品' }) },
    { id: 'contacts', name: '联系人', value: `${personN} 人`, progress: pct(personN, 20), tone: 'purple', icon: '○', ...(personN ? {} : { unlockHint: '记录重要的人' }) },
    { id: 'tasks', name: '任务清单', value: `${taskN} 件`, progress: pct(taskN, 15), tone: 'green', icon: '≡', ...(taskN ? {} : { unlockHint: '创建待办' }) },
    { id: 'spending', name: '消费记录', value: spend ? '已接入' : '未接入', progress: spend ? 100 : 0, tone: 'amber', icon: '▣', ...(spend ? {} : { unlockHint: '接入支出记录' }) },
    { id: 'habits', name: '习惯追踪', value: `${habitN} 个习惯`, progress: pct(habitN, 8), tone: 'blue', icon: '◔', ...(habitN ? {} : { unlockHint: '记录习惯' }) },
    { id: 'health', name: '健康数据', value: health ? '已接入' : '未接入', progress: health ? 100 : 0, tone: 'red', icon: '+', ...(health ? {} : { unlockHint: '接入健康数据' }) },
  ];
}

export function getBaohePersonalizationProfile(
  _stage: BaohePersonalizationStage = 'day_34',
): BaohePersonalizationProfile {
  const g = safeGraph();
  const memoryCount = g.length;
  const earliest = g.reduce((min, x) => { const t = Date.parse(x.createdAt); return Number.isNaN(t) ? min : Math.min(min, t); }, Date.now());
  const days = Math.max(1, Math.round((Date.now() - earliest) / 86_400_000));
  return {
    ...FIRST_USE_PROFILE,                    // 形状 + 诚实占位;ToolsTreasureSheet 只渲染 dataDepth
    slots: { ...FIRST_USE_PROFILE.slots, moodDotColor: memoryCount >= 10 ? MOOD_DOT.calm : MOOD_DOT.gentle },
    stage: memoryCount >= 10 ? 'day_34' : 'first_use',
    daysSinceStart: days,
    memoryCount,
    memoryProgress: Math.min(100, Math.round((memoryCount / 30) * 100)),
    memoryProgressLabel: memoryCount === 0
      ? 'Nesio 正在了解你 · 记一点东西就会有发现'
      : `已记住 ${memoryCount} 件事 · 越用越懂你`,
    insightVisible: false,                   // 不再造假洞察:真洞察走 多面镜 / 学习面板
    pendingInsight: undefined,
    memories: [],                            // 不再预录记忆:真记忆走 Memory
    dataDepth: computeDataDepth(g),
  };
}

function todayKey(now: Date) {
  return now.toISOString().slice(0, 10);
}

function safeGetStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function shouldShowBaoheInsight(profile: BaohePersonalizationProfile, now = new Date()) {
  if (!profile.insightVisible || !profile.pendingInsight) return false;
  if (profile.daysSinceStart < 7) return false;
  if (profile.pendingInsight.confidence < 75) return false;

  const suppressedUntil = safeGetStorage(`${INSIGHT_SUPPRESSED_PREFIX}${profile.pendingInsight.id}`);
  if (suppressedUntil && Date.parse(suppressedUntil) > now.getTime()) return false;

  if (safeGetStorage(INSIGHT_SHOWN_DAY_KEY) === todayKey(now)) return false;

  if (profile.pendingInsight.priority !== 'high') {
    const hour = now.getHours();
    if (hour < 8 || hour > 22) return false;
  }

  return true;
}

export function rememberBaoheInsightShown(now = new Date()) {
  safeSetStorage(INSIGHT_SHOWN_DAY_KEY, todayKey(now));
}

export function rememberBaoheInsightFeedback(profile: BaohePersonalizationProfile, positive: boolean, now = new Date()) {
  const insight = profile.pendingInsight;
  if (!insight) return;
  if (!positive) {
    const suppressedUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    safeSetStorage(`${INSIGHT_SUPPRESSED_PREFIX}${insight.id}`, suppressedUntil);
  }
}
