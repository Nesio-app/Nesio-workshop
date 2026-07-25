/**
 * 行为契约:做饭/库存确定性核心(lib/cooking/pantry-core.ts)。
 * 钉死 M1 不变式 —— 用掉判定(扣1/用光删)、距到期天数、快过期过滤与排序、库存排序稳定。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/cooking/pantry-core.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, Number, String, Math, Array, Object });
  return mod.exports;
}

const M = load();
const item = (over) => ({ id: 'x', name: '牛奶', quantity: null, expiry: null, location: '', category: '', daysLeft: null, ...over });

// ── 用掉一份判定(跨 vm realm,逐字段断言避免原型不等) ──
const dec = (q) => M.consumeDecision(q);
assert.equal(dec(3).remove, false); assert.equal(dec(3).nextQty, 2); // 数量>1 应扣 1
assert.equal(dec(2).nextQty, 1, '2 → 扣到 1');
assert.equal(dec(1).remove, true, '只剩 1 → 用光删除');
assert.equal(dec(null).remove, true, '不计数 → 用光删除');
assert.equal(dec(0).remove, true, '0/异常 → 删除');

// ── 距到期天数(固定 now = 2026-07-25) ──
const now = new Date(2026, 6, 25, 13, 0, 0); // 月份 0 基:6=七月
assert.equal(M.daysLeftOf(null, now), null, '无效期 → null');
assert.equal(M.daysLeftOf('2026-07-25', now), 0, '今天到期 → 0');
assert.equal(M.daysLeftOf('2026-07-26', now), 1, '明天 → 1');
assert.equal(M.daysLeftOf('2026-07-22', now), -3, '三天前过期 → -3');
assert.equal(M.daysLeftOf('not-a-date', now), null, '烂字符串 → null');

// ── 快过期过滤 + 排序(≤days,最早在前,排除无效期) ──
const items = [
  item({ id: 'a', name: '菠菜', daysLeft: 3 }),
  item({ id: 'b', name: '鸡蛋', daysLeft: -1 }),
  item({ id: 'c', name: '面条', daysLeft: null }),
  item({ id: 'd', name: '酸奶', daysLeft: 1 }),
  item({ id: 'e', name: '大米', daysLeft: 30 }),
];
const soon = M.expiringPantry(items, 4);
assert.equal(soon.map((i) => i.id).join(','), 'b,d,a', '快过期:≤4 天且按 daysLeft 升序,无效期不进');
assert.ok(!soon.some((i) => i.daysLeft == null), '无效期项不应出现在快过期');

// ── 库存排序:有效期者优先且早到期在前;都无效期按名字 ──
const sorted = M.sortPantry(items);
assert.equal(sorted[0].id, 'b', '最早到期(-1)排最前');
assert.equal(sorted[sorted.length - 1].id, 'c', '无效期(面条)排最后');
// 纯函数:不改原数组
assert.equal(items[0].id, 'a', 'sortPantry 不得就地改原数组');

// 两个都无效期按中文名
const noExp = M.sortPantry([item({ id: '1', name: '盐', daysLeft: null }), item({ id: '2', name: '油', daysLeft: null })]);
assert.equal(noExp.length, 2, '都无效期也应返回全部');

// ── 分类表 ──
assert.ok(Array.isArray(M.PANTRY_CATEGORIES) && M.PANTRY_CATEGORIES.includes('蔬菜'), '分类表应含「蔬菜」');

console.log('cooking-pantry-core: OK');
