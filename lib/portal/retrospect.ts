/**
 * retrospect — 今天页「回顾卡(去年今日)」的选片逻辑(批次 105)。
 *
 * 设计规范今天页:问候 → **回顾卡** → 接下来。念念主动翻出一条旧记忆放问候下面。
 * 用户定案「整年整月纪念日优先」:
 *   1. 周年:同月同日 ±3 天、≥1 年前 → 「去年今天 / N 年前的今天」(最优先)
 *   2. 月纪念:同「日」(day-of-month) ±3 天、≥3 个月前 → 「N 个月前的今天」
 *   3. 兜底:一年前这一周(±7 天)→ 「一年前的这几天」
 * 命中带心情/照片/地点/旅行的更优先(有画面感)。没有符合的返回 null —— 不硬凑。
 * 打分确定性(不含随机),同一天内稳定不闪。纯函数,可单测。
 */

import { firstNodeDate } from '@/lib/platform/node-dates';

export interface RetroNode {
  id: string;
  name: string;
  type?: string;
  source?: string;
  createdAt?: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
  assets?: unknown[];
}

export interface Retrospect {
  nodeId: string;
  name: string;
  labelZh: string;
  labelEn: string;
}

const DAY = 86_400_000;

/** 事件锚点:优先节点自带的事件日期,否则记录日期(createdAt)。 */
function anchorDate(n: RetroNode): Date | null {
  const d = firstNodeDate(n.attributes || {});
  if (d) return d;
  if (n.createdAt) {
    const c = new Date(n.createdAt);
    if (!Number.isNaN(c.getTime()) && c.getFullYear() > 2020) return c;
  }
  return null;
}

/** 情感/画面重量:有心情/照片/地点/旅行标记 → 更值得翻出来。 */
function weight(n: RetroNode): number {
  let w = 0;
  const tags = n.tags || [];
  if (n.type === 'mood' || tags.some((t) => /心情|mood|情绪/i.test(t)) || n.attributes?.mood != null) w += 3;
  if (Array.isArray(n.assets) && n.assets.length > 0) w += 2;
  if (n.type === 'place' || n.attributes?.lat != null || n.attributes?.place != null || n.attributes?.location != null) w += 1;
  if (tags.some((t) => /旅行|旅程|生日|纪念|里程碑|travel|birthday|milestone/i.test(t))) w += 2;
  return w;
}

/** 系统/天气/空名节点不进回顾。 */
function excluded(n: RetroNode): boolean {
  const s = n.source || '';
  if (s === 'system' || s === 'weather') return true;
  const tags = n.tags || [];
  if (tags.some((t) => /天气|weather|系统|system/i.test(t))) return true;
  if (!n.name || n.name.trim().length < 2) return true;
  return false;
}

export function pickRetrospect(nodes: RetroNode[], now: Date = new Date()): Retrospect | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  interface Cand { n: RetroNode; score: number; labelZh: string; labelEn: string }
  const cands: Cand[] = [];

  for (const n of nodes) {
    if (excluded(n)) continue;
    const d = anchorDate(n);
    if (!d) continue;
    const dOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const daysAgo = Math.round((today.getTime() - dOnly.getTime()) / DAY);
    if (daysAgo < 60) continue; // 太近不算回顾
    const w = weight(n);
    const yearsAgo = today.getFullYear() - dOnly.getFullYear();
    const sameMonthDay = dOnly.getMonth() === today.getMonth() && Math.abs(dOnly.getDate() - today.getDate()) <= 3;

    // ① 周年(同月同日 ±3,≥1 年)
    if (sameMonthDay && yearsAgo >= 1) {
      cands.push({
        n, score: 1000 - yearsAgo + w * 5,
        labelZh: yearsAgo === 1 ? '去年今天' : `${yearsAgo} 年前的今天`,
        labelEn: yearsAgo === 1 ? 'A year ago today' : `${yearsAgo} years ago today`,
      });
      continue;
    }
    // ② 月纪念(同 day-of-month ±3,≥3 个月)
    const monthsAgo = (today.getFullYear() - dOnly.getFullYear()) * 12 + (today.getMonth() - dOnly.getMonth());
    if (Math.abs(dOnly.getDate() - today.getDate()) <= 3 && monthsAgo >= 3) {
      cands.push({
        n, score: 500 - monthsAgo + w * 5,
        labelZh: `${monthsAgo} 个月前的今天`,
        labelEn: `${monthsAgo} months ago today`,
      });
      continue;
    }
    // ③ 兜底:一年前这一周(±7 天)
    const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    const dist = Math.abs((dOnly.getTime() - oneYearAgo.getTime()) / DAY);
    if (dist <= 7) {
      cands.push({
        n, score: 100 - dist + w * 5,
        labelZh: '一年前的这几天', labelEn: 'Around a year ago',
      });
    }
  }

  if (cands.length === 0) return null;
  // 确定性排序:分数高优先,平手按 id 稳定(同一天内不闪)
  cands.sort((a, b) => (b.score - a.score) || (a.n.id < b.n.id ? -1 : 1));
  const top = cands[0];
  return { nodeId: top.n.id, name: top.n.name, labelZh: top.labelZh, labelEn: top.labelEn };
}
