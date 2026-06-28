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

function defaultMirror(): MirrorProfile {
  return {
    domainWeights: {},
    hourEngagement: Array(24).fill(0.5),
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
    .sort((a, b) => b.v - a.v)
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
