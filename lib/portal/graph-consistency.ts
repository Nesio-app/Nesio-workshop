/**
 * graph-consistency — 「我的记忆全在吗」的可回答化(地基 F2)。
 *
 * 病根:同步机制齐备(outbox / 退避 / LWW / 删除传导),但**没有任何一处能回答
 * 「本地 N 条、云端 M 条、差在哪」**。`getLifeGraphCloudSyncSummary` 只统计 outbox
 * 状态(有多少条挂着),它不知道那些从没进过 outbox 的节点 —— 比如登录前创建的、
 * 或者 outbox 记录被清理过的。
 *
 * 而补传路径也是残的:`backfillLocalLifeGraphToCloud` 默认 `nodes.slice(0, 200)`,
 * 图是新→旧排序,所以**只补最新 200 条**。2500 条里的老节点若当初没成功 upsert,
 * 永远轮不到 —— 而且没人会发现。
 *
 * 这个模块做两件事:
 *   ① 体检:拉云端快照,与本地做 id 集合差集,分类解释每一类差异;
 *   ② 定点补传:把「本地有、云端没有」的那批按 id 传上去(不受 200 条限制)。
 *
 * 它也是 F3(按年分片存储)的**验收工具**:迁移前后各跑一次,条数与 id 集合必须一致。
 *
 * 只读 + 显式触发,不自动跑 —— 体检要拉全量云快照,不该在启动路径上做。
 */

import { getLifeGraph, getLifeGraphCloudSyncRecords, backfillLocalLifeGraphToCloud } from './life-graph';
import { createAppApiClient } from './app-api-client';
import { logDropped } from './storage-health';

export interface GraphConsistencyReport {
  checkedAt: string;
  localCount: number;
  cloudCount: number;
  /** 本地有、云端没有 —— 这批是真缺口,该补传 */
  missingInCloud: string[];
  /**
   * 云端有、本地没有 —— 两种可能:
   *   · 别的设备刚加的(下次自动同步会拉下来,正常);
   *   · 本地删了但删除还没传导到云(会出现在 pendingDeleteIds 里)。
   * 所以这个数字**单看没有意义**,必须跟 pendingDeletes 一起读。
   */
  missingLocally: string[];
  /** 挂起的删除(解释 missingLocally 的一部分) */
  pendingDeletes: string[];
  /** outbox 里已标 failed 的(非临时错误,重试也不会自己好) */
  stuckCount: number;
}

export type GraphConsistencyFailure =
  | 'offline'          // 拉不到云快照(离线/未配置)
  | 'not_signed_in'    // 未登录:云端本来就没有,不构成缺口
  | 'unavailable';     // 浏览器环境不具备

/**
 * 跑一次同步体检。**不改任何数据。**
 * @returns 报告,或失败原因(不抛异常 —— 体检本身不该是个能崩的东西)。
 */
export async function auditGraphConsistency(): Promise<
  { ok: true; report: GraphConsistencyReport } | { ok: false; reason: GraphConsistencyFailure }
> {
  if (typeof window === 'undefined') return { ok: false, reason: 'unavailable' };

  const local = getLifeGraph();
  const localIds = new Set(local.map((n) => n.id));

  let cloudIds: Set<string>;
  try {
    const snapshot = await createAppApiClient().fetchCloudMemorySnapshot();
    if (!snapshot.ok) {
      // 路由对未登录返回 ok:false —— 这不是「同步坏了」,是「还没有云端这一侧」。
      return { ok: false, reason: 'not_signed_in' };
    }
    cloudIds = new Set(
      (snapshot.nodes || [])
        .map((n) => (n as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
  } catch (err) {
    logDropped('graph.consistency_audit', err); // 体检失败也要可观测,别哑吞
    return { ok: false, reason: 'offline' };
  }

  const records = getLifeGraphCloudSyncRecords();
  const pendingDeletes = records
    .filter((r) => r.operation === 'delete' && r.status !== 'synced')
    .map((r) => r.resourceId);
  const stuckCount = records.filter((r) => r.status === 'failed').length;

  return {
    ok: true,
    report: {
      checkedAt: new Date().toISOString(),
      localCount: localIds.size,
      cloudCount: cloudIds.size,
      missingInCloud: [...localIds].filter((id) => !cloudIds.has(id)),
      missingLocally: [...cloudIds].filter((id) => !localIds.has(id)),
      pendingDeletes,
      stuckCount,
    },
  };
}

/** 报告读起来「有没有问题」的一句话判定(UI 与契约共用同一份判据)。 */
export function consistencyVerdict(r: GraphConsistencyReport): 'clean' | 'repairable' | 'attention' {
  const pending = new Set(r.pendingDeletes);
  // 云端有本地没有,且不是「删除还没传导」的那批 —— 才算意外
  const unexplainedCloudOnly = r.missingLocally.filter((id) => !pending.has(id));
  if (r.missingInCloud.length === 0 && unexplainedCloudOnly.length === 0 && r.stuckCount === 0) return 'clean';
  // 只差「本地有云端没有」→ 一键补传就能修好
  if (unexplainedCloudOnly.length === 0 && r.stuckCount === 0) return 'repairable';
  return 'attention';
}

/**
 * 把体检查出的缺口补上云(定点补传,不受 200 条限制)。
 * 分批发,别把几百条塞进一个请求。
 */
export async function repairMissingInCloud(
  ids: readonly string[],
  { batchSize = 50 }: { batchSize?: number } = {},
): Promise<{ attempted: number }> {
  let attempted = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const res = await backfillLocalLifeGraphToCloud({ ids: [...slice] });
    attempted += res.attemptedNodeCount;
  }
  return { attempted };
}
