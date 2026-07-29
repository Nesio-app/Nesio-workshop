/**
 * Proactive card 共享类型与本地存储 helpers(dismiss / snooze / 时间兜底)。
 * 从 TodayFeed 拆出(工程 PRD 组件阈值整改)。
 */

import { L } from '@/lib/portal/i18n';
import type { EvidenceRef } from '@/lib/portal/reasoning-engine';
import type { RecommendationCard } from '@/lib/portal/reasoning-engine';
import { localDayKey } from '@/lib/portal/local-day';

export interface ProactiveAction {
  label: string;
  actionType: 'dismiss' | 'snooze' | 'done';
}

export interface ProactiveCardData {
  id: string;
  title: string;
  body: string;
  confidence: number;
  sourceTags: string[];
  icon: string;
  priority: number;
  cardType?: string;
  /**
   * 事实指纹 —— 取 AI 改写**之前**的原始标题+正文。
   * 渲染出来的文案会被 Layer 7 重写,拿它当指纹的话每次重写都算「新事实」,
   * 「不要再出现」永远对不上号。所以指纹必须在管线出卡处一次定死。
   */
  factKey?: string;
  /** 冷却键 —— 与 guidance-pipeline 的 dedupKey 同源(多实例类型是 `type:id`)。 */
  coolKey?: string;
  nodeId?: string;
  actions?: ProactiveAction[];
  expiresAt?: string;  // ISO — card auto-hides after this time (Google Now lifecycle)
  /** Traceable evidence (PRD TODAY-002) — rendered as an expandable 依据 section. */
  evidence?: EvidenceRef[];
  /** 为什么现在出现 one-liner. */
  reason?: string;
  /** 金句卡:这句所属类别(批次 29 偏好算法用:收藏→多推同类,不再提醒→换类别)。 */
  quoteCategory?: QuoteCat;
}


// Time-based fallback nudge — only shown when the guidance pipeline produces nothing
export function buildTimeFallback(now: Date, locale: string = 'zh'): ProactiveCardData | null {
  const l = (zh: string, en: string) => L(locale, zh, en);
  const dow = now.getDay();
  const hour = now.getHours();
  if (dow === 1 && hour < 11) {
    return { id: 'fallback-week-start', title: l('新的一周从规划开始', 'Start the week with a plan'), body: l('周一早上，把本周最重要的 3 件事先记下来。', 'Monday morning: jot down the 3 things that matter most this week.'), confidence: 70, sourceTags: [l('时间·周一', 'Time · Monday')], icon: '🗓', priority: 5 };
  }
  if (dow === 5 && hour >= 15) {
    return { id: 'fallback-week-end', title: l('本周还有什么没收尾？', 'Anything left to wrap up this week?'), body: l('周五下午，快速过一遍本周待办，周末才能真正放松。', 'Friday afternoon: a quick pass over the week so the weekend is actually off.'), confidence: 70, sourceTags: [l('时间·周五', 'Time · Friday')], icon: '✅', priority: 5 };
  }
  if (hour >= 21) {
    return { id: 'fallback-evening', title: l('今天有什么想记下来的？', 'Anything worth writing down today?'), body: l('睡前花 30 秒，把今天的想法或待办存进来。', '30 seconds before bed: capture today\'s thoughts or todos.'), confidence: 65, sourceTags: [l('时间·晚间', 'Time · Evening')], icon: '🌙', priority: 4 };
  }
  return null;
}


/**
 * @deprecated v1 规格 §1(2026-07):Today 不再硬凑 —— TodayFeed 已停用本兜底,
 * 「页面活着」由收据首行负责;「历史上的今天/随机回顾」内容迁到洞察「走走看」。
 * 保留一版待金句偏好学习(quoteCategory)迁移后整体删除。
 */
export interface FallbackNodeLike { id: string; name: string; createdAt: string; type?: string }

/**
 * 确定性种子(批次 22:修「未来预测自己跳」根因)。
 * 此前池内 5 处 Math.random,useMemo 的 allNodes 引用一抖动就重算 →
 * 每次 re-render 都随机换卡,视觉上「自己跳」。改用「日期+小时」种子:
 * 同一小时内选出的卡稳定;整点滚动一次;划掉才立即换下一张。
 */
function hourSeed(now: Date): number {
  return now.getFullYear() * 1_000_000 + (now.getMonth() + 1) * 10_000 + now.getDate() * 100 + now.getHours();
}
function seededPick<T>(arr: readonly T[], seed: number, salt = 0): T {
  // xorshift 小散列,种子稳定则结果稳定
  let h = (seed + salt * 2_654_435_761) >>> 0;
  h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0;
  return arr[h % arr.length];
}

