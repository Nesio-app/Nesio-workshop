/**
 * tx-node — 每一笔银行流水在记忆图里的**轻量节点**。
 *
 * ## 设计原则:流水没有等级
 *
 * 每一笔流水都是一等公民。**你关联没关联它、挂没挂附件,都不改变它是什么** ——
 * 流水是事实,是这一层最硬的东西;关联只是往上面挂线索。
 *
 * (2026-07-30 更正:第一版做成了「你第一次关联它时才建节点」的懒升格。那是错的 ——
 * 它让流水的地位取决于你有没有碰过它,后果是「你关联过的那笔能搜到,旁边一模一样的
 * 那笔搜不到」。用户当场指出来了。现在改成同步进来就建,一视同仁。)
 *
 * ## 为什么要进图(不是「因为重要」,是因为这些能力只在图里)
 *
 *   · **被搜到** —— smartSearch / searchLifeGraphFuzzy 扫的是内存图谱
 *   · **被问一问引用** —— chat-context / memory-retrieval 组 RAG 只从图里取
 *   · **出现在记忆库 / 时间线** —— MemoryTab 只读 getLifeGraph()
 *   · **能被双向关联** —— linkNodes 的 targetId 必须是真节点 id(R1 的规矩)
 *   · **能挂附件进 node.assets** —— 记忆详情/问一问取附件都走这里
 *   · **跨设备实时同步** —— memory_nodes 表只收 LifeNode
 *
 * 不进图的东西不会丢、不会算错(流水本身是 durable、进备份、标了 critical),
 * 只是**在记忆那一侧不存在**。
 *
 * ## 轻的进图,重的留在外面
 *
 * 邮件早就是这么做的:每一封都进图,但正文留在本机 IndexedDB + 内存全文索引
 * (`email-fulltext-index.ts`)。几千封邮件没压垮它。
 *
 * 流水照抄:节点只带日期/商户/金额/账户/分类 —— 够被搜到、够被关联。
 * **权威数字仍然在 `nesio-bank-tx-v1`,聚合永远读那边。**
 *
 * ## 双计防线
 *
 * 节点带 `txShadow: true`。任何按金额求和的地方看到它**必须跳过** ——
 * 读了就是同一笔钱算两次,而且错得不显眼(月支出多一倍,每一条看起来都对)。
 */

import type { BankTx } from './providers/bank-tx';
import { upsertLifeNodesBatch, getLifeGraph, type LifeNode } from './life-graph';

/** 影子节点的来源前缀。 */
export const TX_NODE_PREFIX = 'plaidtx:';

/** 一笔流水的幂等键。同一笔流水恒定 —— `externalKey()` 认 `externalId`。 */
export function txExternalId(txId: string): string {
  return `${TX_NODE_PREFIX}${txId}`;
}

/** 已经建过节点的流水 → 节点。 */
export function findTxNode(txId: string, graph?: readonly LifeNode[]): LifeNode | null {
  const key = txExternalId(txId);
  const g = graph ?? (() => { try { return getLifeGraph(); } catch { return []; } })();
  return g.find((n) => n.attributes?.externalId === key) ?? null;
}

/** 一笔流水 → 节点输入。纯函数,可单测。 */
export function txToNodeInput(tx: BankTx): Omit<LifeNode, 'id' | 'createdAt'> {
  return {
    type: 'event',
    name: tx.name || '一笔交易',
    source: 'system',
    confidence: 1,
    relations: [],
    tags: ['财务', '交易'],
    rawInput: [tx.date, tx.name, tx.amount].filter((v) => v != null && v !== '').join(' · '),
    attributes: {
      externalId: txExternalId(tx.id),
      txId: tx.id,
      // BankTx 的约定是**支出为正**(Plaid)。影子原样转述,不翻号 ——
      // 翻不翻号是聚合层的事。字段名带 tx 前缀,免得跟账本自己的 amount 语义混起来。
      txAmount: tx.amount,
      txCurrency: tx.currency || 'USD',
      occurredAt: tx.date,
      ...(tx.accountId ? { accountId: tx.accountId } : {}),
      ...(tx.category ? { txCategory: tx.category } : {}),
      ...(tx.merchantId ? { merchantId: tx.merchantId } : {}),
      // 双计防线:聚合看到它必须跳过
      txShadow: true,
      epistemic: 'observation',
      generator: 'system:tx-shadow',
      // source: 'system' 落 LifeNodeSource 只能压平成泛泛的 device —— 银行流水有专属
      // SignalSource('Bank'),不标就跟其它系统生成的东西混在一起,分不清是不是流水。
      signalSource: 'Bank',
    },
  };
}

/** `upsertLifeNodesBatch` 用的键提取器。 */
export const txKeyOf = (attrs: LifeNode['attributes']): string | null => {
  const v = attrs?.externalId;
  return typeof v === 'string' && v.startsWith(TX_NODE_PREFIX) ? v : null;
};

/** 一次最多灌多少条 —— 超过的下次同步继续(幂等键保证不重复)。 */
export const TX_NODE_CAP = 800;
/** 每块之间让出事件循环,主线程不被长时间独占。 */
const CHUNK = 200;

/**
 * 把流水同步进记忆图。**在 saveBankTx 之后调用。**
 *
 * 走批量 upsert(一次 loadAll、一次 saveAll)—— 逐条 `ingestLifeNode` 是 O(n²) 写盘,
 * flomo 就是这么把 iOS 标签写死的(connector-sync.ts:102)。这里同一个量级。
 *
 * 失败不抛:流水已经存好了,记忆那一侧没建成不该让整个同步报错。
 * 但也不静默 —— 返回计数,调用方可以据此提示。
 */
export async function syncTxNodes(txs: readonly BankTx[]): Promise<{ created: number; updated: number; skipped: number }> {
  if (typeof window === 'undefined' || !txs.length) return { created: 0, updated: 0, skipped: 0 };
  // 新的在前:超出上限时先灌最近的
  const ordered = [...txs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const batch = ordered.slice(0, TX_NODE_CAP);
  const skipped = ordered.length - batch.length;
  let created = 0; let updated = 0;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const part = batch.slice(i, i + CHUNK).map(txToNodeInput);
    try {
      const r = upsertLifeNodesBatch(part, txKeyOf);
      created += r.created; updated += r.updated;
    } catch { /* 这一块没写进去,下次同步靠幂等键补 */ }
    // 让出主线程 —— 不让出的话几千条会把 UI 卡住,iOS 上直接被杀
    if (i + CHUNK < batch.length) await new Promise((r) => setTimeout(r, 0));
  }
  return { created, updated, skipped };
}

/**
 * 这个节点是不是流水影子。
 *
 * **任何按金额求和的地方都必须先问这一句。**
 */
export function isTxShadow(n: { attributes?: Record<string, unknown> } | null | undefined): boolean {
  return Boolean(n?.attributes?.txShadow);
}

/** 从影子节点回到那笔流水的 id。 */
export function txIdOfShadow(n: LifeNode): string | null {
  const v = n.attributes?.txId;
  return typeof v === 'string' && v ? v : null;
}
