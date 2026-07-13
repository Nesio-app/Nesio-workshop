/**
 * 行为契约:足迹成就卡数据(原创分享卡)。
 * 锁死:国家→洲映射 · 覆盖世界% · 最长连续天数 · 离家最远地点 · 点阵地图陆地格
 * · 到过的洲高亮集合。纯本机推导,分享的是过去·聚合,不含实时定位。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
const mod = { exports: {} };
vm.runInNewContext(compile('../lib/portal/places-share.ts'), {
  module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, Set, Map, Intl,
  window: undefined, document: undefined,
  require: () => ({}),
});
const ps = mod.exports;

// ── 国家 → 洲 ──
assert.equal(ps.countryContinent('冰岛'), 'EU', '冰岛=欧洲');
assert.equal(ps.countryContinent('Japan'), 'AS', 'Japan=Asia');
assert.equal(ps.countryContinent('Australia'), 'OC', '澳大利亚=大洋洲');
assert.equal(ps.countryContinent('Brazil'), 'SA', 'Brazil=南美');
assert.equal(ps.countryContinent('火星国'), null, '未知国=null');

// ── 点阵地图陆地格:六洲都有格,坐标在网格内 ──
const cells = ps.worldDotCells();
assert.ok(cells.length > 80, '陆地格足够多');
const conts = new Set(cells.map((c) => c.continent));
for (const k of ['NA', 'SA', 'EU', 'AF', 'AS', 'OC']) assert.ok(conts.has(k), `点阵含 ${k}`);
assert.ok(cells.every((c) => c.col >= 0 && c.col < ps.WORLD_GRID.w && c.row >= 0 && c.row < ps.WORLD_GRID.h), '格坐标在网格内');

// ── 统计:多国多洲 + 覆盖% ──
const visits = [
  { ts: '2023-03-01T10:00:00Z', label: '家 · 上海', lat: 31.23, lon: 121.47, source: 'live' },
  { ts: '2023-03-02T10:00:00Z', label: '外滩', lat: 31.24, lon: 121.49, source: 'live' },
  { ts: '2023-03-03T10:00:00Z', label: '东京塔', lat: 35.66, lon: 139.74, source: 'live' },
  { ts: '2024-07-10T10:00:00Z', label: 'Reykjavík', lat: 64.15, lon: -21.94, source: 'import' },
];
const countryNames = ['中国', '日本', '冰岛'];
const stats = ps.computePlacesShareStats(visits, countryNames, new Date('2026-07-13T00:00:00Z'));

assert.equal(stats.countries, 3, '3 国');
// 中国+日本=亚洲,冰岛=欧洲 → 2 洲
assert.equal(stats.continents, 2, '亚 + 欧 = 2 洲');
assert.deepEqual([...stats.visitedContinents].sort(), ['AS', 'EU'], '到过亚洲+欧洲');
assert.equal(stats.year, 2023, '最早到访年 = 2023');
assert.ok(stats.worldPct >= 1, '覆盖% 至少 1');
assert.equal(stats.worldPct, Math.round((3 / 195) * 100) || 1, '覆盖% = round(3/195*100) 兜底 1');

// ── 最远地点:离家(上海最密)最远 = 冰岛 Reykjavík ──
assert.ok(stats.furthest, '有最远地点');
assert.equal(stats.furthest.name, 'Reykjavík', '最远 = Reykjavík');
assert.ok(stats.furthest.km > 8000, '上海→冰岛 > 8000km');

// ── 连续天数:3/1,3/2,3/3 连续三天 = 3 ──
assert.equal(stats.dayStreak, 3, '连续三天');

// ── 数据不足:单点无最远 ──
const one = ps.computePlacesShareStats([{ ts: '2025-01-01T00:00:00Z', label: 'X', lat: 1, lon: 1, source: 'live' }], ['中国'], new Date('2026-01-01'));
assert.equal(one.furthest, null, '单点无最远');
assert.equal(one.countries, 1, '1 国');

console.log('places-share: OK');
