/**
 * statement-parse — statement 解析的契约(L3 · S1)。真跑纯函数,喂构造出来的版式。
 *
 * 这一层最贵的四条错误,各有断言:
 *   ① **把「当日余额」列当成交易额** —— 整份单子全错,而且错得不显眼:
 *      金额都是真数字,只是意思不对。人对着看半天也发现不了。
 *   ② **年份猜错** —— 交易行常常只印 `07/12`。拿系统时间的年份去补,
 *      一月读十二月的单子就整份差一年,而且每一笔看起来都合理。
 *   ③ **把不是金额的数当金额** —— 不要求两位小数的话,日期 `07`、页码、
 *      卡号里的数全会中,一份单子能解析出几百笔不存在的交易。
 *   ④ **认不出来的行被悄悄丢掉** —— 「漏了一笔」是对账里最难查的错,
 *      因为没有任何痕迹。所以认不出来的行必须留在 skipped 里。
 *
 * 还钉一条元规则:**自校验抽不到锚点时报 unknown,不许报 pass**。
 * pass 会让人直接点「全部接受」。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { deepEqual as looseDeepEqual } from 'node:assert';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');

/**
 * 跑源码。pdfjs-loader 里有 `import.meta.url`(worker 路径),vm 跑不了 ——
 * 所以只切**纯函数那一段**,和 scripts/lab-pdf.test.mjs 同样的做法。
 * 切片起点用代码标识符,不用注释:注释是会被清掉的。
 */
function runSource(src) {
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, {
    module: m, exports: m.exports,
    JSON, Array, Object, Set, Map, Number, Math, String, Boolean, Date, RegExp, isNaN,
    require: () => ({}),
  });
  return m.exports;
}
const LOADER_SRC = read('lib/portal/pdfjs-loader.ts');
const rowsAt = LOADER_SRC.indexOf('export function groupItemsIntoRows');
assert.ok(rowsAt > 0, 'pdfjs-loader 的分行函数改名了 —— 这条测试要跟着改');
const L = runSource(LOADER_SRC.slice(rowsAt));
// statement-parse 只 import 了 PdfLine 这个**类型**,transpile 后就没了 —— 可以整份跑。
const P = runSource(read('lib/portal/statement-parse.ts'));

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

/** 造一行:`[[x, '文本'], ...]` → PdfLine。 */
const line = (cells) => ({
  y: 0,
  cells: cells.map(([x, text]) => ({ x, text })),
  text: cells.map((c) => c[1]).join(' ').replace(/\s{2,}/g, ' ').trim(),
});

// ── ① 金额 token:必须带两位小数 ────────────────────────────────────────────
check('①a 各种写法都认得(逗号 / 美元号 / 括号负 / 尾随负 / 前置负)', () => {
  looseDeepEqual(P.parseAmountToken('1,234.56'), { value: 1234.56, explicitSign: false });
  looseDeepEqual(P.parseAmountToken('$1,234.56'), { value: 1234.56, explicitSign: false });
  looseDeepEqual(P.parseAmountToken('(1,234.56)'), { value: -1234.56, explicitSign: true });
  looseDeepEqual(P.parseAmountToken('1,234.56-'), { value: -1234.56, explicitSign: true });
  looseDeepEqual(P.parseAmountToken('-45.00'), { value: -45, explicitSign: true });
});

check('①b 没有两位小数的一律不认 —— 否则日期/页码/卡号里的数会被当成交易额', () => {
  for (const s of ['07', '12', '2026', '1,234', '3', '2K4LM', '5.6', '12.345']) {
    assert.strictEqual(P.parseAmountToken(s), null, `「${s}」被当成金额了 —— 一份单子会多出几百笔假交易`);
  }
});

check('①c CR/DR 后缀翻方向,且比列位置优先', () => {
  const toks = P.amountTokensOfLine(line([[10, '07/12'], [200, '50.00'], [230, 'CR']]));
  assert.strictEqual(toks.length, 1);
  assert.strictEqual(toks[0].value, 50, 'CR = 进账,应为正');
  assert.strictEqual(toks[0].explicitSign, true);
  const dr = P.amountTokensOfLine(line([[200, '50.00 DR']]));
  assert.strictEqual(dr[0].value, -50, 'DR = 出账,应为负');
});

