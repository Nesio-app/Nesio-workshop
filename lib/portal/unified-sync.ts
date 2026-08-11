/**
 * unified-sync —— 设置「同步」与记忆页下拉共用同一条动作。
 *
 * 以前三颗按钮各干各的,用户分不清:
 *   ·「立即同步」= 记忆图 + 资料(且云端读曾被 PostgREST 默认 1000 行截断)
 *   ·「从云恢复」= 整包备份 merge(不清空;用户常误以为会清空)
 *   ·记忆下拉   = 只拉外部连接器
 *
 * 合并后的「同步」= 记忆双向 + 资料 + 模块 durable + 连接器。
 * 「用备份补缺」仍单独保留(整包 gzip 备份,与实时表不同管道)。
 */

import { syncMemoryWithCloud, type CloudMemorySyncResult } from './cloud-memory-sync';
import { syncProfileWithCloud } from './cloud-profile-sync';
import { autoSyncModulesWithCloud } from './cloud-module-sync';
import { syncAllConnectors } from './connector-sync';

export type UnifiedSyncResult = {
  memory: CloudMemorySyncResult;
  profileOk: boolean;
  modulesOk: boolean;
  connectorsOk: boolean;
};

export async function runUnifiedSync(opts?: { force?: boolean }): Promise<UnifiedSyncResult> {
  const force = opts?.force !== false;
  const memory = await syncMemoryWithCloud({ force });
  let profileOk = true;
  try {
    await syncProfileWithCloud();
  } catch {
    profileOk = false;
  }
  let modulesOk = true;
  try {
    await autoSyncModulesWithCloud();
  } catch {
    modulesOk = false;
  }
  let connectorsOk = true;
  try {
    await syncAllConnectors();
  } catch {
    connectorsOk = false;
  }
  return { memory, profileOk, modulesOk, connectorsOk };
}

/** 给设置 / 记忆页共用的结果文案(中/英)。 */
export function describeUnifiedSync(r: UnifiedSyncResult, zh: boolean): string {
  const fresh = r.memory.importedNodeCount || 0;
  const updated = r.memory.updatedNodeCount || 0;
  const total = r.memory.cloudNodeCount || 0;
  const parts: string[] = [];
  if (zh) {
    if (fresh || updated) parts.push(`记忆 +${fresh} 新 / ${updated} 更新(云上 ${total})`);
    else parts.push(`记忆已对齐(云上 ${total})`);
    if (!r.profileOk) parts.push('资料未对齐');
    if (!r.modulesOk) parts.push('模块未对齐');
    if (!r.connectorsOk) parts.push('外部源未拉完');
    return `✓ ${parts.join(' · ')}`;
  }
  if (fresh || updated) parts.push(`memories +${fresh} new / ${updated} updated (cloud ${total})`);
  else parts.push(`memories aligned (cloud ${total})`);
  if (!r.profileOk) parts.push('profile lag');
  if (!r.modulesOk) parts.push('modules lag');
  if (!r.connectorsOk) parts.push('connectors lag');
  return `✓ ${parts.join(' · ')}`;
}
