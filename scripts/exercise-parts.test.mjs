/**
 * 行为契约:动作库左侧部位栏的分类轴(lib/portal/exercise-parts.ts)。
 *
 * 侧栏是「一根轴管两个库」,最容易坏的两件事:
 *   ① 某一项点进去两个库都是空的 —— 用户看到的就是「点了没反应」;
 *   ② 扩展库里有动作**任何一项都翻不到** —— 1324 个动作静悄悄少掉一批。
 * 所以这条测试拿真实的 public/exercise-catalog.json 跑覆盖率,不是拿假数据比对。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/exercise-parts.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Array, Object, Boolean, Set });
  return mod.exports;
}
const M = load();
const catalog = JSON.parse(fs.readFileSync(new URL('../public/exercise-catalog.json', import.meta.url), 'utf8')).exercises;
// 精选库的肌群标签直接从源文件里抠(它是 TS 常量数组,不值得为测试单独 transpile)。
const libSrc = fs.readFileSync(new URL('../lib/portal/exercise-library.ts', import.meta.url), 'utf8');
const KNOWN_MUSCLES = ['glute', 'hip', 'chest', 'shoulder', 'core', 'back'];

// ── 每一项都必须在至少一个库里有货(没有死项)──
{
  for (const p of M.BODY_PARTS) {
    const inCatalog = catalog.filter((e) => M.catalogInPart(e, p.key)).length;
    assert.ok(
      inCatalog > 0 || p.muscles.length > 0,
      `「${p.zh}」两个库都是空的 —— 侧栏不该有点进去空白的项`,
    );
  }
}

// ── 扩展库每个动作都至少能从某一项翻到 ──
{
  const keys = M.BODY_PARTS.map((p) => p.key);
  const orphan = catalog.filter((e) => !keys.some((k) => M.catalogInPart(e, k)));
  assert.equal(
    orphan.length, 0,
    `${orphan.length} 个动作任何部位项都翻不到,例如:${orphan.slice(0, 3).map((e) => `${e.nameZh}(${e.bodyPart}/${e.target})`).join('、')}`,
  );
}

// ── 臀髋 和 腿 不许互相吞(腿曾经是臀的严格超集)──
{
  const glute = new Set(catalog.filter((e) => M.catalogInPart(e, 'glute')).map((e) => e.id));
  const legs = catalog.filter((e) => M.catalogInPart(e, 'legs')).map((e) => e.id);
  assert.ok(glute.size > 0, '臀髋在扩展库里应该有货(靠 target=glutes 捞)');
  assert.ok(legs.length > 0, '腿在扩展库里应该有货');
  assert.equal(legs.filter((id) => glute.has(id)).length, 0, '臀髋和腿不该有重叠动作');
}

// ── 声明的肌群标签必须是精选库真有的(拼错就等于这一项永远筛不到东西)──
{
  for (const p of M.BODY_PARTS) {
    for (const m of p.muscles) {
      assert.ok(KNOWN_MUSCLES.includes(m), `「${p.zh}」写了不存在的肌群标签 ${m}`);
      assert.ok(libSrc.includes(`${m}:`), `MUSCLE_LABEL 里没有 ${m}`);
    }
  }
}

// ── 'all' 一律放行;未知 key 不许把列表筛空(宁可全放,不许白屏)──
{
  assert.equal(catalog.filter((e) => M.catalogInPart(e, 'all')).length, catalog.length);
  assert.equal(catalog.filter((e) => M.catalogInPart(e, 'nonsense')).length, catalog.length);
  assert.equal(M.musclesOfPart('all'), 'all');
  assert.equal(M.musclesOfPart('nonsense'), 'all');
}

// ── 器械轴:同样两条不变量 ──
{
  for (const g of M.EQUIP_AXIS) {
    const n = catalog.filter((e) => M.catalogInEquip(e, g.key)).length;
    assert.ok(n > 0 || g.equips.length > 0, `器械「${g.zh}」两个库都是空的`);
  }
  const keys = M.EQUIP_AXIS.map((g) => g.key);
  const orphan = catalog.filter((e) => !keys.some((k) => M.catalogInEquip(e, k)));
  assert.equal(
    orphan.length, 0,
    `${orphan.length} 个动作的器械没归堆(扩展库新增器械类型时就会红),例如:${[...new Set(orphan.map((e) => e.equipment))].slice(0, 5).join('、')}`,
  );
  // 器械堆之间不许重叠 —— 同一个动作在两个器械 chip 下都出现会让人以为筛选没生效
  const seen = new Map();
  for (const g of M.EQUIP_AXIS) {
    for (const gear of g.gear) {
      assert.ok(!seen.has(gear), `器械 ${gear} 同时归进「${seen.get(gear)}」和「${g.zh}」`);
      seen.set(gear, g.zh);
    }
  }
  const KNOWN_EQUIP = ['bodyweight', 'dumbbell', 'bench', 'wall'];
  for (const g of M.EQUIP_AXIS) {
    for (const e of g.equips) assert.ok(KNOWN_EQUIP.includes(e), `器械「${g.zh}」写了不存在的精选标签 ${e}`);
  }
  assert.equal(catalog.filter((e) => M.catalogInEquip(e, 'nonsense')).length, catalog.length, '未知 key 不许筛空');
  assert.equal(M.equipsOfKey('all'), 'all');
  assert.equal(M.equipsOfKey('nonsense'), 'all');
}

console.log(`exercise-parts: OK(部位 ${M.BODY_PARTS.length} 项 / 器械 ${M.EQUIP_AXIS.length} 项,各自全覆盖扩展库 ${catalog.length} 个动作)`);