export function buildRotatingFallback(now: Date, nodes: readonly FallbackNodeLike[], locale: string = 'zh', rotation = 0): ProactiveCardData | null {
  const l = (zh: string, en: string) => L(locale, zh, en);
  // rotation:用户每划掉一张 +1,才换下一张;否则同一小时内稳定不跳
  const seed = hourSeed(now) + rotation * 101;
  const pool: ProactiveCardData[] = [];

  const timeCard = buildTimeFallback(now, locale);
  if (timeCard) pool.push(timeCard);

  // 历史上的今天(同月同日、更早年份)
  const otd = nodes.filter((n) => {
    const d = new Date(n.createdAt);
    return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear();
  });
  if (otd.length > 0) {
    const pick = seededPick(otd, seed, 1);
    const years = now.getFullYear() - new Date(pick.createdAt).getFullYear();
    pool.push({
      id: 'fallback-on-this-day',
      title: l(`${years} 年前的今天`, `On this day, ${years} year${years > 1 ? 's' : ''} ago`),
      body: l(`你记下了「${pick.name.slice(0, 40)}」。点 Memory 可以回看。`, `You noted "${pick.name.slice(0, 40)}". Tap Memory to revisit.`),
      confidence: 70, sourceTags: [l('历史上的今天', 'On this day')], icon: '🗓', priority: 4,
    });
  }

  // 记忆回顾(随机一条 14 天前的旧记录)
  const old14 = nodes.filter((n) => now.getTime() - new Date(n.createdAt).getTime() > 14 * 86_400_000);
  if (old14.length > 0) {
    const pick = seededPick(old14, seed, 2);
    const d = new Date(pick.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    pool.push({
      id: 'fallback-resurface',
      title: l('还记得这条吗？', 'Remember this one?'),
      body: l(`${d} 你记下了「${pick.name.slice(0, 40)}」。`, `On ${d} you noted "${pick.name.slice(0, 40)}".`),
      confidence: 65, sourceTags: [l('记忆回顾', 'Memory review')], icon: '💡', priority: 3,
    });
  }

  // 使用提示(永远可用的兜底之兜底)
  pool.push({
    id: 'fallback-tip-ask',
    title: l('找东西不用翻', 'Find things without digging'),
    body: l('长按中间按钮问一问:「护照放在哪」「上次买的药」,记过的都能找到。', 'Long-press the center button and ask: "Where\'s my passport?" — anything you noted can be found.'),
    confidence: 60, sourceTags: [l('小技巧', 'Tip')], icon: '💡', priority: 2,
  });
  if (nodes.length >= 5) {
    pool.push({
      id: 'fallback-tip-count',
      title: l(`已经陪你记住 ${nodes.length} 件事`, `${nodes.length} things remembered together so far`),
      body: l('点左上角 Nesio 图标,看看这段时间的洞察和分析。', 'Tap the Nesio mark top-left for insights and analytics on this stretch.'),
      confidence: 60, sourceTags: [l('小技巧', 'Tip')], icon: '📦', priority: 2,
    });
  }

  // 金句兜底(批次 10 用户反馈:「如果所有卡片都没有了就显示金句、quote 之类的」)。
  // 全部取公版格言,带出处;和其他池子一样随机轮换,保证这一区永远有内容。
  // 批次 29:按类别偏好加权 —— 收藏过的类别多出现,不再提醒的类别少出现。
  // 每句按其类别权重重复若干次进候选池,再确定性挑选(同一小时仍稳定)。
  const catPref = loadQuoteCatPref();
  // 有界加权:pref(0.15..5)映射成 1..5 份 —— 偏好类多出现,但每类至少 1 份、最多 5×,
  // 保证探索(冷门类仍有机会露出),口味变了也能被重新学到(不像 pref×3 那样近乎垄断)。
  const copies = (p: number) => 1 + Math.round(4 * (Math.max(0.15, Math.min(5, p)) - 0.15) / (5 - 0.15));
  const weighted = FALLBACK_QUOTES.flatMap((item) => Array(copies(catPref[item.cat] ?? 1)).fill(item) as typeof FALLBACK_QUOTES);
  const q = seededPick(weighted, seed, 3);
  pool.push({
    id: 'fallback-quote',
    title: l('今日一句', 'Line of the day'),
    body: l(`「${q.zh}」— ${q.byZh}`, `"${q.en}" — ${q.byEn}`),
    confidence: 60, sourceTags: [l('金句', 'Quote')], icon: '✨', priority: 1,
    quoteCategory: q.cat,
  });

  // 确定性挑一张:同一小时稳定,不再自己跳
  return seededPick(pool, seed, 0);
}

/** 金句类别(批次 29):行动 / 自省 / 安定 / 知足。 */
export type QuoteCat = 'action' | 'reflect' | 'calm' | 'content';

export const QUOTE_CAT_LABELS: Record<QuoteCat, [string, string]> = {
  action: ['行动', 'Action'], reflect: ['自省', 'Reflection'], calm: ['安定', 'Calm'], content: ['知足', 'Contentment'],
};

const FALLBACK_QUOTES: Array<{ zh: string; en: string; byZh: string; byEn: string; cat: QuoteCat }> = [
  { zh: '千里之行,始于足下。', en: 'A journey of a thousand miles begins with a single step.', byZh: '老子', byEn: 'Laozi', cat: 'action' },
  { zh: '不积跬步,无以至千里。', en: 'Without small steps, there is no thousand-mile journey.', byZh: '荀子', byEn: 'Xunzi', cat: 'action' },
  { zh: '水滴石穿,不靠力,靠恒。', en: 'Dripping water pierces stone by persistence, not force.', byZh: '谚语', byEn: 'Proverb', cat: 'action' },
  { zh: '种一棵树最好的时间是十年前,其次是现在。', en: 'The best time to plant a tree was ten years ago; the second best is now.', byZh: '谚语', byEn: 'Proverb', cat: 'action' },
  { zh: '未经审视的生活不值得过。', en: 'The unexamined life is not worth living.', byZh: '苏格拉底', byEn: 'Socrates', cat: 'reflect' },
  { zh: '我的经验,由我选择注意什么决定。', en: 'My experience is what I agree to attend to.', byZh: '威廉·詹姆斯', byEn: 'William James', cat: 'reflect' },
  { zh: '我们受的苦,多半来自想象。', en: 'We suffer more often in imagination than in reality.', byZh: '塞涅卡', byEn: 'Seneca', cat: 'reflect' },
  { zh: '逝者如斯夫,不舍昼夜。', en: 'Time flows on like this river, day and night.', byZh: '孔子', byEn: 'Confucius', cat: 'reflect' },
  { zh: '慢慢来,比较快。', en: 'Slow is smooth, and smooth is fast.', byZh: '谚语', byEn: 'Proverb', cat: 'calm' },
  { zh: '此心安处是吾乡。', en: 'Where the heart is at peace, there is home.', byZh: '苏轼', byEn: 'Su Shi', cat: 'calm' },
  { zh: '每一天都是一年中最好的一天。', en: 'Every day is the best day in the year.', byZh: '爱默生', byEn: 'Emerson', cat: 'calm' },
  { zh: '知足者富。', en: 'He who knows he has enough is rich.', byZh: '老子', byEn: 'Laozi', cat: 'content' },
];

// ── 批次 29:金句类别偏好权重 ───────────────────────────────────────────────
// 收藏(存到记忆)→ 该类别 +;不再提醒 → 该类别 −。挑句时按权重加权(仍每小时稳定)。
const QUOTE_CAT_PREF_KEY = 'nesio-quote-cat-pref-v1';
const ALL_QUOTE_CATS: QuoteCat[] = ['action', 'reflect', 'calm', 'content'];

export function loadQuoteCatPref(): Record<QuoteCat, number> {
  const base: Record<QuoteCat, number> = { action: 1, reflect: 1, calm: 1, content: 1 };
  if (typeof window === 'undefined') return base;
  try {
    const raw = JSON.parse(localStorage.getItem(QUOTE_CAT_PREF_KEY) || '{}') as Partial<Record<QuoteCat, number>>;
    for (const c of ALL_QUOTE_CATS) if (typeof raw[c] === 'number') base[c] = raw[c] as number;
  } catch { /* ignore */ }
  return base;
}

/** 调整某类别权重(clamp 0.15..5);收藏 +0.6,不再提醒 -0.6。
 *  每次调整先把所有类别向中性 1 轻微回归(λ=0.06),没被持续强化的偏好会慢慢淡忘 ——
 *  口味变了不会被旧偏好锁死(和 mirror hourEngagement 的抗饱和同思路)。 */
export function bumpQuoteCat(cat: QuoteCat | undefined, delta: number): void {
  if (!cat || typeof window === 'undefined') return;
  const pref = loadQuoteCatPref();
  for (const c of ALL_QUOTE_CATS) pref[c] = (pref[c] ?? 1) + 0.06 * (1 - (pref[c] ?? 1));
  pref[cat] = Math.max(0.15, Math.min(5, pref[cat] + delta));
  try { localStorage.setItem(QUOTE_CAT_PREF_KEY, JSON.stringify(pref)); } catch { /* ignore */ }
}


const SNOOZE_KEY = 'nesio-snoozed-overdue';

export function snoozeOverdue(nodeId: string, days: number) {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}');
    const until = new Date();
    until.setDate(until.getDate() + days);
    map[nodeId] = until.toISOString();
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}


