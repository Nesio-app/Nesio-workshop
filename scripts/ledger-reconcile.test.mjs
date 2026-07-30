/**
 * ledger-reconcile — 对账与差额诊断的契约(L2)。真跑纯函数,不断言源码长相。
 *
 * 这一层最贵的三条错误,各有断言:
 *   ① **把查不出的差额悄悄抹平** —— 账面平了、问题埋进历史,明年报税带着利息回来。
 *   ② **配错对** —— 金额放宽一点点就会把不同的两笔配到一起,「已对账」标记打在
 *      错的一对上,之后再也查不出来。所以金额必须分分不差。
 *   ③ **瞎猜修正** —— 一个「大概是这里」的错误建议比没有建议更贵:人会照着改。
 *      凑不出精确解就只报线索。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { deepEqual as looseDeepEqual } from 'node:assert';

const ROOT = new URL('..', import.meta.url).pathname;
function load(rel) {
  const js = ts.transpileModule(fs.readFileSync(ROOT + rel, 'utf8'), {
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
const R = load('lib/portal/ledger-reconcile.ts');

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

/** 流出为负、流入为正 —— 方向在入口统一好,对账层不猜。 */
const row = (id, occurredAt, amount, merchant) => ({ id, occurredAt, amount, merchant });
const PERIOD = { periodStart: '2026-07-01', periodEnd: '2026-07-31' };

// ── ① 断言对账:一套函数吃四种场景 ──────────────────────────────────────────
check('①a 期末余额型:期初 + Σ交易 = 期末', () => {
  const items = [row('a', '2026-07-05', -91.69), row('b', '2026-07-20', 2000)];
  const r = R.reconcileAssertion(items, {
    kind: 'balance', ...PERIOD, openingBalance: 1000, expected: 2908.31,
  });
  assert.strictEqual(r.computed, 2908.31);
  assert.strictEqual(r.delta, 0);
  assert.strictEqual(r.balanced, true);
});

check('①b 合计型(年终报告/税单):不需要期初', () => {
  const r = R.reconcileAssertion([row('a', '2026-07-05', -10), row('b', '2026-07-06', -20)], {
    kind: 'total', ...PERIOD, expected: -30,
  });
  assert.strictEqual(r.balanced, true);
});

check('①c 分为单位比较 —— 0.1+0.2 那类浮点毛刺不许把平账判成有差', () => {
  const r = R.reconcileAssertion([row('a', '2026-07-05', 0.1), row('b', '2026-07-06', 0.2)], {
    kind: 'total', ...PERIOD, expected: 0.3,
  });
  assert.strictEqual(r.balanced, true, '0.1+0.2 !== 0.3 的浮点毛刺漏进了对账判定');
});

check('①d 作废的条目不计入 —— 那正是作废的意义', () => {
  const items = [row('a', '2026-07-05', -10), { ...row('b', '2026-07-06', -999), voided: true }];
  const r = R.reconcileAssertion(items, { kind: 'total', ...PERIOD, expected: -10 });
  assert.strictEqual(r.balanced, true);
});

check('①e 期间外的条目单列 —— 那是解析自校验 B(日期跑出期间 = 多半解析错行)', () => {
  const items = [row('a', '2026-07-05', -10), row('b', '2025-01-01', -10)];
  const r = R.reconcileAssertion(items, { kind: 'total', ...PERIOD, expected: -10 });
  looseDeepEqual(r.outOfPeriod.map((i) => i.id), ['b']);
  assert.strictEqual(r.balanced, true, '期间外的条目不该被算进区间合计');
});

check('①f 有期间外条目时**先别锁** —— 锁了错日期就固化进已关账期间', () => {
  const withOut = R.reconcileAssertion(
    [row('a', '2026-07-05', -10), row('b', '2025-01-01', -10)],
    { kind: 'total', ...PERIOD, expected: -10 },
  );
  assert.strictEqual(R.reconcileVerdict(withOut), 'attention',
    '差额为零就放行会让「日期解析错了」这种错悄悄进已锁定期间');
  const clean = R.reconcileAssertion([row('a', '2026-07-05', -10)], { kind: 'total', ...PERIOD, expected: -10 });
  assert.strictEqual(R.reconcileVerdict(clean), 'clean');
  const off = R.reconcileAssertion([row('a', '2026-07-05', -10)], { kind: 'total', ...PERIOD, expected: -20 });
  assert.strictEqual(R.reconcileVerdict(off), 'adjustable');
});