// ── ② 日期:年份不许猜 ──────────────────────────────────────────────────────
check('②a 多种格式', () => {
  assert.strictEqual(P.parseDateToken('2026-07-12', 2026), '2026-07-12');
  assert.strictEqual(P.parseDateToken('07/12/2026', 2000), '2026-07-12');
  assert.strictEqual(P.parseDateToken('07/12/26', 2000), '2026-07-12');
  assert.strictEqual(P.parseDateToken('12 JUL 2026', 2000), '2026-07-12');
  assert.strictEqual(P.parseDateToken('Jul 12, 2026', 2000), '2026-07-12');
});

check('②b 只印月日时,年份来自 statement 期间 —— 不是系统时间', () => {
  assert.strictEqual(P.parseDateToken('07/12', 2024), '2024-07-12');
  assert.strictEqual(P.parseDateToken('07/12', 2026), '2026-07-12');
});

check('②c 跨年 statement(12/28–01/03):12 月那几笔要算上一年', () => {
  // 期间结束是 2027-01-03(endMonth=1),行上印 12/28 → 只能是 2026 年
  assert.strictEqual(P.parseDateToken('12/28', 2027, 1), '2026-12-28');
  assert.strictEqual(P.parseDateToken('01/03', 2027, 1), '2027-01-03');
});

check('②d 不存在的日期不认(02/30、13/01)', () => {
  assert.strictEqual(P.parseDateToken('02/30/2026', 2026), null);
  assert.strictEqual(P.parseDateToken('13/01/2026', 2026), null);
});

// ── ③ 页眉锚点 ─────────────────────────────────────────────────────────────
const HEADER_LINES = [
  line([[40, 'CHASE'], [400, 'Statement']]),
  line([[40, 'Account Number: ****4821']]),
  line([[40, '07/01/2026 - 07/31/2026']]),
  line([[40, 'Beginning Balance'], [480, '0.00']]),
  line([[40, 'Ending Balance'], [480, '2,908.31']]),
  line([[40, '2 transactions this period']]),
];
/** 同一份页眉,但期末余额少了 50 —— 相当于「有一笔没被解析出来」。 */
const HEADER_MISSING_ONE = HEADER_LINES.map((l) =>
  l.text.startsWith('Ending Balance') ? line([[40, 'Ending Balance'], [480, '2,858.31']]) : l);

check('③a 抽出账户尾号 / 期间 / 期初期末 / 笔数', () => {
  const h = P.extractHeader(HEADER_LINES);
  assert.strictEqual(h.accountTail, '4821');
  assert.strictEqual(h.periodStart, '2026-07-01');
  assert.strictEqual(h.periodEnd, '2026-07-31');
  assert.strictEqual(h.openingBalance, 0);
  assert.strictEqual(h.closingBalance, 2908.31);
  assert.strictEqual(h.txCountClaimed, 2);
});

check('③b 抽不到就是 undefined,不许拿系统时间或 0 顶上', () => {
  const h = P.extractHeader([line([[40, 'Some Bank']])]);
  assert.strictEqual(h.periodEnd, undefined);
  assert.strictEqual(h.openingBalance, undefined);
});

// ── ④ 整份解析 + 三条自校验 ────────────────────────────────────────────────
const txLines = [
  line([[40, '07/05'], [80, 'AMAZON MKTPL*2K4LM'], [400, '91.69']]),
  line([[40, '07/20'], [80, 'PAYROLL DEPOSIT'], [470, '3,000.00']]),
];

check('④a 借/贷两列:左列出账、右列进账,期初+Σ=期末 → 自校验 A 通过', () => {
  const r = P.parseStatement([[...HEADER_LINES, ...txLines]]);
  assert.strictEqual(r.rows.length, 2, `只解析出 ${r.rows.length} 行`);
  assert.strictEqual(r.rows[0].amount, -91.69, '左列应判为出账');
  assert.strictEqual(r.rows[1].amount, 3000, '右列应判为进账');
  assert.strictEqual(r.selfCheck.balance, 'pass', `期初+Σ≠期末,差 ${r.selfCheck.balanceDelta}`);
  assert.strictEqual(r.selfCheck.period, 'pass');
  assert.strictEqual(r.selfCheck.count, 'pass');
  assert.strictEqual(P.parseVerdict(r), 'ready');
});

