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
 * 冲突规则(与「IDB 是权威源」契约一致):
 *   - 启动水合:同 id 时 IDB 版本胜出;投影独有的 id 回填(并写入 IDB)。
 *     不再让陈旧投影覆盖并持久化 IDB —— 否则未来跨设备/云端拉取写进 IDB 的
 *     编辑,会被下次 hydrate 的旧 localStorage 冲掉(数据完整性隐患)。
 *   - 实时编辑(onGraphUpdated):本机刚经 updateLifeNode 改的投影就是最新,
 *     那里投影同步叠加并写 IDB —— 与启动合并规则不冲突。
 */

import { getLifeGraph, replaceLifeGraphProjection, type LifeNode } from '@/lib/portal/life-graph';
import { lifeNodeToSignal, signalToLifeNode, type Signal } from './signal';
import { bulkPutSignalsIdb, deleteSignalIdb, getAllSignalsIdb } from './signal-store-idb';
import { mergeFactStore } from './signal-fact-merge.mjs';

let byId: Map<string, Signal> | null = null;
let listening = false;
let idbTimer: ReturnType<typeof setTimeout> | null = null;

/** 同步读取水合后的事实缓存;未水合返回 null(调用方回退投影)。 */
export function getCachedSignals(): Signal[] | null {
  return byId ? Array.from(byId.values()) : null;
}

/**
 * 投影同步叠加进缓存 —— 仅供实时编辑路径(onGraphUpdated)用:本机刚改的投影
 * 是最新,同 id 投影胜出;缓存独有的 id 保留。启动水合走 hydrate 的 IDB-权威合并。
 */
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
    const projection = getLifeGraph().map(lifeNodeToSignal);
    // IDB 权威:同 id 保留 IDB 版本,只回填投影独有的 id(并只把这些写进 IDB)。
    const { merged, backfill } = mergeFactStore(idbAll, projection) as { merged: Signal[]; backfill: Signal[] };
    const next = new Map<string, Signal>(merged.map((s) => [s.id, s] as const));
    byId = next;
    if (backfill.length) await bulkPutSignalsIdb(backfill);
    return { total: next.size };
  } catch {
    byId = null; // 事实缓存是增强不是依赖:失败读路径走投影
    return null;
  }
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
