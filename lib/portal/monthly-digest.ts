/**
 * monthly-digest —— 成长 / 运动 / 家务的**月度小结节点**。
 *
 * ## 要解决的是什么
 *
 * 「我这个月练了什么」「我上周训练了什么」「这个月家务干了多少」——
 * 这三个问题现在答不上来。不是因为数据没有,而是因为**图里没有能被搜到的代表节点**。
 *
 * 底层数据都在(练习记录、训练记录、家务账本),但它们要么是散在别处的业务数据,
 * 要么是几十条零碎节点。搜索扫的是图,问一问的 RAG 也从图里取 —— 没有一个
 * 「2026 年 7 月 · 练了什么」这样的节点,这些问题就永远命中不到东西。
 *
 * 回看/年度回顾也一样:它们是图的消费者,补上这三类节点它们自动就能引用。
 *
 * ## 为什么是「月度小结」而不是把每条都塞进去
 *
 * 每一次练习/训练/家务都建节点的话,图里会多出几千条颗粒度极细的东西,
 * 而你问的问题是**月这个尺度**的。小结节点一条顶一个月,搜「这个月练了什么」
 * 直接命中,点进去能看到明细。
 *
 * ## 幂等
 *
 * 每个 (类型, 月份) 一个节点,`externalId = digest:<kind>:<YYYY-MM>`。
 * 重算就地更新,不会每次开机多一条。当月的那条会随着你继续记而不断更新 ——
 * 所以它的数字始终是「到目前为止」,这一点写在节点正文里,免得你月中看到
 * 一个偏小的数以为漏了。
 */

import { getLifeGraph, type LifeNode } from './life-graph';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';

export type DigestKind = 'growth' | 'workout' | 'chore';

const KIND_META: Record<DigestKind, { zh: string; en: string; tag: string }> = {
  growth: { zh: '练习', en: 'Practice', tag: '成长' },
  workout: { zh: '训练', en: 'Training', tag: '运动' },
  chore: { zh: '家务', en: 'Chores', tag: '家务' },
};

export function digestExternalId(kind: DigestKind, month: string): string {
  return `digest:${kind}:${month}`;
}

