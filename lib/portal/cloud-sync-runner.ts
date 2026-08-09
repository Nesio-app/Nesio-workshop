/**
 * cloud-sync-runner —— 七条云同步的**统一重试与离线兜底**。
 *
 * ## 之前的样子
 *
 * `runHeavySyncBatch` 里一排 `void syncXxxWithCloud()`,发出去就不管了。
 * 断网、超时、服务端 5xx —— 一律无声无息,这一轮就这么丢了,
 * 要等下一次回前台碰运气。而 `lib/idb/offline-queue.ts` 那个离线队列
 * 写好了躺在那儿,**零调用方**。
 *
 * ## 这一层做什么
 *
 * 在**任务级**包一层:哪条同步这次没跑成,记进队列;下次开机或网络回来时重跑。
 * 带指数退避,带次数上限。
 *
 * ## ⚠️ 它覆盖什么、不覆盖什么(别高估它)
 *
 * **覆盖**:整条同步任务抛出来的失败(网络断、await 的请求 reject)。
 *
 * **不覆盖**:那些函数**内部**的 `void pushXxxToCloud()` —— 即发即忘,
 * 错误在里面就被吃掉了,外面根本看不见。比如 `syncLearningWithCloud`:
 *
 * ```ts
 * await pullLearningFromCloud();          // ← 这个失败,这里能接住
 * void pushLearningToCloud();             // ← 这个失败,这里接不住
 * ```
 *
 * 要接住后半截,得逐个改那七个模块的内部,把 `void` 换成 await + 上抛。
 * 那是另一件事(而且要一个个验),不在这一层里假装做到了。
 *
 * 所以这一层的诚实说法是:**「拉取失败会重试;推送失败暂时还不会」**。
 * 记在这里,免得下次有人看到「统一队列」四个字就以为全保住了。
 *
 * ## 为什么是任务级而不是记录级
 *
 * 记录级(每条数据一个队列项)更精细,但要求每个同步模块把「我要发哪几条」
 * 交出来 —— 那是七次内部重写。任务级不用动它们的内脏,
 * 而且这些同步本来就是幂等的全量对账(union / LWW),重跑一次是安全的。
 *
 * 先拿到「断网不再默默丢一轮」这个大头。记录级等有具体的丢数据案例再说。
 */

import { logDropped } from './storage-health';

/** 一条同步任务。`name` 要稳定 —— 队列靠它去重和重试。 */
export interface CloudSyncTask {
  name: string;
  run: () => Promise<unknown>;
}

/** 最多重试几轮。超了就不再排队 —— 一直失败的东西留着只会挡住别人。 */
const MAX_ROUNDS = 4;
/** 退避基数。第 n 次失败后等 BASE * 2^n。 */
const BACKOFF_BASE_MS = 60_000;

const QUEUE_CATEGORY = 'cloud-sync-task';

/** 任务名 → 波次(越小越先跑)。未列出的落在波次 2(与模块后、连接器前的资产同步同级)。 */
const TASK_WAVE: Record<string, number> = {
  memory: 0,
  learning: 0,
  profile: 0,
  modules: 1,
  connectors: 3,
};

function waveOf(name: string): number {
  return TASK_WAVE[name] ?? 2;
}

/**
 * 跑一批同步任务。**失败的记进离线队列,不抛。**
 *
 * 波次串行(波内也串行):记忆/profile → 模块 → 资产类 → 连接器。
 * 避免并行 gzip/IDB 把主线程打满,也减少模块与记忆图并发写同一存储的竞态。
 *
 * 返回哪些成功、哪些进了队列 —— 调用方可以据此告诉用户
 * 「有 2 项还没同步上,联网后会自动补」,而不是假装全好了。
 */
export async function runCloudSyncBatch(
  tasks: readonly CloudSyncTask[],
): Promise<{ ok: string[]; queued: string[] }> {
  const ok: string[] = [];
  const queued: string[] = [];

  const waves = new Map<number, CloudSyncTask[]>();
  for (const t of tasks) {
    const w = waveOf(t.name);
    if (!waves.has(w)) waves.set(w, []);
    waves.get(w)!.push(t);
  }

  for (const w of [...waves.keys()].sort((a, b) => a - b)) {
    for (const t of waves.get(w)!) {
      try {
        await t.run();
        ok.push(t.name);
      } catch (err) {
        queued.push(t.name);
        await enqueueFailedTask(t.name, err);
      }
    }
  }

  return { ok, queued };
}

