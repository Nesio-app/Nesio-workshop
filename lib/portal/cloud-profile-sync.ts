/**
 * Profile(名字 + 头像)跨端同步(批次200)。补上批次198/199 之后剩的最后一块:
 * 记忆和学习态都进银行了,但**头像/名字仍各端不同** —— 根因:此前没有任何地方在登录时
 * 把云端 profile 拉回本地(saveCloudProfileSettings 只在换头像时推 avatarStoragePath,
 * displayName 压根不推,且从不拉)。
 *
 * 机制(全走现成 /api/cloud/profile-settings,零新表):
 *  - 推:名字 / 头像 storagePath + identityUpdatedAt(身份 LWW 时间戳)→ profile_settings。
 *  - 拉:登录/回前台取云端 profile,按 identityUpdatedAt 做 last-write-wins:
 *      云更新 → 采纳(换头像时清本地旧签名 URL,让 useProfileAvatar 用新 storagePath 换签重渲染);
 *      本地更新 → 反推。不覆盖本地更晚的改动。
 *
 * 为什么用 identityUpdatedAt 而非 row 的 updatedAt:后者会被 learningRef 等任意字段写刷新,
 * 不能代表「名字/头像」何时改的。头像本体(dataURL)太大不进 profile_settings(2000 字上限),
 * 走 avatarStoragePath + 资产签名 URL;NesioProfileCard 已保证头像总上传成资产。
 *
 * 免费(P3):durability 不锁付费门。best-effort:未登录/离线静默。
 */
import { createAppApiClient } from './app-api-client';
import { loadProfileSettings, saveProfileSettings, profileIdentityUpdatedAt } from './profile';
import type { CloudProfileSettings } from './app-api-client';

/** 把云端身份字段落到本地(换头像清旧 avatarUrl,强制按新 storagePath 换签)。 */
function applyCloudProfile(cloud: CloudProfileSettings, cloudAt: string): boolean {
  const patch: { displayName?: string; avatarStoragePath?: string; avatarUrl?: string } = {};
  if (typeof cloud.displayName === 'string' && cloud.displayName.trim()) patch.displayName = cloud.displayName;
  if (typeof cloud.avatarStoragePath === 'string') {
    patch.avatarStoragePath = cloud.avatarStoragePath;
    patch.avatarUrl = ''; // 清旧签名 URL → useProfileAvatar 用新 storagePath 重新换签渲染
  }
  if (patch.displayName === undefined && patch.avatarStoragePath === undefined) return false;
  saveProfileSettings(patch, { identityUpdatedAt: cloudAt });
  return true;
}

/** 把本地身份推上云(合并保留其他字段:mirrorProfile/learningRef 等不被清掉)。 */
export async function pushProfileToCloud(existing?: CloudProfileSettings): Promise<{ ok: boolean }> {
  if (typeof window === 'undefined') return { ok: false };
  try {
    const identityAt = profileIdentityUpdatedAt();
    if (!identityAt) return { ok: false }; // 本地从没改过身份 → 无可推
    const p = loadProfileSettings();
    const client = createAppApiClient();
    let base: CloudProfileSettings = existing ?? {};
    if (!existing) {
      const cur = await client.fetchCloudProfileSettings();
      base = cur.ok && cur.settings ? cur.settings : {};
    }
    await client.saveCloudProfileSettings({
      ...base,
      displayName: p.displayName,
      avatarStoragePath: p.avatarStoragePath || '',
      identityUpdatedAt: identityAt,
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * 登录/回前台:取云端 profile 一次,按 identityUpdatedAt 决定采纳云端还是反推本地。
 */
export async function syncProfileWithCloud(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const client = createAppApiClient();
    const res = await client.fetchCloudProfileSettings();
    const cloud = res.ok && res.settings ? res.settings : undefined;
    const cloudAt = cloud && typeof cloud.identityUpdatedAt === 'string' ? cloud.identityUpdatedAt : '';
    const localAt = profileIdentityUpdatedAt();
    if (cloud && cloudAt && cloudAt > localAt) {
      applyCloudProfile(cloud, cloudAt);
    } else if (localAt && localAt > cloudAt) {
      void pushProfileToCloud(cloud ?? {});
    }
  } catch {
    /* best-effort */
  }
}
