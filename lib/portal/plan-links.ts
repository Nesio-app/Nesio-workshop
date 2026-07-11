/**
 * plan-links — 行程/计划节点 ↔ 确认邮件的**确定性**自动挂钩(批次 70)。
 *
 * DEC 精神:不用 AI 猜,只认可辩护的证据锚点,三条规则命中其一才连线:
 *   1. 航班号交集(DL1234 / AA 89 —— 两位航司码+2-4位数字);
 *   2. 机场对相同(RDU→KEF)且日期吻合(邮件正文里的日期,±1 天);
 *   3. 确认码/PNR(带「确认号/confirmation/booking/PNR」上下文的 5-8 位大写码)双方一致。
 * 匹配到就写双向 relations(confirmed_by_email / confirms_plan),幂等可重跑;
 * 弱模型/无 key 时照样工作 —— 这层永远是端上纯规则。
 */

import { getLifeGraph, updateLifeNode, type LifeNode } from './life-graph';
import { nearestNodeDate } from '@/lib/platform/node-dates';

export interface TravelAnchors {
  flightNos: Set<string>;
  airportPairs: Set<string>;   // 'RDU>KEF'
  pnrs: Set<string>;
  dateKeys: Set<string>;       // 文本里解析出的 YYYY-MM-DD(年份缺省取"即将到来")
}

const FLIGHT_RE = /\b([A-Z]{2})\s?(\d{2,4})\b/g;
const PAIR_RE = /\b([A-Z]{3})\s*(?:→|->|—|–|-|至|到|✈)\s*([A-Z]{3})\b/g;
const PNR_RE = /(?:确认号|订单号|预订号|confirmation(?:\s+(?:no|number|code))?|booking\s+(?:ref|reference|code)|PNR)[^A-Z0-9]{0,8}([A-Z0-9]{5,8})/gi;
// 常见非航司双字母(误报源):介词/单位/州缩写等
const NOT_AIRLINE = new Set(['NO', 'ID', 'PM', 'AM', 'TO', 'OF', 'ON', 'AT', 'IN', 'US', 'UK', 'PO', 'RE', 'CC', 'TV', 'PC', 'IP', 'OK']);

function pushDates(text: string, out: Set<string>, now: Date): void {
  // YYYY-MM-DD / YYYY/M/D
  for (const m of text.matchAll(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g)) {
    out.add(`${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`);
  }
  // M月D日 / M/D(无年份 → 即将到来的那个)
  const bare: Array<[number, number]> = [];
  for (const m of text.matchAll(/(\d{1,2})月(\d{1,2})日/g)) bare.push([Number(m[1]), Number(m[2])]);
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
    const a = Number(m[1]); const b = Number(m[2]);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) bare.push([a, b]);
  }
  for (const [mo, d] of bare) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    let y = now.getFullYear();
    const cand = new Date(y, mo - 1, d);
    if (cand.getTime() < now.getTime() - 45 * 86_400_000) y += 1; // 过去 45 天以上 → 明年
    out.add(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
}

export function extractTravelAnchors(text: string, now: Date = new Date()): TravelAnchors {
  const flightNos = new Set<string>();
  const airportPairs = new Set<string>();
  const pnrs = new Set<string>();
  const dateKeys = new Set<string>();
  for (const m of text.matchAll(FLIGHT_RE)) {
    if (!NOT_AIRLINE.has(m[1])) flightNos.add(`${m[1]}${m[2]}`);
  }
  for (const m of text.matchAll(PAIR_RE)) airportPairs.add(`${m[1]}>${m[2]}`);
  for (const m of text.matchAll(PNR_RE)) pnrs.add(m[1].toUpperCase());
  pushDates(text, dateKeys, now);
  return { flightNos, airportPairs, pnrs, dateKeys };
}

