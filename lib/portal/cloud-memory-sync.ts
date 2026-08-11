/**
 * 前台自动云同步(读侧)—— 让 web / PWA / iOS App / 各设备,只要登录同一账号,
 * 打开就自动看到同一份记忆(把「记忆图」这份护城河真正存进账号级银行,而不是躺在各端本地盒子里)。
 *
 * 触发(用户选定「登录后 + 每次打开拉一次」):Portal 顶层在登录态确定后调一次,
 * 并在标签页从后台回到前台(visibilitychange→visible)时再拉。不做后台/定时轮询。
 *
 * 机制:GET /api/cloud/memory 拉云端快照 → mergeCloudMemorySnapshot 合并进本地图谱
 * (批次198 已改 last-write-wins,按编辑时刻定胜负,不覆盖本地未上传的新编辑)→ 顺带
 * backfill 把本地新记忆推上云 + 重试挂起的同步。全 best-effort:未登录/未配置/离线都静默,
 * local-first 体验不受影响。
 *
 * 免费(P3):durability = 护城河,不锁在付费墙后。此路径不查任何付费权益门 —— 登录即同步。
 * 付费门只管重资产(手动整包备份/图片),不管「记忆跨端一致」这个基本盘。
 *
 * 节流:mount 与 visibility 可能连触发,MIN_INTERVAL_MS 内只真正拉一次(force 跳过)。
 */
import { createAppApiClient } from './app-api-client';
import { logDropped } from './storage-health';
import { mergeCloudMemorySnapshot, retryLifeGraphCloudSync, backfillLocalLifeGraphToCloud, whenGraphHydrated } from './life-graph';

const MIN_INTERVAL_MS = 20_000;
let lastSyncAt = 0;
let inFlight = false;

export interface CloudMemorySyncResult {
  ok: boolean;
  importedNodeCount: number;
  /** 本地已有、被云端那份更新过的条数。 */
  updatedNodeCount?: number;
  /** 云端这次一共给了多少条 —— 和「取回了几条新的」不是一回事。 */
  cloudNodeCount?: number;
}

/**
 * 从云拉取记忆快照并合并进本地。登录态由路由层判断(未登录→snapshot.ok=false,静默)。
 * @param opts.force 跳过节流(手动刷新用)。
 */
export async function syncMemoryWithCloud(opts: { force?: boolean } = {}): Promise<CloudMemorySyncResult> {
  if (typeof window === 'undefined') return { ok: false, importedNodeCount: 0 };
  const now = Date.now();
  if (!opts.force && (inFlight || now - lastSyncAt < MIN_INTERVAL_MS)) {
    return { ok: false, importedNodeCount: 0 };
  }
  inFlight = true;
  lastSyncAt = now;
  try {
    await whenGraphHydrated();
    const client = createAppApiClient();
    const snapshot = await client.fetchCloudMemorySnapshot();
    if (!snapshot.ok) return { ok: false, importedNodeCount: 0 };
    await whenGraphHydrated();
    const merged = mergeCloudMemorySnapshot({ nodes: snapshot.nodes || [], assets: snapshot.assets || [] });
    // 顺带把本地新记忆推上云 + 重试挂起项,让「拉」的同时也「推」,两端逐步收敛。
    void retryLifeGraphCloudSync();
    void backfillLocalLifeGraphToCloud({ limit: 200 });
    return {
      ok: true,
      importedNodeCount: merged.importedNodeCount,
      updatedNodeCount: merged.updatedNodeCount,
      cloudNodeCount: merged.cloudNodeCount,
    };
  } catch (err) {
    logDropped('cloud.memory_sync', err); // 可观测:整条记忆同步失败别哑吞(196-205 静默丢的教训)
    return { ok: false, importedNodeCount: 0 };
  } finally {
    inFlight = false;
  }
}
