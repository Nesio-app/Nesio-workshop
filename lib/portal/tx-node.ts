/**
 * tx-node — 银行流水的**懒升格**(把交易变成记忆节点)。
 *
 * 这是 `docs/design/module-link-matrix.md` 里所有财务类 🔴 的共同解法,
 * 也是那四个 use case(交易关联人/附件、小票认领、发票挂账目)的共同卡点。
 *
 * ## 为什么之前不通
 *
 * `BankTx` 不是 LifeNode(存 `nesio-bank-tx-v1`)。于是:
 *   · 关联只能走 overlay(`tx-annotations`),而**全仓只有 FinanceTab 读它** ——
 *     你把一笔钱关联给 Linda,Linda 的关系页看不到;
 *   · 附件只留 assetId,不在 `node.assets` 体系,问一问/记忆详情都取不到;
 *   · 记忆库搜不到任何一笔消费。
 *
 * ## 为什么是「懒」升格
 *
 * 几千条流水**不该**全塞进记忆图 —— 那会把记忆库淹掉(而且 R2 审计里
 * 「自建表」的三条豁免第一条就是「数据量级会压垮记忆图」)。
 *
 * 但**你动过的那几笔**不一样:你给它关联了人、挂了附件、写了备注,
 * 那说明这笔钱对你有意义。**有意义的才进图**,是很自然的一条线。
 *
 * 所以升格发生在**你第一次关联它的那一刻**,不在同步时。
 *
 * ## 幂等
 *
 * `externalId: 'plaidtx:<transaction_id>'` —— `ingest-node.ts` 的 `externalKey()`
 * 认这个字段,所以同一笔流水升格一百次也只有一个节点。
 * (连接器那批因为不带这三个字段之一,每点一次同步就整批重灌 —— 见
 * `scripts/connector-idempotency.test.mjs`。这里从一开始就带上。)
 *
 * ## 节点是流水的**影子**,不是副本
 *
 * 金额/日期/商户只是**冗余进来给人看**的,权威仍然是 `nesio-bank-tx-v1`。
 * 所以:
 *   · 节点上的这些字段跟着流水走,人改不了(要改去财务页改规则);
 *   · 聚合**永远不读这些节点** —— 读了就是双计。契约里钉死这一条。
 */

import type { BankTx } from './bank-tx';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { getLifeGraph, type LifeNode } from './life-graph';

/** 影子节点的来源前缀。 */
export const TX_NODE_PREFIX = 'plaidtx:';

/** 一笔流水的幂等键。同一笔流水恒定。 */
export function txExternalId(txId: string): string {
  return `${TX_NODE_PREFIX}${txId}`;
}

/** 已经升格过的流水 → 节点。零参,读图。 */
export function findTxNode(txId: string, graph?: readonly LifeNode[]): LifeNode | null {
  const key = txExternalId(txId);
  const g = graph ?? (() => { try { return getLifeGraph(); } catch { return []; } })();
  return g.find((n) => n.attributes?.externalId === key) ?? null;
}

/**
 * 找不到就建。返回影子节点。
 *
 * **只在「人主动关联/批注这笔钱」时调用** —— 别在同步流程里顺手调,
 * 那等于把几千条流水全塞进图(见文件头)。
 */
export function ensureTxNode(tx: BankTx): LifeNode {
  const existing = findTxNode(tx.id);
  if (existing) return existing;
  // BankTx 的约定是**支出为正**(Plaid)。影子节点上原样保留,不翻号 ——
  // 翻不翻号是聚合层的事,影子只忠实转述。转述用的字段名带 tx 前缀,
  // 免得跟账本自己的 amount 语义混起来。
  return ingestLifeNode({
    type: 'event',
    name: tx.name || '一笔交易',
    source: 'system',
    confidence: 1,
    relations: [],
    tags: ['财务', '交易'],
    rawInput: [tx.date, tx.name, tx.amount].filter(Boolean).join(' · '),
    attributes: {
      externalId: txExternalId(tx.id),
      txId: tx.id,
      txAmount: tx.amount,
      txCurrency: tx.currency || 'USD',
      occurredAt: tx.date,
      ...(tx.accountId ? { accountId: tx.accountId } : {}),
      ...(tx.category ? { txCategory: tx.category } : {}),
      // 影子标记:聚合看到它必须跳过,否则同一笔钱算两次
      txShadow: true,
      epistemic: 'observation',
      generator: 'system:tx-shadow',
    },
  });
}

/**
 * 这个节点是不是流水影子。
 *
 * **任何按金额求和的地方都必须先问这一句。** 影子节点带着 `txAmount`,
 * 而真正的账在 `nesio-bank-tx-v1` 里 —— 两边都算就是双计,
 * 而且错得不显眼(月支出多一倍,但每一条看起来都对)。
 */
export function isTxShadow(n: { attributes?: Record<string, unknown> } | null | undefined): boolean {
  return Boolean(n?.attributes?.txShadow);
}

/** 从影子节点回到那笔流水的 id。 */
export function txIdOfShadow(n: LifeNode): string | null {
  const v = n.attributes?.txId;
  return typeof v === 'string' && v ? v : null;
}