// ── ② 配对:金额必须分分不差 ────────────────────────────────────────────────
check('②a 金额一致、日期在容差内 → 配上', () => {
  const m = R.matchStatementRows(
    [row('s1', '2026-07-12', -91.69, 'AMAZON MKTPL')],
    [row('l1', '2026-07-14', -91.69, 'AMAZON')],
  );
  assert.strictEqual(m.matched.length, 1);
  assert.strictEqual(m.matched[0].dayGap, 2);
  looseDeepEqual(m.onlyInStatement, []);
  looseDeepEqual(m.onlyInLedger, []);
});

check('②b 金额差一分就不配 —— 放宽金额会把「已对账」打在错的一对上', () => {
  const m = R.matchStatementRows(
    [row('s1', '2026-07-12', -91.69, 'AMAZON')],
    [row('l1', '2026-07-12', -91.70, 'AMAZON')],
  );
  looseDeepEqual(m.matched, []);
  looseDeepEqual(m.onlyInStatement.map((i) => i.id), ['s1']);
  looseDeepEqual(m.onlyInLedger.map((i) => i.id), ['l1']);
});

check('②c 日期超出容差就不配', () => {
  const m = R.matchStatementRows(
    [row('s1', '2026-07-01', -10, 'X')],
    [row('l1', '2026-07-20', -10, 'X')],
  );
  looseDeepEqual(m.matched, []);
});

check('②d 同日同额两笔:商户名对得上的优先配,且一对一不重复占用', () => {
  const m = R.matchStatementRows(
    [row('s1', '2026-07-12', -10, 'STARBUCKS'), row('s2', '2026-07-12', -10, 'AMAZON')],
    [row('l1', '2026-07-12', -10, 'AMAZON'), row('l2', '2026-07-12', -10, 'STARBUCKS')],
  );
  assert.strictEqual(m.matched.length, 2, '一对一被破坏 —— 同一条分录被配了两次');
  const pairs = Object.fromEntries(m.matched.map((p) => [p.statement.id, p.ledger.id]));
  looseDeepEqual(pairs, { s1: 'l2', s2: 'l1' }, '商户名对得上的没有优先配');
});

check('②e 作废的分录不参与配对', () => {
  const m = R.matchStatementRows(
    [row('s1', '2026-07-12', -10, 'X')],
    [{ ...row('l1', '2026-07-12', -10, 'X'), voided: true }],
  );
  looseDeepEqual(m.matched, []);
  looseDeepEqual(m.onlyInLedger, [], '作废的分录不该被列进「只在我账上有」让人去处理第二遍');
});

check('②f 规模冒烟:上万条分录 × 上千行不许退化成全表内积', () => {
  // 用户现在就有几千条记录,全年对账时这里是最容易变成「点一下 app 就死」的地方
  // (地点卡的 placeCoords 用 O(节点 × 上万点) 扫,已经栽过一次)。
  // 金额是硬相等条件 —— 拿它当桶键,内积只发生在同额条目之间。
  const ledger = []; const statement = [];
  for (let i = 0; i < 12000; i++) ledger.push(row(`l${i}`, '2026-07-05', -(i / 100 + 1)));
  for (let i = 0; i < 1500; i++) statement.push(row(`s${i}`, '2026-07-05', -(i / 100 + 1)));
  const t0 = Date.now();
  const m = R.matchStatementRows(statement, ledger);
  const ms = Date.now() - t0;
  assert.strictEqual(m.matched.length, 1500, '分桶之后配对结果必须和全表内积一模一样');
  assert.ok(ms < 1500, `配对花了 ${ms}ms —— 退化成全表内积了,真机上就是点一下卡住`);
});

// ── ③ 诊断:四步,且只有精确解才提议 ────────────────────────────────────────
const diag = (ledger, statement, assertion, raws) => {
  const r = R.reconcileAssertion(ledger, assertion);
  const m = R.matchStatementRows(statement, ledger);
  return R.diagnoseDelta(r, m, raws);
};

check('③a 差额恰好等于某笔「只在银行有」 → 我漏记了,给出补录', () => {
  const d = diag(
    [row('l1', '2026-07-05', -10, 'A')],
    [row('s1', '2026-07-05', -10, 'A'), row('s2', '2026-07-09', -25.5, 'B')],
    { kind: 'total', ...PERIOD, expected: -35.5 },
  );
  assert.strictEqual(d.reason, 'missing_in_ledger');
  assert.strictEqual(d.fix.kind, 'add_missing');
  looseDeepEqual(d.fix.targetIds, ['s2']);
  assert.strictEqual(d.fix.resultingDelta, 0, '提议了一个改完还不平的修正 —— 那就不是精确解');
});