check('④b 有一笔没解析出来 → 自校验 A 立刻 fail,并报出差多少', () => {
  const r = P.parseStatement([[...HEADER_MISSING_ONE, ...txLines]]);
  assert.strictEqual(r.selfCheck.balance, 'fail', '漏了一笔居然还报 pass —— 那这个自校验就是摆设');
  assert.strictEqual(r.selfCheck.balanceDelta, -50, '差多少要报准,否则 L2 的诊断没法据此定位');
  assert.strictEqual(P.parseVerdict(r), 'review', '有 fail 还放行 → 人会一键全部接受,错的直接进账本');
});

check('④c 日期跑出期间 → 自校验 B fail 并列出是哪几行', () => {
  const stray = line([[40, '09/09'], [80, 'WEIRD'], [400, '5.00']]);
  const r = P.parseStatement([[...HEADER_LINES, ...txLines, stray]]);
  assert.strictEqual(r.selfCheck.period, 'fail');
  looseDeepEqual(r.selfCheck.outOfPeriod.map((t) => t.occurredAt), ['2026-09-09']);
});

check('④d 笔数对不上 → 自校验 C fail', () => {
  const extra = line([[40, '07/06'], [80, 'COFFEE'], [400, '4.50']]);
  const r = P.parseStatement([[...HEADER_LINES, ...txLines, extra]]);
  assert.strictEqual(r.selfCheck.count, 'fail');
  assert.strictEqual(r.selfCheck.countClaimed, 2);
  assert.strictEqual(r.selfCheck.countParsed, 3);
});

check('④e 抽不到期初/期末 → 自校验报 **unknown**,不许报 pass', () => {
  const noAnchor = [
    line([[40, 'Account Number: ****4821']]),
    line([[40, '07/01/2026 - 07/31/2026']]),
    ...txLines,
  ];
  const r = P.parseStatement([noAnchor]);
  assert.strictEqual(r.selfCheck.balance, 'unknown', '没检查过就报 pass,人会直接点「全部接受」');
  assert.strictEqual(r.selfCheck.count, 'unknown');
  assert.strictEqual(r.selfCheck.period, 'pass', '期间抽到了,这一条该真判');
});

// ── ⑤ 当日余额列:最贵的一条 ───────────────────────────────────────────────
check('⑤a 认出 running balance 列并排除 —— 否则整份单子的金额全是余额', () => {
  // 期初 1000;每行右侧 480 是当日余额
  const withBal = [
    line([[40, 'Account Number: ****4821']]),
    line([[40, '07/01/2026 - 07/31/2026']]),
    line([[40, 'Beginning Balance'], [480, '1,000.00']]),
    line([[40, 'Ending Balance'], [480, '1,700.00']]),
    line([[40, '07/05'], [80, 'RENT'], [400, '100.00'], [480, '900.00']]),
    line([[40, '07/06'], [80, 'DEPOSIT'], [400, '1,000.00'], [480, '1,900.00']]),
    line([[40, '07/07'], [80, 'GROCERY'], [400, '200.00'], [480, '1,700.00']]),
  ];
  const r = P.parseStatement([withBal]);
  assert.strictEqual(r.rows.length, 3, `解析出 ${r.rows.length} 行,应为 3`);
  looseDeepEqual(r.rows.map((t) => t.amount), [-100, 1000, -200],
    '余额列被当成交易额了 —— 金额都是真数字,只是意思不对,人对着看半天也发现不了');
  assert.strictEqual(r.selfCheck.balance, 'pass');
});

