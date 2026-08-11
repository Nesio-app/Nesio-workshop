/**
 * 把用户勾选的类目真正排进系统通知。
 * 设置开关此前只要了权限就 return,排程函数从未被叫到。
 */
import { isNativePlatform } from './platform-capabilities';
import { isLocalNotifyEnabled, loadNotifyPrefs, setLocalNotifyEnabled } from './notify-prefs';
import { syncReminderNotifications, type SyncResult } from './reminder-notifications';
import { notifyTeslaLowBattery } from './tesla-low-battery';
import { readTeslaSnapshot } from './tesla-snapshot-store';
import { loadFamilyBoards } from './family-board-store';
import { ensureLocalNotificationPermission, scheduleLocalAt, tombstoneScheduled } from './native-local-notifications';
import { logDropped } from './storage-health';

const CHORE_NOTIFY_STATE_KEY = 'nesio-chore-notify-state-v1';

function loadChoreKeys(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(CHORE_NOTIFY_STATE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function saveChoreKeys(keys: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(CHORE_NOTIFY_STATE_KEY, JSON.stringify(keys)); }
  catch (err) { logDropped('chore-notify.state', err); }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function scheduleFamilyChoreNotifications(zh: boolean): Promise<{ scheduled: number; retired: number }> {
  const boards = loadFamilyBoards();
  const today = todayIso();
  const planned: Array<{ key: string; title: string; body: string; at: Date }> = [];
  for (const b of boards) {
    for (const c of b.myChoresToday || []) {
      if (c.state !== 'todo') continue;
      const due = (c.dueDate || today).slice(0, 10);
      const at = new Date(`${due}T18:00:00`);
      if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) continue;
      const title = (c.title || '').trim() || (zh ? '今天的家务' : "Today's chore");
      planned.push({
        key: `chore:${c.id}:${due}`,
        title,
        body: zh ? '到点了 —— 做完可在今天页勾掉。' : 'Due now — you can tick it off on Today.',
        at,
      });
    }
  }
  const plannedKeys = new Set(planned.map((p) => p.key));
  const previous = loadChoreKeys();
  let retired = 0;
  let scheduled = 0;
  for (const key of previous) {
    if (plannedKeys.has(key)) continue;
    const r = await tombstoneScheduled(key);
    if (r.ok) retired += 1;
  }
  for (const p of planned) {
    const r = await scheduleLocalAt({ key: p.key, title: p.title, body: p.body, at: p.at });
    if (r.ok) scheduled += 1;
  }
  saveChoreKeys([...plannedKeys]);
  return { scheduled, retired };
}

export async function applyAllLocalNotifications(
  opts: { askPermission?: boolean; zh?: boolean } = {},
): Promise<SyncResult> {
  if (typeof window === 'undefined' || !isNativePlatform()) {
    return { ok: false, scheduled: 0, retired: 0, reason: 'not_native' };
  }

  if (opts.askPermission) {
    const granted = await ensureLocalNotificationPermission();
    if (!granted) return { ok: false, scheduled: 0, retired: 0, reason: 'denied' };
    setLocalNotifyEnabled(true);
  }

  if (!isLocalNotifyEnabled()) {
    return { ok: false, scheduled: 0, retired: 0, reason: 'no_permission_ask' };
  }

  const prefs = loadNotifyPrefs();
  const zh = opts.zh !== false;
  let scheduled = 0;
  let retired = 0;

  if (prefs.reminders) {
    const r = await syncReminderNotifications();
    scheduled += r.scheduled;
    retired += r.retired;
    if (!r.ok && r.reason === 'denied') return r;
  }

  if (prefs.teslaLowBatt) {
    const snap = readTeslaSnapshot();
    const rows = (snap?.charges || [])
      .filter((c) => c.batteryLevel != null)
      .map((c) => ({
        vehicleId: c.vehicleId,
        displayName: c.displayName,
        batteryLevel: c.batteryLevel as number,
        chargingState: c.chargingState,
      }));
    await notifyTeslaLowBattery(rows, { zh });
  }

  if (prefs.familyChores) {
    const r = await scheduleFamilyChoreNotifications(zh);
    scheduled += r.scheduled;
    retired += r.retired;
  }

  return { ok: true, scheduled, retired };
}
