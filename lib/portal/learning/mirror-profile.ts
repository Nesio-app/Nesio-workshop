/**
 * Mirror Profile — tracks user preferences from feedback signals.
 * Stores locally + syncs to cloud profile when signed in.
 *
 * What it learns:
 * - Which card domains the user acts on vs. dismisses
 * - Best time-of-day for interruptions (from interaction timestamps)
 * - Language/tone preferences
 *
 * 2a 收编(A 计划):domainWeights 的**真源移到 Preference 原语**(personalization/preference-store,
 * dimension='domain',更新律=本文件原 EWMA-toward-target 逐字搬过去)。本文件保留时段/打扰风格/云同步,
 * 对外 API(getMirrorProfile/getDomainWeight/learnFromFeedback)不变;旧 blob 里的 domainWeights
 * 首次访问时一次性灌进 Preference(保留现 key,云回灌时同样回填)。
 */

import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import { getWeights, recordPreference, seedPreferenceWeights, resetPreferenceDimension, type Reaction } from '@/lib/platform/personalization';

const MIRROR_KEY = 'nesio-mirror-profile-v1';

export interface MirrorProfile {
  // Domain preferences 0-1 (higher = user engages more)
  domainWeights: Record<string, number>;
  // Hour buckets 0-23, engagement rate
  hourEngagement: number[];
  // How many total feedbacks recorded
  feedbackCount: number;
  // Preferred interruption style
  interruptionStyle: 'proactive' | 'minimal' | 'silent';
  updatedAt: string;
}

// 🔴#4 冷启动:清醒时段的先验(0=深夜最差 → 白天最佳)。用作初始种子 + 并列时的次序,
// 避免新用户 hourEngagement 全 0.5、稳定排序把「最佳打扰时段」判成凌晨 0-7 点(最差窗口)。
//                   0   1   2   3   4   5    6    7    8    9   10   11   12   13   14   15   16   17   18   19   20   21   22   23
const HOUR_PRIOR = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2, 0.4, 0.7, 0.9, 1.0, 1.0, 0.8, 0.8, 0.9, 1.0, 1.0, 0.9, 0.8, 0.8, 0.7, 0.6, 0.4, 0.2];
/** 把先验映射成 0.35–0.55 的软基线:有先验但很弱,几次真实反馈就能盖过。 */
function seededHourEngagement(): number[] {
  return HOUR_PRIOR.map((p) => 0.35 + 0.2 * p);
}

function defaultMirror(): MirrorProfile {
  return {
    domainWeights: {},
    hourEngagement: seededHourEngagement(),
    feedbackCount: 0,
    interruptionStyle: 'proactive',
    updatedAt: new Date().toISOString(),
  };
}

// 一次性迁移:旧 blob 里的 domainWeights 灌进 Preference(只补缺,不盖已学的)。模块生命周期内跑一次。
let domainWeightsMigrated = false;
function ensureDomainWeightsMigrated(stored: MirrorProfile | null): void {
  if (domainWeightsMigrated) return;
  domainWeightsMigrated = true;
  if (stored?.domainWeights && Object.keys(stored.domainWeights).length) {
    seedPreferenceWeights('domain', stored.domainWeights);
  }
}

// 存储完整性批:localStorage → IDB blob(同步缓存读 + 旧值自动迁移 + 备份/删除收口)。
const blob = createBlobStore<MirrorProfile>({
  key: MIRROR_KEY, updateEvent: `${MIRROR_KEY}-updated`,
  validate: (v) => typeof v === 'object' && v !== null, onWriteError: reportStorageDropped,
});

function readStored(): MirrorProfile | null {
  if (typeof window === 'undefined') return null;
  return blob.load();
}

export function getMirrorProfile(): MirrorProfile {
  const stored = readStored();
  ensureDomainWeightsMigrated(stored);
  const base = stored ?? defaultMirror();
  // domainWeights 从规范 Preference 装配(真源);blob 里的副本仅供云往返/旧数据迁移。
  return { ...base, domainWeights: getWeights('domain') };
}

function saveMirrorProfile(profile: MirrorProfile): void {
  if (typeof window === 'undefined') return;
  blob.save(profile);
}

export function resetMirrorProfile(): void {
  saveMirrorProfile(defaultMirror());
  resetPreferenceDimension('domain'); // 真源在 Preference,重置必须一起清,否则"重置"是假的
  domainWeightsMigrated = true;       // 防止随后又从(已清空的)旧 blob 重新灌种
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nesio-feedback-recorded'));
  }
}

/**
 * 走 session-state 单例(2026-07-31 归一)。原来这里自己 fetch 一趟,
 * 和 Portal、PortalOnboarding 各打各的 —— 三趟请求在不同时刻回来、
 * 各自 setState,开机头几秒登录态就会来回变。
 *
 * 顺带修好一处语义:原来 `catch → false`,把「问不出来」当成「没登录」。
 * 单例是三态的,`unknown` 保持未知 —— 这里只在**服务器明确说登录了**时返回 true,
 * 网络抖一下不会让镜像档案误以为用户登出了。
 */
