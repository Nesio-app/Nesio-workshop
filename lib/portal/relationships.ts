/**
 * relationships — 关系管理层(批次 41)。
 * 复用 life-graph 已有的 person 节点 + relations + email 节点,不新增数据模型。
 * 纯规则:从记忆里推出「你认识谁 / 多久没联系 / 关系亲疏 / 该主动联系谁」。
 *
 * 联系信号来源(取最近一次):
 *   1. email 节点 attributes.from + attributes.date(你和谁通过信)
 *   2. person 节点 lastConfirmedAt / createdAt
 *   3. 任意节点在 rawInput / name / relations 里提到这个人名
 *   4. 本机「联系过了」打卡(nesio-rel-contact-v1)—— 不依赖任何同步也能维护
 */
import type { LifeNode } from './life-graph';
import { reportStorageDropped } from './storage-health';
import { loadRelationshipOverrides } from './relationship-overrides';
import { resolveEntityKey, loadEntityAliases } from './entity-resolution';

export type Closeness = 'core' | 'close' | 'acquaintance';

export interface Contact {
  key: string;                   // 归一身份(小写名/邮箱)
  name: string;                  // 显示名
  relation: string | null;      // 家人/朋友/同事… 来自 relations 或推断
  closeness: Closeness;
  mentions: number;              // 被多少条记忆提到(亲疏代理)
  lastContactAt: string | null; // ISO
  daysSince: number | null;
  cadenceDays: number;           // 期望联系节奏
  reachOut: boolean;             // 超期该联系
  overdueRatio: number;          // daysSince / cadence,排序用
  groups: string[];              // Google 联系人分组(家人/同事/自建组),关系 tab 按此筛选
  /** Gmail/通讯录头像 URL(person 节点 attributes.photo,Google People API 拉的非默认头像)。 */
  photo: string | null;
}

const CADENCE: Record<Closeness, number> = { core: 14, close: 30, acquaintance: 90 };

/**
 * 关系标签固定选项(bug3:关系改「选 tag」,不再自由填写)。
 * 值原样存进 Contact.relation,所以每一项都要能被下面的 CORE_RE / CLOSE_RE 认出来 ——
 * 否则选了「父母」亲疏还是算「一般」。改这个表时对着两个正则核一遍。
 */
export const RELATION_TAGS: Array<{ zh: string; en: string }> = [
  { zh: '伴侣', en: 'Partner' },
  { zh: '父母', en: 'Parent' },
  { zh: '子女', en: 'Child' },
  { zh: '兄弟姐妹', en: 'Sibling' },
  { zh: '家人', en: 'Family' },
  { zh: '朋友', en: 'Friend' },
  { zh: '同事', en: 'Coworker' },
  { zh: '同学', en: 'Classmate' },
  { zh: '邻居', en: 'Neighbor' },
  { zh: '客户', en: 'Client' },
  { zh: '医生', en: 'Doctor' },
];

// 关系词 → 亲疏。中英混合匹配。
const CORE_RE = /家人|亲人|配偶|伴侣|老婆|老公|妻|夫|父|母|爸|妈|儿|女|兄|弟|姐|妹|family|spouse|partner|wife|husband|mother|father|mom|dad|son|daughter|brother|sister|parent/i;
const CLOSE_RE = /朋友|挚友|好友|闺蜜|哥们|死党|friend|bestie|buddy/i;
// 结构性/非人关系:这些 relation 的 targetId 不是人(品牌架构/文档/物品归属),不进联系人。
const NON_PERSON_REL = /架构|品牌|文档|包含|定义|属于|归属|拥有|收纳|容器|involves_person|owned_by|contains|part_of|belongs|includes|defines|architecture|brand|document|category|object/i;
/** life-graph 节点 id 误当人名(如 node-178495…)—— 绝不能进联系人列表。 */
const NODE_ID_RE = /^node-\d+/i;

