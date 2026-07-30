/**
 * statement-reconcile — 解析结果接进账本的契约(L3-b 的确定性层)。
 *
 * 这一层只有两件事,但两件都能把钱算错:
 *
 *   ① **符号约定**。BankTx 是「支出为正」(Plaid),解析器是「支出为负」。
 *      漏了翻号:每一行都变成「银行有我没有」+「我有银行没有」,对账台凭空
 *      多出两倍未达账项;更糟的是真退款(银行侧负)会和消费(解析侧负)配上,
 *      「已对账」打在错的一对上,之后再也查不出来。
 *
 *   ② **默认勾选**。默认把 matched 也勾上 = 把银行已经有的那笔又记一遍,
 *      月支出直接翻倍;默认把 imported 勾上 = 同一份单子接受两次,重复的是钱。
 *      默认值必须站在「不重复记账」这一边。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { deepEqual as looseDeepEqual } from 'node:assert';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');

/**
 * 三个模块一起 transpile 再跑 —— statement-reconcile import 了 ledger-reconcile 的
 * **函数**(不只是类型),所以不能像 statement-parse 那样单文件跑。
 * 做法:把 import 行去掉,按依赖顺序拼在一起,共享一个 exports。
 */
function runTogether(rels) {
  const src = rels.map((r) => read(r)
    .replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '')
    .replace(/^export type \{[\s\S]*?\};$/gm, ''))
    .join('\n');
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
const R = runTogether(['lib/portal/ledger-reconcile.ts', 'lib/portal/statement-reconcile.ts']);

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

/** 解析出的候选行:**支出为负**。 */
const cand = (id, occurredAt, amount, description = '') =>
  ({ id, page: 1, line: 1, raw: '', occurredAt, description, amount, directionBasis: 'explicit_sign' });
/** 银行流水:**支出为正**(Plaid 约定)。 */
const tx = (id, date, amount, name) => ({ id, date, amount, name });

const HEADER = {
  periodStart: '2026-07-01', periodEnd: '2026-07-31',
  openingBalance: 0, closingBalance: -101.69,
};

// ── ① 符号约定:整条链上最容易静默出错的一处 ──────────────────────────────
check('①a 银行流水翻号成统一口径(流出为负)', () => {
  looseDeepEqual(
    R.bankTxToItems([tx('b1', '2026-07-05', 91.69, 'AMAZON')]),
    [{ id: 'b1', occurredAt: '2026-07-05', amount: -91.69, merchant: 'AMAZON' }],
  );
});

check('①b 候选行**不翻号**(它本来就是流出为负)', () => {
  looseDeepEqual(
    R.candidatesToItems([cand('p1:l1', '2026-07-05', -91.69, 'AMAZON')]),
    [{ id: 'p1:l1', occurredAt: '2026-07-05', amount: -91.69, merchant: 'AMAZON' }],
  );
});

check('①c 同一笔消费必须配上 —— 漏翻号的话它会变成两条未达账项', () => {
  const rev = R.reviewStatement({
    rows: [cand('p1:l1', '2026-07-05', -91.69, 'AMAZON')],
    header: HEADER,
    bankTx: [tx('b1', '2026-07-05', 91.69, 'AMAZON MKTPL')],
    fileKey: 'f1',
  });
  assert.strictEqual(rev.rows[0].state, 'matched',
    '同一笔消费没配上 —— 符号约定漏了翻号,对账台会凭空多出两倍未达账项');
  assert.strictEqual(rev.rows[0].matchedId, 'b1');
  looseDeepEqual(rev.match.onlyInLedger, []);
});

check('①d 退款不许和消费配上(符号搞反的最坏后果)', () => {
  // 银行侧 −25 = 退款(进账);候选行 −25 = 支出。两者方向相反,不该配。
  const rev = R.reviewStatement({
    rows: [cand('p1:l1', '2026-07-05', -25, 'AMAZON')],
    header: HEADER,
    bankTx: [tx('b1', '2026-07-05', -25, 'AMAZON REFUND')],
    fileKey: 'f1',
  });
  assert.strictEqual(rev.rows[0].state, 'new',
    '退款和消费配上了 ——「已对账」打在错的一对上,之后再也查不出来');
});

