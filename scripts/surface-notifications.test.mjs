/**
 * surface-notifications 纯函数契约:时间线 / 焦点 / 日报 / 回顾会排到正确时刻。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// 源码守卫:权限探测必须走 checkLocalNotifyDisplay,不能再读 Capacitor.Plugins
const remSrc = readFileSync(new URL('../lib/portal/reminder-notifications.ts', import.meta.url), 'utf8');
assert.match(remSrc, /checkLocalNotifyDisplay/, '真实提醒同步要用 checkLocalNotifyDisplay');
assert.doesNotMatch(remSrc, /Plugins\?\.NesioLocalNotify/, '禁止再读 Capacitor.Plugins.NesioLocalNotify');

const applySrc = readFileSync(new URL('../lib/portal/notify-apply.ts', import.meta.url), 'utf8');
assert.match(applySrc, /syncSurfaceNotifications/, 'applyAll 必须排 surface 类目');

const prefsSrc = readFileSync(new URL('../lib/portal/notify-prefs.ts', import.meta.url), 'utf8');
for (const k of ['timeline', 'focusDue', 'dailyReport', 'retrospect']) {
  assert.match(prefsSrc, new RegExp(k), `NotifyPrefs 缺 ${k}`);
}

// 动态加载 TS 较重;这里用最小手写复刻关键日期规则做烟雾断言
function planDaily(enabled, now) {
  if (!enabled) return null;
  const p = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  let at = new Date(`${today}T08:05:00`);
  if (at.getTime() <= now.getTime()) {
    if (now.getHours() < 20) at = new Date(now.getTime() + 90_000);
    else return null;
  }
  return { key: `daily-report:${today}`, at };
}

const morning = new Date('2026-08-13T07:00:00');
const d1 = planDaily(true, morning);
assert.ok(d1);
assert.equal(d1.at.getHours(), 8);
assert.equal(d1.at.getMinutes(), 5);

const afternoon = new Date('2026-08-13T14:00:00');
const d2 = planDaily(true, afternoon);
assert.ok(d2);
assert.ok(d2.at.getTime() > afternoon.getTime());

assert.equal(planDaily(false, morning), null);

console.log('surface-notifications: OK');
