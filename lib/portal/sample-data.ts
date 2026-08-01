/**
 * 样例数据(冷启动「先看看样例」)—— 登录后一键灌入一批**真节点**,体验完可一键清。
 *
 * 与 demo-seed(游客只读、写路径拒收)不同:这是真数据,走合法写入门 ingestLifeNode,
 * 按 attributes.externalId 幂等(重灌不堆重复),统一盖 tag「样例」;清除时按该 tag 删。
 * 覆盖:人物(核心/家人/朋友/同事)· 记忆/邮件/日历/位置 · 提醒(承诺)· 心情 · 回顾(去年今日)。
 *
 * 全离线构造(纯数据 + 相对日期),不调 AI、不联网。私据门:仅登录态可灌(调用方把守)。
 */
import { getLifeGraph, deleteLifeNode, type LifeNode } from '@/lib/portal/life-graph';
import { ingestLifeNode, type IngestNodeInput } from '@/lib/life-domain/ingest-node';
import { loadProfileSettings } from '@/lib/portal/profile';

export const SAMPLE_TAG = '样例';
const SAMPLE_EVENT = 'nesio-life-graph-updated';

export type SampleLocale = 'zh' | 'en';

function iso(daysFromNow: number, hour = 10, min = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}
/** 去年今天(±偏移),给「回顾 · 去年今日」用。 */
function lastYear(hour = 9): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** 样例节点模板(相对日期,每次灌入按当下时间生成)。externalId 幂等键统一 sample- 前缀。
 *  locale='en' 出一套英文样例(不含 Linda 这类杜撰人名,重点导览洞察页/头像进设置/提醒卡手势)。 */
export function buildSampleNodes(locale: SampleLocale = 'zh'): IngestNodeInput[] {
  return locale === 'en' ? buildSampleNodesEn() : buildSampleNodesZh();
}

function buildSampleNodesZh(): IngestNodeInput[] {
  const t = (extra: string[] = []) => [SAMPLE_TAG, ...extra];
  return [
    // ── 人物(关系 tab:核心/家人/朋友/同事)──
    { type: 'person', name: '妈妈', source: 'manual', confidence: 1, relations: [],
      tags: t(['家人', '联系人']),
      attributes: { externalId: 'sample-mom', category: 'family', relation: '家人', note: '喜欢散步、爱操心' } },
    { type: 'person', name: '发小', source: 'manual', confidence: 1, relations: [],
      tags: t(['朋友', '联系人']),
      attributes: { externalId: 'sample-linda', category: 'friend', relation: '朋友', birthday: iso(6), note: '喜欢蓝色' } },
    { type: 'person', name: '老王', source: 'manual', confidence: 1, relations: [],
      tags: t(['同事', '联系人']),
      attributes: { externalId: 'sample-wang', category: 'colleague', relation: '同事' } },

    // ── 记忆(提到人,攒出关系热度）──
    { type: 'event', name: '和妈妈通了电话', source: 'manual', confidence: 1,
      relations: [{ targetId: '妈妈', relation: '家人' }],
      tags: t(['关系']), rawInput: '晚上给妈妈打了电话,聊了快一个小时',
      attributes: { externalId: 'sample-call-mom', date: iso(-1, 20) } },
    { type: 'collection', name: '想给发小挑个生日礼物', source: 'manual', confidence: 1,
      relations: [{ targetId: '发小', relation: '朋友' }],
      tags: t(['关系', '提醒']), rawInput: '发小生日快到了,她喜欢蓝色的东西',
      attributes: { externalId: 'sample-linda-gift' } },

    // ── 邮件(记忆页来源=邮件)──
    { type: 'event', name: 'Your Day Ahead · 今日概览', source: 'email', confidence: 1,
      relations: [], tags: t(['邮件']),
      rawInput: '早上好。今天有一场评审会,下午天气转晴,适合出门走走。',
      attributes: { externalId: 'sample-email-daily', from: 'Nesio Digest <digest@nesio.app>', subject: 'Your Day Ahead', date: iso(0, 7), snippet: '今天有一场评审会,下午天气转晴。' } },

    // ── 日历(今天页日程 + 洞察）──
    { type: 'event', name: '产品评审会', source: 'calendar', confidence: 1,
      relations: [], tags: t(['会议', '日历']),
      rawInput: '明天上午十点产品评审会,提前整理三个重点',
      attributes: { externalId: 'sample-cal-review', start: iso(1, 10), end: iso(1, 11), location: '会议室 B', participants: '产品组' } },

    // ── 提醒 / 承诺（今日焦点 · 该做的事）──
    { type: 'task', name: '给妈妈回个电话', source: 'manual', confidence: 1,
      relations: [{ targetId: '妈妈', relation: '家人' }], tags: t(['提醒']),
      rawInput: '答应妈妈这周末回个电话',
      attributes: { externalId: 'sample-todo-callmom', dueDate: iso(2, 19), owner: '我', priority: 'medium' } },

    // ── 地方笔记（批次 174:place 类型退役 —— 无真实数据源,真实地点走「足迹」与物品 location 属性）──
    { type: 'collection', name: '巷口咖啡馆', source: 'manual', confidence: 1,
      relations: [], tags: t(['地点']),
      rawInput: '巷口那家咖啡馆下午人少,写东西效率很高',
      attributes: { externalId: 'sample-cafe', category: 'cafe', note: '靠窗的位置最好', lat: 40.0308, lon: -105.2925, city: 'Boulder', country: '美国' } },

    // ── 心情（今天页第一拍 · 洞察情绪）──
    { type: 'Mind', name: '此刻 · 平静', source: 'manual', confidence: 1,
      relations: [], tags: t(['moment', 'feeling', 'calm', 'energy-mid']),
      rawInput: '此刻 平静 · 精力中',
      attributes: { externalId: 'sample-mood-today', date: iso(0, 14, 20), emotion: 'calm', emotionLabel: '平静', emotionQuadrant: 'hv-la', energyValue: 55, energyLevel: 'mid' } },

    // ── 回顾（去年今日 · 念念翻出旧记忆）──
    { type: 'event', name: '第一次一个人去看海', source: 'manual', confidence: 1,
      relations: [], tags: t(['回顾']),
      rawInput: '第一次一个人去看海,风很大,居然没那么怕。',
      attributes: { externalId: 'sample-lastyear-sea', date: lastYear() } },
  ];
}

