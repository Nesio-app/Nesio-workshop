/**
 * 行为契约:衣橱 Pro 云造型师的服务端钳制(不信模型)。
 * 锁死:pieceIds 只保留衣橱真实存在的 id、去重、封顶;编造的 id 丢弃;
 * reason/tips 截断;tips 封顶 3 条。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../app/api/portal/wardrobe-stylist/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Number, Math, String, Boolean,
    require: (p) => {
      // 只测 clampStylist 纯函数;路由依赖给安全 stub。
      if (p === 'next/server') return { NextResponse: { json: () => ({}) } };
      return {};
    },
  });
  return mod.exports;
}

const M = load();
const valid = new Set(['a', 'b', 'c']);

// 编造 id 丢弃、去重、只留真实 id(跨 realm 用 join 比较,避开原型差异)
{
  const r = M.clampStylist({ pieceIds: ['a', 'a', 'zzz', 'b'], reason: '协调', tips: ['卷袖'] }, valid);
  assert.equal(r.pieceIds.join(','), 'a,b', '去重 + 丢弃编造 id(zzz)');
  assert.equal(r.reason, '协调', 'reason 保留');
  assert.equal(r.tips.length, 1, 'tips 保留');
}

// tips 封顶 3、非字符串忽略
{
  const r = M.clampStylist({ pieceIds: ['c'], reason: '', tips: ['1', '2', '3', '4', 5] }, valid);
  assert.equal(r.tips.length, 3, 'tips 封顶 3');
  assert.equal(r.pieceIds.join(','), 'c', '有效 id');
}

// 垃圾输入 → 空 pieceIds(客户端会回落规则版)
{
  const r = M.clampStylist(null, valid);
  assert.equal(r.pieceIds.length, 0, 'null → 空');
  const r2 = M.clampStylist({ pieceIds: ['x', 'y'] }, valid);
  assert.equal(r2.pieceIds.length, 0, '全是编造 id → 空');
}

console.log('✓ wardrobe-stylist 契约通过');
