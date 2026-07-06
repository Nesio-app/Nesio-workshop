/**
 * Mirror Profile — tracks user preferences from feedback signals.
 * Stores locally + syncs to cloud profile when signed in.
 *
 * What it learns:
 * - Which card domains the user acts on vs. dismisses
 * - Best time-of-day for interruptions (from interaction timestamps)
 * - Language/tone preferences
 */

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

export function getMirrorProfile(): MirrorProfile {
  if (typeof window === 'undefined') return defaultMirror();
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    return raw ? (JSON.parse(raw) as MirrorProfile) : defaultMirror();
  } catch {
    return defaultMirror();
  }
}

function saveMirrorProfile(profile: MirrorProfile): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

export function resetMirrorProfile(): void {
  saveMirrorProfile(defaultMirror());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nesio-feedback-recorded'));
  }
}

async function hasCloudSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json() as { loggedIn?: boolean };
    return data.loggedIn === true;
  } catch {
    return false;
  }
}

/** Call this whenever user gives feedback on a card */
export function learnFromFeedback(
  domain: string,
  feedback: 'useful' | 'wrong' | 'not_now' | 'too_much' | undefined,
): void {
  const profile = getMirrorProfile();
  const hour = new Date().getHours();
  const current = profile.domainWeights[domain] ?? 0.5;

  // 🟠#5 抗单调饱和:每次反馈都把所有小时轻微拉回先验(均值回归),没被持续正反馈的时段
  // 会淡出,重度用户不再所有活跃时段一起趋近 1.0、丢失区分度。
  for (let h = 0; h < 24; h++) {
    const prior = 0.35 + 0.2 * HOUR_PRIOR[h];
    profile.hourEngagement[h] += 0.02 * (prior - profile.hourEngagement[h]);
  }

  // Adjust domain weight
  if (feedback === 'useful') {
    profile.domainWeights[domain] = Math.min(1, current + 0.08);
    profile.hourEngagement[hour] = Math.min(1, profile.hourEngagement[hour] + 0.05);
  } else if (feedback === 'wrong') {
    profile.domainWeights[domain] = Math.max(0.1, current - 0.06);
  } else if (feedback === 'too_much') {
    profile.domainWeights[domain] = Math.max(0.05, current - 0.12);
  } else if (feedback === 'not_now') {
    // Just note timing, don't penalize domain heavily
    profile.hourEngagement[hour] = Math.max(0.1, profile.hourEngagement[hour] - 0.03);
  }

  profile.feedbackCount += 1;
  profile.updatedAt = new Date().toISOString();

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
  return getMirrorProfile().domainWeights[domain] ?? 0.5;
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
    }
  } catch {
    /* offline */
  }
}
