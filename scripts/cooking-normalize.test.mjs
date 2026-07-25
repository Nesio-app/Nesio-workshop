/**
 * 行为契约:食材归一化纯核心(lib/cooking/ingredient-normalize.ts)。
 * 焊点不变式 —— 去供应商注解、常备(调料)判定、标准名直命中、菜料别名映射、词表外兜底。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/cooking/ingredient-normalize.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, RegExp, String, Object, Set });
  return mod.exports;
}
const M = load();

// 上层会传入的标准名集合(测试用小集,含真实条目)
const STD = new Set(['猪肉', '里脊肉', '五花肉', '鸡肉', '鸡腿', '虾', '番茄', '马铃薯', '小白菜', '鸡蛋']);
const C = (raw) => M.classifyIngredient(raw, STD);

// ── 去供应商/备注注解 ──
assert.equal(M.stripSupplier('虾滑馄饨（老乡鸡中央厨房）'), '虾滑馄饨', '去成对中文括号注解');
assert.equal(M.stripSupplier('紫菜（阿一波）'), '紫菜');
assert.equal(M.stripSupplier('[老鸡汤]'), '', '整体注解 → 空');
assert.equal(M.stripSupplier('  盐  '), '盐', '去空白');

// ── 常备(调料)判定:不算缺料 ──
for (const [raw, canon] of [['大豆油', '油'], ['熟猪油', '油'], ['白砂糖', '糖'], ['蒜子', '蒜'], ['葱花', '葱'], ['白胡椒粉', '胡椒粉'], ['清水', '水'], ['老鸡汤', '高汤']]) {
  const r = C(raw);
  assert.equal(r.isStaple, true, `${raw} 应判为常备`);
  assert.equal(r.name, canon, `${raw} → 规范名 ${canon}`);
  assert.equal(r.matched, true, `${raw} 常备应算命中`);
}
assert.equal(C('盐').isStaple, true, '规范调料名本身也是常备');
assert.equal(M.isStaple('生抽'), true);
assert.equal(M.isStaple('猪肉'), false, '猪肉不是常备');

// ── 标准名直命中 ──
let r = C('五花肉');
assert.equal(r.matched, true); assert.equal(r.isStaple, false); assert.equal(r.name, '五花肉');

// ── 菜料别名映射 ──
assert.equal(C('猪里脊').name, '里脊肉', '猪里脊 → 里脊肉');
assert.equal(C('猪里脊').isStaple, false);
assert.equal(C('土豆').name, '马铃薯', '土豆 → 马铃薯');
assert.equal(C('西红柿').name, '番茄');
assert.equal(C('基围虾').name, '虾');

// ── 词表外兜底:保留去注解原名、matched=false ──
r = C('老乡鸡秘制酱包（中央厨房）');
assert.equal(r.matched, false, '词表外 → 未命中');
assert.equal(r.name, '老乡鸡秘制酱包', '兜底保留去注解原名');
assert.equal(C('').name, '', '空 → 空');

console.log('cooking-normalize: OK');
