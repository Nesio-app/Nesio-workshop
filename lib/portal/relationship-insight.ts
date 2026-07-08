/**
 * 人缘洞察 —— 在 relationships 的联系人推断之上做确定性判定(A 计划 Layer 1,health 范式铺开·人缘域)。
 *
 * 定位(引擎/知识分离):relationships.ts = 数据层/特征层(从记忆图谱推联系人:亲疏、
 * 学到的联系节奏、该联系名单),这里 = 判定层(声明式 RULES + domain-rules 通用运行时)。
 * 此前人缘只有 UI(关系 tab 列表),没有归一 finding、没进 computeDomainFindings、没有 guidance
 * 适配器 —— 是个孤岛。这一层把它接进智能后台:判定 → 脊柱 → Today,与问一问/简报同源。
 *
 * warm-coach 从严(人际最忌焦虑):只出 attention、绝不出红;文案不催不评判,始终给出口
 * (跳过/稍后由卡片机制自带)。重点服务家庭成员(核心亲疏),泛泛之交不打扰。
 * 无持久态:对当前联系人快照做确定性判定(联系节奏/生日临近都是即时算的)。
 */
import type { LifeNode } from './life-graph';
import { buildRelationships, type Closeness } from './relationships';
import { evaluateRules, type DomainRule, type RuleSeverity } from './domain-rules';
import { loadAllPersonRecords, RECORD_CATEGORY_MAP, type PersonRecord } from './person-records';

export interface RelationshipFinding {
  id: string;
  severity: RuleSeverity;
  title: [string, string];  // [zh, en]
  detail: [string, string];
}

export interface RelationshipInsightInput {
  nodes: LifeNode[];
  now: Date;
  /** 可注入「联系过了」打卡(单测用);默认由 buildRelationships 读本机 nesio-rel-contact-v1。 */
  contactLog?: Record<string, string>;
  /** 可注入按人记录(单测用);默认读本机 person-records。仅消费非敏感类(成绩/消费),敏感三类绝不进。 */
  records?: PersonRecord[];
}

const DAY_MS = 86_400_000;
// 重点管理的亲疏层级:核心(家人)优先,亲近次之;泛泛之交(acquaintance)不主动催。
const FOCUS_CLOSENESS: ReadonlyArray<Closeness> = ['core', 'close'];
const BIRTHDAY_WINDOW = 7; // 生日提前 7 天提醒(够时间准备,又不过早)
const ACHIEVEMENT_WINDOW = 45; // 成绩/好消息回看窗口(天)
const FAMILY_RE = /家人|家庭|family/i;

/** 从 person 节点的 birthday(--MM-DD / YYYY-MM-DD / MM-DD)算距下一次生日还有几天。无效返回 null。 */
function daysUntilBirthday(raw: unknown, now: Date): { days: number; mmdd: string } | null {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/(\d{1,2})-(\d{1,2})\s*$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const y = now.getFullYear();
  // 用当天 00:00 起算,当天生日=0 天
  const today = new Date(y, now.getMonth(), now.getDate());
  let next = new Date(y, month - 1, day);
  if (next.getTime() < today.getTime()) next = new Date(y + 1, month - 1, day);
  const days = Math.round((next.getTime() - today.getTime()) / DAY_MS);
  const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { days, mmdd };
}

