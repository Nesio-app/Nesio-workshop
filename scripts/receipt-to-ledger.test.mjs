/**
 * receipt-to-ledger —— 「上传发票 → 自动找账」这条的接线契约。
 *
 * ## 为什么补这一条
 *
 * `receipt-extract.ts`(从图里抽金额/日期)写好之后,**一个调用方都没有** ——
 * 函数在、测试在、契约在,但产品里点不到。这类「数据层做完就当做完了」的欠账
 * 从外面看和没做一模一样,而且比没做更难发现:grep 得到命中,以为通了。
 *
 * 所以这道守卫盯的不是抽取逻辑本身(那是 `receipt-extract` 自己的事),
 * 是**它有没有真的被接到界面上**,以及接的方式对不对。
 *
 * 产品改口(2026-08):总览不再手记银行流水,QuickAddSheet 只留资产估值。
 * 发票对账走「交易 → 修改 → 传附件」(端上识字 + 金额比对),ReceiptScanRow 仍保留给
 * 其它入口/回归;本契约盯识字路径与查重出口。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripComments(read(rel));

const SCAN = code('components/portal/finance/ReceiptScanRow.tsx');
const QUICK = code('components/portal/finance/QuickAddSheet.tsx');
const FIN = code('components/portal/finance/FinanceTab.tsx');

// ── ① 抽取函数必须有产品里的调用方 ──────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const callers = [...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'lib'))]
  .filter((f) => !f.endsWith('receipt-extract.ts'))
  .filter((f) => /extractReceiptFields\s*\(/.test(stripComments(fs.readFileSync(f, 'utf8'))))
  .map((f) => path.relative(ROOT, f));
assert.ok(
  callers.length > 0,
  'extractReceiptFields 没有任何调用方 —— 抽取逻辑写好了但产品里点不到,\n'
  + '  这和没做是一样的效果,而且更难发现(grep 有命中,看着像通了)。',
);

// ── ② 走端上,不打云 ────────────────────────────────────────────────────────
// 发票上是税号和金额。识字端上做得了(验血报告那条路已经在用),就不该把它发出去;
// 而且云识图现在是付费门后面的,走云等于这个功能免费用不了。
// ⚠️ 断言的是**调用点**不是名字 —— 只 grep `recognizeOnDevice` 的话,
// 把调用换成 fetch 而 import 行没删,断言照样绿(自查反证时这里空转过)。
assert.match(
  SCAN, /await\s+recognizeOnDevice\s*\(/,
  'ReceiptScanRow 没走端上 OCR —— 发票该在手机里认完,不出门。',
);
assert.ok(
  !/fetch\(\s*['"`]\/api\//.test(SCAN),
  'ReceiptScanRow 打了云接口。识字端上做得了,而且云识图在付费门后面 —— 走云就等于免费用不了。',
);
assert.match(
  SCAN, /await\s+visionAvailability\s*\(\)/,
  '没先探端上能力就直接识别 —— 探不到时要明说「这台设备认不了字」,不能偷偷降级去云。',
);

// ── ③ 每条走不通的路都要说出来 ──────────────────────────────────────────────
// CLAUDE.md 红线:异步动作必须有看得见的失败态。这个流程有四种走不通,
// 少一种就是一次「点了没反应」。
for (const [s, what] of [
  ["'blocked'", '这台设备认不了字'],
  ["'failed'", '识别本身出错'],
  ["'empty'", '认出字了但没有像金额的数'],
]) {
  assert.ok(
    SCAN.includes(`s: ${s}`),
    `ReceiptScanRow 少了「${what}」这个状态 —— 走不通却不说,就是又一次「按钮点了没反应」。`,
  );
}
assert.match(SCAN, /role="alert"/, '失败提示没有 role="alert" —— 读屏用户听不到。');

// ── ④ 重点:别记两遍(交易附件路径 + ReceiptScanRow 查重) ────────────────────
// 刷卡付的税费,Plaid 那条流水已经在账上。再手记一笔就是双计 ——
// 和 spend-claim 里「price 只认领不记账」是同一条规矩。
assert.match(
  SCAN, /receiptMatchCandidates\s*\(/,
  'ReceiptScanRow 抽完金额没去查银行里有没有这笔 —— 那这个功能只是「填得快一点」,\n'
  + '  而它真正要解决的是**别把同一笔钱记两次**。',
);
// 交易编辑传附件:端上识字后跟本笔金额比对(FinanceTab),不再经 QuickAdd 手记流水。
assert.match(
  FIN, /attachImageUnderstanding/,
  '交易「传附件」必须端上识字并对金额 —— 发票对账入口在修改面板,不在手记流水。',
);

// ── ⑤ 查重不许硬拦 ──────────────────────────────────────────────────────────
// 匹配是启发式的(±1% + ±3天),会误判。硬拦就变成「系统觉得你错了所以不让你记」。
// CLAUDE.md 文案红线:每个提示都要有出口。
assert.match(
  SCAN, /rejectPair\s*\(\s*scanKey\(/,
  '没有「不是同一笔」的出口 —— 金额日期撞车是常事(同一天两笔一样的),\n'
  + '  没出口的话你就再也记不了那笔账了。',
);

// ── ⑥ 产品改口:QuickAdd 不再手记银行流水 ───────────────────────────────────
assert.ok(!/addManualBankTx/.test(QUICK), 'QuickAddSheet 不许再写银行流水');
assert.ok(!/addManualEntry/.test(QUICK), 'QuickAddSheet 不许再走现金账本手记');
assert.ok(/addAssetAnchor/.test(QUICK), '资产估值锚点仍须可记');

console.log(`receipt-to-ledger: OK(抽取有 ${callers.length} 个调用方 / 端上识别不打云 / 三种失败态都说得出 / 查重不硬拦 / QuickAdd 仅资产)`);
