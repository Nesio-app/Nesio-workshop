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
import { loadProfileSettings, saveProfileSettings, profileIdentityUpdatedAt, PROFILE_UPDATED_EVENT, type PortalProfileSettings } from './profile';
import type { CloudProfileSettings } from './app-api-client';

// 批次205:主题在 profile 之外单存(AppearanceSheet 的 treasurebox-theme),同步时直接读写它。
const THEME_KEY = 'treasurebox-theme';
function readTheme(): string {
  try { return localStorage.getItem(THEME_KEY) || ''; } catch { return ''; }
}
function applyTheme(theme: string): void {
  if (theme !== 'day' && theme !== 'night' && theme !== 'auto') return;
  try {
    localStorage.setItem(THEME_KEY, theme);
    const resolved = theme === 'auto'
      ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day')
      : theme;
    document.documentElement.setAttribute('data-portal-theme', resolved);
  } catch { /* ignore */ }
}

/** 批次204:dataURL → File(老头像自动迁移上云用)。 */
function dataUrlToFile(dataUrl: string, name: string): File | null {
  try {
    const [meta, b64] = dataUrl.split(',');
    if (!b64) return null;
    const mime = /data:(.*?);/.exec(meta)?.[1] || 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: mime });
  } catch {
    return null;
  }
}

/** 把云端 profile 字段落到本地(换头像清旧 avatarUrl;主题单存,单独 applyTheme)。 */
function applyCloudProfile(cloud: CloudProfileSettings, cloudAt: string): boolean {
  const patch: Record<string, unknown> = {};
  if (typeof cloud.displayName === 'string' && cloud.displayName.trim()) patch.displayName = cloud.displayName;
  if (typeof cloud.avatarStoragePath === 'string') {
    patch.avatarStoragePath = cloud.avatarStoragePath;
    patch.avatarUrl = ''; // 清旧签名 URL → useProfileAvatar 用新 storagePath 重新换签渲染
  }
  // 批次205:语言/教练风格/日报开关跨端一致(用户选定四项同步)。
  if (typeof cloud.locale === 'string' && cloud.locale) patch.locale = cloud.locale;
  if (typeof cloud.coachStyle === 'string' && cloud.coachStyle) patch.coachStyle = cloud.coachStyle;
  if (typeof cloud.dailyReportEnabled === 'boolean') patch.dailyReportEnabled = cloud.dailyReportEnabled;
  const themeChanged = typeof cloud.theme === 'string' && cloud.theme !== '' && cloud.theme !== readTheme();
  const noProfileField = Object.keys(patch).length === 0;
  if (noProfileField && !themeChanged) return false;
  if (themeChanged) applyTheme(cloud.theme as string); // 主题不走 saveProfileSettings
  if (!noProfileField) saveProfileSettings(patch as Partial<PortalProfileSettings>, { identityUpdatedAt: cloudAt });
  else localStorage.setItem('treasurebox-profile-updated-at', cloudAt); // 只有主题变:也同步时间戳,防再拉
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
    // 批次204:老头像自动迁移 —— 本地有头像(dataURL)但云里没副本(无 storagePath)时,上传成
    // 云资产拿到 storagePath,换机/跨端头像就带得走,老用户无需手动重传;之后所有老头像自愈。
    let avatarStoragePath = p.avatarStoragePath || '';
    if (!avatarStoragePath && typeof p.avatarUrl === 'string' && p.avatarUrl.startsWith('data:')) {
      try {
        const file = dataUrlToFile(p.avatarUrl, 'avatar.png');
        if (file) {
          const up = await client.uploadCloudAsset({ file, purpose: 'avatar' });
          if (up.ok && up.storagePath) {
            avatarStoragePath = up.storagePath;
            // 回写本地 storagePath(不改身份时间戳,避免多推一次);下次不再迁移。
            saveProfileSettings({ avatarStoragePath }, { identityUpdatedAt: identityAt });
          }
        }
      } catch { /* 迁移失败不阻塞名字推送 */ }
    }
    let base: CloudProfileSettings = existing ?? {};
    if (!existing) {
      const cur = await client.fetchCloudProfileSettings();
      base = cur.ok && cur.settings ? cur.settings : {};
    }
    // 批次203:检查写入是否真成功(此前无脑 return ok:true,把「云写失败」吞了 6 个批次都没露出)。
    const res = await client.saveCloudProfileSettings({
      ...base,
      displayName: p.displayName,
      avatarStoragePath,
      // 批次205:四项设置跨端一致(语言/教练风格/日报/主题)。
      locale: p.locale,
      coachStyle: p.coachStyle,
      dailyReportEnabled: p.dailyReportEnabled,
      theme: readTheme() || undefined,
      identityUpdatedAt: identityAt,
    });
    return { ok: Boolean(res?.ok && res?.writesCloud) };
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

/** 批次205:订阅 PROFILE_UPDATED_EVENT → 防抖回推。改名字/头像/语言/教练/日报/主题任一,
 *  几秒后自动推上云,别端登录/回前台即拉到。返回注销函数(Portal 登录 effect 挂/卸)。 */
let profilePushTimer: ReturnType<typeof setTimeout> | null = null;
export function registerProfileAutoPush(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onUpdate = () => {
    if (profilePushTimer) clearTimeout(profilePushTimer);
    profilePushTimer = setTimeout(() => { profilePushTimer = null; void pushProfileToCloud(); }, 4000);
  };
  window.addEventListener(PROFILE_UPDATED_EVENT, onUpdate);
  return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdate);
}
