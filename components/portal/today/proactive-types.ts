/**
 * Proactive card 共享类型与本地存储 helpers(dismiss / snooze / 时间兜底)。
 * 从 TodayFeed 拆出(工程 PRD 组件阈值整改)。
 */

import { L } from '@/lib/portal/i18n';
import type { EvidenceRef } from '@/lib/portal/reasoning-engine';
import type { RecommendationCard } from '@/lib/portal/reasoning-engine';

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
  nodeId?: string;
  actions?: ProactiveAction[];
  expiresAt?: string;  // ISO — card auto-hides after this time (Google Now lifecycle)
  /** Traceable evidence (PRD TODAY-002) — rendered as an expandable 依据 section. */
  evidence?: EvidenceRef[];
  /** 为什么现在出现 one-liner. */
  reason?: string;
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
 * 轮播兜底(批次 3 用户反馈:「希望未来预测一直有东西显示,每次打开都不一样」)。
 * 管线没有卡可出时,从内容池随机挑一张:时间段建议 / 历史上的今天 /
 * 记忆回顾 / 使用提示。安静模式(预算 0)下仍然不出。
 */
export interface FallbackNodeLike { id: string; name: string; createdAt: string; type?: string }

export function buildRotatingFallback(now: Date, nodes: readonly FallbackNodeLike[], locale: string = 'zh'): ProactiveCardData | null {
  const l = (zh: string, en: string) => L(locale, zh, en);
  const pool: ProactiveCardData[] = [];

  const timeCard = buildTimeFallback(now, locale);
  if (timeCard) pool.push(timeCard);

  // 历史上的今天(同月同日、更早年份)
  const otd = nodes.filter((n) => {
    const d = new Date(n.createdAt);
    return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear();
  });
  if (otd.length > 0) {
    const pick = otd[Math.floor(Math.random() * otd.length)];
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
    const pick = old14[Math.floor(Math.random() * old14.length)];
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
  const q = FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
  pool.push({
    id: 'fallback-quote',
    title: l('今日一句', 'Line of the day'),
    body: l(`「${q.zh}」— ${q.byZh}`, `"${q.en}" — ${q.byEn}`),
    confidence: 60, sourceTags: [l('金句', 'Quote')], icon: '✨', priority: 1,
  });

  return pool[Math.floor(Math.random() * pool.length)];
}

const FALLBACK_QUOTES: Array<{ zh: string; en: string; byZh: string; byEn: string }> = [
  { zh: '千里之行,始于足下。', en: 'A journey of a thousand miles begins with a single step.', byZh: '老子', byEn: 'Laozi' },
  { zh: '不积跬步,无以至千里。', en: 'Without small steps, there is no thousand-mile journey.', byZh: '荀子', byEn: 'Xunzi' },
  { zh: '逝者如斯夫,不舍昼夜。', en: 'Time flows on like this river, day and night.', byZh: '孔子', byEn: 'Confucius' },
  { zh: '知足者富。', en: 'He who knows he has enough is rich.', byZh: '老子', byEn: 'Laozi' },
  { zh: '未经审视的生活不值得过。', en: 'The unexamined life is not worth living.', byZh: '苏格拉底', byEn: 'Socrates' },
  { zh: '我们受的苦,多半来自想象。', en: 'We suffer more often in imagination than in reality.', byZh: '塞涅卡', byEn: 'Seneca' },
  { zh: '每一天都是一年中最好的一天。', en: 'Every day is the best day in the year.', byZh: '爱默生', byEn: 'Emerson' },
  { zh: '我的经验,由我选择注意什么决定。', en: 'My experience is what I agree to attend to.', byZh: '威廉·詹姆斯', byEn: 'William James' },
  { zh: '水滴石穿,不靠力,靠恒。', en: 'Dripping water pierces stone by persistence, not force.', byZh: '谚语', byEn: 'Proverb' },
  { zh: '种一棵树最好的时间是十年前,其次是现在。', en: 'The best time to plant a tree was ten years ago; the second best is now.', byZh: '谚语', byEn: 'Proverb' },
  { zh: '慢慢来,比较快。', en: 'Slow is smooth, and smooth is fast.', byZh: '谚语', byEn: 'Proverb' },
  { zh: '此心安处是吾乡。', en: 'Where the heart is at peace, there is home.', byZh: '苏轼', byEn: 'Su Shi' },
];


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

export function dismissProactiveById(cardId: string) {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(PROACTIVE_DISMISS_KEY) || '{}');
    map[cardId] = new Date().toISOString().slice(0, 10);
    localStorage.setItem(PROACTIVE_DISMISS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

export function isProactiveCardDismissed(cardId: string): boolean {
  try {
    const map: Record<string, string> = JSON.parse(localStorage.getItem(PROACTIVE_DISMISS_KEY) || '{}');
    return map[cardId] === new Date().toISOString().slice(0, 10);
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
