/**
 * life-graph-shards — 记忆图按年分片存储(地基 F3)。
 *
 * 病根:整图存成 IndexedDB 里的**一个 JSON blob**,每次写都要 `JSON.stringify(全图)`。
 * 2500 条时约 1–3MB,靠 400ms 合并窗还压得住(那正是当初「速记提交冻结」的修法);
 * 但财务账本一进来量级就变了 —— 你 Notion 里一个人就挂着 204 条支出,全家几年上万条
 * 很正常。到 2 万条时每次写要序列化 10MB+,会原样重演那次冻结。
 *
 * 分片按 `createdAt` 的年份切。为什么是年:
 *   · 写热点天然集中在当年 —— 改一条今年的记忆只重写今年这一片,历史片纹丝不动;
 *   · 它同时是**对账/锁定的边界**(见 finance-ledger-plan.md):2025 年对完账锁定后,
 *     那一片基本只读;
 *   · 片数可控(十几片),不需要额外索引结构。
 *
 * 三条安全性质,比性能重要得多:
 *
 *   ① **读缺一片 ≠ 图变小了。** 任何一片读失败,整次读标记 `complete: false`,
 *      调用方必须拒绝把它当权威。否则一次瞬时 IDB 故障就会让内存里只剩半张图,
 *      随后一次保存把半张图写回去 —— 那是真丢数据。
 *   ② **写只碰变了的片。** 因此即便某片读不出来,它也不会被覆盖(我们压根不写它)。
 *      这是分片相对单 blob 的**安全性**收益,不只是性能收益。
 *   ③ **迁移先写后验再删。** 旧 blob 拆成片写完 → 读回来比对条数与 id 集合 →
 *      完全一致才删旧 blob。任何一步不对就保留旧 blob,下次再来。
 *
 * `createdAt` 坏掉的节点落 'x' 片,绝不丢弃 —— 数据脏是另一个问题,不该在存储层被吃掉。
 */

import type { LifeNode } from './life-graph';

export interface ShardBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** 分片键前缀。片名是四位年份,或 'x'(createdAt 不可解析)。 */
export const GRAPH_SHARD_PREFIX = 'nesio-life-graph-v1:';
/** 索引键:记录当前有哪些片,避免枚举 IDB。 */
export const GRAPH_SHARD_INDEX_KEY = 'nesio-life-graph-v1:index';
export const GRAPH_SHARD_UNKNOWN = 'x';

export const shardStorageKey = (shard: string): string => `${GRAPH_SHARD_PREFIX}${shard}`;

/** 节点归哪一片。createdAt 坏了不丢,落 'x'。 */
export function shardOf(node: Pick<LifeNode, 'createdAt'>): string {
  const y = String(node?.createdAt ?? '').slice(0, 4);
  return /^\d{4}$/.test(y) ? y : GRAPH_SHARD_UNKNOWN;
}

/** 纯函数:按片分组(顺序保持输入顺序,便于 JSON 比较稳定)。 */
export function groupByShard(nodes: readonly LifeNode[]): Map<string, LifeNode[]> {
  const out = new Map<string, LifeNode[]>();
  for (const n of nodes) {
    if (!n?.id) continue;
    const k = shardOf(n);
    const list = out.get(k);
    if (list) list.push(n); else out.set(k, [n]);
  }
  return out;
}

/**
 * 纯函数:对比「这次要写的每片 JSON」与「上次写过的每片 JSON」,得出真正要落盘的片。
 * @returns write 要写的片名;remove 变空、应当删掉的片名。
 */
export function diffShardJson(
  next: ReadonlyMap<string, string>,
  prev: ReadonlyMap<string, string>,
): { write: string[]; remove: string[] } {
  const write: string[] = [];
  for (const [shard, json] of next) {
    if (prev.get(shard) !== json) write.push(shard);
  }
  const remove: string[] = [];
  for (const shard of prev.keys()) {
    if (!next.has(shard)) remove.push(shard);
  }
  return { write, remove };
}

function parseNodeArray(raw: string | null): LifeNode[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as LifeNode[]) : null;
  } catch { return null; }
}

/**
 * 读全图。
 * @returns null 表示「还没有分片存储」(该走迁移或旧路径);
 *          complete=false 表示**有片没读出来** —— 调用方不许把 nodes 当全量。
 */
