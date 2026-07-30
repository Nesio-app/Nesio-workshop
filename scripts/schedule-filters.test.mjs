/**
 * 行为契约:日程页的一排筛选标签(2026-07-30 用户要求
 *「用谷歌的 filter 先筛选,我也可以自定义」)。
 *
 * 这类功能最容易犯的两个错,都钉死:
 *   ① **空标签** —— 给一个点下去筛出 0 条的标签,比没有这个标签更糟:
 *      用户会以为数据没了。所以 Google 标签必须从**当前数据**里长出来,
 *      数据里没有的分类不给标签。
 *   ② **自定义标签被藏起来** —— 反过来,用户亲手建的标签哪怕这会儿命中 0 条也要留着
 *      (写 0),否则他会以为自己建的东西丢了。
 * 另外钉:匹配规则必须是**可预测**的(字面包含,大小写不敏感),
 * 不做隐式语义匹配 —— 那是这个仓库反复踩坑的地方。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    // 只要纯判定那几个函数;存储层给个哑实现,免得为了单测把纯逻辑和 IDB 绑在一起。
    require: (id) => (String(id).includes('idb-blob-store')
      ? { createBlobStore: () => ({ load: () => [], save: () => {}, ready: () => Promise.resolve() }) }
      : {}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp,
  });
  return mod.exports;
}

const { buildChips, matchesChip, matchesCustom } = loadTs('../lib/portal/schedule-filters.ts');

const row = (title, meta, labels) => ({ title, meta, googleLabels: labels });

// ── ① Google 标签只从当前数据长出来,且都筛得出东西 ──
{
  const rows = [
    row('ADE PROD Install', 'zoom.us', ['工作']),
    row('Church camp pick', 'Janice', ['家庭']),
    row('Sea Cadets', 'Online', ['家庭']),
  ];
  const chips = buildChips(rows, []);
  const google = chips.filter((c) => c.kind === 'google');
  // 注意:被测模块跑在 vm 的独立 realm 里,它造的数组 prototype 与本文件的不同 ——
  // assert.deepEqual 会因为 prototype 不同而失败(内容明明一样)。本仓库其它契约
  // 也是因此改用 join 比较,这里照做。
  assert.equal(google.map((c) => c.label).join(','), '家庭,工作', '按命中数从多到少');
  for (const c of google) {
    assert.ok(c.count > 0, `「${c.label}」是空标签 —— 点下去筛出 0 条,用户会以为数据丢了`);
    assert.equal(rows.filter((r) => matchesChip(r, c)).length, c.count, '标签上的数字必须等于真筛出来的条数');
  }
  // 不变量(比「不许出现广告」更强):**每一个** Google 标签都必须在数据里真出现过。
  // 这样无论实现怎么写(写死一张分类表 / 忘了过滤 0 命中),越界都会被抓住。
  const present = new Set(rows.flatMap((r) => r.googleLabels));
  for (const c of google) {
    assert.ok(present.has(c.id), `「${c.label}」在当前数据里根本不存在 —— 凭空长出来的标签点下去必然 0 条`);
  }
}

// ── ② 用户自建的标签:命中 0 也要留着(写 0),不许悄悄藏 ──
{
  const rows = [row('Church camp pick', 'Janice', ['家庭'])];
  const customs = [
    { id: 'c1', name: '孩子学校', keyword: 'camp', createdAt: '2026-07-30T00:00:00Z' },
    { id: 'c2', name: '报税', keyword: 'tax', createdAt: '2026-07-30T00:00:00Z' },
  ];
  const chips = buildChips(rows, customs);
  const mine = chips.filter((c) => c.kind === 'custom');
  assert.equal(mine.length, 2, '用户亲手建的标签不许因为暂时命中 0 条就被藏起来');
  assert.equal(mine.find((c) => c.id === 'c1').count, 1);
  assert.equal(mine.find((c) => c.id === 'c2').count, 0, '命中 0 要如实写 0,不是消失');
  // 自定义排在 Google 之后(用户自己的次序在后面,系统的先看)
  assert.equal(chips[0].kind, 'google');
}

// ── ③ 匹配规则可预测:字面包含 · 标题或副行 · 大小写不敏感 ──
{
  assert.ok(matchesCustom(row('Church CAMP pick', 'Janice', []), 'camp'), '大小写不敏感');
  assert.ok(matchesCustom(row('咨询', 'Janice', []), 'janice'), '副行(发件人/地点)也算');
  assert.ok(!matchesCustom(row('Church camp', 'Janice', []), 'school'), '不做同义/语义匹配 —— 它必须是可预测的字面包含');
  assert.ok(!matchesCustom(row('anything', 'x', []), '   '), '空关键词不匹配任何东西(否则等于全选)');
}

// ── ④ google 标签按 id 精确比,不做包含 ──
{
  const r = row('x', 'y', ['家庭']);
  assert.ok(matchesChip(r, { kind: 'google', id: '家庭', label: '家庭', count: 1 }));
  assert.ok(!matchesChip(r, { kind: 'google', id: '家', label: '家', count: 1 }), 'Google 标签必须整体相等,不能子串命中');
}

console.log('schedule-filters: OK(无空标签 / 自建标签不藏 / 字面可预测 / 标签精确比)');
