/**
 * loose-threads —— 「没接上的线头」的**唯一判据**(2026-07-30 抽出来)。
 *
 * 这段判据本来内联在 InsightsSheet 里。日报也要用它(用户问的「未来机会」——
 * 我的答复是:Nesio 唯一有依据说「机会」的,是**你自己说过想做、却一直没动的事**,
 * 不是我觉得你该干什么)。两处各写一份的话必然漂移:一边改了阈值、另一边没改,
 * 洞察页说有 3 条线头、日报说 5 条,而两边都言之凿凿。
 *
 * 判据(正向 + 排除,顺序有意):
 *   · person / place / health_state 是**实体**,不是待办 —— 一个人、一个地方
 *     不会「没接上」;
 *   · 标了 done 的不算;
 *   · **碰过就不算**:lastConfirmedAt 与 createdAt 不同 = 后来又回来看过/改过;
 *   · 剩下的里,创建至今超过 THREAD_STALE_DAYS 天的,才是线头。
 *
 * 纯函数,不碰存储。
 */

/** 多久没再碰算「线头」。 */
export const THREAD_STALE_DAYS = 30;

const DAY_MS = 86_400_000;

/** 线头判据只用得到节点的这几样。 */
export interface ThreadNode {
  type?: string;
  createdAt?: string;
  lastConfirmedAt?: string;
  attributes?: Record<string, unknown>;
}

/** 实体类型 —— 它们不是「要做的事」,不存在接不接得上。 */
const ENTITY_TYPES = new Set(['person', 'place', 'Mind']);

export function isLooseThread(n: ThreadNode, now: number = Date.now()): boolean {
  if (!n || !n.createdAt) return false;
  if (n.type && ENTITY_TYPES.has(n.type)) return false;
  if (n.attributes?.done === true) return false;
  // 后来又回来看过/改过 → 不算落下的
  if (n.lastConfirmedAt && n.lastConfirmedAt !== n.createdAt) return false;
  const born = new Date(n.createdAt).getTime();
  if (!Number.isFinite(born)) return false;
  return now - born > THREAD_STALE_DAYS * DAY_MS;
}

/** 全部线头,**最老的在前**(放得最久的那条最该先被看见)。 */
export function looseThreads<T extends ThreadNode>(nodes: readonly T[], now: number = Date.now()): T[] {
  return nodes
    .filter((n) => isLooseThread(n, now))
    .sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
}