check('①e 写回账本时翻回账本口径(金额恒正,方向由 kind 表达)', () => {
  const out = R.candidateToEntry(cand('p1:l1', '2026-07-05', -91.69, 'AMAZON'), 'f1');
  assert.strictEqual(out.amount, 91.69, '账本口径金额恒正');
  assert.strictEqual(out.kind, 'expense');
  const income = R.candidateToEntry(cand('p1:l2', '2026-07-20', 3000, 'PAYROLL'), 'f1');
  assert.strictEqual(income.kind, 'income', '收入被记成了支出 —— 第二个符号转换点写反了');
  assert.strictEqual(income.amount, 3000);
});

// ── ② 默认勾选:必须站在「不重复记账」这一边 ────────────────────────────
check('②a 默认只勾 new,不勾 matched', () => {
  const rev = R.reviewStatement({
    rows: [cand('p1:l1', '2026-07-05', -91.69, 'AMAZON'), cand('p1:l2', '2026-07-06', -10, 'COFFEE')],
    header: HEADER,
    bankTx: [tx('b1', '2026-07-05', 91.69, 'AMAZON')],
    fileKey: 'f1',
  });
  looseDeepEqual(rev.defaultSelected, ['p1:l2'],
    '默认勾上了已配对的行 —— 那是把银行已经有的那笔又记一遍,月支出直接翻倍');
});

check('②b 这份单子已经接受过的行标 imported 且默认不勾', () => {
  const existing = [{ sourceRef: R.statementSourceRef('f1', 'p1:l1') }];
  const rev = R.reviewStatement({
    rows: [cand('p1:l1', '2026-07-05', -91.69, 'AMAZON')],
    header: HEADER, bankTx: [], existing, fileKey: 'f1',
  });
  assert.strictEqual(rev.rows[0].state, 'imported', '幂等键没生效 —— 同一份单子接受两次,重复的是钱');
  looseDeepEqual(rev.defaultSelected, []);
});

check('②c 幂等键按文件区分 —— 别的单子的记录不许误判成「已导入」', () => {
  const existing = [{ sourceRef: R.statementSourceRef('OTHER_FILE', 'p1:l1') }];
  const rev = R.reviewStatement({
    rows: [cand('p1:l1', '2026-07-05', -91.69, 'AMAZON')],
    header: HEADER, bankTx: [], existing, fileKey: 'f1',
  });
  assert.strictEqual(rev.rows[0].state, 'new', '两份不同的单子共用了幂等键 —— 第二份会被整批吞掉');
});

check('②d imported 优先于 matched —— 已经进过账的不该再劝人「配上了」', () => {
  const existing = [{ sourceRef: R.statementSourceRef('f1', 'p1:l1') }];
  const rev = R.reviewStatement({
    rows: [cand('p1:l1', '2026-07-05', -91.69, 'AMAZON')],
    header: HEADER,
    bankTx: [tx('b1', '2026-07-05', 91.69, 'AMAZON')],
    existing, fileKey: 'f1',
  });
  assert.strictEqual(rev.rows[0].state, 'imported');
});

check('②e 非本前缀的 sourceRef 不许被当成 statement 导入记录', () => {
  looseDeepEqual([...R.importedRowIds([{ sourceRef: 'receipt:abc:1' }, {}], 'f1')], []);
});

// ── ③ 差额与诊断 ───────────────────────────────────────────────────────────
check('③a 有期初+期末才报差额,并接上四步诊断', () => {
  const rev = R.reviewStatement({
    rows: [cand('p1:l1', '2026-07-05', -91.69, 'AMAZON')],
    header: HEADER, bankTx: [], fileKey: 'f1',
  });
  assert.ok(rev.reconcile, '有断言却没算差额');
  assert.strictEqual(rev.reconcile.delta, -10, '0 + (−91.69) 对 −101.69,差 −10');
  assert.ok(rev.diagnosis, '有差额却没接诊断 —— 只报「差 $X」等于没做');
  assert.strictEqual(rev.diagnosis.reason, 'unexplained', '凑不出精确解就该只报线索');
});

