/**
 * Signal Read Cache — Signal 主事实表(source_of_truth 相位)。
 * (服务端引用链安全:所有入口都有 typeof window 守卫,无 'use client'。)
 *
 * CEO Gate 已批准 cutover(2026-07-04):IDB 事实库是权威源,LifeGraph
 * localStorage 是可重建的派生投影(重建入口 rebuildLifeGraphFromSignals)。
 *
 * 事实库独立的含义:
 *   - 不再用「不在投影 = 删」推断——事实库可以保留投影之外的信号
 *     (未来:云端拉取、跨设备事实)。
 *   - 删除是显式意图:life-graph 的 deleteLifeNode / prunePrivateExternalNodes
 *     广播 'nesio-life-node-deleted'(携带被删节点),这里删对应 Signal。
 *     用户删除权(隐私红线)因此仍然贯通;剪枝引擎删 Disposable 同理
 *     (Disposable 本就该 24h 内消费完,物理删除是保留策略在执行)。
 *
 * 同步读桥接:getSignals() 的消费者全部同步,IDB 异步——启动时水合
 * 内存 Map,LifeGraph 变更事件**同步**叠加投影(读新鲜度不降),
 * IDB 落盘去抖。未水合时 getCachedSignals() 返回 null,调用方回退投影。
 *
 * 冲突规则:同 id 时投影版本覆盖 IDB 版本(投影可被 updateLifeNode
 * 编辑,是更新鲜的内容);投影没有的 id 保留(事实库独立)。
 */

import { getLifeGraph, replaceLifeGraphProjection, type LifeNode } from '@/lib/portal/life-graph';
import { lifeNodeToSignal, signalToLifeNode, type Signal } from './signal';
import { bulkPutSignalsIdb, deleteSignalIdb, getAllSignalsIdb } from './signal-store-idb';

let byId: Map<string, Signal> | null = null;
let listening = false;
let idbTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

/**
 * 水合完成事件。**这是「开机头十秒数字跳来跳回」的修法。**
 *
 * ## 之前发生了什么
 *
 * `getSignals()` 的第一行是:
 *
 * ```ts
 * const cached = getCachedSignals();
 * let signals = cached ?? getLifeGraph().map(lifeNodeToSignal);
 * ```
 *
 * 水合**之前** cached 是 null → 读到的是投影(N 条)。
 * 水合**之后** cached 是「IDB 事实 ∪ 投影」→ 可能是 N+k 条
 * (事实库是独立的,可以保留投影之外的信号 —— 见文件头)。
 *
 * 也就是说同一个函数在两个时刻返回**两个不同的集合**,这本身是设计使然、没问题。
 * 出问题的是:**水合完成时什么都不广播**。
 *
 * 于是没有任何组件在那一刻重算 —— 它们各自保持着水合前算出的旧数字,
 * 直到被某个**不相干的**重渲染碰到,才悄悄换成新数字。
 * 一个卡片因为你滑了一下重渲染了,数字变了;另一个没被碰到,还是旧的。
 * 用户看到的就是「数字跳来跳回」和「不同地方数不一样」。
 *
 * 修法两条,缺一不可:
 *
 *   ① 水合完成**广播一次** —— 所有读点在**同一时刻**一起收敛到新数字,
 *      而不是各自在随机时刻漂移过去。
 *   ② 暴露 `isFactStoreHydrated()` —— 显示条数的地方在水合前显示骨架,
 *      而不是先给一个待会儿会变的数。
 *
 * 只做①的话数字仍然会当着用户的面跳一次(只是整齐地跳);
 * 只做②的话各处仍然会在不同时刻醒来。
 */
export const SIGNAL_FACT_STORE_HYDRATED_EVENT = 'nesio-signal-fact-store-hydrated';

/**
 * 事实库水合完了没有。
 *
 * **注意语义**:`false` 不代表「没数据」,代表「现在读到的是投影,
 * 待会儿可能变多」。显示条数的地方应该据此显示骨架,
 * 而不是先摆一个会变的数字出来 —— 那比转圈更伤信任:
 * 用户会以为自己刚才看错了,或者以为 App 弄丢了东西。
 */
export function isFactStoreHydrated(): boolean {
  return hydrated;
}

/** 同步读取水合后的事实缓存;未水合返回 null(调用方回退投影)。 */
export function getCachedSignals(): Signal[] | null {
  return byId ? Array.from(byId.values()) : null;
}

/** 投影同步叠加进缓存(同 id 投影胜出;缓存独有的 id 保留)。 */
function overlayProjection(): Signal[] {
  const graphSignals = getLifeGraph().map(lifeNodeToSignal);
  if (!byId) byId = new Map();
  for (const s of graphSignals) byId.set(s.id, s);
  return graphSignals;
}

function onGraphUpdated() {
  const graphSignals = overlayProjection(); // 同步:读路径立即看到新事实
  if (idbTimer) clearTimeout(idbTimer);
  idbTimer = setTimeout(() => { void bulkPutSignalsIdb(graphSignals).catch(() => {}); }, 800);
}

function onNodeDeleted(event: Event) {
  const nodes = (event as CustomEvent<{ nodes?: LifeNode[] }>).detail?.nodes;
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    const signalId = lifeNodeToSignal(node).id;
    byId?.delete(signalId);
    void deleteSignalIdb(signalId);
  }
}

/**
 * 启动水合:IDB 全量装载 + 投影叠加(回填/内容漂移修复)。
 * App mount 调一次(Portal),幂等。
 */
export async function hydrateSignalFactStore(): Promise<{ total: number } | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return null;
  if (!listening) {
    listening = true;
    window.addEventListener('nesio-life-graph-updated', onGraphUpdated);
    window.addEventListener('nesio-life-node-deleted', onNodeDeleted);
  }
  try {
    const idbAll = await getAllSignalsIdb();
    byId = new Map(idbAll.map((s) => [s.id, s]));
    const graphSignals = overlayProjection();
    await bulkPutSignalsIdb(graphSignals);
    markHydrated();
    return { total: byId.size };
  } catch {
    byId = null; // 事实缓存是增强不是依赖:失败读路径走投影
    // 失败也要标 —— 否则「还在读取」的骨架会一直转下去。
    // 读到的是投影(而不是投影 ∪ 事实),但它是**稳定**的:不会再变了。
    // 对用户来说「这就是最终答案」比「永远在加载」诚实得多。
    markHydrated();
    return null;
  }
}

/**
 * 标记水合完成并广播一次。
 *
 * 广播的是 `nesio-life-graph-updated` **加**一个专用事件,两个都要:
 *   · `nesio-life-graph-updated` —— 现存的 135 个读点已经在听它了,
 *     借它让所有人**在同一时刻**一起收敛(而不是各自随机醒来)。
 *   · 专用事件 —— 给「显示骨架直到落定」的那些地方用。
 *     它们不关心图变了,只关心「还会不会再变」。
 */
function markHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SIGNAL_FACT_STORE_HYDRATED_EVENT));
  window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
}

/**
 * 投影重建 — 从事实库整体重建 LifeGraph localStorage(恢复路径)。
 * 这是「Signal 是权威源」的可执行证明:投影可以随时丢弃再生。
 * 仅供数据主权面板/恢复流程手动触发,不自动运行。
 */
export async function rebuildLifeGraphFromSignals(): Promise<{ rebuilt: number } | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return null;
  const signals = byId ? Array.from(byId.values()) : await getAllSignalsIdb();
  if (!signals.length) return { rebuilt: 0 };
  const nodes = signals
    .map(signalToLifeNode)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  replaceLifeGraphProjection(nodes);
  return { rebuilt: nodes.length };
}
