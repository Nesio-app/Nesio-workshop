/**
 * 行为契约:看起来能点的行,就得真能点(2026-07-30 真机,bug #9 / #38 / #39)。
 *
 * 一轮走查里同一种「假死行」出现在三个互不相干的板块:
 *   #9  资产 → 房产「家」、资产 → 车「Model Y」:点了没反应。
 *       代码其实有 onClick —— 但只有**名字那一行**是 <button>(高约 24px),
 *       它下面的日期行、「下次…」行都在按钮外面。用户看见的是一整块卡片,
 *       手指落在名字底下就什么都不发生。**可点区域比它看起来的样子小**,
 *       在用户那里跟「按了没反应」是同一件事。
 *   #38 家务「已安排」展开后的行:纯 <div>,长得跟上面能点的「大家」行一模一样。
 *   #39 美味「黄瓜」库存卡:整行只有右边那个 ✕ 可点,行本身是 <div>。
 *       而它偏偏标着「过期」—— 效期是记进来时估的,估错了却没地方能改。
 *
 * 判据是正向的:**一行只要长得像行(有主标题 + 副标题 + 分割线),就必须有去处**;
 * 有去处就得给足 44px 的手指落点。
 *
 * 外加两条同源的:
 *   · #37 家务页 / 美味页页头只剩「‹ 洞察」,不写自己叫什么 ——
 *     左边说的是「点它去哪」,中间说的是「你现在在哪」,两件事不能互相顶替。
 *   · #38 后半:日期只印「2026-08-06」,紧挨在「你今天的活」下面,会被读成今天。
 *     先说相对今天是什么时候(relativeFutureLabel),再给日期。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, require: () => ({}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

/* ══ ① 资产卡:整块头部都在按钮里,且给足 44px ══════════════════════ */
{
  const src = read('components/portal/AssetsPanel.tsx');
  const head = src.slice(src.indexOf('className="nesio-assets-head"'), src.indexOf('{open && ('));

  assert.match(head, /nesio-assets-sub/,
    '日期/估值那一行必须**在按钮里面** —— 它原来在按钮外面,' +
    '所以手指落在那儿时「没有任何反应」。逻辑没坏,是可点区域太小');
  assert.match(head, /nesio-assets-due/, '「下次…」那行同理');
  assert.doesNotMatch(head, /<p className="nesio-assets-sub"/,
    '搬进按钮里就不能再是 <p> —— <button> 里放块级 <p> 是非法嵌套,' +
    '浏览器会把它拆出去,等于没搬');

  const css = read('app/globals.css');
  const rule = css.slice(css.indexOf('.nesio-assets-head {'), css.indexOf('.nesio-assets-head:active'));
  assert.match(rule, /min-height:\s*44px/,
    '一行字高约 24px,手指按不准。44px 是最低的手指落点');
  assert.match(rule, /flex-direction:\s*column/,
    '头部现在是竖着排的三块(名字行 / 日期行 / 下次行),不再是一行');
}

/* ══ ② 家务「已安排」行:有去处 + 日期不许被读成今天 ═════════════════ */
{
  const src = read('components/portal/family/FamilySharingSheet.tsx');
  const at = src.indexOf('{rows.map((g, i) => {');
  assert.ok(at > 0, '已安排那段还在');
  const block = src.slice(at, at + 2600);

  assert.match(block, /<button type="button" aria-expanded=\{open\}/,
    '这些行原来是纯 <div>,跟上面能点的「大家」行长得一模一样却什么都不做。' +
    '现在点开显示这一组的每一条实例(哪天、什么状态)');
  assert.match(block, /minHeight: 44/, '手指落点');
  assert.match(block, /relativeFutureLabel\(g\.earliest/,
    '原来只印一个「2026-08-06」,紧挨在「你今天的活」下面 —— 看起来就像今天要做的。' +
    '必须先说相对今天是什么时候');
  assert.match(block, /assignedStateLabel\(c\.state/,
    'assignedStateLabel 之前是**定义了却没人调**的死函数 —— 说明这些行早就不显示状态了');

  // 页头要写自己叫什么(#37)
  assert.match(src, /title=\{view\.kind === 'ledger' \? .* : t\('家务', 'Chores'\)\}/s,
    '#37:页头只剩「‹ 洞察」,不写自己叫什么。' +
    '左边说的是「点它去哪」,中间说的是「你现在在哪」');
}

/* ══ ③ 美味库存行:有去处,而且能改效期 ════════════════════════════ */
{
  const src = read('components/portal/cooking/CookingSheet.tsx');
  const at = src.indexOf('function PantryRow(');
  const block = src.slice(at, src.indexOf('// ── 屏4 想做清单'));

  assert.match(block, /aria-expanded=\{open\}/, '行本身要能点开,不能只有右边那个 ✕');
  assert.match(block, /minHeight: 44/, '手指落点');
  assert.match(block, /updatePantry\(/,
    '#39 的另一半:「黄瓜」标着「过期」,而效期是记进来时按默认保质期估的 —— ' +
    '估错了用户却没有任何地方能改。点开就得能改');
  assert.match(block, /效期 \$\{it\.expiry\}/,
    '收起时也要把效期**日期本身**印出来。只写一个「过期」而不说是哪天,' +
    '用户根本没法判断它是不是记错了');
  assert.match(block, /onError\(/,
    '写失败必须看得见(CLAUDE.md 红线:每个异步/写入动作都要有显式失败态)');

  // #37:三个顶层屏都要写页名
  const heads = src.match(/backLabel=\{t\('洞察', 'Insights'\)\}[^/]*\/>/g) || [];
  assert.equal(heads.length, 3, '首页 / 库存 / 想做三个顶层屏');
  for (const h of heads) {
    assert.match(h, /page=\{t\('美味', 'Cooking'\)\}/, `顶层屏要写自己叫什么:${h}`);
  }
}

/* ══ ④ relativeFutureLabel:纯日期串按本地自然日算 ══════════════════ */
{
  const { relativeFutureLabel } = loadTs('lib/portal/time-labels.ts');
  const NOW = new Date(2026, 6, 30, 15, 0);   // 2026-07-30 下午 3 点

  assert.equal(relativeFutureLabel('2026-07-30', NOW), '今天',
    "'YYYY-MM-DD' 原来被 new Date() 当成 **UTC 零点**解析 —— 在 UTC-5 那是本地前一天 19:00," +
    '于是「今天到期」被说成「已过期」。日期串本来就没有时刻,必须按本地自然日算');
  assert.equal(relativeFutureLabel('2026-07-31', NOW), '明天');
  assert.equal(relativeFutureLabel('2026-08-06', NOW), '7 天后',
    '截图里那条家务:8/6 是一周后,不是今天');
  assert.equal(relativeFutureLabel('2026-07-29', NOW), '已过期');
  assert.equal(relativeFutureLabel('2026-08-06', NOW, 'en'), 'in 7 days');

  // 带时刻的输入维持原判定 —— 今天早上 9 点、现在下午 3 点,确实过去了
  assert.equal(relativeFutureLabel(new Date(2026, 6, 30, 9, 0), NOW), '已过期',
    '有时刻的就按时刻算,不能因为「同一天」就说成「今天」');
}

console.log('inert-rows: OK(资产整块可点 / 家务行有去处 + 日期说相对 / 库存行能改效期 / 页头写页名 / 日期串按本地日)');
