/**
 * 行为契约:菜谱用量按人数缩放(lib/cooking/scale-recipe.ts)。
 *
 * 这条测试的重点不是「会不会乘」,是「**不该缩的有没有被缩**」——
 * 菜谱正文里数字遍地都是,把「小火 3 分钟」缩成「1.5 分钟」、把「180°C」缩成「90°C」
 * 比不缩糟得多。所以反向断言(时间/温度/次数原样)比正向断言更重要。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/cooking/scale-recipe.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Number, Math, String, RegExp, Array, Object });
  return mod.exports;
}
const M = load();

// ── 正向:用量确实跟着缩 ──
{
  assert.equal(M.scaleAmountsInText('胡萝卜 300 克', 0.5), '胡萝卜 150 克');
  assert.equal(M.scaleAmountsInText('高汤 500ml', 0.5), '高汤 250 ml');
  assert.equal(M.scaleAmountsInText('鸡蛋 4 个', 0.5), '鸡蛋 2 个');
  assert.equal(M.scaleAmountsInText('盐 2 茶匙', 0.5), '盐 1 茶匙');
  // 放大也要对
  assert.equal(M.scaleAmountsInText('米 200g', 2), '米 400 g');
}

// ── 反向(这条最要紧):时间 / 温度 / 次数 / 火候 一个都不许动 ──
{
  const keep = [
    '小火煨煮 15 分钟',
    '中火 3 分钟后翻面',
    '烤箱 180°C 预热',
    '油温六成热',
    '分 2 次下锅',
    '切成 3 段',
    '静置 30 秒',
    '焯水 1 小时',
  ];
  for (const line of keep) {
    assert.equal(M.scaleAmountsInText(line, 0.5), line, `不该缩:「${line}」`);
  }
}

// ── 混排:同一句里既有用量又有时间,只缩前者 ──
{
  assert.equal(
    M.scaleAmountsInText('放 400 克胡萝卜,小火煮 15 分钟', 0.5),
    '放 200 克胡萝卜,小火煮 15 分钟',
  );
}

// ── 长单位不被短单位吃掉(千克 ≠ 克) ──
{
  assert.equal(M.scaleAmountsInText('猪肉 2 千克', 0.5), '猪肉 1 千克');
}

// ── factor 无意义时原样返回,不做无谓改写 ──
{
  const t = '胡萝卜 300 克';
  assert.equal(M.scaleAmountsInText(t, 1), t, 'factor=1 不改写');
  assert.equal(M.scaleAmountsInText(t, 0), t, 'factor=0 不改写');
  assert.equal(M.scaleAmountsInText(t, -1), t, '负数不改写');
  assert.equal(M.scaleAmountsInText('', 0.5), '');
}

// ── 数字可读:不出现 0 克,也不出现一长串小数 ──
{
  assert.equal(M.prettyAmount(150), '150');
  assert.equal(M.prettyAmount(2.04), '2');
  assert.equal(M.prettyAmount(2.06), '2.1');
  assert.equal(M.prettyAmount(0.02), '0.1', '极小值托到 0.1,不能写成 0 克');
  assert.equal(M.prettyAmount(0), '0');
}

// ── servingFactor:两边都夹在合理区间 ──
{
  assert.equal(M.servingFactor(2, 4), 0.5);
  assert.equal(M.servingFactor(4, 4), 1);
  assert.equal(M.servingFactor(0, 4), 0.25, '人数至少 1');
  assert.equal(M.servingFactor(99, 4), 3, '人数封顶 12');
  assert.equal(M.servingFactor(2, 0), 2, '原份数至少 1');
}

console.log('cooking-scale-recipe: OK');
