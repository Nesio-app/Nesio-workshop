/**
 * Signal Read Cache — Signal 主事实表迁移里程碑 3(读切换)+ 4(投影降级)。
 *
 * IndexedDB 是异步的,而 getSignals() 的全部消费者(DEC/life-state/
 * platform-health/搜索)是同步调用。桥接方式:启动时水合内存缓存,
 * getSignals() 优先读缓存,未水合时回退 LifeGraph 投影(优雅降级,
 * 行为等价)。LifeGraph 变更事件到达时**同步**刷新内存缓存(成本等于
 * 原先一次 getSignals 投影),IDB 落盘则去抖——读新鲜度与投影一致。
 *
 * IDB 同步做两件事:
 *   1. 回填(backfill):LifeGraph 全量节点批量投影进 IDB(幂等覆盖,
 *      顺带修复内容漂移)——IDB 从此含完整历史。
 *   2. 删除传导(reconcile):IDB 中已不在 LifeGraph 的信号删除——
 *      用户删除/剪枝引擎的意图传导到本地事实缓存(云镜像不受影响)。
 *
 * 边界(signal-main-fact-contract):当前相位 signal_read_preferred,
 * 本地缓存与投影保持一致;「事实库独立于投影保留数据」属
 * source_of_truth cutover,需 CEO Gate,本模块不做。
 * localStorage LifeGraph 保留为兼容投影(noDestructiveProjectionCleanup)。
 */

import { getLifeGraph } from '@/lib/portal/life-graph';
import { lifeNodeToSignal, type Signal } from './signal';
import { bulkPutSignalsIdb, deleteSignalIdb, getAllSignalsIdb } from './signal-store-idb';

let cache: Signal[] | null = null;
let listening = false;
let idbTimer: ReturnType<typeof setTimeout> | null = null;

/** 同步读取水合后的事实缓存;未水合返回 null(调用方回退投影)。 */
export function getCachedSignals(): Signal[] | null {
  return cache;
}

function refreshCache(): Signal[] {
  const graphSignals = getLifeGraph().map(lifeNodeToSignal);
  cache = graphSignals;
  return graphSignals;
}

async function syncIdb(graphSignals: Signal[]): Promise<{ total: number; removed: number }> {
  const graphIds = new Set(graphSignals.map((s) => s.id));

  // 回填 + 内容漂移修复(幂等覆盖)
  await bulkPutSignalsIdb(graphSignals);

  // 删除传导:IDB 有而投影没有 → 用户已删/已剪枝
  const idbSignals = await getAllSignalsIdb();
  let removed = 0;
  for (const s of idbSignals) {
    if (!graphIds.has(s.id)) {
      await deleteSignalIdb(s.id);
      removed += 1;
    }
  }
  return { total: graphSignals.length, removed };
}

function onGraphUpdated() {
  const graphSignals = refreshCache(); // 同步:读路径立即看到新事实
  if (idbTimer) clearTimeout(idbTimer);
  idbTimer = setTimeout(() => { void syncIdb(graphSignals).catch(() => {}); }, 800);
}

/**
 * 启动水合:回填 + 删除传导 + 装载内存缓存,并订阅 LifeGraph 变更
 * 事件保持一致。App mount 调一次(Portal),幂等。
 */
export async function hydrateSignalFactStore(): Promise<{ total: number; removed: number } | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return null;
  if (!listening) {
    listening = true;
    window.addEventListener('nesio-life-graph-updated', onGraphUpdated);
  }
  try {
    return await syncIdb(refreshCache());
  } catch {
    return null; // 事实缓存是增强不是依赖:失败保持 null,读路径走投影
  }
}
