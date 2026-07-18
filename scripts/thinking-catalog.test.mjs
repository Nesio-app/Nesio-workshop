/**
 * 行为契约:思维陷阱策展库 + 确定性出题算法(用户定:别随机给 LLM,靠算法)。
 *  1) 库结构完整:每条含 name/category/spot/why/example/domain;逻辑谬误带 principle;
 *  2) buildChallenge 确定性:4 选项、正确项就是该条、干扰项来自库、同 seed 同结果;
 *  3) pickDailyChallenge 日内幂等;trapsMet 子串派生。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Array, Object, JSON, Map, Set, String, Number, Boolean, Date, RegExp, Math });
  return mod.exports;
}
const C = loadTs('../lib/portal/thinking-catalog.ts');

// 1) 库结构
{
  assert.ok(C.THINKING_TRAPS.length >= 30, '至少 30 条陷阱');
  assert.equal(new Set(C.THINKING_TRAPS.map((t) => t.id)).size, C.THINKING_TRAPS.length, 'id 不重复');
  const cats = new Set();
  for (const t of C.THINKING_TRAPS) {
    for (const f of ['name', 'nameEn', 'category', 'spot', 'why', 'example', 'domain']) assert.ok(t[f], `${t.id} 缺 ${f}`);
    assert.ok(C.CATEGORY_ORDER.includes(t.category), `${t.id} 类别合法`);
    if (t.category === 'logic') assert.ok(t.principle, `逻辑谬误 ${t.id} 带违反的规律`);
    cats.add(t.category);
  }
  assert.equal(cats.size, 6, '六类都有条目');
}

// 2) buildChallenge 确定性
{
  const trap = C.trapById('sunk-cost');
  const a = C.buildChallenge(trap, 42), b = C.buildChallenge(trap, 42);
  assert.equal(a.options.length, 4, '4 个选项');
  assert.equal(a.options[a.correctIndex], trap.name, '正确项就是这条陷阱');
  assert.deepEqual(a.options, b.options, '同 seed 同顺序(确定性)');
  const names = new Set(C.THINKING_TRAPS.map((t) => t.name));
  assert.ok(a.options.every((o) => names.has(o)), '干扰项都来自库(不是 LLM 乱给)');
  assert.equal(new Set(a.options).size, 4, '选项不重复');
}

// 3) 日内幂等 + trapsMet
{
  const now = Date.UTC(2026, 6, 18, 12);
  assert.equal(C.pickDailyChallenge(now).trap.id, C.pickDailyChallenge(now + 3600_000).trap.id, '同一天同一题');
  assert.ok(C.trapsMet([{ answer: '这是「沉没成本」' }]).has('sunk-cost'), '答里出现陷阱名 → 遇见');
  assert.equal(C.trapsMet([]).size, 0, '没答过 = 没遇见');
}

console.log('thinking-catalog contract tests passed');