check('③b 抽不到期初/期末 → 不报差额,**不许编一个出来**', () => {
  const rev = R.reviewStatement({
    rows: [cand('p1:l1', '2026-07-05', -91.69)],
    header: { periodStart: '2026-07-01', periodEnd: '2026-07-31' },
    bankTx: [], fileKey: 'f1',
  });
  assert.strictEqual(rev.reconcile, null, '没有断言却报了差额 —— 那个数字是编的,会把人引到错的地方');
  assert.strictEqual(rev.diagnosis, null);
});

check('③c 差额恰好等于某笔候选行 → 诊断给出「补录这一笔」', () => {
  const rev = R.reviewStatement({
    rows: [cand('p1:l1', '2026-07-05', -91.69, 'AMAZON'), cand('p1:l2', '2026-07-06', -10, 'COFFEE')],
    header: { ...HEADER, closingBalance: -101.69 },
    bankTx: [tx('b1', '2026-07-05', 91.69, 'AMAZON')],
    fileKey: 'f1',
  });
  // 账本里只有 AMAZON;COFFEE 只在单子上 —— 但断言是对**解析出的行**求和,所以这里平。
  assert.strictEqual(rev.reconcile.delta, 0);
  assert.strictEqual(rev.diagnosis.reason, 'balanced');
});

// ── ④ 符号约定只有一个翻号点(源码层)───────────────────────────────────
check('④ 全仓只有 bankTxToItems 一处翻号', () => {
  const src = read('lib/portal/statement-reconcile.ts');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const flips = code.match(/-\s*t\.amount|-\s*tx\.amount|-\s*b\.amount/g) || [];
  assert.strictEqual(flips.length, 1,
    `翻号出现了 ${flips.length} 处 —— 分散的符号转换是这条链上最容易静默算错的东西,只许有一处`);
  assert.ok(/export function bankTxToItems/.test(src) && /amount: -t\.amount/.test(src),
    '翻号不在 bankTxToItems 里 —— 约定要在一个能被指着看的地方');
});

// ── ⑤ 面板接线:三条红线在 UI 上的落点 ─────────────────────────────────────
const SHEET = read('components/portal/finance/ReconcileSheet.tsx');
const SHEET_CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

check('⑤a 文件不出设备:面板里不许有任何网络调用', () => {
  for (const bad of ['fetch(', 'XMLHttpRequest', 'navigator.sendBeacon', 'WebSocket']) {
    assert.ok(!SHEET_CODE.includes(bad),
      `对账面板里出现了 ${bad} —— statement 是最敏感的文件之一,「传上去智能识别」这件事本身就不该发生`);
  }
  assert.ok(/openPdf/.test(SHEET_CODE), '没走本机 pdf.js');
});

