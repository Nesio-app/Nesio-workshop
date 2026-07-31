/**
 * trip-suggest —— 从机票/酒店确认邮件里认出「这像一次还没记下来的行程」,
 * **建议你建**,不替你建。
 *
 * ## 为什么是建议,不是自动
 *
 * `plan-links.ts` 一直能把机票邮件连到**已存在**的行程上(航班号/PNR/航线+日期交集),
 * 但它不会凭空建一个新行程。这不是欠账,是一条该守的线:
 *
 * 自动建行程等于系统替你下了一个判断 ——「你要去这趟」。而这个判断错起来是不可见的:
 * 你不会知道它错了,只会发现行程列表里多了个不认识的东西。这个仓库在「猜用户的意思」
 * 上翻过车(邮件标题里的「健身」被认成健康打卡、一张毯子的照片长出假「明天」)。
 *
 * 弹一次确认的代价是一次点击;自动建错的代价是你从此不信任这个列表。
 * 这跟 `email-schedule-suggest` 走的是同一条理由,也跟差额诊断的两颗按钮同一套。
 *
 * ## 判据是苛刻的
 *
 * 必须同时有:
 *   ① **航班号或 PNR** —— 光有 "SFO" 三个字母不算(邮件签名档里的地址也能凑出机场码);
 *   ② **一个明确日期**;
 *   ③ **图里还没有能接住它的行程** —— 已经有了就该走 plan-links 去连,不是再建一个。
 *
 * 缺一条就不提。宁可漏掉一封真的机票邮件(你还能自己加),
 * 也不要弹一个莫名其妙的确认框 —— 那种东西弹三次,你就再也不看了。
 *
 * ## 每条建议都有「不再提醒」
 *
 * 否决记忆存本机。没有出口的提示就是骚扰。
 */

import { getLifeGraph, linkNodes, type LifeNode } from './life-graph';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { extractTravelAnchors } from './plan-links';
import { reportStorageDropped } from './storage-health';

const DISMISS_KEY = 'nesio-trip-suggest-dismissed-v1';

export interface TripSuggestion {
  /** 提出这条建议的那封邮件。建了行程之后要连回它。 */
  emailNodeId: string;
  /** 「7/12 SFO→NRT」这种。给卡片当标题。 */
  title: string;
  /** 'SFO>NRT',可空(只有航班号没有航线时)。 */
  route: string | null;
  /** YYYY-MM-DD。 */
  dateKey: string;
  flightNos: string[];
  pnrs: string[];
}

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string') : []);
  } catch { return new Set(); }
}

/** 这条建议的身份 —— 同一封邮件重复出现时认得出来。 */
export function suggestionKey(s: Pick<TripSuggestion, 'emailNodeId'>): string {
  return s.emailNodeId;
}

/** 「不再提醒」。写失败要报出来 —— 悄悄没存下的话下次它又冒出来,用户会以为按钮坏了。 */
export function dismissTripSuggestion(emailNodeId: string): boolean {
  if (typeof window === 'undefined') return false;
  const cur = loadDismissed();
  cur.add(emailNodeId);
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...cur])); return true; }
  catch { reportStorageDropped(); return false; }
}

function nodeText(n: LifeNode): string {
  const a = n.attributes || {};
  return [n.name, n.rawInput, a.subject, a.summary, a.snippet].filter((v) => typeof v === 'string').join('\n');
}

/**
 * 扫一遍邮件,给出「像行程但图里还没有」的那几封。
 *
 * `now` 可注入 —— 纯逻辑要能单测,而且 `extractTravelAnchors` 的无年份日期
 * 是按「即将到来的那个」算的,固定不了 now 就测不了。
 */