/** 英文样例 —— 无杜撰人名(只保留 Mom 这类角色),重点是导览:
 *  ①洞察页的观察与分析(引导点进去)②点头像进设置 ③顶部提醒卡的左滑/右滑/双击手势。 */
function buildSampleNodesEn(): IngestNodeInput[] {
  const t = (extra: string[] = []) => [SAMPLE_TAG, ...extra];
  return [
    // ── People:只留角色关系,不杜撰名字(关系 tab 有内容但不喧宾夺主）──
    { type: 'person', name: 'Mom', source: 'manual', confidence: 1, relations: [],
      tags: t(['family', '联系人']),
      attributes: { externalId: 'sample-en-mom', category: 'family', relation: 'family', note: 'Loves long walks; worries a little' } },

    // ── 记忆(提到人,攒关系热度)──
    { type: 'event', name: 'Called Mom on the way home', source: 'manual', confidence: 1,
      relations: [{ targetId: 'Mom', relation: 'family' }],
      tags: t(['relationship']), rawInput: 'Called Mom walking home — talked for almost an hour, she sounded happy.',
      attributes: { externalId: 'sample-en-call-mom', date: iso(-1, 20) } },

    // ── 导览①:洞察页(观察 + 分析,引导点进去)──
    { type: 'collection', name: 'See what Insights noticed this week', source: 'manual', confidence: 1,
      relations: [], tags: t(['guide']),
      rawInput: 'Nesio quietly watches your week and turns it into observations. Open Insights (bottom bar) to see your daily rhythm, what keeps coming to mind, and a few threads worth picking back up — tap the pie to explore.',
      attributes: { externalId: 'sample-en-guide-insights', date: iso(0, 8) } },

    // ── 导览②:点头像进设置 ──
    { type: 'collection', name: 'Tap your avatar to open Settings', source: 'manual', confidence: 1,
      relations: [], tags: t(['guide']),
      rawInput: 'Your avatar sits at the top-left. Tap it to reach your profile and Settings — appearance & language, data & privacy, membership, and Lab. That is also where you rename yourself and change your photo.',
      attributes: { externalId: 'sample-en-guide-avatar', date: iso(0, 8, 30) } },

    // ── 导览③:顶部提醒卡的手势(左滑/右滑/双击)──
    { type: 'collection', name: 'The reminder cards respond to gestures', source: 'manual', confidence: 1,
      relations: [], tags: t(['guide']),
      rawInput: 'On the reminder cards up top: swipe left if a nudge is not useful, swipe right to be reminded later, and double-tap when it is useful. No buttons to hunt for.',
      attributes: { externalId: 'sample-en-guide-gestures', date: iso(0, 9) } },

    // ── 邮件(记忆页来源=邮件)──
    { type: 'event', name: 'Your Day Ahead', source: 'email', confidence: 1,
      relations: [], tags: t(['邮件']),
      rawInput: 'Good morning. One review today, and the afternoon clears up — a good window for a walk. Check Insights for what stood out this week.',
      attributes: { externalId: 'sample-en-email-daily', from: 'Nesio Digest <digest@nesio.app>', subject: 'Your Day Ahead', date: iso(0, 7), snippet: 'One review today; the afternoon clears up.' } },

    // ── 日历(今天页日程 + 洞察)──
    { type: 'event', name: 'Product review', source: 'calendar', confidence: 1,
      relations: [], tags: t(['会议', '日历']),
      rawInput: 'Product review at 10am — pull together the three key points beforehand.',
      attributes: { externalId: 'sample-en-cal-review', start: iso(1, 10), end: iso(1, 11), location: 'Room B', participants: 'Product team' } },

    // ── 提醒 / 承诺（今日焦点 · 顶部提醒卡,可练手势）──
    { type: 'task', name: 'Call Mom back this weekend', source: 'manual', confidence: 1,
      relations: [{ targetId: 'Mom', relation: 'family' }], tags: t(['提醒']),
      rawInput: 'Promised to call Mom back this weekend.',
      attributes: { externalId: 'sample-en-todo-callmom', dueDate: iso(2, 19), owner: 'me', priority: 'medium' } },

    // ── 位置（足迹 · 常去）──
    { type: 'place', name: 'Corner Café', source: 'manual', confidence: 1,
      relations: [], tags: t(['地点']),
      rawInput: 'The café on the corner is quiet in the afternoon — good place to write.',
      attributes: { externalId: 'sample-en-cafe', category: 'cafe', note: 'The window seat is best', lat: 40.0308, lon: -105.2925, city: 'Boulder', country: 'United States' } },

    // ── 心情（今天页第一拍 · 洞察情绪）──
    { type: 'Mind', name: 'Right now · Calm', source: 'manual', confidence: 1,
      relations: [], tags: t(['moment', 'feeling', 'calm', 'energy-mid']),
      rawInput: 'Right now: calm · steady energy',
      attributes: { externalId: 'sample-en-mood-today', date: iso(0, 14, 20), emotion: 'calm', emotionLabel: 'Calm', emotionQuadrant: 'hv-la', energyValue: 55, energyLevel: 'mid' } },

    // ── 反复在想（洞察·「你最近反复在想」的饼图,同标签≥3 攒出一瓣）──
    { type: 'collection', name: 'Morning pages before the day starts', source: 'manual', confidence: 1,
      relations: [], tags: t(['reflection']),
      rawInput: 'Three pages longhand before email. Head feels clearer after.',
      attributes: { externalId: 'sample-en-reflect-morning', date: iso(-2, 7) } },
    { type: 'collection', name: 'A long walk untangled a decision', source: 'manual', confidence: 1,
      relations: [], tags: t(['reflection']),
      rawInput: 'Walked the loop and the stuck decision suddenly made sense.',
      attributes: { externalId: 'sample-en-reflect-walk', date: iso(-4, 18) } },
    { type: 'collection', name: 'One deep-work block, phone away', source: 'manual', confidence: 1,
      relations: [], tags: t(['reflection']),
      rawInput: 'Ninety focused minutes beat the whole scattered afternoon before it.',
      attributes: { externalId: 'sample-en-reflect-focus', date: iso(-6, 15) } },

    // ── 回顾（去年今日 · 念念翻出旧记忆,顶部提醒卡）──
    { type: 'event', name: 'My first solo trip to the coast', source: 'manual', confidence: 1,
      relations: [], tags: t(['回顾']),
      rawInput: 'First time at the coast on my own — the wind was fierce, and it felt less scary than I expected.',
      attributes: { externalId: 'sample-en-lastyear-sea', date: lastYear() } },
  ];
}

