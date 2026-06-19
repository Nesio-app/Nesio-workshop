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

export const PERSONALIZATION_STAGE_KEY = 'treasurebox-personalization-demo-stage';
const INSIGHT_SHOWN_DAY_KEY = 'treasurebox-personalization-insight-shown-day';
const INSIGHT_SUPPRESSED_PREFIX = 'treasurebox-personalization-insight-suppressed-until:';

const FIRST_USE_PROFILE: BaohePersonalizationProfile = {
  stage: 'first_use',
  daysSinceStart: 1,
  summary: '宝盒正在了解你',
  memoryCount: 0,
  memoryProgress: 4,
  memoryProgressLabel: '宝盒正在了解你 · 再用几天就会有发现',
  insightVisible: false,
  slots: {
    greeting: '早上好，婧',
    quote: '慢一点，深一点，稳一点。',
    remindBarText: '今天先从一件小事开始',
    energyNote: '宝盒正在了解你的节奏',
    actionCardText: '先把最小的一步放下来，之后再慢慢整理。',
    moodDotColor: '#f6c90e',
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

const DAY_34_PROFILE: BaohePersonalizationProfile = {
  stage: 'day_34',
  daysSinceStart: 34,
  summary: '持续增长中',
  memoryCount: 23,
  memoryProgress: 68,
  memoryProgressLabel: '已了解 23 件事 · 持续成长中',
  insightVisible: true,
  insightBody: '你好像每周五下午特别高效，我会把重要提醒调到那时候',
  insightSource: '基于过去 4 周任务完成时段分析',
  pendingInsight: {
    id: 'insight-friday-productivity',
    type: 'pattern',
    content: '你好像每周五下午特别高效，我会把重要提醒调到那时候',
    source: '基于过去 4 周任务完成时段分析',
    confidence: 82,
    priority: 'normal',
    relatedMemoryId: 'memory-weekly-output',
  },
  slots: {
    greeting: '下午好，婧',
    quote: '允许自己不确定，答案会在路上长出来。',
    remindBarText: '妈妈生日还有几天，要不要现在花两分钟挑个礼物？',
    energyNote: '昨晚睡得好，身体在慢慢回升',
    actionCardText: '妈妈生日还有几天，要不要现在花两分钟挑个礼物？定制相册或护肤套装都很贴心，做不完也没关系。',
    moodDotColor: '#74b9ff',
    dayBadge: '第 34 天 · 越来越了解你',
  },
  dayBadge: '第 34 天 · 越来越了解你',
  dataDepth: [
    { id: 'home_items', name: '家居物品', value: '32 件物品', progress: 80, tone: 'blue', icon: '⌂' },
    { id: 'contacts', name: '联系人', value: '8 人', progress: 20, tone: 'purple', icon: '○' },
    { id: 'tasks', name: '任务清单', value: '今日 3 件', progress: 68, tone: 'green', icon: '≡' },
    { id: 'spending', name: '消费记录', value: '本月 ¥2,340', progress: 60, tone: 'amber', icon: '▣' },
    { id: 'habits', name: '习惯追踪', value: '5 个习惯', progress: 50, tone: 'blue', icon: '◔' },
    { id: 'health', name: '健康数据', value: '未接入', progress: 0, tone: 'red', icon: '+', unlockHint: '接入后可推算最佳状态时段' },
  ],
  memories: [
    { id: 'memory-active-night', category: '节律', text: '晚上 10-11 点最活跃', confidence: 88, evidenceCount: 8, strength: 2, userVerified: null },
    { id: 'memory-mood-recovering', category: '情绪', text: '近两周情绪偏蓝，在慢慢回暖', confidence: 75, evidenceCount: 4, strength: 1, userVerified: null },
    { id: 'memory-weekly-output', category: '习惯', text: '周一低效，周五产出高', confidence: 82, evidenceCount: 7, strength: 2, userVerified: null },
    { id: 'memory-pace-preference', category: '偏好', text: '喜欢从容节奏，不喜欢被催', confidence: 91, evidenceCount: 12, strength: 3, userVerified: null },
    { id: 'memory-close-relations', category: '关系', text: '最在意妈妈和几个老朋友', confidence: 79, evidenceCount: 5, strength: 1, userVerified: null },
  ],
  preferences: {
    pace: '从容',
    pushTime: '22:00',
    observationPushEnabled: true,
  },
};

export function getBaohePersonalizationProfile(
  stage: BaohePersonalizationStage = 'day_34',
): BaohePersonalizationProfile {
  return stage === 'first_use' ? FIRST_USE_PROFILE : DAY_34_PROFILE;
}

export function readBaohePersonalizationStage(): BaohePersonalizationStage {
  if (typeof window === 'undefined') return 'day_34';
  try {
    return localStorage.getItem(PERSONALIZATION_STAGE_KEY) === 'first_use'
      ? 'first_use'
      : 'day_34';
  } catch {
    return 'day_34';
  }
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
  safeSetStorage(`treasurebox-personalization-insight-feedback:${insight.id}`, positive ? 'positive' : 'negative');
  if (!positive) {
    const suppressedUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    safeSetStorage(`${INSIGHT_SUPPRESSED_PREFIX}${insight.id}`, suppressedUntil);
  }
}

export function saveBaohePersonalizationStage(stage: BaohePersonalizationStage) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PERSONALIZATION_STAGE_KEY, stage);
  } catch {
    /* ignore */
  }
}