check('⑤b 只有一个金额列时不许误判成余额列(那会把所有行都吞掉)', () => {
  const single = [
    line([[40, '07/01/2026 - 07/31/2026']]),
    line([[40, 'Beginning Balance'], [400, '0.00']]),
    line([[40, '07/05'], [80, 'A'], [400, '10.00']]),
    line([[40, '07/06'], [80, 'B'], [400, '20.00']]),
    line([[40, '07/07'], [80, 'C'], [400, '30.00']]),
  ];
  const r = P.parseStatement([single], { accountKind: 'credit_card' });
  assert.strictEqual(r.rows.length, 3, '所有行都被当成余额吞掉了');
  looseDeepEqual(r.rows.map((t) => t.amount), [-10, -20, -30], '信用卡上的裸金额默认是消费');
  looseDeepEqual(r.rows.map((t) => t.directionBasis), ['account_default', 'account_default', 'account_default'],
    '方向判据要如实标出来 —— 这是最弱的一档,人得知道');
});

// ── ⑥ 认不出来的行不许丢 ───────────────────────────────────────────────────
check('⑥a 有日期没金额的行进 skipped,不是消失', () => {
  const odd = line([[40, '07/09'], [80, 'CONTINUED FROM PREVIOUS PAGE']]);
  const r = P.parseStatement([[...HEADER_LINES, ...txLines, odd]]);
  assert.strictEqual(r.rows.length, 2);
  const s = r.skipped.find((x) => x.raw.includes('CONTINUED'));
  assert.ok(s, '认不出来的行被悄悄丢了 ——「漏了一笔」是对账里最难查的错,因为没有任何痕迹');
  assert.strictEqual(s.why, 'no_amount');
  assert.ok(s.page >= 1 && s.line >= 1, 'skipped 也要带页/行号,人才找得到它');
});

check('⑥b 去掉余额列后还剩多个金额 → 摆到 skipped,不猜', () => {
  const ambiguous = [
    line([[40, '07/01/2026 - 07/31/2026']]),
    line([[40, 'Beginning Balance'], [480, '0.00']]),
    line([[40, '07/05'], [80, 'A'], [300, '1.00'], [400, '2.00'], [480, '3.00']]),
  ];
  const r = P.parseStatement([ambiguous]);
  assert.strictEqual(r.rows.length, 0, '分不出哪个是交易额还硬挑一个 —— 猜错就是一笔假账');
  assert.ok(r.skipped.some((s) => s.why === 'ambiguous_amounts'));
});

// ── ⑦ 可解释 / 可复现 ──────────────────────────────────────────────────────
check('⑦a 每一行都能指回「第几页第几行」+ 原始文本(诊断第①步要用)', () => {
  const r = P.parseStatement([HEADER_LINES, txLines]);
  const t = r.rows[0];
  assert.strictEqual(t.page, 2, '页码不对,「跳到 PDF 那一页」就跳错了');
  assert.strictEqual(t.id, `p${t.page}:l${t.line}`);
  assert.ok(t.raw.includes('AMAZON'), '没留原始文本 —— 诊断只能报「差 $X」,那等于没做');
});

