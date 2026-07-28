/**
 * 行为契约:存下来的搭配(lib/portal/wardrobe-outfits.ts)。
 * 不变式 —— 同一天同一套不重复存、排序稳定、按月分组、淘汰只打标不删、入参不可变。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

/** 跨 realm 比数组:只比内容,不比原型。 */
const ids = (arr) => arr.map((o) => o.id).join(',');

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/wardrobe-outfits.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  // 没有 window → 存储那半段走 SSR 分支;纯函数照常可测
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Set, Array, Number, Object, Math, JSON, String, Map, Date });
  return mod.exports;
}
const M = load();

const of = (id, pieceIds, date, at, extra = {}) => ({ id, pieceIds, date, at, ...extra });

// ── outfitKey:顺序无关(同样几件就是同一套) ──
{
  assert.equal(M.outfitKey(['a', 'b', 'c']), M.outfitKey(['c', 'a', 'b']));
  assert.notEqual(M.outfitKey(['a', 'b']), M.outfitKey(['a', 'b', 'c']));
}

// ── 排序:日期新→旧;同日按存入时刻新→旧 ──
{
  const list = [
    of('1', ['a'], '2026-07-20', '2026-07-20T09:00:00Z'),
    of('2', ['b'], '2026-07-28', '2026-07-28T08:00:00Z'),
    of('3', ['c'], '2026-07-28', '2026-07-28T20:00:00Z'),
  ];
  const sorted = M.sortOutfits(list);
  assert.equal(ids(sorted), '3,2,1');
  // 入参不可变
  assert.equal(ids(list), '1,2,3', 'sortOutfits 不该改入参');
}

// ── 按月分组:月份新→旧,月内也新→旧 ──
{
  const list = [
    of('1', ['a'], '2026-06-02', '2026-06-02T09:00:00Z'),
    of('2', ['b'], '2026-07-28', '2026-07-28T08:00:00Z'),
    of('3', ['c'], '2026-07-01', '2026-07-01T08:00:00Z'),
  ];
  const g = M.groupByMonth(list);
  assert.equal(g.map((x) => x.month).join(','), '2026-07,2026-06');
  assert.equal(ids(g[0].items), '2,3', '月内新→旧');
  assert.equal(g[1].items.length, 1);
}

// ── 某一天穿的 ──
{
  const list = [
    of('1', ['a'], '2026-07-28', '2026-07-28T08:00:00Z'),
    of('2', ['b'], '2026-07-28', '2026-07-28T19:00:00Z'),
    of('3', ['c'], '2026-07-27', '2026-07-27T08:00:00Z'),
  ];
  assert.equal(ids(M.outfitsOn(list, '2026-07-28')), '2,1');
  assert.equal(M.outfitsOn(list, '2026-01-01').length, 0);
}

// ── 淘汰:只收 retired 的组合 key ──
{
  const list = [
    of('1', ['a', 'b'], '2026-07-28', 'x', { retired: true }),
    of('2', ['c'], '2026-07-27', 'x', { starred: true }),
  ];
  const keys = M.retiredKeys(list);
  assert.equal(keys.size, 1);
  assert.ok(keys.has(M.outfitKey(['b', 'a'])), '顺序不同也认得出是同一套');
  assert.equal(keys.has(M.outfitKey(['c'])), false, '星标的不算淘汰');
}

// ── upsert:同一天同一套 → 更新,不新增 ──
{
  const base = [of('1', ['a', 'b'], '2026-07-28', '2026-07-28T08:00:00Z')];
  const same = M.upsertOutfit(base, of('9', ['b', 'a'], '2026-07-28', '2026-07-28T20:00:00Z', { starred: true }));
  assert.equal(same.length, 1, '同天同套不新增');
  assert.equal(same[0].id, '1', 'id 保持原来的(引用不断)');
  assert.equal(same[0].starred, true, '新的字段要合并进去');
  // 换一天 → 新增
  assert.equal(M.upsertOutfit(base, of('9', ['a', 'b'], '2026-07-29', 'z')).length, 2);
  // 同一天换一套 → 新增
  assert.equal(M.upsertOutfit(base, of('9', ['a', 'c'], '2026-07-28', 'z')).length, 2);
  // 新的排最前
  assert.equal(M.upsertOutfit(base, of('9', ['x'], '2026-07-29', 'z'))[0].id, '9');
  // 入参不可变
  assert.equal(base.length, 1);
  assert.equal(base[0].starred, undefined, 'upsertOutfit 不该改入参');
}

console.log('wardrobe-outfits: OK');
