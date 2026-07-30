/**
 * 一次性自愈(2026-07-29)—— 清掉两轮改造留下的历史残渣。代码修好只管**将来**,
 * 已经写进用户本机的坏数据得有人去扫。幂等:做过一次落标记,之后零开销直接返回。
 *
 * 两件事:
 *  ① **邮件重复节点**。病灶已修(见 ingest-node 的 attributes 合并 + gmail 路由丢弃无主富化),
 *     但此前云 AI 富化认不出源邮件时会建出没有 emailId 的副本 —— 没有去重键,每轮富化再来一个。
 *     清法两条,都保守:
 *       · 同 emailId 多条 → 保**最早**那条(它的 id 被别处引用过的可能性最大),其余删;
 *       · 无 emailId 的邮件节点,**仅当**存在同名且有 emailId 的兄弟时才删(那才是它的正主)。
 *         老同步遗留的、没有同名正主的无 id 邮件节点一律留着 —— 宁可留冗余,不误删真数据。
 *  ② **已拆模块的孤儿 key**。8 层管线/ranker/llm-sweep/润色层物理删除后,它们的 localStorage
 *     还躺在用户机器上(占空间、进备份、还会被当 durable 同步上云)。列名清掉。
 *
 * 失败不抛:自愈是锦上添花,不能拖垮启动。
 */
import { getLifeGraph, deleteLifeNode } from './life-graph';
import { logDropped } from './storage-health';

const HEAL_FLAG = 'nesio-storage-heal-v1';

/** 已拆模块留下的孤儿 key(模块本体已物理删除,数据无人再读)。 */
const RETIRED_KEYS = [
  'nesio-guidance-cooling',                    // cooling-store(自适应冷却,随 8 层管线拆除)
  'nesio-guidance-ranker-v1',                  // guidance-ranker 权重
  'nesio-ranker-trainlog-v1',                  // ranker 训练日志(学习态只剩偏好)
  'nesio-ranker-learning-retired-purge-v1',    // ranker 退役时的一次性清理标记
  'nesio-llm-sweep-ledger-v1',                 // llm-sweep 巡查账本(判决层已吸收其职责)
  'nesio-guidance-lang-cache-v1',              // Layer 7 润色缓存(润色层已删)
];

export interface HealReport {
  emailDupsRemoved: number;
  orphanEnrichRemoved: number;
  retiredKeysRemoved: number;
}

/** 邮件节点去重(纯函数,可单测):返回该删的节点 id。 */
export function planEmailDedup(
  nodes: ReadonlyArray<{ id: string; name: string; source?: string; createdAt: string; attributes?: Record<string, unknown> }>,
): { dupIds: string[]; orphanIds: string[] } {
  const emails = nodes.filter((n) => n.source === 'email');
  const emailIdOf = (n: (typeof emails)[number]) =>
    typeof n.attributes?.emailId === 'string' && n.attributes.emailId ? n.attributes.emailId : '';

  // ① 同 emailId → 保最早
  const byId = new Map<string, typeof emails>();
  for (const n of emails) {
    const eid = emailIdOf(n);
    if (!eid) continue;
    const arr = byId.get(eid) || [];
    arr.push(n);
    byId.set(eid, arr);
  }
  const dupIds: string[] = [];
  for (const arr of byId.values()) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    dupIds.push(...sorted.slice(1).map((n) => n.id));
  }

  // ② 无 emailId 的,仅当有同名且带 emailId 的正主时才算孤儿副本
  const namesWithId = new Set(emails.filter((n) => emailIdOf(n)).map((n) => n.name));
  const orphanIds = emails
    .filter((n) => !emailIdOf(n) && namesWithId.has(n.name))
    .map((n) => n.id);

  return { dupIds, orphanIds };
}

/** 跑一次自愈(幂等)。返回本次清理量;已跑过或非浏览器环境返回 null。 */
export function runStorageHealOnce(): HealReport | null {
  if (typeof window === 'undefined') return null;
  try {
    if (localStorage.getItem(HEAL_FLAG)) return null;
  } catch {
    return null; // 读不到 localStorage(隐私模式):不跑,免得每次启动重来
  }

  const report: HealReport = { emailDupsRemoved: 0, orphanEnrichRemoved: 0, retiredKeysRemoved: 0 };
  try {
    const { dupIds, orphanIds } = planEmailDedup(getLifeGraph());
    for (const id of dupIds) if (deleteLifeNode(id)) report.emailDupsRemoved += 1;
    for (const id of orphanIds) if (deleteLifeNode(id)) report.orphanEnrichRemoved += 1;
  } catch (err) {
    logDropped('storage-heal.email-dedup', err);
  }

  for (const key of RETIRED_KEYS) {
    try {
      if (localStorage.getItem(key) === null) continue;
      localStorage.removeItem(key);
      report.retiredKeysRemoved += 1;
    } catch { /* 单个 key 删不掉不拦其余 */ }
  }

  try { localStorage.setItem(HEAL_FLAG, new Date().toISOString()); } catch { /* 标记写不进:下次再跑一遍,幂等无害 */ }
  if (report.emailDupsRemoved || report.orphanEnrichRemoved || report.retiredKeysRemoved) {
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
  }
  return report;
}