async function enqueueFailedTask(name: string, err: unknown): Promise<void> {
  try {
    // 用 sync-queue-engine 而不是 offline-queue:后者的 `table` 参数钉死在
    // `StoreName` 那组固定的 IDB 表名上 —— 它是给**记录级**同步设计的
    // (「把 signals 表的这一行传上去」)。这里排的是**任务**,不是记录,
    // 硬塞一个表名进去只是骗过类型检查,语义是错的。
    // sync-queue-engine 收任意 key/category,正合适。
    const { enqueueSyncItem } = await import('@/lib/idb/sync-queue-engine');
    await enqueueSyncItem(`cloud-sync:${name}`, QUEUE_CATEGORY, {
      name,
      failedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    });
  } catch (e) {
    // 连队列都写不进去 —— 这次同步就是真丢了一轮。记一笔,
    // 至少让 storage-health 那条线知道有东西没存上。
    logDropped('cloud_sync.enqueue', e);
  }
}

/**
 * 把队列里攒着的失败任务重跑一遍。
 *
 * 开机时调一次,`online` 事件回来时再调一次 —— 后者是这整件事的意义所在:
 * 用户在地铁里改了东西,出站那一刻自动补上,而不是等他下次想起来打开 App。
 *
 * @param registry 任务名 → 怎么跑。队列里只存名字,函数得由调用方给
 *   (函数没法序列化,存进 IDB 的只能是数据)。
 */
export async function drainCloudSyncQueue(
  registry: Readonly<Record<string, () => Promise<unknown>>>,
): Promise<{ retried: number; stillFailing: number }> {
  let retried = 0;
  let stillFailing = 0;
  try {
    const q = await import('@/lib/idb/sync-queue-engine');
    // 只取**到期该重试**的(pending,或 failed 且过了退避时间)——
    // 不是把队列里所有东西都拿出来重打一遍,那样退避就白设了。
    const due = (await q.getPendingRetryItems())
      .filter((it) => it.category === QUEUE_CATEGORY);

    for (const entry of due) {
      const name = (entry.data as { name?: string } | undefined)?.name;
      const fn = name ? registry[name] : undefined;
      if (!fn) {
        // 队列里有一条我们已经不认识的任务(改过名 / 删过模块)。
        // 标成功让它出队 —— 留着只会一直被捞出来重试一个不存在的东西。
        await q.markSyncItemSucceeded(entry.id);
        continue;
      }
      // dequeue 会把状态推成 syncing 并 attempts++ —— 先占住,
      // 免得 online 事件和开机那一路同时捞到同一条重复跑。
      await q.dequeueSyncItem(entry.id);
      try {
        await fn();
        await q.markSyncItemSucceeded(entry.id);
        retried += 1;
      } catch (e) {
        // markSyncItemFailed 自己管退避和次数上限。
        await q.markSyncItemFailed(entry.id, e instanceof Error ? e.message : 'retry_failed');
        stillFailing += 1;
      }
    }
  } catch (err) {
    logDropped('cloud_sync.drain', err);
  }
  return { retried, stillFailing };
}

/** 给 UI 看的:还有几条没同步上。0 以外的数字该说出来,别假装全好了。 */
export async function pendingCloudSyncCount(): Promise<number> {
  try {
    const { getSyncQueueStats } = await import('@/lib/idb/sync-queue-engine');
    const s = await getSyncQueueStats();
    // `allPendingCount` = IDB 里 pending/failed + localStorage outbox 那部分。
    // 队列在 IDB 项数接近上限时会降级到 outbox,只数 IDB 会漏掉降级后的那些 ——
    // 而那正是「东西特别多」的时候,也就是最该报数的时候。
    return s.allPendingCount ?? 0;
  } catch {
    return 0;
  }
}

export const CLOUD_SYNC_LIMITS = { maxRounds: MAX_ROUNDS, backoffBaseMs: BACKOFF_BASE_MS };
