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

export const SAMPLE_TAG = '样例';
const SAMPLE_EVENT = 'nesio-life-graph-updated';

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

/** 样例节点模板(相对日期,每次灌入按当下时间生成)。externalId 幂等键统一 sample- 前缀。 */
export function buildSampleNodes(): IngestNodeInput[] {
  const t = (extra: string[] = []) => [SAMPLE_TAG, ...extra];
  return [
    // ── 人物(关系 tab:核心/家人/朋友/同事)──
    { type: 'person', name: '妈妈', source: 'manual', confidence: 1, relations: [],
      tags: t(['家人', '联系人']),
      attributes: { externalId: 'sample-mom', category: 'family', relation: '家人', note: '喜欢散步、爱操心' } },
    { type: 'person', name: 'Linda', source: 'manual', confidence: 1, relations: [],
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
    { type: 'note', name: '想给 Linda 挑个生日礼物', source: 'manual', confidence: 1,
      relations: [{ targetId: 'Linda', relation: '朋友' }],
      tags: t(['关系', '提醒']), rawInput: 'Linda 生日快到了,她喜欢蓝色的东西',
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
    { type: 'commitment', name: '给妈妈回个电话', source: 'manual', confidence: 1,
      relations: [{ targetId: '妈妈', relation: '家人' }], tags: t(['提醒']),
      rawInput: '答应妈妈这周末回个电话',
      attributes: { externalId: 'sample-todo-callmom', dueDate: iso(2, 19), owner: '我', priority: 'medium' } },

    // ── 位置（足迹 · 常去）──
    { type: 'place', name: '巷口咖啡馆', source: 'manual', confidence: 1,
      relations: [], tags: t(['地点']),
      rawInput: '巷口那家咖啡馆下午人少,写东西效率很高',
      attributes: { externalId: 'sample-cafe', category: 'cafe', note: '靠窗的位置最好', lat: 40.0308, lon: -105.2925, city: 'Boulder', country: '美国' } },

    // ── 心情（今天页第一拍 · 洞察情绪）──
    { type: 'health_state', name: '此刻 · 平静', source: 'manual', confidence: 1,
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

/** 是否已灌过样例。 */
export function hasSampleData(nodes: LifeNode[] = safeGraph()): boolean {
  return nodes.some((n) => (n.tags ?? []).includes(SAMPLE_TAG));
}

function safeGraph(): LifeNode[] {
  try { return getLifeGraph(); } catch { return []; }
}

/** 灌入样例(幂等:externalId 命中则原地更新)。返回写入条数。调用方保证仅登录态调用。 */
export function seedSampleData(): number {
  if (typeof window === 'undefined') return 0;
  const nodes = buildSampleNodes();
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
