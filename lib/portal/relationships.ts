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
}

const CADENCE: Record<Closeness, number> = { core: 14, close: 30, acquaintance: 90 };

// 关系词 → 亲疏。中英混合匹配。
const CORE_RE = /家人|亲人|配偶|伴侣|老婆|老公|妻|夫|父|母|爸|妈|儿|女|兄|弟|姐|妹|family|spouse|partner|wife|husband|mother|father|mom|dad|son|daughter|brother|sister|parent/i;
const CLOSE_RE = /朋友|挚友|好友|闺蜜|哥们|死党|friend|bestie|buddy/i;

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
export function buildRelationships(nodes: LifeNode[], now = Date.now(), contactLog = loadContactLog()): Contact[] {
  const acc = new Map<string, Acc>();
  const bump = (rawName: string, rawKey: string, date: string | null, relation: string | null) => {
    const name = rawName.trim();
    const key = rawKey.trim().toLowerCase();
    if (!key || key.length < 2) return;
    // 过滤明显不是人的 key(纯数字/系统标记)
    if (/^\d+$/.test(key)) return;
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

  for (const n of nodes) {
    const nodeDate = n.lastConfirmedAt || (typeof n.attributes?.date === 'string' ? n.attributes.date : null) || n.createdAt;
    const nodeIso = toIso(nodeDate);

    // email 节点:from = 对方
    if (n.source === 'email' && typeof n.attributes?.from === 'string') {
      const c = parseContactFrom(n.attributes.from);
      if (c) bump(c.name, c.key, toIso(n.attributes.date) || nodeIso, null);
    }

    // person 节点本身
    if (n.type === 'person' && n.name) {
      bump(n.name, n.name, nodeIso, null);
    }

    // relations:targetId 常是人名,relation 是关系词
    for (const r of n.relations || []) {
      if (!r.targetId) continue;
      // 只收指向人的关系(排除 owned_by 之类物品关系时,仍把人名收进来但不加亲疏)
      const rel = r.relation || '';
      bump(r.targetId, r.targetId, nodeIso, rel && rel !== 'owned_by' ? rel : null);
    }
  }

  const out: Contact[] = [];
  for (const a of acc.values()) {
    const logged = contactLog[a.key] || null;
    const last = newer(a.last, logged);
    const closeness = closenessOf(a);
    // 学到的真实节奏优先;学不出(联系次数<3)才用按亲疏的固定桶。
    const cadenceDays = learnedCadence(a.times, CADENCE[closeness]);
    const daysSince = last ? Math.floor((now - Date.parse(last)) / 86400000) : null;
    const overdueRatio = daysSince == null ? 1.5 : daysSince / cadenceDays; // 无记录 → 略微提示
    const reachOut = daysSince == null ? false : daysSince > cadenceDays;
    out.push({
      key: a.key, name: a.name, relation: a.relation, closeness,
      mentions: a.mentions, lastContactAt: last, daysSince, cadenceDays, reachOut, overdueRatio,
    });
  }

  // 排序:该联系的排前(超期越多越前),其余按提及频率
  out.sort((x, y) => {
    if (x.reachOut !== y.reachOut) return x.reachOut ? -1 : 1;
    if (x.reachOut && y.reachOut) return y.overdueRatio - x.overdueRatio;
    return y.mentions - x.mentions;
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
