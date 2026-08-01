/**
 * boot —— IDB 那一整套东西的**唯一启动入口**。
 *
 * ## 之前是什么状况
 *
 * `lib/idb/` 有 16 个模块,**14 个零调用方**:
 * 写入通道、离线队列、同步队列引擎、迁移执行器、完整性检查、回滚 ——
 * 一个都没接到业务上。只有 `storage-monitor` 和 `cleanup` 被一个警告卡片用着。
 *
 * 这个中间态比「没做」更坏:读代码的人会以为离线队列和完整性检查已经在保护数据,
 * 其实一行都没跑。这个文件是把它们接上的那一根线。
 *
 * ## 顺序
 *
 *   ① `initializeStorageOnApp` —— 开库 / 健康检查 / 配额 / 首次清理 / 定期清理
 *   ② `executePhase1Migration` —— 7 个 P1 缓存键 localStorage → IDB
 *   ③ `pruneMigratedSources`  —— **删源**。没有这一步整件事等于白做(见那个文件)
 *
 * ②必须在①之后:迁移要往库里写,库得先开着。
 * ③必须在②之后而且只删校验通过的 —— 顺序反了就是删完才发现拷坏了。
 *
 * ## 三条纪律
 *
 * · **不挡首屏。** 整条链在 `requestIdleCallback` 里跑。它是维护工作,
 *   不是用户在等的东西;而 IDB 事务和 JSON 解析都在主线程上,
 *   放进首屏那一帧会实打实地卡住渲染。
 * · **失败不抛给调用方。** 这一整套的设计前提就是「坏了就降级到 localStorage」。
 *   开机路径上抛异常会把整个 Portal 挂掉 —— 为了一个后台维护任务,不值当。
 * · **一次会话只跑一次。** 底层各自都有幂等保护,但没必要靠它们:
 *   这里自己拦住,少一层可能出错的地方。
 */

import { logDropped } from '@/lib/portal/storage-health';

/** 定期清理的间隔。init-hook 的默认值是 5 分钟 —— 对一个要扫 IDB 的活来说太密了。 */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6 小时

let started = false;

export interface StorageBootResult {
  ok: boolean;
  migrated: number;
  removedKeys: number;
  freedBytes: number;
  /** 校验没过、原件**故意留着**的类别。留着是对的。 */
  keptCategories: string[];
}

/**
 * 跑一次存储启动链。**幂等**,多调无害。
 *
 * @param onIdle 传 false 可以立刻跑(测试用)。默认排到空闲。
 */
export async function bootStorage(opts: { onIdle?: boolean } = {}): Promise<StorageBootResult | null> {
  if (typeof window === 'undefined') return null;
  if (started) return null;
  started = true;

  const run = async (): Promise<StorageBootResult> => {
    const out: StorageBootResult = {
      ok: false, migrated: 0, removedKeys: 0, freedBytes: 0, keptCategories: [],
    };
    try {
      const { initializeStorageOnApp } = await import('./init-hook');
      await initializeStorageOnApp({
        enablePeriodicCleanup: true,
        cleanupIntervalMs: CLEANUP_INTERVAL_MS,
        // 申请持久化存储 —— 不申请的话 Safari 会在空间紧张时**默默清掉**整个 IDB,
        // 而这里面躺着记忆事实库。iOS 上这条尤其要紧。
        requestPersistentStorage: true,
      });

      const { executePhase1Migration } = await import('./phase1-migration');
      const result = await executePhase1Migration();
      out.migrated = result.totalItemsMigrated;

      const { pruneMigratedSources } = await import('./phase1-prune-source');
      const pruned = pruneMigratedSources(result);
      out.removedKeys = pruned.removed;
      out.freedBytes = pruned.freedBytes;
      out.keptCategories = pruned.keptCategories;

      out.ok = result.success;
      return out;
    } catch (err) {
      // 记一笔但不抛。整套东西的设计前提就是「坏了降级到 localStorage」——
      // 为一个后台维护任务把 Portal 挂掉,那是拿用户的会话去赔。
      logDropped('idb.boot', err);
      return out;
    }
  };

  if (opts.onIdle === false) return run();

  return new Promise<StorageBootResult>((resolve) => {
    const kick = () => { void run().then(resolve); };
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    }).requestIdleCallback;
    // 没有 requestIdleCallback 的浏览器(Safari 直到最近都没有)退到 setTimeout。
    // 3 秒:足够首屏画完并让用户先看到东西,又不至于拖到用户已经开始操作。
    if (ric) ric(kick, { timeout: 8000 });
    else setTimeout(kick, 3000);
  });
}