export function suggestTripsFromEmails(
  graph?: readonly LifeNode[],
  now: Date = new Date(),
  opts: { max?: number } = {},
): TripSuggestion[] {
  const g = graph ?? (() => { try { return getLifeGraph(); } catch { return []; } })();
  const dismissed = loadDismissed();

  // 已有的行程锚点:航班号 / PNR 全都收进来。命中就说明「图里已经有能接住它的行程」——
  // 那是 plan-links 的活(去连),不是这里的活(再建一个)。
  const planned = { flights: new Set<string>(), pnrs: new Set<string>() };
  for (const n of g) {
    const isPlan = (n.tags || []).includes('行程') || n.attributes?.planImported === true || n.attributes?.planContainer === true;
    if (!isPlan) continue;
    const a = extractTravelAnchors(nodeText(n), now);
    a.flightNos.forEach((v) => planned.flights.add(v));
    a.pnrs.forEach((v) => planned.pnrs.add(v));
  }

  const out: TripSuggestion[] = [];
  for (const n of g) {
    if (n.source !== 'email') continue;
    if (dismissed.has(n.id)) continue;
    // 已经连上某个行程的邮件不用再提 —— 它的活干完了
    if ((n.relations || []).some((r) => r.relation === 'confirms_plan')) continue;

    const a = extractTravelAnchors(nodeText(n), now);
    const flights = [...a.flightNos];
    const pnrs = [...a.pnrs];
    // ① 航班号或 PNR 必须有一个。光有机场码不算 —— 签名档里的地址也能凑出三字母。
    if (!flights.length && !pnrs.length) continue;
    // ③ 图里已经有行程带着同一个航班号/PNR → 交给 plan-links 去连
    if (flights.some((f) => planned.flights.has(f)) || pnrs.some((p) => planned.pnrs.has(p))) continue;
    // ② 明确日期
    const dates = [...a.dateKeys].sort();
    if (!dates.length) continue;
    const dateKey = dates[0];

    const route = [...a.airportPairs][0] ?? null;
    const md = `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;
    const title = route
      ? `${md} ${route.replace('>', '→')}`
      : `${md} ${flights[0] || pnrs[0]}`;

    out.push({ emailNodeId: n.id, title, route, dateKey, flightNos: flights, pnrs });
    if (out.length >= (opts.max ?? 3)) break;   // 一次最多提三条,别刷屏
  }
  return out;
}

export type AcceptResult =
  | { ok: true; nodeId: string }
  | { ok: false; reason: 'create_failed' | 'link_failed' };

/**
 * 你点了「建」。建一个行程容器节点,并连回那封邮件。
 *
 * 连回去这一步很重要:不连的话下次扫描又会把同一封邮件当成「还没记下来的行程」
 * 再提一遍 —— 那就成了每次进来都推同一条的骚扰。
 *
 * 连失败**不回滚**行程:行程本身是你要的东西,为了一条关联把它删掉更糟。
 * 但也不谎报成功 —— 返回 link_failed,让 UI 说清楚「行程建好了,但没连上那封邮件」。
 */
export function acceptTripSuggestion(s: TripSuggestion): AcceptResult {
  let node: LifeNode;
  try {
    node = ingestLifeNode({
      name: s.title,
      type: 'event',
      source: 'manual',        // 是**你**点头建的,不是系统抓来的 —— 来源要如实
      confidence: 0.9,
      tags: ['行程', '计划'],
      relations: [],
      rawInput: [s.title, ...s.flightNos, ...s.pnrs].join(' · '),
      attributes: {
        planContainer: true,
        date: s.dateKey,
        ...(s.route ? { route: s.route } : {}),
        ...(s.flightNos.length ? { flightNos: s.flightNos.join(',') } : {}),
        ...(s.pnrs.length ? { pnr: s.pnrs[0] } : {}),
        suggestedFromEmail: s.emailNodeId,
      },
    });
  } catch { return { ok: false, reason: 'create_failed' }; }

  const r = linkNodes(node.id, s.emailNodeId, 'confirmed_by_email');
  if (!r.ok) return { ok: false, reason: 'link_failed' };
  return { ok: true, nodeId: node.id };
}
