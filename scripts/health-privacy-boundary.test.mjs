/**
 * 行为契约:健康 Signal 不进云镜像(2026-07-29,健康镜头 H1)。
 *
 * 不是隐私洁癖 —— workshop 是自己的实验室,家人健康数据照样该被问一问答出来
 * (「小宝上次血常规怎么样」问不出来才是坏产品)。这条拦的是**数据正确性**:
 *
 *   createSignalWithNode 在浏览器里对每条 Signal 都调 writeCloudSignal。
 *   云端 Signal 表的行级权限(RLS)还没建 —— 健康事实镜像上去就是写进一张
 *   没有行级隔离的表。等 RLS 到位再放开,放开只需要改 isDeviceOnlySignal 一处。
 *
 * 沉默是这件事最坏的地方:漏上云没有任何可见症状,不锁住就不会有人发现。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// 注释里的承诺不是承诺 —— 剥掉再匹配。踩过:文件头注释里正好写着要断言的那句,
// 把真代码删掉测试照样绿。
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const src = code('lib/life-domain/create-signal.ts');

assert.match(src, /export function isDeviceOnlySignal/, 'create-signal 必须导出 isDeviceOnlySignal 闸门');
assert.match(src, /sensitivity\s*===\s*'health'/, "isDeviceOnlySignal 必须认 sensitivity === 'health'");

// 关键:闸门要真的挂在云镜像那一行上。定义了放着 = 没装上。
assert.match(
  src,
  /signalWriteMode\(\)\s*===\s*'cloud_mirror_pending'\s*&&\s*!isDeviceOnlySignal\(/,
  '云镜像那一行没接上 isDeviceOnlySignal —— 闸门定义了但没装上,健康数据照样上云',
);

// 健康信号确实会被标成 health(否则上面那道闸门永远不触发,等于摆设)。
const hs = code('lib/health/health-signals.ts');
assert.match(hs, /sensitivity:\s*'health'/, '健康 Signal 没标 sensitivity: health,云镜像闸门就拦不到它');

console.log('health-privacy-boundary: OK(健康 Signal 不进云镜像 —— RLS 到位前)');
