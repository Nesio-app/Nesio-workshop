/**
 * 行为契约:用户时区源(lib/portal/user-timezone.ts)。
 * DST 感知(夏 -04:00 / 冬 -05:00);跨 UTC 午夜时纽约仍判对「前一天/周几」。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/user-timezone.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Intl, Date, Number, String, Math, Array, Object });
  return mod.exports;
}

const M = load();

// UTC 周六 02:30 = 纽约 周五 22:30(夏令时) —— 关键:不能把它当成周六。
const summer = new Date('2026-07-25T02:30:00Z');
const p = M.userTzParts(summer);
assert.equal(p.year, 2026);
assert.equal(p.month, 7);
assert.equal(p.day, 24, '纽约应是 24 日(周五),不是 UTC 的 25 日');
assert.equal(p.hour, 22);
assert.equal(p.weekdayIndex, 5, '周五 = 5');
assert.equal(M.userTzOffset(summer), '-04:00', '夏令时 -04:00');
assert.equal(M.nowUserTzISO(summer), '2026-07-24T22:30:00-04:00');
assert.equal(M.userTzDayKey(summer), '2026-07-24');

// 冬令时 -05:00
assert.equal(M.userTzOffset(new Date('2026-01-15T12:00:00Z')), '-05:00', '冬令时 -05:00');

console.log('✓ user-timezone 契约通过(DST + 跨午夜判日)');