check('⑦b 同一份文件解析两次结果完全一样(零 AI 的意义就在这)', () => {
  const a = P.parseStatement([[...HEADER_LINES, ...txLines]]);
  const b = P.parseStatement([[...HEADER_LINES, ...txLines]]);
  looseDeepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

check('⑦c 没有文字层(扫描件)→ unusable,而不是「解析出 0 笔然后说通过」', () => {
  const r = P.parseStatement([[line([[40, 'Some Bank']])]], { fallbackYear: 2026 });
  assert.strictEqual(P.parseVerdict(r), 'unusable');
});

check('⑦e 只差一个年份 → need_year,**不许报成 unusable**', () => {
  // 交易行上只印「07/12」,页眉没印期间,调用方也没给年份 —— 补哪一年无从得知。
  // 报成 unusable 的话人会以为自己的单子根本不被支持而放弃,实际上填个年份就好了。
  const r = P.parseStatement([[line([[40, 'Some Bank']]), ...txLines]]);
  assert.strictEqual(r.needsYear, true);
  assert.strictEqual(P.parseVerdict(r), 'need_year');
  // 给了年份就能解析
  const ok = P.parseStatement([[line([[40, 'Some Bank']]), ...txLines]], { fallbackYear: 2026 });
  assert.strictEqual(ok.needsYear, false);
  assert.strictEqual(ok.rows.length, 2);
});

check('⑦f 描述里不许留下当日余额那个数字', () => {
  const withBal = [
    line([[40, '07/01/2026 - 07/31/2026']]),
    line([[40, 'Beginning Balance'], [480, '1,000.00']]),
    line([[40, '07/05'], [80, 'RENT'], [400, '100.00'], [480, '900.00']]),
    line([[40, '07/06'], [80, 'DEPOSIT'], [400, '1,000.00'], [480, '1,900.00']]),
    line([[40, '07/07'], [80, 'GROCERY'], [400, '200.00'], [480, '1,700.00']]),
  ];
  const r = P.parseStatement([withBal]);
  looseDeepEqual(r.rows.map((t) => t.description), ['RENT', 'DEPOSIT', 'GROCERY'],
    '余额数字混进了描述,变成「RENT 900.00」—— 之后按商户名配对全废');
});

check('⑦g 期初/期末印在同一行时不许都读成期末', () => {
  const h = P.extractHeader([
    line([[40, 'Beginning Balance'], [200, '1,000.00'], [300, 'Ending Balance'], [480, '2,000.00']]),
  ]);
  assert.strictEqual(h.openingBalance, 1000, '期初被读成了期末 —— 自校验 A 直接失效,而且看起来还很合理');
  assert.strictEqual(h.closingBalance, 2000);
});

check('⑦d 解析器不写账:整个模块不许出现任何存储/写入动作', () => {
  const src = fs.readFileSync(`${ROOT}lib/portal/statement-parse.ts`, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const bad of ['localStorage', 'indexedDB', 'addLifeNode', 'ingestLifeNode', 'fetch(']) {
    assert.ok(!code.includes(bad),
      `解析器里出现了 ${bad} —— 它只能产出候选行。直接写账的话,一次版式误判就污染账本,且重新解析也救不回来`);
  }
});

// ── ⑧ 分行:全仓一份 ───────────────────────────────────────────────────────
check('⑧a groupItemsIntoLines 是 groupItemsIntoRows 的薄封装(不许两套分行逻辑)', () => {
  const items = [
    { str: 'B', transform: [1, 0, 0, 1, 200, 700] },
    { str: 'A', transform: [1, 0, 0, 1, 40, 700] },
    { str: '下一行', transform: [1, 0, 0, 1, 40, 680] },
  ];
  looseDeepEqual(L.groupItemsIntoLines(items), ['A B', '下一行']);
  const rows = L.groupItemsIntoRows(items);
  looseDeepEqual(rows.map((r) => r.text), L.groupItemsIntoLines(items));
  looseDeepEqual(rows[0].cells.map((c) => c.x), [40, 200], '行内块要按 x 排好,且保留 x');
  const src = fs.readFileSync(`${ROOT}lib/portal/pdfjs-loader.ts`, 'utf8');
  assert.ok(/export function groupItemsIntoLines[\s\S]{0,200}groupItemsIntoRows\(/.test(src),
    'groupItemsIntoLines 又自己写了一套分行 —— 两套的话,调容差只调一边,同一份 PDF 会给出不同的行');
});

check('⑧b y 降序(PDF 的 y 向上)—— 写成升序整份文档会读反', () => {
  const items = [
    { str: '底部', transform: [1, 0, 0, 1, 40, 100] },
    { str: '顶部', transform: [1, 0, 0, 1, 40, 700] },
  ];
  looseDeepEqual(L.groupItemsIntoRows(items).map((r) => r.text), ['顶部', '底部']);
});

const fails = results.filter((r) => r[0] === 'FAIL');
if (fails.length) {
  assert.fail(`statement-parse 有 ${fails.length} 条不过:\n  - `
    + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
}
console.log(`statement-parse: OK(${results.length} 条,金额必带两位小数 / 年份来自单子 / 余额列不当交易额 / 认不出的不丢 / 自校验不谎报 pass)`);