check('⑤b 三处异步各有可见失败态 + 重试出口(红线:不许「点了没反应」)', () => {
  assert.ok((SHEET_CODE.match(/role="alert"/g) || []).length >= 2,
    '失败提示没有 role=alert —— 读屏用户完全不知道出了事');
  assert.ok(/catch \{[\s\S]{0,400}?setErr\(/.test(SHEET_CODE),
    '读文件失败被吞了 —— 界面会停在「正在读取」或直接回到初始态,人以为按钮坏了');
  assert.ok(/setPhase\('idle'\)/.test(SHEET_CODE), '失败后要能回到「再选一份」,不能卡死在中间态');
});

check('⑤c 解析器不写账:落库只发生在显式点击之后', () => {
  // addExpense 只许出现在 saveSelected 里(那是「记入账本」按钮的 handler)
  const at = SHEET_CODE.indexOf('function saveSelected');
  assert.ok(at > 0, 'saveSelected 不见了 —— 这条测试的锚点失效,请更新');
  const before = SHEET_CODE.slice(0, at);
  const after = SHEET_CODE.slice(at);
  assert.ok(!/addExpense\(/.test(before),
    'saveSelected 之外出现了落库 —— 解析完就写账的话,一次版式误判就污染账本,且重新解析救不回来');
  assert.ok(/addExpense\(/.test(after));
});

check('⑤d 落库那一刻再查一次幂等 —— 连点两次不许记两遍', () => {
  const at = SHEET_CODE.indexOf('function saveSelected');
  const fn = SHEET_CODE.slice(at, SHEET_CODE.indexOf('\n  }', at + 200));
  assert.ok(/importedRowIds\(/.test(fn),
    '只靠打开面板时算的状态做幂等 —— 中间没重新解析就连点两次「记入账本」,同一批会再记一遍');
});

check('⑤e 算钱的事不在组件里重写一遍', () => {
  for (const fn of ['parseStatement', 'reviewStatement', 'candidateToEntry']) {
    assert.ok(SHEET_CODE.includes(fn), `面板没复用 ${fn} —— 组件里另写一套就没有契约管得住它`);
  }
  assert.ok(!/toCents|matchStatementRows|amountTokensOfLine/.test(SHEET_CODE),
    '面板里出现了算钱/配对的实现 —— 那些必须留在纯函数层,否则改一次要改两处');
});

check('⑤f 颜色全走 token,没有硬编码色值', () => {
  const hits = SHEET.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [];
  const bad = hits.filter((h) => h !== '#fff' && h !== '#FFF');
  assert.deepStrictEqual(bad, [],
    `硬编码色值:${bad.join(', ')} —— 夜间模式下会瞎(设计系统红线)`);
});

check('⑤h 诊断给得出精确解时必须有两颗按钮 —— 不能只把建议念一遍', () => {
  assert.ok(/就这么改/.test(SHEET) && /不对,我自己来/.test(SHEET),
    '只显示了建议、没有「就这么改」/「不对,我自己来」—— 那还是要人自己去翻 PDF 手动改,等于没做');
  assert.ok(/onClick=\{applyFix\}/.test(SHEET_CODE), '「就这么改」不接任何动作(死按钮)');
  assert.ok(/setRefusedFix\(true\)/.test(SHEET_CODE), '「不对」点了之后建议还在,会一直劝');
});

check('⑤i 一键改完自校验要跟着重算 —— 否则改对了还继续显示「差 $X」', () => {
  assert.ok(/selfCheckStatement\(/.test(SHEET_CODE),
    '沿用了旧的 selfCheck —— 面板会在已经改对之后继续报差额,人会以为按钮没生效');
});

check('⑤j 只有「金额读错」能一键改 —— 改账本的动作不许代劳', () => {
  const at = SHEET_CODE.indexOf('function applyFix');
  assert.ok(at > 0, 'applyFix 不见了 —— 测试锚点失效,请更新');
  const fn = SHEET_CODE.slice(at, SHEET_CODE.indexOf('\n  }', at));
  assert.ok(/fix\.kind !== 'reread_amount'/.test(fn),
    'applyFix 没限定种类 —— 让它去替人「作废账本里那条」是越权,那是钱的动作');
  assert.ok(!/addExpense|voidLedger/.test(fn), 'applyFix 里出现了改账本的动作 —— 它只该改我的解析结果');
});

check('⑤g 入口挂在财务·交易页,且说清了「不上传」', () => {
  const tab = read('components/portal/finance/FinanceTab.tsx');
  const code = tab.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(/<ReconcileSheet\b/.test(code), '面板没挂上去 —— 又是一个点不开的功能');
  assert.ok(/setReconcileOpen\(true\)/.test(code), '没有打开它的按钮');
  assert.ok(/只在本机解析/.test(code),
    '入口文案没写清「不上传」—— 传账单这件事人得先知道文件去哪了才敢点');
});

const fails = results.filter((r) => r[0] === 'FAIL');
if (fails.length) {
  assert.fail(`statement-reconcile 有 ${fails.length} 条不过:\n  - `
    + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
}
console.log(`statement-reconcile: OK(${results.length} 条,符号约定只有一处翻号 / 默认不重复记账 / 幂等键按文件 / 没断言不编差额)`);
