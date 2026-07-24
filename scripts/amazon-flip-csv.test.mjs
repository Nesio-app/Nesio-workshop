/**
 * 行为契约:亚马逊转卖 CSV 导入(Notion「Amazon Free Tracker」导出)。
 * 锁死:
 *  1) CSV 解析尊重引号内逗号("November 28, 2025" / "CN¥2,115.50" 不被切断);
 *  2) 金额剥 $/¥/CN/逗号,负号(-$0.67)保留;空 → null;
 *  3) 返现用美元反推(rebate = 美金价格 − 自付额),使 app 派生的自付额/盈利与表一致;
 *  4) In Stock=Sold→sold、PayStatus/Review Status=Done→已到账/已评、免评=No→非免评;
 *  5) 日期归一为 YYYY-MM-DD;缺 Name 的行跳过;非本表(无关列)返回空。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadInventory() {
  const src = fs.readFileSync(new URL('../lib/portal/inventory.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, Array, Object, JSON, Map, Set, String, Number, Boolean, Date, RegExp, Math, parseFloat, isNaN,
    require: () => ({}),
  });
  return mod.exports;
}
const inv = loadInventory();

// ── 纯函数:CSV 分行 / 金额 / 日期 ──
assert.deepEqual([...inv.splitCsvLine('a,"b, c",d')], ['a', 'b, c', 'd'], '引号内逗号不切断');
assert.deepEqual([...inv.splitCsvLine('壁炉,Sold,,Done')], ['壁炉', 'Sold', '', 'Done'], '空字段保留');
assert.equal(inv.parseMoneyLoose('$53.39'), 53.39);
assert.equal(inv.parseMoneyLoose('-$0.67'), -0.67, '负号在货币符前也解析');
assert.equal(inv.parseMoneyLoose('$2,115.50'), 2115.5, '千分位逗号剥掉');
assert.equal(inv.parseMoneyLoose('CN¥373.00'), 373, '人民币符号剥掉');
assert.equal(inv.parseMoneyLoose(''), null, '空 → null');
assert.equal(inv.parseFlexibleDate('November 28, 2025'), '2025-11-28');
assert.equal(inv.parseFlexibleDate('2025-12-05'), '2025-12-05');
assert.equal(inv.parseFlexibleDate(''), '');

// ── 端到端:真实表头 + 3 行真实数据 ──
const CSV = [
  '﻿Name,In Stock,Order #,PayStatus,Review Status,免评,到货时间,盈利,美金价格,自付额,转卖价,返现金额',
  '乳胶枕头,In stock,,Done,Done,No,"November 28, 2025",$0.67,$53.39,-$0.67,,CN¥373.00',
  '壁炉,Sold,,Done,Done,No,"November 30, 2025",$144.50,$312.09,$5.50,$150.00,"CN¥2,115.50"',
  '卷发梳,Sold,,Done,Done,No,"December 5, 2025",$10.36,$64.34,$9.64,$20.00,CN¥377.46',
  ',In stock,,,,,,,,,,',            // 缺 Name → 跳过
].join('\n');

const items = inv.parseAmazonFlipCsv(CSV);
assert.equal(items.length, 3, '缺 Name 的行被跳过');

const bilu = items.find((i) => i.name === '壁炉');
assert.equal(bilu.isAmazon, true, '标记为亚马逊');
assert.equal(bilu.buyPrice, 312.09, '美金价格 → buyPrice');
assert.equal(bilu.rebate, 306.59, '返现 = 买入价 − 自付额(反推,USD)');
assert.equal(bilu.resalePrice, 150, '转卖价');
assert.equal(bilu.arrivedAt, '2025-11-30', '到货日归一');
assert.equal(bilu.sold, true, 'In Stock=Sold → 已售');
assert.equal(bilu.rebateReceived, true, 'PayStatus=Done → 返现到账');
assert.equal(bilu.reviewDone, true, 'Review Status=Done → 已评');
assert.ok(!bilu.reviewExempt, '免评=No → 非免评');

// app 派生自付额/盈利应与表一致:outOfPocket = buyPrice − rebate, profit = resale − outOfPocket
const oop = Math.round((bilu.buyPrice - bilu.rebate) * 100) / 100;
const profit = Math.round((bilu.resalePrice - oop) * 100) / 100;
assert.equal(oop, 5.5, '派生自付额 = 表里 $5.50');
assert.equal(profit, 144.5, '派生盈利 = 表里 $144.50');

// 在库无转卖价 → resalePrice 不设(undefined)
const zhen = items.find((i) => i.name === '乳胶枕头');
assert.equal(zhen.resalePrice, undefined, '无转卖价 → 不设');
assert.equal(zhen.sold, undefined, 'In stock → 未售');
assert.equal(zhen.rebate, 54.06, '返现反推:53.39 −(−0.67)=54.06');

// ── 非本表(无关列)→ 空 ──
assert.deepEqual([...inv.parseAmazonFlipCsv('foo,bar\n1,2')], [], '没有 Name 列 → 空');

console.log('amazon-flip-csv: OK');