export async function readGraphShards(
  idb: ShardBackend,
): Promise<{ nodes: LifeNode[]; complete: boolean; shards: string[] } | null> {
  const indexRaw = await idb.get(GRAPH_SHARD_INDEX_KEY);
  if (!indexRaw) return null;
  let shards: string[];
  try {
    const parsed = JSON.parse(indexRaw) as unknown;
    shards = Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch { return null; }
  if (!shards.length) return { nodes: [], complete: true, shards: [] };

  const nodes: LifeNode[] = [];
  let complete = true;
  for (const shard of shards) {
    let raw: string | null = null;
    try { raw = await idb.get(shardStorageKey(shard)); } catch { complete = false; continue; }
    const parsed = parseNodeArray(raw);
    if (parsed == null) {
      // 索引说有这片,却读不出来/解析不了 —— 宁可报不完整,也不许悄悄少一截。
      complete = false;
      continue;
    }
    nodes.push(...parsed);
  }
  return { nodes, complete, shards };
}

/**
 * 写全图(只落变了的片)。
 * @param prevJson 上次写过的每片 JSON(会话内记忆);传空 Map 则全量重写。
 * @returns nextJson 供调用方替换缓存;written/removed 便于观测与测试。
 */
export async function writeGraphShards(
  idb: ShardBackend,
  nodes: readonly LifeNode[],
  prevJson: ReadonlyMap<string, string>,
): Promise<{ nextJson: Map<string, string>; written: string[]; removed: string[] }> {
  const grouped = groupByShard(nodes);
  const nextJson = new Map<string, string>();
  for (const [shard, list] of grouped) nextJson.set(shard, JSON.stringify(list));

  const { write, remove } = diffShardJson(nextJson, prevJson);
  for (const shard of write) await idb.set(shardStorageKey(shard), nextJson.get(shard)!);
  for (const shard of remove) await idb.delete(shardStorageKey(shard));

  // 索引最后写:片都落好了再宣布它们存在。顺序反了会出现「索引指向还没写的片」。
  const nextShards = [...nextJson.keys()].sort();
  const prevShards = [...prevJson.keys()].sort();
  if (write.length || remove.length || nextShards.join(',') !== prevShards.join(',')) {
    await idb.set(GRAPH_SHARD_INDEX_KEY, JSON.stringify(nextShards));
  }
  return { nextJson, written: write, removed: remove };
}

/**
 * 旧的单 blob → 分片。**先写后验再删**:
 * 写完把片读回来,条数与 id 集合都跟源头一致才删旧 blob;任一步不对就保留旧 blob。
 * @returns null 表示没有旧 blob(无需迁移);verified=false 表示写了但校验没过(旧 blob 已保留)。
 */
export async function migrateLegacyBlobToShards(
  idb: ShardBackend,
  legacyKey: string,
): Promise<{ migrated: number; verified: boolean } | null> {
  const legacy = parseNodeArray(await idb.get(legacyKey));
  if (legacy == null) return null;
  if (!legacy.length) {
    // 空 blob:直接删,不留一个永远为空的旧键。
    await idb.delete(legacyKey);
    return { migrated: 0, verified: true };
  }

  // ⚠️ 必须与**已有分片** union,不能整片覆盖。
  // 场景(自查抓到的丢数据路径):机器早已迁移完(分片在、legacy 已删),之后用户恢复了
  // 一份**旧备份** —— 旧备份里带着 legacy 单 blob,于是 legacy 键又出现了。下次水合再迁移时,
  // 若用空 prev 整片写,2026 片会被旧备份的内容整片替换,**迁移之后新增的记忆全部消失**。
  // union 语义与 life-graph 的 unionNodesById 一致:同 id 取 updatedAt(退化 createdAt)新的那个。
  const existing = await readGraphShards(idb);
  const stamp = (n: LifeNode) => String((n.attributes?.updatedAt as string) || n.createdAt || '');
  const byId = new Map<string, LifeNode>();
  for (const n of [...(existing?.complete ? existing.nodes : []), ...legacy]) {
    if (!n?.id) continue;
    const prev = byId.get(n.id);
    if (!prev || stamp(n) >= stamp(prev)) byId.set(n.id, n);
  }
  // 已有分片读不完整时**不迁移** —— 拿半张图去 union 会把没读出来的片挤掉。
  if (existing && !existing.complete) return { migrated: 0, verified: false };
  const merged = [...byId.values()];

  await writeGraphShards(idb, merged, new Map());

  const back = await readGraphShards(idb);
  const sourceIds = new Set(merged.map((n) => n.id).filter(Boolean));
  const verified = Boolean(
    back?.complete
    && back.nodes.length === merged.length
    && back.nodes.every((n) => sourceIds.has(n.id)),
  );
  // 只有对得上才敢删旧的。对不上就把旧 blob 留着 —— 下次启动重来,数据一直在。
  if (verified) await idb.delete(legacyKey);
  return { migrated: legacy.length, verified };
}
