/**
 * 学习态跨端银行(批次199 P2)—— 把「被纠偏的 ranker + 学到的偏好」这份用户级 harness
 * 存进账号级云,换机/重装/多端都带得走。这是战略里「②级 harness(抄不走的私有累积)」
 * 真正落袋的那一步 —— 此前它只躺在设备本地 localStorage,换机即蒸发。
 *
 * 为什么不塞进 cloud/memory:记忆节点属性有 2000 字上限 + 类型白名单,装不下训练日志。
 * 通道 = 两跳,全走**现成**端点、零新表零 DDL:
 *   ① 载荷(trainLog + 偏好)→ POST /api/cloud/assets(purpose=learning,按身份隔离,8MB 上限);
 *   ② 短指针 {path,n,at} → profile_settings.learningRef(JSONB,按身份同步,新设备照账号找得到)。
 *
 * 反回归(关键):跨端合并走**无损 union**(importRankerTrainLog 按样本去重回放),不是
 * 「权重 last-write-wins」—— 后者会让陈旧设备把别端更多的学习覆盖掉(回退)。偏好走非覆盖 seed。
 *
 * 免费(P3):durability = 护城河,不查任何付费权益门。best-effort:未登录/未配置/离线静默。
 */
import { createAppApiClient } from './app-api-client';
import { logDropped } from './storage-health';
import {
  exportRankerTrainLog, importRankerTrainLog, rankerTrainCount, type TrainExample,
} from '@/lib/platform/guidance-engine/guidance-ranker';
import { exportPreferenceState, restorePreferenceState } from '@/lib/platform/personalization/preference-store';
import { onFeedback } from '@/lib/platform/personalization/feedback-bus';

interface LearningBlob {
  v: 1;
  at: string;
  trainLog: TrainExample[];
  preference: Record<string, Record<string, number>>;
}
interface LearningRef { path: string; n: number; at: string }

// 刚拉/刚推过的 path,避免同一份反复拉回(union 幂等,但省一趟网络)。
let lastSyncedPath = '';
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 从云回灌学习态并 union 合并进本地。登录态由路由层判断(未登录 → settings.ok=false,静默)。
 */
export async function pullLearningFromCloud(): Promise<{ ok: boolean; merged: number }> {
  if (typeof window === 'undefined') return { ok: false, merged: 0 };
  try {
    const client = createAppApiClient();
    const res = await client.fetchCloudProfileSettings();
    const rawRef = res.ok ? res.settings?.learningRef : undefined;
    if (!rawRef) return { ok: false, merged: 0 };
    let ref: LearningRef;
    try { ref = JSON.parse(rawRef) as LearningRef; } catch { return { ok: false, merged: 0 }; }
    if (!ref?.path || ref.path === lastSyncedPath) return { ok: true, merged: 0 };

    const metaRes = await fetch(`/api/cloud/assets?storagePath=${encodeURIComponent(ref.path)}`, { cache: 'no-store' });
    const meta = (await metaRes.json().catch(() => ({}))) as { ok?: boolean; signedUrl?: string };
    if (!metaRes.ok || !meta.ok || !meta.signedUrl) return { ok: false, merged: 0 };
    const blobRes = await fetch(meta.signedUrl, { cache: 'no-store' });
    if (!blobRes.ok) return { ok: false, merged: 0 };
    let blob: LearningBlob;
    try { blob = JSON.parse(await blobRes.text()) as LearningBlob; } catch { return { ok: false, merged: 0 }; }
    if (!blob || blob.v !== 1) return { ok: false, merged: 0 };

    lastSyncedPath = ref.path;
    const r = importRankerTrainLog(Array.isArray(blob.trainLog) ? blob.trainLog : []);
    restorePreferenceState(blob.preference || {});
    return { ok: true, merged: r.merged };
  } catch (err) {
    logDropped('cloud.learning_pull', err);
    return { ok: false, merged: 0 };
  }
}

/**
 * 把本地学习态(含刚 union 进来的别端样本)推上云:载荷进 assets,指针进 profile_settings。
 */
export async function pushLearningToCloud(): Promise<{ ok: boolean }> {
  if (typeof window === 'undefined') return { ok: false };
  try {
    const trainLog = exportRankerTrainLog();
    const preference = exportPreferenceState();
    if (!trainLog.length && !Object.keys(preference).length) return { ok: false };

    const blob: LearningBlob = { v: 1, at: new Date().toISOString(), trainLog, preference };
    const file = new File([JSON.stringify(blob)], 'nesio-learning.json', { type: 'text/plain' });
    const form = new FormData();
    form.append('file', file);
    form.append('purpose', 'learning');
    const res = await fetch('/api/cloud/assets', { method: 'POST', body: form, cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; storagePath?: string };
    if (!res.ok || !data.ok || !data.storagePath) return { ok: false };

    // 指针写进 profile_settings —— 先读现有设置再合并,别清掉别的设置(displayName/locale…)。
    const client = createAppApiClient();
    const cur = await client.fetchCloudProfileSettings();
    const ref: LearningRef = { path: data.storagePath, n: trainLog.length, at: blob.at };
    // 批次204:检查指针写云是否真成功(和 profile 同款:此前无脑 return ok:true,把
    // learningRef 写失败吞了 —— 这正是学习态跨端在 203 前从没真正工作的原因)。
    const saved = await client.saveCloudProfileSettings({
      ...(cur.ok ? cur.settings : {}),
      learningRef: JSON.stringify(ref),
    });
    if (!saved?.ok || !saved?.writesCloud) return { ok: false };
    lastSyncedPath = data.storagePath; // 自己刚推的,别再拉回
    return { ok: true };
  } catch (err) {
    logDropped('cloud.learning_push', err);
    return { ok: false };
  }
}

/**
 * 登录/回前台时:先拉 union 合并,再把 union 结果推回(让远端累积两端的学习)。
 */
export async function syncLearningWithCloud(): Promise<void> {
  await pullLearningFromCloud();
  if (rankerTrainCount() > 0 || Object.keys(exportPreferenceState()).length > 0) {
    void pushLearningToCloud();
  }
}

/** 反馈后防抖推送(默认 15s)——避免每点一次「有用/错了」就传一趟 assets。 */
export function scheduleLearningPush(delayMs = 15_000): void {
  if (typeof window === 'undefined') return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; void pushLearningToCloud(); }, delayMs);
}

/** 订阅反馈总线:每次纠偏 → 防抖推送。返回注销函数(Portal 登录 effect 里挂/卸)。 */
export function registerLearningAutoPush(): () => void {
  return onFeedback(() => scheduleLearningPush());
}
