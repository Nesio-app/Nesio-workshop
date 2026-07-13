/**
 * 行为契约:多面镜信的键/月份/主题/幂等(纯函数)。
 * 锁死:月-镜-主题三元键、近 n 月降序、存记忆幂等 externalId。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

// mirror-letters.ts 无运行期 import(纯 localStorage 存取)→ 直接 vm。
const src = fs.readFileSync(new URL('../lib/portal/mirror-letters.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports });
const { recentMonthKeys, mirrorLetterKey, MIRROR_TOPICS, currentMonthKey } = mod.exports;

// 三元键
{
  assert.equal(mirrorLetterKey('2026-07', 'jung', 'emotion'), '2026-07:jung:emotion', '月-镜-主题键');
  assert.equal(mirrorLetterKey('2026-07', 'friend'), '2026-07:friend:all', 'topic 默认 all');
}

// 近 n 月降序 + 跨年
{
  const keys = recentMonthKeys(6, new Date(2026, 6, 12)); // 2026-07
  assert.equal(keys.join('|'), '2026-07|2026-06|2026-05|2026-04|2026-03|2026-02', '近 6 月新到旧');
  const cross = recentMonthKeys(3, new Date(2026, 0, 15)); // 2026-01
  assert.equal(cross.join('|'), '2026-01|2025-12|2025-11', '跨年回退正确');
  assert.equal(recentMonthKeys(6)[0], currentMonthKey(), '首项=本月');
}

// 主题集
{
  assert.ok(MIRROR_TOPICS.some((t) => t.id === 'all'), '含全部');
  assert.ok(MIRROR_TOPICS.every((t) => t.id && t.name && t.nameEn), '主题字段齐');
}

// 存记忆幂等 externalId(从 persist 抽小函数,避开其顶层 import)
{
  const psrc = fs.readFileSync(new URL('../lib/portal/mirror-letter-persist.ts', import.meta.url), 'utf8');
  const m = /export function mirrorLetterExternalId\([\s\S]*?\n\}/.exec(psrc);
  assert.ok(m, '定位 mirrorLetterExternalId');
  const fnJs = ts.transpileModule(m[0].replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const sb = {};
  vm.runInNewContext(fnJs + '\nsb.f = mirrorLetterExternalId;', { sb });
  assert.equal(sb.f({ month: '2026-07', mirrorId: 'jung', topic: 'emotion' }), 'mirror-letter-2026-07-jung-emotion', '幂等键含月镜主题');
  assert.equal(sb.f({ month: '2026-06', mirrorId: 'friend', topic: '' }), 'mirror-letter-2026-06-friend-all', '空主题回落 all');
}

console.log('mirror-letter: OK');