/** 是否已灌过样例。 */
export function hasSampleData(nodes: LifeNode[] = safeGraph()): boolean {
  return nodes.some((n) => (n.tags ?? []).includes(SAMPLE_TAG));
}

function safeGraph(): LifeNode[] {
  try { return getLifeGraph(); } catch { return []; }
}

/** 灌入样例(幂等:externalId 命中则原地更新)。返回写入条数。调用方保证仅登录态调用。
 *  按当前界面语言选中/英文样例(英文界面 → 英文数据)。 */
export function seedSampleData(): number {
  if (typeof window === 'undefined') return 0;
  const locale: SampleLocale = String(loadProfileSettings().locale).startsWith('en') ? 'en' : 'zh';
  const nodes = buildSampleNodes(locale);
  for (const input of nodes) ingestLifeNode(input);
  window.dispatchEvent(new CustomEvent(SAMPLE_EVENT));
  return nodes.length;
}

/** 清除全部样例节点(按 tag「样例」删)。返回删除条数。 */
export function clearSampleData(): number {
  if (typeof window === 'undefined') return 0;
  const victims = safeGraph().filter((n) => (n.tags ?? []).includes(SAMPLE_TAG));
  for (const v of victims) deleteLifeNode(v.id);
  if (victims.length) window.dispatchEvent(new CustomEvent(SAMPLE_EVENT));
  return victims.length;
}
