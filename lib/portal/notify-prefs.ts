/**
 * 系统通知类目开关 —— 用户原话「app 不知道哪些需要 push 系统通知」。
 * 权限是设备态;类目选择跟人走(durable / module-sync)。
 */
import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';

export const LOCAL_NOTIFY_ENABLED_KEY = 'nesio-local-notify-enabled-v1';
export const NOTIFY_PREFS_KEY = 'nesio-notify-prefs-v1';
export const NOTIFY_PREFS_UPDATED = 'nesio-notify-prefs-updated';

export type NotifyPrefs = {
  /** 自己设的提醒(家务/账单/约会)→ 到点系统通知 */
  reminders: boolean;
  /** Tesla 电量低于 40% */
  teslaLowBatt: boolean;
  /** 家庭家务板今天待办 */
  familyChores: boolean;
};

const DEFAULTS: NotifyPrefs = { reminders: true, teslaLowBatt: true, familyChores: true };

const prefsStore = createBlobStore<NotifyPrefs>({
  key: NOTIFY_PREFS_KEY,
  updateEvent: NOTIFY_PREFS_UPDATED,
  validate: (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v)),
  onWriteError: reportStorageDropped,
});

export function isLocalNotifyEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(LOCAL_NOTIFY_ENABLED_KEY) === '1';
}

export function setLocalNotifyEnabled(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (on) localStorage.setItem(LOCAL_NOTIFY_ENABLED_KEY, '1');
    else localStorage.removeItem(LOCAL_NOTIFY_ENABLED_KEY);
  } catch {
    reportStorageDropped();
  }
}

export function loadNotifyPrefs(): NotifyPrefs {
  const v = prefsStore.load();
  if (!v) return { ...DEFAULTS };
  return {
    reminders: v.reminders !== false,
    teslaLowBatt: v.teslaLowBatt !== false,
    familyChores: v.familyChores !== false,
  };
}

export function saveNotifyPrefs(patch: Partial<NotifyPrefs>): NotifyPrefs {
  const next = { ...loadNotifyPrefs(), ...patch };
  prefsStore.save(next);
  return next;
}
