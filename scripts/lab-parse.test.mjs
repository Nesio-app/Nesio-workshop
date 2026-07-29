/**
 * 行为契约:化验单文字 → 指标行(lib/health/lab-parse.ts)。
 *
 * 这是健康镜头里唯一「解错了会静静地把假数据写进病历」的地方,所以按最坏情况测:
 *
 *   ① 参考区间的数字被当成结果值 —— 「6.80 mmol/L 3.90-6.10」解成 3.90。
 *      整条曲线从此是假的,而且看起来完全正常。
 *   ② 编一个不存在的参考区间 —— 判定偏高偏低的唯一依据是它,编了整屏都是假的。
 *   ③ 表头行造出假指标 ——「项目 结果 单位 参考值」变成一条指标。
 *   ④ 日期找不到时回退成「今天」—— 三个月前的单子落到今天,C 屏那条
 *      「吃药后有没有用」直接失真。
 *
 * 用真实版式 + OCR 噪声(逗号当小数点、列被挤在一起、↑↓ 符号)测,不用干净假数据。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/health/lab-parse.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Number, String, Array, Object, Set, RegExp, Math });
  return mod.exports;
}
const M = load();

// ── ① 参考区间的数字绝不能当成结果值 ──────────────────────────────────────────
{
  const r = M.parseLabLine('空腹血糖   6.80  mmol/L   3.90-6.10  ↑');
  assert.ok(r, '这行该解得出来');
  assert.equal(r.value, 6.80, `结果值解错了(拿到 ${r.value})—— 多半是把参考区间下界当成了结果`);
  assert.equal(r.low, 3.90);
  assert.equal(r.high, 6.10);
  assert.equal(r.unit, 'mmol/L');
  assert.equal(r.flag, 'high');
  assert.equal(r.name, '空腹血糖');
  assert.equal(r.confidence, 'high');
}

// ── 各种真实版式 ──────────────────────────────────────────────────────────────
{
  const cases = [
    // [行, 期望名, 值, low, high, flag]
    ['葡萄糖(GLU)  5.42  mmol/L  3.9~6.1', '葡萄糖(GLU)', 5.42, 3.9, 6.1, 'normal'],
    ['1. 白细胞计数 WBC 5.6 10^9/L 3.5-9.5', '白细胞计数 WBC', 5.6, 3.5, 9.5, 'normal'],
    ['总胆固醇 5.20 mmol/L <5.20', '总胆固醇', 5.20, undefined, 5.20, 'normal'],
    ['高密度脂蛋白 0.85 mmol/L >1.00 ↓', '高密度脂蛋白', 0.85, 1.00, undefined, 'low'],
    ['Glucose, Fasting 105 mg/dL 70-99 High', 'Glucose, Fasting', 105, 70, 99, 'high'],
    ['糖化血红蛋白 7.2 % 4.0—6.0', '糖化血红蛋白', 7.2, 4.0, 6.0, 'high'],
    ['血红蛋白 138 g/L 130 to 175', '血红蛋白', 138, 130, 175, 'normal'],
    // 单位里的斜杠两边带空格(OCR 常见)。不先剥单位的话,「10^9 / L」里那个孤立的 L
    // 会被当成「偏低」标记 —— 整张血常规全被判成偏低,而且看起来毫无异样。
    ['中性粒细胞 3.2 10^9 / L 1.8-6.3', '中性粒细胞', 3.2, 1.8, 6.3, 'normal'],
    ['尿素 5.1 mmol / L 2.9-8.2', '尿素', 5.1, 2.9, 8.2, 'normal'],
  ];
  for (const [line, name, value, low, high, flag] of cases) {
    const r = M.parseLabLine(line);
    assert.ok(r, `解不出来:「${line}」`);
    assert.equal(r.name, name, `名字解错:「${line}」→「${r.name}」`);
    assert.equal(r.value, value, `值解错:「${line}」→ ${r.value}`);
    assert.equal(r.low, low, `下界解错:「${line}」→ ${r.low}`);
    assert.equal(r.high, high, `上界解错:「${line}」→ ${r.high}`);
    assert.equal(r.flag, flag, `判定错:「${line}」→ ${r.flag}`);
  }
}

// ── OCR 噪声:小数点被认成逗号 ────────────────────────────────────────────────
{
  const r = M.parseLabLine('甘油三酯 1,85 mmol/L 0,45-1,70');
  assert.ok(r, '逗号小数点该能认');
  assert.equal(r.value, 1.85);
  assert.equal(r.high, 1.70);
  assert.equal(r.flag, 'high');
}

// ── ② 没有区间就不许编 ────────────────────────────────────────────────────────
{
  const r = M.parseLabLine('尿酸 380 umol/L');
  assert.ok(r);
  assert.equal(r.low, undefined, '没印参考区间就不许编一个');
  assert.equal(r.high, undefined);
  assert.equal(r.flag, undefined, '没有区间时不许判「正常」—— 那是编的');
  assert.equal(r.confidence, 'medium', '有单位无区间 = medium');

  const bare = M.parseLabLine('某项指标 12');
  assert.ok(bare);
  assert.equal(bare.unit, undefined, '没识别到单位就不许补一个');
  assert.equal(bare.confidence, 'low', '只有名字和值 = low,得让人核');
}

// ── ③ 表头 / 抬头 / 签名行不许变成指标 ────────────────────────────────────────
{
  for (const noise of [
    '项目   结果   单位   参考值',
    '检验项目  结果  参考范围',
    'Item  Result  Unit  Reference Range',
    '姓名: 张三   性别: 女   年龄: 34',
    '报告日期 2026-03-15',
    '第 1 页 / 共 2 页',
    '审核者: 李四',
    '2026-03-15 09:41',
    '   ',
  ]) {
    assert.equal(M.parseLabLine(noise), null, `这行不该被当成指标:「${noise}」`);
  }
}

// ── 纯数字行 / 没字的行不算指标 ───────────────────────────────────────────────
{
  assert.equal(M.parseLabLine('3.90-6.10'), null, '只有一个区间、没有项目名 —— 不是指标行');
  assert.equal(M.parseLabLine('12345'), null);
}

// ── 上下颠倒的「区间」当没认出来,别硬凑 ───────────────────────────────────────
{
  const hit = M.findRange('6.1-3.9');
  assert.equal(hit, null, '大在前小在后不是参考区间(多半是别的东西),不许硬凑');
}

// ── 整张单子:异常置顶 + 去重 ─────────────────────────────────────────────────
{
  const report = `
检验报告单
姓名: 张三   性别: 女
项目        结果    单位      参考值
白细胞计数   5.6   10^9/L   3.5-9.5
空腹血糖     6.80  mmol/L   3.90-6.10  ↑
血红蛋白     138   g/L      115-150
血红蛋白     138   g/L      115-150
甘油三酯     2.30  mmol/L   0.45-1.70  ↑
报告日期 2026-03-15
`;
  const rows = M.parseLabReport(report);
  assert.equal(rows.length, 4, `该解出 4 项(去掉重复的血红蛋白),实际 ${rows.length}:${rows.map((r) => r.name).join('、')}`);
  assert.equal(M.abnormalCount(rows), 2);
  // 异常置顶
  assert.equal(rows[0].name, '空腹血糖');
  assert.equal(rows[1].name, '甘油三酯');
  // 同档内保持原始顺序
  assert.equal(rows[2].name, '白细胞计数');
  assert.equal(rows[3].name, '血红蛋白');
}

// ── ④ 日期:找得到就用,找不到返回 null(绝不回退成今天)────────────────────────
{
  assert.equal(M.findReportDate('报告日期 2026-03-15'), '2026-03-15');
  assert.equal(M.findReportDate('采样时间:2026年3月5日 08:30'), '2026-03-05');
  assert.equal(M.findReportDate('2026/12/31'), '2026-12-31');
  assert.equal(M.findReportDate('没有日期的单子'), null, '找不到就返回 null —— 回退成今天会让曲线上的点落错位置');
  assert.equal(M.findReportDate('2026-13-45'), null, '不合法的月/日不算日期');
}

console.log('lab-parse: OK(区间不当结果 · 没区间不编 · 表头不成指标 · 日期找不到不回退今天)');