const RULES: ReadonlyArray<DomainRule<RelationshipInsightInput, RelationshipFinding>> = [
  // ── 该联系了(重点家人/亲近):超过你和这个人真实节奏没联系 ────────────────────────
  // 只对核心/亲近的人提示(家庭成员重点);泛泛之交不催。有真实联系记录(daysSince 非空)
  // 才会 reachOut,所以不会对「从没联系过」的通讯录条目瞎催。
  {
    id: 'reach-out-core',
    run: (i) => {
      const contacts = buildRelationships(i.nodes, i.now.getTime(), i.contactLog);
      const due = contacts.filter((c) => c.reachOut && FOCUS_CLOSENESS.includes(c.closeness));
      if (!due.length) return null; // buildRelationships 已按超期程度排序,取最靠前的
      const top = due[0];
      const rel = top.relation ? `${top.relation} · ` : '';
      const more = due.length - 1;
      const moreZh = more > 0 ? ` · 还有 ${more} 位家人/亲近的人也可以问候一下` : '';
      const moreEn = more > 0 ? ` · ${more} more close one${more > 1 ? 's' : ''} to check in on too` : '';
      const dayTxt = top.daysSince != null ? `${top.daysSince} 天` : '一阵子';
      const dayTxtEn = top.daysSince != null ? `${top.daysSince} days` : 'a while';
      return {
        severity: 'attention',
        title: ['家里人有阵子没联系了', "It's been a while with someone close"],
        detail: [
          `${rel}${top.name} 已经 ${dayTxt}没联系了${moreZh}。想的话,发条消息就好,不急。`,
          `${rel}${top.name} — ${dayTxtEn} since you last connected${moreEn}. A quick message is enough, no rush.`,
        ],
      };
    },
  },

  // ── 生日临近:重点的人(核心/亲近)7 天内过生日 ───────────────────────────────
  // 只对有亲疏信号的人提示(避免整本通讯录的生日刷屏);取最近的一个。
  {
    id: 'birthday-soon',
    run: (i) => {
      const focus = new Set(
        buildRelationships(i.nodes, i.now.getTime(), i.contactLog)
          .filter((c) => FOCUS_CLOSENESS.includes(c.closeness))
          .map((c) => c.key),
      );
      let best: { name: string; days: number; mmdd: string } | null = null;
      for (const n of i.nodes) {
        if (n.type !== 'person' || !n.name) continue;
        // 只提示重点的人的生日(核心/亲近);key 归一同 buildRelationships(小写名/邮箱)
        const email = typeof n.attributes?.email === 'string' ? n.attributes.email.toLowerCase() : '';
        if (!focus.has(n.name.toLowerCase()) && !(email && focus.has(email))) continue;
        const b = daysUntilBirthday(n.attributes?.birthday, i.now);
        if (!b || b.days > BIRTHDAY_WINDOW) continue;
        if (!best || b.days < best.days) best = { name: n.name, days: b.days, mmdd: b.mmdd };
      }
      if (!best) return null;
      const whenZh = best.days === 0 ? '就是今天' : best.days === 1 ? '就在明天' : `还有 ${best.days} 天`;
      const whenEn = best.days === 0 ? 'today' : best.days === 1 ? 'tomorrow' : `in ${best.days} days`;
      return {
        severity: 'attention',
        title: [`${best.name} 的生日快到了`, `${best.name}'s birthday is coming up`],
        detail: [
          `${whenZh}(${best.mmdd})。要不要先想个小小的问候或礼物?`,
          `It's ${whenEn} (${best.mmdd}). Maybe plan a little note or gift?`,
        ],
      };
    },
  },

  // ── 好消息:近期有人挂了「成绩」(非敏感)—— 提醒你去给一句鼓励。绝不碰医疗/药物/健康。 ──
  {
    id: 'person-achievement',
    run: (i) => {
      const contacts = buildRelationships(i.nodes, i.now.getTime(), i.contactLog);
      const nameByKey = new Map(contacts.map((c) => [c.key, c.name]));
      const cutoff = i.now.getTime() - ACHIEVEMENT_WINDOW * DAY_MS;
      const hits = (i.records || [])
        // 只看成绩类,且再用 sensitive 标位兜底(双保险:敏感三类永不进洞察/AI)
        .filter((r) => r.category === 'achievement' && !RECORD_CATEGORY_MAP[r.category]?.sensitive && nameByKey.has(r.personKey))
        .map((r) => ({ r, t: Date.parse(r.date || r.createdAt) }))
        .filter((x) => !Number.isNaN(x.t) && x.t >= cutoff && x.t <= i.now.getTime())
        .sort((a, b) => b.t - a.t);
      if (!hits.length) return null;
      const top = hits[0].r;
      const name = nameByKey.get(top.personKey) || top.personKey;
      const more = hits.length - 1;
      const moreZh = more > 0 ? `(近期还有 ${more} 条好消息)` : '';
      const moreEn = more > 0 ? ` (+${more} more lately)` : '';
      return {
        severity: 'attention',
        title: [`${name} 有件值得高兴的事`, `Good news for ${name}`],
        detail: [
          `${top.title}${top.date ? `(${top.date.slice(5)})` : ''}${moreZh} —— 要不要给 TA 一句鼓励?`,
          `${top.title}${top.date ? ` (${top.date.slice(5)})` : ''}${moreEn} — maybe send a word of cheer?`,
        ],
      };
    },
  },

  // ── 本月给家人的记账(非敏感·消费):温和汇总,方便回顾。绝不碰敏感三类。 ──
  {
    id: 'family-spending-month',
    run: (i) => {
      const contacts = buildRelationships(i.nodes, i.now.getTime(), i.contactLog);
      const familyKeys = new Set(
        contacts.filter((c) => c.closeness === 'core' || c.groups.some((g) => FAMILY_RE.test(g))).map((c) => c.key),
      );
      if (!familyKeys.size) return null;
      const ym = `${i.now.getFullYear()}-${String(i.now.getMonth() + 1).padStart(2, '0')}`;
      let total = 0; let count = 0;
      for (const r of i.records || []) {
        if (r.category !== 'spending' || !familyKeys.has(r.personKey)) continue;
        if ((r.date || r.createdAt).slice(0, 7) !== ym) continue;
        count += 1;
        if (typeof r.amount === 'number') total += r.amount;
      }
      if (count === 0 || total <= 0) return null;
      return {
        severity: 'attention',
        title: ['这个月给家人的记账', 'Family spending this month'],
        detail: [
          `本月为家人记了 ${count} 笔消费,合计 ${total}。想看是给谁的,点进去就有。`,
          `${count} spending note${count > 1 ? 's' : ''} for family this month, ${total} total. Tap in to see who.`,
        ],
      };
    },
  },
];

/** 人缘域 findings 总入口(确定性;人际域从严 —— 只轻提示、绝不出红)。 */
export function relationshipFindings(input: RelationshipInsightInput): RelationshipFinding[] {
  if (!input.nodes.length) return [];
  // records 缺省读本机 person-records;仅成绩/消费两类规则消费,敏感三类在规则里被排除。
  const resolved: RelationshipInsightInput = { ...input, records: input.records ?? loadAllPersonRecords() };
  return evaluateRules(RULES, resolved);
}