// 非人类「联系人」:邮件发件人里大量是机器人/机构/通知/账单/银行卡,不是你认识的人 ——
// 关系管理只保留真人(用户实测:vercel[bot]、Platinum Card from American Express、Chase® Ink® 漏进列表)。
// 显示名强信号(机器人标记/商标符/no-reply/通知/账单/多词银行卡品牌);单词银行名(Chase/Citi/Visa)
// 是常见姓氏,不据此过滤,靠 ® / card / bank / 邮箱角色地址兜底,避免误杀真人。
// 显示名的公司/机构强信号:商标符、机器人、no-reply、账单、以及公司实体标记(.com/Inc/LLC/
// 投资/日历/团队…)。用户实测:Calendar (Google Calendar)、Fidelity Investments、Amazon.com 漏进。
const NON_HUMAN_NAME = /\[bot\]|®|™|no[-\s.]?reply|do[-\s.]?not[-\s.]?reply|noreply|donotreply|\bnotifications?\b|\bnewsletter\b|\bstatements?\b|\breceipts?\b|\binvoice\b|mailer[-\s.]?daemon|postmaster|american express|capital one|wells fargo|mastercard|\bcard\b|\bbank\b|\.com\b|\.net\b|\.org\b|\binc\b|\bllc\b|\bltd\b|\bcorp\b|investments?|\bcalendar\b|\bteam\b|\bstore\b/i;
// 邮箱角色地址(local part):这些是机构群发/通知地址,不是个人。
const NON_HUMAN_EMAIL_LOCAL = /^(no-?reply|do-?not-?reply|noreply|donotreply|notify|notifications?|alerts?|mailer-daemon|postmaster|bounce|info|support|hello|team|sales|news|newsletter|updates?|accounts?|billing|service|member|statements?|automated|system|admin|marketing|contact|receipts?|orders?)$/i;

// 个人邮箱服务商:发件人若来自这些域,才把「未在通讯录里」的邮件发件人当新联系人 ——
// 公司/机构域(fidelity.com / amazon.com / google.com …)的发件人不新建联系人(避免公司刷进人缘)。
const PERSONAL_EMAIL_DOMAIN = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'ymail.com', 'aol.com',
  'qq.com', '163.com', '126.com', 'foxmail.com', 'sina.com', '139.com',
  'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com', 'hey.com',
]);

function emailDomain(key: string): string {
  const at = key.indexOf('@');
  return at > 0 ? key.slice(at + 1).toLowerCase() : '';
}

/** 邮箱归一:小写、去 +别名;Gmail 再去本地部分的点号。用于把自己的各种别名收敛成一个身份。 */
export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.indexOf('@');
  if (at < 0) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/** 账户本人身份键集合:归一后的邮箱 + 小写名字。用来把「自己」从联系人里剔除。 */
export function selfIdentityKeys(self?: { emails?: string[]; names?: string[] }): { emails: Set<string>; names: Set<string> } {
  const emails = new Set<string>();
  const names = new Set<string>();
  for (const em of self?.emails ?? []) { const n = normalizeEmail(em); if (n.includes('@')) emails.add(n); }
  for (const nm of self?.names ?? []) { const t = nm.trim().toLowerCase(); if (t.length >= 2) names.add(t); }
  return { emails, names };
}

/** 一次性会议与会人:只当过一次「participant/attendee」、无分组、无联系记录 → 噪声,不列入关系。 */
const PARTICIPANT_REL = /participant|attendee|invitee|与会|参会|受邀|列席/i;

/** 判断一个候选联系人是否明显不是真人(机器人/机构/通知/账单/公司发件人)。 */
function isLikelyNonHuman(name: string, key: string): boolean {
  if (NON_HUMAN_NAME.test(name)) return true;
  const at = key.indexOf('@');
  if (at > 0 && NON_HUMAN_EMAIL_LOCAL.test(key.slice(0, at))) return true;
  return false;
}