function nodeText(n: LifeNode): string {
  return [
    n.name, n.rawInput || '',
    ...Object.values(n.attributes || {}).filter((v): v is string => typeof v === 'string'),
  ].join(' ');
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayOffset(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return localDayKey(new Date(y, m - 1, d + days));
}

function intersects<T>(a: Set<T>, b: Set<T>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function alreadyLinked(n: LifeNode, targetId: string): boolean {
  return (n.relations || []).some((r) => r.targetId === targetId);
}

/** 一次调和:给未连线的行程节点找证据吻合的邮件。返回新建连线数。幂等。 */
export function reconcilePlanEmailLinks(): number {
  if (typeof window === 'undefined') return 0;
  const graph = getLifeGraph();
  const now = new Date();
  const plans = graph.filter((n) =>
    (n.tags || []).includes('行程') || n.attributes?.planImported === true,
  );
  if (!plans.length) return 0;
  const emails = graph.filter((n) => n.source === 'email');
  if (!emails.length) return 0;

  const emailAnchors = emails.map((e) => ({ node: e, a: extractTravelAnchors(nodeText(e), now) }));
  let linked = 0;

  for (const plan of plans) {
    if ((plan.relations || []).some((r) => r.relation === 'confirmed_by_email')) continue;
    const pa = extractTravelAnchors(nodeText(plan), now);
    const d = nearestNodeDate(plan.attributes || {});
    const planDay = d ? localDayKey(d) : null;
    const planDays = planDay ? new Set([planDay, dayOffset(planDay, -1), dayOffset(planDay, 1)]) : null;

    for (const { node: email, a: ea } of emailAnchors) {
      const byFlight = intersects(pa.flightNos, ea.flightNos);
      const byPnr = intersects(pa.pnrs, ea.pnrs);
      const byRoute = intersects(pa.airportPairs, ea.airportPairs)
        && planDays !== null && [...ea.dateKeys].some((k) => planDays.has(k));
      if (!byFlight && !byPnr && !byRoute) continue;

      updateLifeNode(plan.id, {
        relations: [...(plan.relations || []), { targetId: email.id, relation: 'confirmed_by_email' }],
      });
      if (!alreadyLinked(email, plan.id)) {
        updateLifeNode(email.id, {
          relations: [...(email.relations || []), { targetId: plan.id, relation: 'confirms_plan' }],
        });
      }
      linked += 1;
      break; // 一个行程认一封主确认邮件,避免噪声连线
    }
  }
  if (linked > 0) window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  return linked;
}

// ── 批次 76:存量计划日期愈合 —— 年份自愈(批次 73)只管新数据,
// 已存的 2025 错年条目还在「已过期」。规则同一把尺:计划天然朝前,
// planImported 节点的 start 早于它自己的创建日 24h 以上 = 不可能的计划,
// 年份滚到创建日之后。开机一次,幂等。 ──
const PLAN_DATE_HEAL_FLAG = 'nesio-plan-date-heal-v1';
export function healPlanDatesOnce(): number {
  if (typeof window === 'undefined') return 0;
  try { if (localStorage.getItem(PLAN_DATE_HEAL_FLAG)) return 0; localStorage.setItem(PLAN_DATE_HEAL_FLAG, '1'); } catch { return 0; }
  let healed = 0;
  for (const n of getLifeGraph()) {
    if (n.attributes?.planImported !== true) continue;
    const start = n.attributes?.start;
    if (typeof start !== 'string') continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
    if (!m) continue;
    const createdMs = new Date(n.createdAt).getTime();
    let y = Number(m[1]);
    const mo = Number(m[2]); const d = Number(m[3]);
    if (new Date(y, mo - 1, d).getTime() >= createdMs - 24 * 3_600_000) continue;
    for (let guard = 0; guard < 3 && new Date(y, mo - 1, d).getTime() < createdMs - 24 * 3_600_000; guard++) y += 1;
    const rest = start.slice(10); // 保留可能的时间部分
    updateLifeNode(n.id, { attributes: { ...n.attributes, start: `${y}-${m[2]}-${m[3]}${rest}` } });
    healed += 1;
  }
  if (healed > 0) window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  return healed;
}

// ── 去抖调和器:图谱一有变化(新邮件同步/新行程入库)静默补连线 ──
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

export function initPlanLinks(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;
  const kick = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; try { reconcilePlanEmailLinks(); } catch { /* 连线失败不打扰 */ } }, 4000);
  };
  window.addEventListener('nesio-life-graph-updated', kick);
  try { healPlanDatesOnce(); } catch { /* 愈合失败不拦启动 */ }
  kick(); // 开机跑一轮,把历史数据也接上
}
