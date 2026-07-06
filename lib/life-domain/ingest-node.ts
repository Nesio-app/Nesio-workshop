/**
 * ingestLifeNode — LifeNode 形状输入的统一写入口(Signal 迁移里程碑 1)。
 *
 * 背景:createSignal() 号称唯一写入口,但审计发现大量旁路直调
 * addLifeNode(ConnectorsHub、gmail 后台同步、Portal 日历保存、
 * onboarding…)。直接把它们换成 createSignal 会改变节点形状
 * (type 重推断、tags 追加、relations 丢弃)——回归风险不可接受。
 *
 * 方案:保持 LifeNode 形状原样落库(消费者零感知),同时投影出
 * 规范 Signal 进入事实流水(IDB 事实库 + 云镜像)。这样:
 *   - 所有写入都产出 Signal 事实(迁移目标达成)
 *   - 现有读路径/形状完全不变(零回归)
 *   - M3 读切换时,事实库已有完整流水
 *
 * 规则:组件层今后禁止直调 addLifeNode——用本函数或 createSignal。
 */

import { addLifeNode, getLifeGraph, updateLifeNode, type LifeNode } from '@/lib/portal/life-graph';
import { lifeNodeToSignal } from './signal';
import { signalWriteMode, writeCloudSignal } from './create-signal';
import { appendSignalIdb } from './signal-store-idb';

export type IngestNodeInput = Omit<LifeNode, 'id' | 'createdAt'>;

/** ⑦ 外部稳定 id:邮件 messageId / Notion pageId / 通用 externalId(如健康锻炼 startISO+活动)。
 *  用于跨同步/重导入去重(同一封邮件、同一页、同一场锻炼只一条)。 */
function externalKey(attrs: IngestNodeInput['attributes'] | undefined): string | null {
  if (!attrs) return null;
  if (typeof attrs.emailId === 'string' && attrs.emailId) return `email:${attrs.emailId}`;
  if (typeof attrs.notionPageId === 'string' && attrs.notionPageId) return `notion:${attrs.notionPageId}`;
  if (typeof attrs.externalId === 'string' && attrs.externalId) return `ext:${attrs.externalId}`;
  return null;
}

export function ingestLifeNode(input: IngestNodeInput): LifeNode {
  // ⑦ 去重下沉到唯一写入口:带外部 id 的输入(Gmail/Notion 重复同步)幂等 —— 命中就原地更新,
  //   不再生成重复节点。一处修掉此前 Gmail/Notion 各自没做去重的问题。
  const key = externalKey(input.attributes);
  let node: LifeNode;
  if (key) {
    const existing = getLifeGraph().find((n) => externalKey(n.attributes) === key);
    if (existing) {
      updateLifeNode(existing.id, input);           // 覆盖内容(id/createdAt 保留)
      node = { ...existing, ...input };             // input 无 id/createdAt → 沿用旧的
    } else {
      node = addLifeNode(input);
    }
  } else {
    node = addLifeNode(input);
  }
  const signal = lifeNodeToSignal(node);
  void appendSignalIdb(signal);
  if (signalWriteMode() === 'cloud_mirror_pending') {
    void writeCloudSignal(signal);
  }
  return node;
}