/** 从 "Linda Smith <linda@x.com>" 或裸邮箱里取显示名 + 归一 key。 */
export function parseContactFrom(from: string): { name: string; key: string } | null {
  const s = from.trim();
  if (!s) return null;
  const m = s.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>/);
  if (m) {
    const name = m[1].trim();
    const email = m[2].trim().toLowerCase();
    return { name: name || email, key: email };
  }
  if (s.includes('@')) {
    const email = s.toLowerCase();
    return { name: s.split('@')[0], key: email };
  }
  return { name: s, key: s.toLowerCase() };
}

function toIso(dateLike: unknown): string | null {
  if (typeof dateLike !== 'string' || !dateLike) return null;
  const t = Date.parse(dateLike);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function newer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

interface Acc {
  key: string;
  name: string;
  relation: string | null;
  mentions: number;
  last: string | null;
  relationHit: Closeness | null;
  times: number[]; // 所有联系时间戳(ms),用来学这个人真实的联系节奏
}

const CADENCE_MIN = 3;   // 学到的节奏夹紧下限(天)
const CADENCE_MAX = 180;

/** 从一个人的真实联系时间戳学出他的联系节奏:相邻两次间隔的中位数(天)。
 *  <3 次没法学 → 回退到按亲疏的固定桶。这把"写死的 14/30/90"换成"你和这个人实际多久联系一次"。 */
function learnedCadence(times: number[], fallbackDays: number): number {
  if (times.length < 3) return fallbackDays;
  const sorted = [...times].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push((sorted[i] - sorted[i - 1]) / 86400000);
  const valid = gaps.filter((g) => g > 0.2); // 同批导入的同秒重复不算一次间隔
  if (valid.length < 2) return fallbackDays;
  valid.sort((a, b) => a - b);
  const mid = valid.length % 2 ? valid[(valid.length - 1) / 2] : (valid[valid.length / 2 - 1] + valid[valid.length / 2]) / 2;
  return Math.max(CADENCE_MIN, Math.min(CADENCE_MAX, Math.round(mid)));
}

// ── 本机「联系过了」打卡:key → ISO ──
const CONTACT_LOG_KEY = 'nesio-rel-contact-v1';

export function loadContactLog(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const v = JSON.parse(localStorage.getItem(CONTACT_LOG_KEY) || '{}');
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch { return {}; }
}

export function markContacted(key: string, dateIso = new Date().toISOString()): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const log = loadContactLog();
  log[key] = dateIso;
  try { localStorage.setItem(CONTACT_LOG_KEY, JSON.stringify(log)); } catch { reportStorageDropped(); }
  return log;
}

function closenessOf(a: Acc): Closeness {
  if (a.relationHit) return a.relationHit;
  if (a.mentions >= 5) return 'core';
  if (a.mentions >= 2) return 'close';
  return 'acquaintance';
}