// ---- Proactive card dismiss helpers ----

const PROACTIVE_DISMISS_KEY = 'nesio-proactive-dismissed';

/**
 * 静音表:cardId → 被静音时这张卡说了什么(内容指纹)。
 *
 * 由来(真机):「AT&T 定期扣款涨价了」这类**事实型**卡片,用户取消多少次都会
 * 第二天再冒出来 —— 因为旧逻辑只记「今天已关」。可事实没变,重复通知就是纯骚扰,
 * 也直接违背 warm-coach 的「每个提示都要有『不再提醒』出口」。
 *
 * 新语义:**静音到内容变化为止**。传进来的是**事实指纹**(ProactiveCardData.factKey,
 * 由管线在 AI 改写之前一次算定)—— AT&T 若再涨到 $70,指纹变了,卡片理应重新出现;
 * 只要还在说同一件事,就永远闭嘴。
 *
 * 注意这里**不再自己对文案取哈希**:渲染出来的 title/body 已被 Layer 7 重写过,
 * 拿它算指纹的话,每天一次新改写就是一个新指纹,静音永远命中不了(第一版就栽在这)。
 */
const PROACTIVE_MUTED_KEY = 'nesio-proactive-muted-v1';

export function dismissProactiveById(cardId: string, factKey?: string) {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(PROACTIVE_DISMISS_KEY) || '{}');
    map[cardId] = localDayKey();
    localStorage.setItem(PROACTIVE_DISMISS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
  if (!factKey) return;
  try {
    const muted: Record<string, string> = JSON.parse(localStorage.getItem(PROACTIVE_MUTED_KEY) || '{}');
    muted[cardId] = factKey;
    localStorage.setItem(PROACTIVE_MUTED_KEY, JSON.stringify(muted));
  } catch { /* ignore */ }
}