/** 'YYYY-MM' */
export function monthKeyOf(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export interface DigestInput {
  kind: DigestKind;
  month: string;              // YYYY-MM
  /** 这个月干了几次。 */
  count: number;
  /** 明细的短标签(菜名/动作/家务名),用来让搜索能命中具体内容。 */
  items: string[];
  /** 这个月还没过完 —— 数字是「到目前为止」。 */
  partial: boolean;
}

/** 节点正文。搜索是全文扫的,所以明细要**写进正文**,不能只放 attributes。 */
export function digestText(d: DigestInput, locale: 'zh' | 'en' = 'zh'): string {
  const meta = KIND_META[d.kind];
  const label = locale === 'en' ? meta.en : meta.zh;
  const head = locale === 'en'
    ? `${d.month} · ${label} — ${d.count} time${d.count === 1 ? '' : 's'}${d.partial ? ' (so far)' : ''}`
    : `${d.month} · ${label} ${d.count} 次${d.partial ? '(到目前为止)' : ''}`;
  const body = d.items.length
    ? (locale === 'en' ? `Included: ${d.items.join(', ')}` : `包括:${d.items.join('、')}`)
    : (locale === 'en' ? 'No details recorded.' : '没有记下明细。');
  return `${head}\n${body}`;
}

/**
 * 写一条月度小结。幂等 —— 同一个 (类型, 月份) 就地更新。
 *
 * 次数为 0 时**不建节点**:一条「这个月练了 0 次」的记忆没有任何用处,
 * 只会在记忆库里占一行、在搜索里抢命中。没干就是没干,不需要一条记录来说明。
 * (已经存在的那条也不删 —— 删了的话你月初看过的东西会凭空消失。)
 */
export function upsertMonthlyDigest(d: DigestInput): LifeNode | null {
  if (typeof window === 'undefined') return null;
  if (!d.month || !(d.count > 0)) return null;
  const meta = KIND_META[d.kind];
  const extId = digestExternalId(d.kind, d.month);
  const items = d.items.slice(0, 40).join(',');

  // ⚠️ 内容没变就**不写**。
  //
  // `ingestLifeNode` 命中已有节点时是无条件 `updateLifeNode`,而那一步会:
  // 盖 updatedAt → saveAll(整图重写)→ syncLifeGraphUpsertToCloud + syncLifeNodeSignalToCloud
  // (两条云推送)。这个函数被调的场合恰好都是**反复重算同一份内容**:
  // 开机折一次、每开一次家庭板又折一次 —— 写的都是同一个数。
  //
  // 代价不只是浪费。updatedAt 被顶到当下,意味着你每瞄一眼家庭板,
  // 三条月度小结就冒到「最近更新」的最前面,把真正新的记忆挤下去。
  const prev = (() => { try { return getLifeGraph(); } catch { return []; } })()
    .find((n) => n.attributes?.externalId === extId);
  if (prev
    && prev.attributes?.count === d.count
    && prev.attributes?.partial === d.partial
    && prev.attributes?.items === items) return prev;

  try {
    return ingestLifeNode({
      type: 'note',
      name: `${d.month} · ${meta.zh}`,
      source: 'system',
      confidence: 1,
      relations: [],
      tags: [meta.tag, '月度小结'],
      rawInput: digestText(d),
      attributes: {
        externalId: extId,
        digestKind: d.kind,
        month: d.month,
        count: d.count,
        partial: d.partial,
        items,
        date: `${d.month}-01`,
        epistemic: 'observation',
        generator: 'system:monthly-digest',
      },
    });
  } catch { return null; }
}

/** 已有的小结节点(给回看/年度回顾直接取)。 */
export function listMonthlyDigests(kind?: DigestKind, graph?: readonly LifeNode[]): LifeNode[] {
  const g = graph ?? (() => { try { return getLifeGraph(); } catch { return []; } })();
  return g
    .filter((n) => {
      const k = n.attributes?.digestKind;
      return typeof k === 'string' && (!kind || k === kind);
    })
    .sort((a, b) => String(b.attributes?.month ?? '').localeCompare(String(a.attributes?.month ?? '')));
}

/**
 * 把一串「发生过的事」聚成按月的小结输入。纯函数,可单测。
 *
 * @param events 每条带一个日期(YYYY-MM-DD 或 ISO)和一个短标签
 * @param now    判断「这个月还没过完」用
 */
export function foldEventsToDigests(
  kind: DigestKind,
  events: ReadonlyArray<{ date: string; label?: string }>,
  now: Date = new Date(),
): DigestInput[] {
  const byMonth = new Map<string, { count: number; items: string[] }>();
  for (const e of events) {
    const m = monthKeyOf(e.date);
    if (!m) continue;
    const cur = byMonth.get(m) ?? { count: 0, items: [] };
    cur.count += 1;
    const label = (e.label || '').trim();
    // 明细去重:一个月做了 12 次「深蹲」,写 12 遍没意义,写一遍就够被搜到
    if (label && !cur.items.includes(label)) cur.items.push(label);
    byMonth.set(m, cur);
  }
  const thisMonth = monthKeyOf(now);
  return [...byMonth.entries()]
    .map(([month, v]) => ({ kind, month, count: v.count, items: v.items, partial: month === thisMonth }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * 开机跑一次:把能拿到的历史折成月度小结。
 *
 * ## 诚实的边界
 *
 * 三个域里,只有**训练**在本机留了流水(2026-07-30 刚加的 `nesio-workout-history-v1` ——
 * 在那之前只存了「最后一次」,所以「我上周训练了什么」根本无从答起,矩阵里那一格
 * 是红的,根因就是没人留历史)。
 *
 * 所以:
 *   · **训练** —— 从今天起开始攒,下个月就有真数据。**以前的练不回来**,那些记录
 *     从来没被写下过,不是这里能补的。
 *   · **家务** —— 账本在服务端(family-server),要登录 + 网络。这里不去拉 ——
 *     开机时打一个网络请求去算一条小结,离线就静默失败,那种「有时有有时没有」的
 *     节点比没有更糟。**已由家庭板接上**(FamilySharingSheet 的 `load()`,
 *     2026-07-31):账本到手的那一刻就地折,不额外发请求。
 *     只折**我自己**的 —— 小结的幂等键是 (类型, 月份),没有人的维度,
 *     顺手把看到的每个人都折进去会让这个数字随手一点就变。
 *   · **练习** —— 目前没有任何持久化的答题历史可折。要先有记录才谈得上小结。
 *
 * 这三条写在这里而不是藏在 commit 里,是因为「为什么我这个月练了什么还是搜不到」
 * 会是下一个问题,答案就在上面。
 */
export function refreshMonthlyDigestsOnBoot(now: Date = new Date()): number {
  if (typeof window === 'undefined') return 0;
  let wrote = 0;
  try {
    // 训练:本机流水 → 按月折
    const raw = localStorage.getItem('nesio-workout-history-v1');
    const arr = raw ? JSON.parse(raw) : [];
    const events = (Array.isArray(arr) ? arr : [])
      .filter((r: unknown): r is { date: string; name?: string } =>
        Boolean(r) && typeof (r as { date?: unknown }).date === 'string')
      .map((r) => ({ date: r.date, label: r.name }));
    // 只重算最近 3 个月 —— 更早的月份不会再变,每次开机重写一遍纯属浪费写盘
    const recent = foldEventsToDigests('workout', events, now).slice(0, 3);
    for (const d of recent) { if (upsertMonthlyDigest(d)) wrote += 1; }
  } catch { /* 折不出来不影响开机 */ }
  return wrote;
}
