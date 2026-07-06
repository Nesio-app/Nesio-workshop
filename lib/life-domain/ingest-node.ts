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

import { addLifeNode, updateLifeNode, externalIdOf, findNodeByExternalId, type LifeNode } from '@/lib/portal/life-graph';
import { lifeNodeToSignal } from './signal';
import { signalWriteMode, writeCloudSignal } from './create-signal';
import { appendSignalIdb } from './signal-store-idb';

export type IngestNodeInput = Omit<LifeNode, 'id' | 'createdAt'>;

/**
 * 统一写入门(带幂等):带稳定外部 id 的条目(Gmail message / Notion 页 / 日历事件…)
 * 重同步时**更新已存在的节点而非新建**,把去重下沉到这里 —— 修「同步 100 行 Notion
 * 三次 = 300 个节点」。无外部 id 的(手动/语音等)照常新建。
 */
export function ingestLifeNode(input: IngestNodeInput): LifeNode {
  const extId = externalIdOf(input.attributes as Record<string, unknown> | undefined);
  const existing = extId ? findNodeByExternalId(input.source, extId) : null;

  let node: LifeNode;
  if (existing) {
    // 就地更新(保留 id/createdAt),合并 attributes、刷新名字/类型/标签/正文/关系。
    const attributes = { ...existing.attributes, ...input.attributes };
    updateLifeNode(existing.id, {
      name: input.name,
      type: input.type,
      attributes,
      tags: input.tags,
      relations: input.relations,
      rawInput: input.rawInput,
      confidence: input.confidence,
    });
    node = { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, attributes };
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
