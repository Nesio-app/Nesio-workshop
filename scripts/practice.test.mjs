/**
 * 行为契约:练习场(artifact 59587b8d)。锁死纯逻辑层(不碰 AI/fetch):
 *  1) 24 把利器,5 维分布固定;
 *  2) toolsMet 从回看流按利器名子串派生(答过里出现过 = 遇见);
 *  3) 每日一练静态起手题日内幂等、结构完整(3 选项 + 三段讲解);
 *  4) DIM_ORDER 五维、toolById 收敛。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, console, Array, Object, JSON, Map, Set, String, Number, Boolean, Date, RegExp, Math });
  return mod.exports;
}
const P = loadTs('../lib/portal/practice.ts', (p) => {
  if (p.includes('life-graph')) return { getLifeGraph: () => [] };
  return {};
});

// 1) 24 把 · 5 维分布
{
  assert.equal(P.THINKING_TOOLS.length, 24, '24 把利器');
  const by = {};
  for (const t of P.THINKING_TOOLS) by[t.dim] = (by[t.dim] || 0) + 1;
  assert.deepEqual(by, { emotion: 4, reframe: 4, logic: 6, blind: 6, decide: 4 }, '5 维分布固定');
  assert.equal(new Set(P.THINKING_TOOLS.map((t) => t.id)).size, 24, 'id 不重复');
}

// 2) toolsMet 子串派生
{
  assert.equal(P.toolsMet([]).size, 0, '没答过 = 一个都没遇见');
  const met = P.toolsMet([{ answer: '[认知重构] 以偏概全:两件事推成我这个人失败', question: '这句错在哪' }]);
  assert.ok(met.has('hasty'), '答里出现「以偏概全」→ 遇见 hasty');
  assert.ok(!met.has('gambler'), '没出现的不算遇见');
}

// 3) 每日一练:日内幂等 + 结构完整
{
  const now = Date.UTC(2026, 6, 18, 12);
  const a = P.pickDailyStatic(now), b = P.pickDailyStatic(now + 3600_000);
  assert.equal(a.toolId, b.toolId, '同一天同一题');
  assert.ok(a.options.length === 3 && typeof a.correctIndex === 'number', '3 选项 + 正确下标');
  assert.ok(a.lesson.how && a.lesson.spot && a.lesson.life, '讲解三段齐全');
  assert.ok(P.STATIC_PRACTICES.length >= 3, '至少 3 条静态起手题');
}

// 4) DIM_ORDER + toolById
{
  assert.equal(P.DIM_ORDER.length, 5, '五维');
  assert.ok(P.toolById('gambler') && !P.toolById('nope'), 'toolById 命中/未命中');
}

console.log('practice contract tests passed');
