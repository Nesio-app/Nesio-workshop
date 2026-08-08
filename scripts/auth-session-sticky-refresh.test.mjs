/**
 * 会话刷新失败不得标成 signed_out(否则前端会 prune 私数据,像隔几分钟登出)。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const session = read('app/api/auth/session/route.ts');
assert.match(session, /status:\s*'session_unverified'/, 'refresh 失败 → session_unverified');
assert.match(session, /hasRefreshToken:\s*true/, 'refresh cookie 仍在时要回传');
assert.match(session, /singleflightRefresh/, 'session 路由走共享 refresh 单飞');
// signed_out 只能在没有 refresh cookie 时
assert.match(session, /hasRefreshToken:\s*false,\s*\n\s*status:\s*'signed_out'/, '真登出才 signed_out');

const runtime = read('lib/portal/cloud-server-runtime.ts');
assert.match(runtime, /singleflightRefresh/, '云 API 走共享 refresh 单飞');

const shared = read('lib/portal/auth/refresh-singleflight.ts');
assert.match(shared, /export function singleflightRefresh/, '共享单飞模块必须存在');
assert.match(shared, /inflight\.get\(refreshToken\)/, '同 token 必须复用 Promise');

const portal = read('components/portal/Portal.tsx');
assert.match(portal, /!data\.loggedIn\s*&&\s*data\.hasRefreshToken/, '前端有 refresh 不踢成游客');
assert.match(portal, /await fetchAuthSessionPayload\(true\)/, '同步前强制刷会话(副作用)');

const moduleSync = read('lib/portal/cloud-module-sync.ts');
assert.match(moduleSync, /module_refuse_empty_push/, '并集模块禁止推空数组上云');

console.log('auth-session-sticky-refresh: OK');