check('③b 差额恰好等于某笔「只在我账上有」的相反数 → 重复了,给出作废', () => {
  const d = diag(
    [row('l1', '2026-07-05', -10, 'A'), row('l2', '2026-07-05', -10, 'A')],
    [row('s1', '2026-07-05', -10, 'A')],
    { kind: 'total', ...PERIOD, expected: -10 },
  );
  assert.strictEqual(d.reason, 'extra_in_ledger');
  assert.strictEqual(d.fix.kind, 'void_duplicate');
  assert.strictEqual(d.fix.targetIds.length, 1);
  assert.strictEqual(d.fix.resultingDelta, 0);
});

check('③c 千分位逗号被当成列分隔:差额指向原文里的另一个数 → 给出「按 1234.56 读」', () => {
  // 这是**解析器自校验**那一场:被求和的就是解析出的行本身(期初 + Σ行 = 期末),
  // 断言来自 statement 页眉上印的期末余额。所以 reconcileAssertion 要吃 rows,
  // 不是吃账本 —— 第一版测试把 items 写成 []、只把行喂给 match,于是差额算成了
  // 整个期末余额,和「读错一位」对不上,诊断报 unexplained。错的是测试的搭法。
  const rows = [row('s1', '2026-07-12', -1, 'AMAZON MKTPL')];
  const r = R.reconcileAssertion(rows, { kind: 'total', ...PERIOD, expected: -1234.56 });
  const d = R.diagnoseDelta(r, R.matchStatementRows(rows, []), {
    s1: '07/12 AMAZON MKTPL*2K4LM 1,234.56',
  });
  assert.strictEqual(d.reason, 'amount_misread');
  assert.strictEqual(d.fix.kind, 'reread_amount');
  assert.strictEqual(d.fix.to, -1234.56, '没给出「已经算好的具体改法」,只报差额等于没做');
  looseDeepEqual(d.locus.map((i) => i.id), ['s1'], '没定位到具体哪一行');
});

check('③d 没有原文就不做金额诊断 —— 不许凭空猜一个数', () => {
  const rows = [row('s1', '2026-07-12', -1, 'AMAZON')];
  const r = R.reconcileAssertion(rows, { kind: 'total', ...PERIOD, expected: -1234.56 });
  const d = R.diagnoseDelta(r, R.matchStatementRows(rows, []), {});
  assert.notStrictEqual(d.reason, 'amount_misread');
  assert.strictEqual(d.fix.kind, 'none');
});

check('③e 差额恰好等于两笔之和 → 列出这两笔', () => {
  const d = diag(
    [],
    [row('s1', '2026-07-05', -10, 'A'), row('s2', '2026-07-06', -25.5, 'B')],
    { kind: 'total', ...PERIOD, expected: -35.5 },
  );
  assert.strictEqual(d.reason, 'missing_two');
  looseDeepEqual(d.fix.targetIds.sort(), ['s1', 's2']);
});

check('③f 凑不出精确解 → **不提议**,只报线索(红线③)', () => {
  const d = diag(
    [row('l1', '2026-07-05', -10, 'A')],
    [row('s1', '2026-07-05', -10, 'A')],
    { kind: 'total', ...PERIOD, expected: -13.33 },
  );
  assert.strictEqual(d.reason, 'unexplained');
  assert.strictEqual(d.fix.kind, 'none', '凑不出精确解还提议 —— 人照着错建议改,账会更乱');
  assert.strictEqual(d.delta, -3.33, '差额本身还是要如实报出来');
});

check('③g 有歧义(两笔金额都等于差额)时不提议 —— 挑一个就是瞎猜', () => {
  const d = diag(
    [],
    [row('s1', '2026-07-05', -10, 'A'), row('s2', '2026-07-06', -10, 'B')],
    { kind: 'total', ...PERIOD, expected: -10 },
  );
  assert.notStrictEqual(d.fix.kind, 'add_missing',
    '两笔都等于差额时挑了一笔提议 —— 有一半概率改错,而人会照着改');
});

check('③h 平账时诊断就是「平了」,不生造修正', () => {
  const d = diag(
    [row('l1', '2026-07-05', -10, 'A')],
    [row('s1', '2026-07-05', -10, 'A')],
    { kind: 'total', ...PERIOD, expected: -10 },
  );
  assert.strictEqual(d.reason, 'balanced');
  assert.strictEqual(d.fix.kind, 'none');
});