/** 从记忆图谱推出联系人清单。now 可注入以便测试。 */
export function buildRelationships(
  nodes: LifeNode[],
  now = Date.now(),
  contactLog = loadContactLog(),
  self?: { emails?: string[]; names?: string[] },
): Contact[] {
  const acc = new Map<string, Acc>();
  const groupsByKey = new Map<string, Set<string>>();  // key → Google 分组名(排除内部标记)
  const photoByKey = new Map<string, string>();        // key → Gmail 头像 URL(左侧显示真头像,不是字母块)
  const selfIds = selfIdentityKeys(self);
  // 数据审计 #4:实体解析 —— 别名表一趟只加载一次;身份键走 resolveEntityKey,让「妈妈/母亲」
  // 「Linda/linda@x.com」这类同一实体的不同写法收敛成一个联系人(无别名配置时=旧的规范化行为)。
  const aliases = loadEntityAliases();
  const bump = (rawName: string, rawKey: string, date: string | null, relation: string | null) => {
    const name = rawName.trim();
    const key = resolveEntityKey(rawKey, aliases);
    if (!key || key.length < 2) return;
    // 过滤明显不是人的 key(纯数字/系统标记/节点 id)
    if (/^\d+$/.test(key) || NODE_ID_RE.test(key) || NODE_ID_RE.test(name)) return;
    // 账户本人不是联系人:自己的邮箱(含 +别名/点号归一)或名字命中即剔除 —— 修「自己的
    // hanbing6228+cc 被当成联系人」。
    if (selfIds.emails.has(normalizeEmail(key)) || selfIds.names.has(key) || selfIds.names.has(name.trim().toLowerCase())) return;
    // 过滤机器人/机构/通知/账单发件人 —— 关系管理只留真人
    if (isLikelyNonHuman(name, key)) return;
    const cur = acc.get(key) || { key, name, relation: null, mentions: 0, last: null, relationHit: null, times: [] };
    cur.mentions += 1;
    cur.last = newer(cur.last, date);
    if (date) { const t = Date.parse(date); if (!Number.isNaN(t)) cur.times.push(t); }
    if (!cur.relation && relation) cur.relation = relation;
    if (relation) {
      if (CORE_RE.test(relation)) cur.relationHit = 'core';
      else if (CLOSE_RE.test(relation) && cur.relationHit !== 'core') cur.relationHit = 'close';
    }
    if (name && name.length > cur.name.length && name.length < 40) cur.name = name;
    acc.set(key, cur);
  };

  // 预扫已知真人(person 节点)的身份 key —— 邮件发件人命中则允许富化(即便公司邮箱)。
  const knownPersonKeys = new Set<string>();
  for (const n of nodes) {
    if (n.type === 'person' && n.name) {
      knownPersonKeys.add(resolveEntityKey(n.name, aliases));
      const em = typeof n.attributes?.email === 'string' ? n.attributes.email : '';
      if (em) knownPersonKeys.add(resolveEntityKey(em, aliases));
    }
  }

  for (const n of nodes) {
    const nodeDate = n.lastConfirmedAt || (typeof n.attributes?.date === 'string' ? n.attributes.date : null) || n.createdAt;
    const nodeIso = toIso(nodeDate);

    // email 节点:from = 对方。但邮件发件人大量是公司/机构 —— 只在「已是通讯录里的人」或
    // 「来自个人邮箱服务商」时才当联系人;公司域(fidelity.com/amazon.com…)的陌生发件人不新建。
    if (n.source === 'email' && typeof n.attributes?.from === 'string') {
      const c = parseContactFrom(n.attributes.from);
      if (c && !isLikelyNonHuman(c.name, c.key)) {
        const known = knownPersonKeys.has(resolveEntityKey(c.key, aliases)) || knownPersonKeys.has(resolveEntityKey(c.name, aliases));
        const personal = PERSONAL_EMAIL_DOMAIN.has(emailDomain(c.key));
        if (known || personal) bump(c.name, c.key, toIso(n.attributes.date) || nodeIso, null);
      }
    }

    // person 节点本身
    if (n.type === 'person' && n.name) {
      bump(n.name, n.name, nodeIso, null);
      // 头像:通讯录同步存在 attributes.photo。名字与邮箱两个 key 都记,联系人由哪条线索
      // 汇聚出来都能取到头像。
      const ph = typeof n.attributes?.photo === 'string' ? n.attributes.photo.trim() : '';
      if (ph) {
        photoByKey.set(resolveEntityKey(n.name, aliases), ph);
        const pe = typeof n.attributes?.email === 'string' ? n.attributes.email : '';
        if (pe) photoByKey.set(resolveEntityKey(pe, aliases), ph);
      }
      // 分组标签(排除内部「联系人」标记)→ 供关系 tab 按组筛选;名字与邮箱两个 key 都记
      const gs = (n.tags || []).filter((t) => t && t !== '联系人');
      if (gs.length) {
        const addGroups = (k: string) => { const s = groupsByKey.get(k) || new Set<string>(); gs.forEach((g) => s.add(g)); groupsByKey.set(k, s); };
        addGroups(resolveEntityKey(n.name, aliases));
        const em = typeof n.attributes?.email === 'string' ? n.attributes.email : '';
        if (em) addGroups(resolveEntityKey(em, aliases));
      }
    }

    // relations:targetId 可能是人名,也可能是节点 id(linkNodes 后)。
    // 结构性关系 / involves_person → 跳过;有节点则只认 type===person。
    for (const r of n.relations || []) {
      if (!r.targetId) continue;
      const rel = r.relation || '';
      if (NON_PERSON_REL.test(rel)) continue;
      if (NODE_ID_RE.test(r.targetId)) {
        const target = nodes.find((x) => x.id === r.targetId);
        if (!target || target.type !== 'person' || !target.name) continue;
        bump(target.name, target.name, nodeIso, rel ? rel : null);
        continue;
      }
      bump(r.targetId, r.targetId, nodeIso, rel ? rel : null);
    }
  }

  const overrides = loadRelationshipOverrides(); // 图4:用户手动改过的亲疏/关系词覆盖推断
  const out: Contact[] = [];
  for (const a of acc.values()) {
    // 用户手动移除过的人:推导层跳过。名字/邮箱任一 key 被 hidden 都算(防同步后换 key 复活)。
    if (overrides[a.key]?.hidden) continue;
    if (Object.entries(overrides).some(([k, ov]) => {
      if (!ov?.hidden) return false;
      if (k === a.key) return true;
      try { return resolveEntityKey(k, aliases) === a.key; } catch { return false; }
    })) continue;
    const logged = contactLog[a.key] || null;
    const groups = Array.from(groupsByKey.get(a.key) || []);
    // 一次性会议与会人降噪:只当过一次 participant、无分组、无联系记录 → 不列入(路人不是关系)。
    if (a.mentions <= 1 && a.relation && PARTICIPANT_REL.test(a.relation) && groups.length === 0 && !logged) continue;
    const last = newer(a.last, logged);
    const ov = overrides[a.key];
    const closeness = ov?.closeness ?? closenessOf(a);
    const relation = ov?.relation ?? a.relation;
    // 学到的真实节奏优先;学不出(联系次数<3)才用按亲疏的固定桶。
    const cadenceDays = learnedCadence(a.times, CADENCE[closeness]);
    const daysSince = last ? Math.floor((now - Date.parse(last)) / 86400000) : null;
    const overdueRatio = daysSince == null ? 1.5 : daysSince / cadenceDays; // 无记录 → 略微提示
    const reachOut = daysSince == null ? false : daysSince > cadenceDays;
    out.push({
      key: a.key, name: a.name, relation, closeness,
      mentions: a.mentions, lastContactAt: last, daysSince, cadenceDays, reachOut, overdueRatio,
      groups, photo: photoByKey.get(a.key) || null,
    });
  }

  // 排序:常联系(提及多)在最上;同频再比最近联系
  out.sort((x, y) => {
    if (y.mentions !== x.mentions) return y.mentions - x.mentions;
    const xt = x.lastContactAt ? Date.parse(x.lastContactAt) : 0;
    const yt = y.lastContactAt ? Date.parse(y.lastContactAt) : 0;
    return yt - xt;
  });
  return out;
}

export const CLOSENESS_META: Record<Closeness, { zh: string; en: string }> = {
  core: { zh: '核心', en: 'Core' },
  close: { zh: '亲近', en: 'Close' },
  acquaintance: { zh: '一般', en: 'Acquaintance' },
};

/** 一句「多久没联系」文案。 */
export function lastContactLabel(c: Contact, dict: string): string {
  if (c.daysSince == null) return dict === 'en' ? 'no contact logged' : '还没有联系记录';
  if (c.daysSince <= 0) return dict === 'en' ? 'today' : '今天';
  if (c.daysSince === 1) return dict === 'en' ? '1 day ago' : '1 天前';
  if (c.daysSince < 30) return dict === 'en' ? `${c.daysSince} days ago` : `${c.daysSince} 天前`;
  const months = Math.round(c.daysSince / 30);
  return dict === 'en' ? `~${months} mo ago` : `约 ${months} 个月前`;
}
