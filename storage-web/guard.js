/* 理智消费 · 购物 App 冷冻 & 提醒 */

const DEFAULT_BLOCKED_APPS = [
  { id: 'taobao', name: '淘宝', emoji: '🛒', enabled: true, tip: '用「分享」把商品丢进冷冻仓' },
  { id: 'jd', name: '京东', emoji: '📦', enabled: true, tip: '结账前先看冷冻仓' },
  { id: 'pdd', name: '拼多多', emoji: '🧧', enabled: true, tip: '拼单前先过 24h' },
  { id: 'xhs', name: '小红书', emoji: '📕', enabled: true, tip: '种草 ≠ 下单' },
  { id: 'amazon', name: 'Amazon', emoji: '🛍️', enabled: false, tip: '' },
  { id: 'shein', name: 'SHEIN', emoji: '👗', enabled: false, tip: '' },
];

function ensureGuard(state) {
  if (!state.guard) {
    state.guard = {
      appsFrozen: false,
      freezeUntil: null,
      freezeHours: 24,
      blockedApps: structuredClone(DEFAULT_BLOCKED_APPS),
      dailyReminder: true,
      reminderHour: 20,
    };
  }
  if (!state.guard.blockedApps?.length) {
    state.guard.blockedApps = structuredClone(DEFAULT_BLOCKED_APPS);
  }
  return state.guard;
}

function isShoppingShieldActive(guard) {
  if (!guard.appsFrozen) return false;
  if (!guard.freezeUntil) return true;
  return Date.now() < guard.freezeUntil;
}

function shoppingShieldRemainMs(guard) {
  if (!guard.freezeUntil) return null;
  return Math.max(0, guard.freezeUntil - Date.now());
}

function formatRemain(ms) {
  if (ms == null) return '持续开启';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function activateShoppingShield(guard, hours) {
  guard.appsFrozen = true;
  guard.freezeHours = hours || 24;
  guard.freezeUntil = Date.now() + guard.freezeHours * 3600000;
}

function deactivateShoppingShield(guard) {
  guard.appsFrozen = false;
  guard.freezeUntil = null;
}

async function scheduleGuardNotifications(guard) {
  const cap = window.Capacitor?.Plugins?.LocalNotifications;
  if (!cap) return;

  try {
    const perm = await cap.requestPermissions();
    if (perm?.display !== 'granted') return;

    await cap.cancel({ notifications: [{ id: 9001 }, { id: 9002 }] });

    const at = new Date();
    at.setHours(guard.reminderHour || 20, 0, 0, 0);
    if (at < new Date()) at.setDate(at.getDate() + 1);

    const notes = [{
      id: 9001,
      title: '🦊 大后方 · 别买提醒',
      body: '打开购物 App 前：先看冷冻仓里有没有同款。',
      schedule: { at, repeats: guard.dailyReminder, every: 'day' },
    }];

    if (guard.appsFrozen && guard.freezeUntil) {
      notes.push({
        id: 9002,
        title: '❄️ 购物冷冻结束',
        body: '24h 已过——仍建议先搜大后方库存再下单。',
        schedule: { at: new Date(guard.freezeUntil) },
      });
    }

    await cap.schedule({ notifications: notes });
  } catch (_) { /* web / denied */ }
}

function openScreenTimeGuide() {
  const msg = 'iOS 无法由 App 直接冻结其他应用。建议：\n\n1. 设置 → 屏幕使用时间 → App 限额\n2. 为淘宝/京东等设每日 0 分钟或「停用时间」\n3. 配合本 App「购物冷冻盾」作心理刹车';
  if (typeof showToast === 'function') showToast('📱 请用屏幕使用时间配合冷冻盾');
  alert(msg);
}
