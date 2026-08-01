/**
 * single-session-source —— **「我登录了吗」只许有一个答案。**
 *
 * ## 病灶,以及它为什么复发过一次
 *
 * 第一次(2026-07-30,bug #21):设置 → 数据与隐私,顶上写「已登录 · 云同步已开」,
 * 旁边说明气泡里写「未登录、未授权」。同一屏两个相反的事实。
 * 病根不在文案 —— 在**同一个问题被六处各问一遍**,每处各自 fetch、
 * 各自定义失败怎么办、默认值还不一样。有一路慢了或抖一下,屏幕上就矛盾了。
 * 当时建了 `lib/portal/session-state.ts` 作为唯一答案。
 *
 * 第二次(2026-07-31,用户报「设置的登录状态也在变」):复查发现**还剩三处没并进去** ——
 * Portal / PortalOnboarding / mirror-profile。理由还挺正当:它们要
 * `hasRefreshToken` / `authReady` / `profileBootstrapBlocking` 这些字段,
 * 而当时的单例只回 `state + email`,装不下。
 *
 * 于是「唯一答案」只统一了一半,而且**没有任何东西拦着它退回去**。
 * 修法是让单例缓存整个 payload;这道守卫是为了让它别再有第三次。
 *
 * ## 判据
 *
 * 除 `lib/portal/session-state.ts` 自己之外,任何文件都不许直接请求
 * `/api/auth/session`。要登录态就走 `readSession()` / `useSessionState()`。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** 唯一允许直接打那个端点的地方 —— 单例自己。 */
const SOLE_OWNER = 'lib/portal/session-state.ts';

/**
 * 服务端路由不算:它们是**实现**这个端点的,不是**消费**它的。
 * (`app/api/auth/session/route.ts` 自己当然会出现这个串。)
 */
const SERVER_PREFIXES = ['app/api/', 'middleware.ts'];

const offenders = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.tsx?$/.test(e.name)) continue;
    const rel = path.relative(ROOT, p);
    if (rel === SOLE_OWNER) continue;
    if (SERVER_PREFIXES.some((pre) => rel.startsWith(pre))) continue;

    // 剥注释再判 —— 这份文件里到处在解释这个端点,不剥的话
    // 讲解本身会把判据判红(strip-comments 那次的教训)。
    const src = stripComments(fs.readFileSync(p, 'utf8'));
    // 判的是**发请求**,不是提到这个串:必须是 fetch(...) 的实参。
    if (/fetch\(\s*['"`][^'"`]*\/api\/auth\/session/.test(src)) offenders.push(rel);
  }
}
walk(path.join(ROOT, 'lib'));
walk(path.join(ROOT, 'components'));
walk(path.join(ROOT, 'app'));

assert.deepEqual(
  offenders.sort(), [],
  `这些地方在自己请求 /api/auth/session:${offenders.join(', ')}\n`
  + `  → 登录态只有一个来源:${SOLE_OWNER}。用 readSession() 或 useSessionState()。\n`
  + '    自己 fetch 的后果不是多打一趟请求,是**屏幕上出现两个互相矛盾的登录态** ——\n'
  + '    各自在不同时刻回来、各自 setState,而两边都言之凿凿。\n'
  + '    要额外字段(hasRefreshToken / authReady / …)就读 SessionInfo.payload,\n'
  + '    单例把整个响应原样缓存着。',
);

// 判据自检:单例本身必须真的在请求那个端点 —— 否则上面那条断言在一个
// 谁都不发请求的世界里恒绿,而登录态其实已经从别的地方漏出去了。
const owner = stripComments(fs.readFileSync(path.join(ROOT, SOLE_OWNER), 'utf8'));
assert.match(
  owner, /fetch\(\s*['"`][^'"`]*\/api\/auth\/session/,
  `${SOLE_OWNER} 里找不到对 /api/auth/session 的请求 —— 判据大概率失效了`,
);

console.log('single-session-source: OK(登录态只有 lib/portal/session-state.ts 一个来源)');