check('③i 候选太多时不做两两枚举 —— 巧合配对的概率随规模上升,精确解反而不可信', () => {
  // 金额全取奇数,差额取偶数 → **没有单笔**等于差额,只有 (-1)+(-3) 这一对凑得出。
  // (第一版这里用了连续整数,差额 -3 恰好等于其中一笔,于是先被「漏记一笔」命中,
  //  两两枚举那段根本没跑到 —— 断言形同虚设。自查反证时抓到的。)
  const odd = [];
  for (let i = 0; i < 60; i++) odd.push(row(`s${i}`, '2026-07-05', -(2 * i + 1)));
  const r = R.reconcileAssertion([], { kind: 'total', ...PERIOD, expected: -4 });
  const d = R.diagnoseDelta(r, R.matchStatementRows(odd, []), {});
  assert.strictEqual(d.reason, 'unexplained', '60 条候选还去两两枚举 —— 凑出来的「精确解」多半是巧合');
  assert.strictEqual(d.fix.kind, 'none');

  // 而候选少的时候必须照常枚举(别把上限设成「永远不枚举」)
  const few = odd.slice(0, 6);
  const r2 = R.reconcileAssertion([], { kind: 'total', ...PERIOD, expected: -4 });
  assert.strictEqual(R.diagnoseDelta(r2, R.matchStatementRows(few, []), {}).reason, 'missing_two');
});

// ── ④ 查不出的差额:记一笔看得见的,不许抹平 ────────────────────────────────
check('④a 调整分录是一条**真的分录**,金额就是差额,标记来源可追溯', () => {
  const r = R.reconcileAssertion([row('l1', '2026-07-05', -10)], { kind: 'total', ...PERIOD, expected: -13.2 });
  const adj = R.reconciliationAdjustment(r, '2026-07-31', '2026-07 对账查不出的差额');
  assert.strictEqual(adj.amount, -3.2, '调整额加上去之后必须正好等于你断言的数');
  assert.strictEqual(adj.occurredAt, '2026-07-31');
  assert.strictEqual(adj.ledgerSource, 'reconcile', '来源没标出来 —— 以后没人分得清它是真交易还是调整');
  assert.ok(adj.merchant, '调整分录要有可见的名字,不能是一条无名的数');
  // 加上调整之后确实平了
  const after = R.reconcileAssertion(
    [row('l1', '2026-07-05', -10), { id: 'adj', occurredAt: adj.occurredAt, amount: adj.amount }],
    { kind: 'total', ...PERIOD, expected: -13.2 },
  );
  assert.strictEqual(after.balanced, true);
});

check('④b 平账时不生成调整 —— 免得每个平的月份都塞一条 $0 噪音', () => {
  const r = R.reconcileAssertion([row('l1', '2026-07-05', -10)], { kind: 'total', ...PERIOD, expected: -10 });
  assert.strictEqual(R.reconciliationAdjustment(r, '2026-07-31', 'x'), null);
});

check('④c 核心层不许「自动抹平」:没有任何路径能在人不点头的情况下改断言/吞差额', () => {
  const src = fs.readFileSync(`${ROOT}lib/portal/ledger-reconcile.ts`, 'utf8');
  // reconcileAssertion 里不许出现任何把 delta 归零的动作
  const fn = src.slice(src.indexOf('export function reconcileAssertion'), src.indexOf('// ── 未达账项'));
  assert.ok(!/delta\s*=\s*0|deltaCents\s*=\s*0/.test(fn),
    '对账函数里出现了把差额直接置零的动作 —— 查不出的差额必须留在明面上');
  assert.ok(!/Math\.abs\(deltaCents\)\s*<|tolerance/i.test(fn),
    '对账函数里出现了「差得不多就算平」的容差 —— 那就是抹平,只是换了个名字');
});

// ── ⑤ 原文金额抠取 ─────────────────────────────────────────────────────────
check('⑤a 千分位 / 括号负数 / 美元号都认得', () => {
  looseDeepEqual(R.amountCandidatesFromRaw('07/12 FOO 1,234.56 $2,000.00 (45.67)'),
    [1234.56, 2000, -45.67]);
});

check('⑤b 不把无小数的裸整数当金额 —— 日期 07/12、卡号尾号 2K4LM 里的数会全中', () => {
  looseDeepEqual(R.amountCandidatesFromRaw('07/12 AMAZON MKTPL*2K4LM 91.69'), [91.69]);
});

const fails = results.filter((r) => r[0] === 'FAIL');
if (fails.length) {
  assert.fail(`ledger-reconcile 有 ${fails.length} 条不过:\n  - `
    + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
}
console.log(`ledger-reconcile: OK(${results.length} 条,断言对账 / 配对不放宽金额 / 四步诊断只给精确解 / 差额不抹平)`);