async function hasCloudSession(): Promise<boolean> {
  try {
    const { readSession } = await import('../session-state');
    return (await readSession()).state === 'signed-in';
  } catch {
    return false;
  }
}

// 旧四元反馈 → 统一 Reaction(not_now 在 domain 策略里=跳过,与原"时机不对不罚领域"等价)。
const FEEDBACK_TO_REACTION: Record<string, Reaction> = {
  useful: 'useful', wrong: 'wrong', too_much: 'too_much', not_now: 'snooze',
};

/** Call this whenever user gives feedback on a card */
export function learnFromFeedback(
  domain: string,
  feedback: 'useful' | 'wrong' | 'not_now' | 'too_much' | undefined,
): void {
  if (!feedback) return;
  const profile = getMirrorProfile();
  const hour = new Date().getHours();

  // 🟠#5 抗单调饱和:每次反馈都把所有小时轻微拉回先验(均值回归),没被持续正反馈的时段
  // 会淡出,重度用户不再所有活跃时段一起趋近 1.0、丢失区分度。
  for (let h = 0; h < 24; h++) {
    const prior = 0.35 + 0.2 * HOUR_PRIOR[h];
    profile.hourEngagement[h] += 0.02 * (prior - profile.hourEngagement[h]);
  }

  // 领域权重:走规范 Preference 原语(dimension='domain';更新律=原 EWMA-toward-target,
  // useful→1 / wrong→0.2 留底 / too_much→0 加速 / not_now 跳过,策略表在 preference-store)。
  recordPreference('domain', domain, FEEDBACK_TO_REACTION[feedback]);

  // 时段互动:留在本文件(带清醒先验 + 均值回归的 24 桶结构,是 mirror 特有形态)。
  const toward = (cur: number, target: number, alpha: number) => cur + alpha * (target - cur);
  const HR = 0.12;
  if (feedback === 'useful') {
    profile.hourEngagement[hour] = toward(profile.hourEngagement[hour], 1, HR);
  } else if (feedback === 'not_now') {
    // 只是时机不对,把该时段拉低
    profile.hourEngagement[hour] = toward(profile.hourEngagement[hour], 0.15, HR);
  }

  profile.feedbackCount += 1;
  profile.updatedAt = new Date().toISOString();
  profile.domainWeights = getWeights('domain'); // blob 携带最新副本(云往返用),真源在 Preference

  // Adjust interruption style after enough data
  if (profile.feedbackCount > 20) {
    const avgWeight = Object.values(profile.domainWeights).reduce((s, v) => s + v, 0) /
      Math.max(1, Object.values(profile.domainWeights).length);
    profile.interruptionStyle = avgWeight > 0.65 ? 'proactive' : avgWeight > 0.4 ? 'minimal' : 'silent';
  }

  saveMirrorProfile(profile);
  syncToCloud(profile).catch(() => undefined);
}

/** Get domain weight for ranking (higher = show more of this domain) */
export function getDomainWeight(domain: string): number {
  return getMirrorProfile().domainWeights[domain] ?? 0.5; // getMirrorProfile 内已做旧数据迁移
}

/** Best hours to interrupt user (top 8 hours by engagement) */
export function getBestInterruptionHours(): number[] {
  const profile = getMirrorProfile();
  return profile.hourEngagement
    .map((v, h) => ({ h, v }))
    // 🔴#4 并列时按清醒先验决胜(而非索引序),避免全 0.5 时判成凌晨最差窗口。
    .sort((a, b) => (b.v - a.v) || (HOUR_PRIOR[b.h] - HOUR_PRIOR[a.h]))
    .slice(0, 8)
    .map((x) => x.h);
}

/** Sync mirror profile to cloud (best-effort, silent on failure) */
async function syncToCloud(profile: MirrorProfile): Promise<void> {
  try {
    if (!(await hasCloudSession())) return;
    const res = await fetch('/api/cloud/profile-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mirrorProfile: JSON.stringify(profile) }),
    });
    if (!res.ok) return; // not signed in or server error — silent fail
  } catch {
    /* offline or not configured */
  }
}

/** Load mirror profile from cloud on sign-in */
export async function loadMirrorFromCloud(): Promise<void> {
  try {
    if (!(await hasCloudSession())) return;
    const res = await fetch('/api/cloud/profile-settings');
    if (!res.ok) return;
    const data = await res.json() as { settings?: { mirrorProfile?: string } };
    const raw = data?.settings?.mirrorProfile;
    if (!raw) return;
    const cloud = JSON.parse(raw) as MirrorProfile;
    const local = getMirrorProfile();
    // Merge: prefer cloud if it has more data
    if (cloud.feedbackCount > local.feedbackCount) {
      saveMirrorProfile(cloud);
      // 采纳云侧 → 云 blob 里的 domainWeights 副本回灌规范 Preference(真源),否则只换了壳
      if (cloud.domainWeights) seedPreferenceWeights('domain', cloud.domainWeights, { overwrite: true });
    }
  } catch {
    /* offline */
  }
}
