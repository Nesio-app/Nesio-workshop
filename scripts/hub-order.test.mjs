/**
 * 行为契约:洞察宫格的自定义顺序(lib/portal/hub-order.ts)。
 *
 * 重点全在「宫格会变」这件事上 —— 存的是一串 key 而不是整张表,所以必须保证:
 * 新加的模块自动出现(不会因为不在我的顺序里就消失)、关掉的模块自动消失(不留空位)。
 * 这两条是把顺序做成「可持久化」时最容易做错的地方。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/hub-order.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  // 没有 window → 存储那半段走 SSR 分支;纯函数照常可测
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Set, Array, JSON, Object, String });
  return mod.exports;
}
const M = load();
const j = (a) => a.join(',');

// ── 没存过:原样 ──
{
  assert.equal(j(M.applyHubOrder(['a', 'b', 'c'], [])), 'a,b,c');
}

// ── 存过的按存的来 ──
{
  assert.equal(j(M.applyHubOrder(['a', 'b', 'c'], ['c', 'a', 'b'])), 'c,a,b');
}

// ── 新模块自动接在后面(不能因为「不在我的顺序里」就消失)──
{
  assert.equal(j(M.applyHubOrder(['a', 'b', 'c', 'newbie'], ['c', 'a', 'b'])), 'c,a,b,newbie');
}

// ── 关掉的模块自动消失,不留空位 ──
{
  assert.equal(j(M.applyHubOrder(['a', 'c'], ['c', 'a', 'b'])), 'c,a');
}

// ── 存档里有重复 key:只认第一次 ──
{
  assert.equal(j(M.applyHubOrder(['a', 'b'], ['b', 'b', 'a'])), 'b,a');
}

// ── 两边都空 / 全新装 ──
{
  assert.equal(j(M.applyHubOrder([], ['a'])), '');
  assert.equal(j(M.applyHubOrder(['a'], [])), 'a');
}

// ── moveItem:拖拽落点 ──
{
  const l = ['a', 'b', 'c', 'd'];
  assert.equal(j(M.moveItem(l, 0, 2)), 'b,c,a,d', '往后拖');
  assert.equal(j(M.moveItem(l, 3, 0)), 'd,a,b,c', '往前拖到头');
  assert.equal(j(M.moveItem(l, 1, 1)), 'a,b,c,d', '原地不动');
  // 越界不许把东西弄丢
  assert.equal(j(M.moveItem(l, -1, 2)), 'a,b,c,d');
  assert.equal(j(M.moveItem(l, 0, 99)), 'a,b,c,d');
  assert.equal(j(M.moveItem(l, 99, 0)), 'a,b,c,d');
  // 入参不可变
  assert.equal(j(l), 'a,b,c,d', 'moveItem 不该改入参');
}

console.log('hub-order: OK');
