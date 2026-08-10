/**
 * pickTeslaCoords + 低电量阈值契约。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const teslaSrc = fs.readFileSync(new URL('../lib/portal/tesla.ts', import.meta.url), 'utf8');
assert.match(teslaSrc, /native_latitude/, '坐标要退 native_*');
assert.match(teslaSrc, /wake_up/, '休眠车要能唤醒再读位置');
assert.match(teslaSrc, /locationHint/, '没坐标时要区分 scope/asleep/unknown');
assert.match(teslaSrc, /function pickTeslaCoords/, '导出/定义 pickTeslaCoords');

const panel = fs.readFileSync(new URL('../components/portal/TeslaPanel.tsx', import.meta.url), 'utf8');
assert.ok(!panel.includes('位置没授权'), '不许再一律说「位置没授权」');
assert.match(panel, /locationHint === 'scope'/, '真缺 scope 才提示重连');
assert.match(panel, /reverseGeocode/, '地名反解先走客户端');
assert.match(panel, /notifyTeslaLowBattery|listLowBatteryVehicles/, '低电量提醒');

const lowSrc = fs.readFileSync(new URL('../lib/portal/tesla-low-battery.ts', import.meta.url), 'utf8');
assert.match(lowSrc, /TESLA_LOW_BATTERY_PCT = 40/, '低于 40% 提醒');

const route = fs.readFileSync(new URL('../app/api/portal/tesla/route.ts', import.meta.url), 'utf8');
assert.match(route, /locationHint/, 'API 要把 locationHint 传给前端');
assert.match(route, /tokenScope/, '采集时带上 token scope');

console.log('tesla-location-fix: OK');
