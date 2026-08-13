/**
 * 把用户勾选的类目真正排进系统通知。
 * 设置开关此前只要了权限就 return,排程函数从未被叫到。
 */
import { isNativePlatform } from './platform-capabilities';
import { hasLocalNotifyChoice, isLocalNotifyEnabled, loadNotifyPrefs, setLocalNotifyEnabled } from './notify-prefs';
import { syncReminderNotifications, type SyncResult } from './reminder-notifications';
import { syncSurfaceNotifications } from './surface-notifications';
import { notifyTeslaLowBattery } from './tesla-low-battery';
import { readTeslaSnapshot } from './tesla-snapshot-store';
import { loadFamilyBoards } from './family-board-store';
import {
  checkLocalNotifyDisplay,
  ensureLocalNotificationPermission,
  scheduleLocalAlert,
  scheduleLocalAt,
  tombstoneScheduled,
} from './native-local-notifications';
import { logDropped } from './storage-health';

export const LOCAL_NOTIFY_WELCOMED_KEY = 'nesio-local-notify-welcomed-v1';

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
      if (!Number.isFinite(at.getTime())) continue;
      // 今天还没做、已经过了 18:00 → 90 秒后响一次,别等明天。
      if (at.getTime() <= Date.now()) {
        if (due !== today) continue;
        at.setTime(Date.now() + 90_000);
      }
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
  opts: { askPermission?: boolean; zh?: boolean; welcomePing?: boolean } = {},
): Promise<SyncResult> {
  if (typeof window === 'undefined' || !isNativePlatform()) {
    return { ok: false, scheduled: 0, retired: 0, reason: 'not_native' };
  }

  const display = await checkLocalNotifyDisplay();
  if (display === 'missing') {
    return { ok: false, scheduled: 0, retired: 0, reason: 'plugin_missing' };
  }

  if (opts.askPermission) {
    const granted = await ensureLocalNotificationPermission();
    if (!granted) return { ok: false, scheduled: 0, retired: 0, reason: 'denied' };
    setLocalNotifyEnabled(true);
  } else if (!hasLocalNotifyChoice() && display === 'granted') {
    // iOS 设置里已经开了通知,App 内开关从未点过 → 当作已开,立刻排程。
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

  {
    const r = await syncSurfaceNotifications({
      timeline: prefs.timeline,
      focusDue: prefs.focusDue,
      dailyReport: prefs.dailyReport,
      retrospect: prefs.retrospect,
    });
    scheduled += r.scheduled;
    retired += r.retired;
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

  if (opts.welcomePing) {
    try {
      if (localStorage.getItem(LOCAL_NOTIFY_WELCOMED_KEY) !== '1') {
        const ping = await scheduleLocalAlert({
          title: zh ? '通知已接通' : 'Notifications on',
          body: zh
            ? '提醒、时间线日程、焦点到期、日报、回顾、家务和车会在到点时响。可在设置里关掉某一类。'
            : 'Reminders, timeline events, due focus, daily report, retrospect, chores, and the car will ring when due. Turn a category off in Settings.',
          afterSec: 3,
          id: 710_001,
        });
        if (ping.ok) localStorage.setItem(LOCAL_NOTIFY_WELCOMED_KEY, '1');
      }
    } catch (err) {
      logDropped('local-notify.welcome', err);
    }
  }

  return { ok: true, scheduled, retired };
}