export function isProactiveCardDismissed(cardId: string, factKey?: string): boolean {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(PROACTIVE_DISMISS_KEY) || '{}');
    if (map[cardId] === localDayKey()) return true;
  } catch { /* ignore */ }
  if (!factKey) return false;
  try {
    const muted: Record<string, string> = JSON.parse(localStorage.getItem(PROACTIVE_MUTED_KEY) || '{}');
    // 说的还是同一件事 → 保持静音;内容变了 → 放行(那是新消息)
    return muted[cardId] === factKey;
  } catch { return false; }
}

// ── DEC 卡登记表(反馈环回写用)─────────────────────────────────────────────
// Today 渲染的是 GuidanceCard 投影,evidenceSignalIds 等字段不进渲染层。
// 反馈(TODAY-004)要写回 signal 反馈环(recordSignalFeedback)需要完整
// RecommendationCard——管线每轮登记,反馈时按 guidance 卡 id 取回,
// evidenceSignalIds 随完整卡保全(契约 todayCardsRequireEvidenceSignalIds)。

const decCardRegistry = new Map<string, RecommendationCard>();

export function registerDecCards(cards: readonly RecommendationCard[]): void {
  decCardRegistry.clear();
  for (const card of cards) decCardRegistry.set(`guidance-dec-${card.id}`, card);
}

export function getRegisteredDecCard(guidanceCardId: string): RecommendationCard | undefined {
  return decCardRegistry.get(guidanceCardId);
}

// ── 主动提醒程度(设置 → 通用):控制 Today 主动卡数量 ─────────────────────
// proactive=3(与 TODAY_CARD_BUDGET 一致)/ minimal=1 / silent=0。
// GeneralSheet 写入并广播 'nesio-proactive-level-changed'。

export const PROACTIVE_LEVEL_KEY = 'nesio-proactive-level-v1';

export function getProactiveCardBudget(): number {
  if (typeof window === 'undefined') return 3;
  try {
    const level = localStorage.getItem(PROACTIVE_LEVEL_KEY);
    if (level === 'silent') return 0;
    if (level === 'minimal') return 1;
  } catch { /* ignore */ }
  return 3;
}
