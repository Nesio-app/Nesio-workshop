/**
 * 行为契约:被遗忘权(数据审计 #5/#6)。
 * 锁死(源断言 —— 全链路运行时难以在 vm 里跑通,锁关键不变量防回归):
 *  - 账号删除覆盖 signals(主数据原子,之前漏删)+ 原有 6 表,物理 DELETE。
 *  - 账号删除设备级擦除匿名遥测(按客户端上报的 device_id 删 telemetry_events)。
 *  - 账号删除删本体 auth.users(仅 supabase 真实 userId),FK cascade 兜残留。
 *  - 客户端删除时上报本机 telemetry device_id。
 *  - telemetry.ts 暴露只读 getTelemetryDeviceId(不创建新 id)。
 *  - GC SQL:软删墓碑过宽限期物理清理(4 表)+ 遥测 TTL,仅 service_role 可执行。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 删除路由 ──
const del = read('../app/api/user-data/delete/route.ts');
assert.match(del, /CLOUD_PRODUCT_DATA_TABLES\s*=\s*\[[^\]]*'signals'/, 'signals 必须在账号删除表集合里');
assert.match(del, /signals:\s*'\/rest\/v1\/signals'/, 'signals REST 路径已登记');
// 六个原有表仍在
for (const t of ['user_profiles', 'profile_settings', 'memory_nodes', 'memory_edges', 'memory_assets', 'product_events']) {
  assert.ok(del.includes(`'${t}'`), `${t} 仍在删除集合`);
}
// 遥测设备级擦除
assert.match(del, /telemetry_events/, '删除路由触及 telemetry_events');
assert.match(del, /device_id.*in\.\(/s, '按 device_id in.() 批量删遥测');
assert.match(del, /function sanitizeDeviceIds/, 'device_id 入参消毒');
assert.match(del, /\/\^\[A-Za-z0-9_-\]\{1,80\}\$\//, 'device_id 限制字符集');
// auth.users 本体删除
assert.match(del, /\/auth\/v1\/admin\/users\//, '删 auth.users 本体');
assert.match(del, /provider === 'supabase' && cloudIdentity\.userId/, '仅 supabase 真实 userId 删本体');
assert.match(del, /telemetryDeletedCount/, '响应含遥测删除计数');
assert.match(del, /authUserDeleted/, '响应含本体删除标记');

// ── 客户端上报 device_id ──
const settings = read('../components/portal/SettingsSheets.tsx');
assert.match(settings, /getTelemetryDeviceId/, '客户端读取本机 telemetry device id');
assert.match(settings, /deviceIds:\s*telemetryDeviceId\s*\?/, '删除请求体带 deviceIds');

// ── telemetry 只读 getter ──
const tel = read('../lib/portal/telemetry.ts');
assert.match(tel, /export function getTelemetryDeviceId\(\)/, '暴露只读 getTelemetryDeviceId');
// 只读:getter 里不写 localStorage(不创建新 id)
const getterBody = tel.slice(tel.indexOf('export function getTelemetryDeviceId'), tel.indexOf('function send'));
assert.ok(!/setItem/.test(getterBody), 'getTelemetryDeviceId 不创建新 id(不 setItem)');

// ── GC SQL ──
const gc = read('../database/schema/supabase-retention-gc-v1.sql');
assert.match(gc, /nesio_gc_soft_deleted/, '软删 GC 函数');
for (const t of ['signals', 'memory_nodes', 'memory_edges', 'memory_assets']) {
  assert.ok(new RegExp(`DELETE FROM public\\.${t}\\b`).test(gc), `软删 GC 物理删 ${t}`);
}
assert.match(gc, /deleted_at IS NOT NULL AND deleted_at < cutoff/, '仅删过宽限期的墓碑');
assert.match(gc, /nesio_gc_telemetry/, '遥测 TTL 函数');
assert.match(gc, /DELETE FROM public\.telemetry_events WHERE at < now\(\) - keep/, '遥测按 TTL 删');
assert.match(gc, /GRANT EXECUTE ON FUNCTION public\.nesio_gc_soft_deleted\(interval\) TO service_role/, '仅 service_role 可跑 GC');
assert.match(gc, /REVOKE ALL ON FUNCTION public\.nesio_gc_soft_deleted\(interval\) FROM public, anon, authenticated/, 'GC 对普通角色收权');

console.log('forgotten-right: OK');
