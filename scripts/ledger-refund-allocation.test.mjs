/**
 * ledger-refund + ledger-allocation — 退款配对与分摊的契约(L4)。
 *
 * 这两件事各有一条「错了很贵、但看起来没事」的失败模式:
 *
 *   退款配对错 → **两笔真实的钱互相抵消**。月支出凭空少一块,而账面上
 *   两条记录都还在、都对,只是关系连错了。人几乎不可能靠肉眼发现。
 *   所以判据必须保守(金额不超原额 / 退款晚于消费 / 商户名对得上),
 *   而且是**建议 + 确认**,不自动生效。
 *
 *   分摊合计不等于原额 → 按类别汇总和总额对不上。这种错会在季度/年度
 *   回看时才暴露,那时早已找不到是哪一笔。所以差一分都不许存。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { deepEqual as looseDeepEqual } from 'node:assert';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');

/** 去掉 import 行再跑 —— storage-health 只在写失败分支用到,这里不测那条。 */
function runSource(rel, extraGlobals = {}) {
  const src = read(rel).replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, {
    module: m, exports: m.exports,
    JSON, Array, Object, Set, Map, Number, Math, String, Boolean, Date, RegExp, isNaN,
    reportStorageDropped: () => {}, require: () => ({}),
    ...extraGlobals,
  });
  return m.exports;
}
const R = runSource('lib/portal/ledger-refund.ts', { window: undefined });
const A = runSource('lib/portal/ledger-allocation.ts');

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

const buy = (id, occurredAt, amount, merchant) => ({ id, occurredAt, amount, merchant });

// ── ① 退款配对:保守判据 ────────────────────────────────────────────────────
check('①a 全额退 + 同商户 + 窗口内 → 配上,且标为 exact', () => {
  const c = R.refundCandidates(
    buy('r1', '2026-07-20', 91.69, 'AMAZON REFUND'),
    [buy('p1', '2026-07-05', 91.69, 'AMAZON MKTPL*2K4LM')],
  );
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].purchase.id, 'p1');
  assert.strictEqual(c[0].exact, true);
  assert.strictEqual(c[0].dayGap, 15);
});

check('①b 部分退款也认(退款常常只退一部分)', () => {
  const c = R.refundCandidates(
    buy('r1', '2026-07-20', 25.5, 'AMAZON RETURN'),
    [buy('p1', '2026-07-05', 91.69, 'AMAZON MKTPL')],
  );
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].exact, false, '部分退不该被标成全额退');
});

check('①c 退得比买的多 → 不配 —— 让它以未达账项的身份被对账暴露', () => {
  looseDeepEqual(R.refundCandidates(
    buy('r1', '2026-07-20', 200, 'AMAZON REFUND'),
    [buy('p1', '2026-07-05', 91.69, 'AMAZON')],
  ), []);
});

check('①d 退款不可能早于消费', () => {
  looseDeepEqual(R.refundCandidates(
    buy('r1', '2026-07-01', 91.69, 'AMAZON REFUND'),
    [buy('p1', '2026-07-05', 91.69, 'AMAZON')],
  ), []);
});

check('①e 超出退货窗口不配', () => {
  looseDeepEqual(R.refundCandidates(
    buy('r1', '2027-07-20', 91.69, 'AMAZON REFUND'),
    [buy('p1', '2026-07-05', 91.69, 'AMAZON')],
  ), []);
});

check('①f 商户名对不上 → 不配(同额巧合唯一能挡住的就是这条)', () => {
  looseDeepEqual(R.refundCandidates(
    buy('r1', '2026-07-20', 91.69, 'STARBUCKS REFUND'),
    [buy('p1', '2026-07-05', 91.69, 'AMAZON MKTPL')],
  ), [], '两笔不相干的钱被配成了退款关系 —— 月支出凭空少一块,而两条记录看起来都对');
});

check('①g 退款词不参与商户比对(AMAZON REFUND 要能对上 AMAZON MKTPL)', () => {
  assert.strictEqual(R.merchantStem('AMAZON REFUND'), 'AMAZON');
  assert.strictEqual(R.merchantStem('AMAZON 退款'), 'AMAZON');
  assert.ok(R.refundCandidates(
    buy('r1', '2026-07-20', 10, 'SQ *BLUE BOTTLE CREDIT'),
    [buy('p1', '2026-07-05', 10, 'SQ *BLUE BOTTLE COFFEE')],
  ).length === 1);
});

check('①h 名字太短不认 —— 两个字的「店」谁都对得上', () => {
  looseDeepEqual(R.refundCandidates(
    buy('r1', '2026-07-20', 10, 'AB'),
    [buy('p1', '2026-07-05', 10, 'AB')],
  ), []);
});

check('①i 否决过的一对不再推荐', () => {
  const rejected = new Set([R.refundPairKey('r1', 'p1')]);
  looseDeepEqual(R.refundCandidates(
    buy('r1', '2026-07-20', 91.69, 'AMAZON REFUND'),
    [buy('p1', '2026-07-05', 91.69, 'AMAZON')],
    { rejected },
  ), [], '被否过的建议又弹出来 —— 比不建议更烦,而且会让人怀疑「不是」有没有生效');
});

check('①j 排序:全额退优先,再按日期近', () => {
  const c = R.refundCandidates(
    buy('r1', '2026-07-20', 50, 'AMAZON REFUND'),
    [
      buy('pA', '2026-07-19', 91.69, 'AMAZON'),   // 日期最近但只能部分退
      buy('pB', '2026-07-01', 50, 'AMAZON'),      // 全额退
    ],
  );
  assert.strictEqual(c[0].purchase.id, 'pB', '全额退没排在前面 —— 那是最可信的一种');
});

check('①k 只有「全额 + 同商户 + 30 天内」才够格默认选中', () => {
  const strong = R.refundCandidates(buy('r1', '2026-07-20', 91.69, 'AMAZON REFUND'), [buy('p1', '2026-07-05', 91.69, 'AMAZON')])[0];
  assert.strictEqual(R.refundSuggestionIsStrong(strong), true);
  const partial = R.refundCandidates(buy('r2', '2026-07-20', 25, 'AMAZON RETURN'), [buy('p1', '2026-07-05', 91.69, 'AMAZON')])[0];
  assert.strictEqual(R.refundSuggestionIsStrong(partial), false,
    '部分退被默认勾上 —— 人看到「已经帮你选好了」多半直接确认,而配错会让两笔真钱互相抵消');
  const far = R.refundCandidates(buy('r3', '2026-10-20', 91.69, 'AMAZON REFUND'), [buy('p1', '2026-07-05', 91.69, 'AMAZON')])[0];
  assert.strictEqual(R.refundSuggestionIsStrong(far), false);
});

check('①l 自己不能配自己', () => {
  looseDeepEqual(R.refundCandidates(buy('x', '2026-07-20', 10, 'AMAZON'), [buy('x', '2026-07-20', 10, 'AMAZON')]), []);
});

check('①n 多笔退款累加超过原额要能提前拦住 —— 别指望净额钳到 0 那道保险', () => {
  // 单笔不超原额是候选阶段挡的,但 $91.69 挂两笔 $50 每笔单看都合法。
  // 靠 netLedgerAmount 钳到 0 的话,人看到的是「这笔花了 $0」,而不是「你可能挂错了」。
  looseDeepEqual(R.wouldOverRefund(91.69, [50], 50), { over: true, excess: 8.31 });
  looseDeepEqual(R.wouldOverRefund(91.69, [50], 41.69), { over: false, excess: 0 });
  looseDeepEqual(R.wouldOverRefund(91.69, [], 91.69), { over: false, excess: 0 }, '全额退不该被判成超额');
});

check('①m 配对只存关系,不存净额(源码层)', () => {
  const src = read('lib/portal/ledger-refund.ts');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/netAmount|netLedgerAmount\s*=/.test(code),
    '退款模块里出现了存净额的动作 —— 跨月退款会让上月数字在本月悄悄变(QA #21 那一类)');
});

// ── ② 分摊:合计必须一分不差 ────────────────────────────────────────────────
check('②a 合计相等才通过', () => {
  const v = A.validateAllocation(300, [
    { target: '家里囤货', amount: 120 }, { target: '猫', amount: 80 }, { target: '聚餐', amount: 100 },
  ]);
  assert.strictEqual(v.ok, true);
});

check('②b 差一分都不通过,并报出还差多少', () => {
  const v = A.validateAllocation(300, [{ target: 'a', amount: 120 }, { target: 'b', amount: 179.99 }]);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'sum_mismatch');
  assert.strictEqual(v.delta, 0.01, '只说「合计不对」不够 —— 人得知道还剩多少要摊');
});

check('②c 负数/零份额不许 —— 那是另一笔交易,不是分摊', () => {
  assert.strictEqual(A.validateAllocation(100, [{ target: 'a', amount: 120 }, { target: 'b', amount: -20 }]).reason, 'nonpositive');
  assert.strictEqual(A.validateAllocation(100, [{ target: 'a', amount: 100 }, { target: 'b', amount: 0 }]).reason, 'nonpositive');
});

check('②d 空分摊不算分摊', () => {
  assert.strictEqual(A.validateAllocation(100, []).reason, 'empty');
});

check('②e 同一个去处出现两次要拦下 —— 多半是重复添加', () => {
  assert.strictEqual(A.validateAllocation(100, [{ target: 'a', amount: 60 }, { target: 'a', amount: 40 }]).reason, 'duplicate_target');
});

check('②f 分摊**不修改原分录**(源码层)', () => {
  const src = read('lib/portal/ledger-allocation.ts');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/entry\.amount\s*=|\.amount\s*=\s*[^=]/.test(code),
    '分摊改了原分录的金额 —— 原分录记的是「银行那天扣了多少」,改了就再也对不上账');
  for (const bad of ['localStorage', 'indexedDB']) {
    assert.ok(!code.includes(bad), `分摊层碰了存储(${bad})—— 它该是纯计算,存哪由调用方决定`);
  }
});

check('②g 平均分:余数给第一份,合计仍等于原额', () => {
  const s = A.splitEvenly(100, 3);
  looseDeepEqual(s.map((x) => x.amount), [33.34, 33.33, 33.33]);
  assert.strictEqual(A.validateAllocation(100, s).ok, true, '平均分出来的自己都过不了校验');
});

check('②h 按月摊:跨年月份要接上', () => {
  const m = A.amortizeMonthly(1200, '2026-11', 4);
  looseDeepEqual(m.map((x) => x.month), ['2026-11', '2026-12', '2027-01', '2027-02'],
    '跨年时月份接错 —— 明年一月的摊销会落到今年');
  assert.strictEqual(m.reduce((a, x) => a + Math.round(x.amount * 100), 0), 120000);
});

check('②i 按类别聚合:有分摊用分摊,没分摊用原额', () => {
  looseDeepEqual(
    A.allocationForCategoryTotals({ amount: 300, category: '超市' }),
    [{ target: '超市', amount: 300 }],
  );
  looseDeepEqual(
    A.allocationForCategoryTotals({ amount: 300, category: '超市' }, [{ target: '猫', amount: 300 }]),
    [{ target: '猫', amount: 300 }],
  );
});

// ── ③ 凭证与对账记录 ───────────────────────────────────────────────────────
const REC = read('lib/portal/reconcile-record.ts');
const REC_CODE = REC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const SHEET = read('components/portal/finance/ReconcileSheet.tsx');
const SHEET_CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

check('③a 对账记录不可改 —— 只有追加,没有原地改写', () => {
  assert.ok(/export function addReconcileRecord/.test(REC_CODE));
  assert.ok(!/export function updateReconcileRecord|export function editReconcileRecord/.test(REC_CODE),
    '给了改旧记录的口子 —— 记录记的是「那一刻的对账结论」,改了就没有审计线索可言');
});

check('③b 同一份文件的凭证 id 恒定 —— 重复上传不占两份空间', () => {
  const R2 = runSource('lib/portal/reconcile-record.ts', { window: undefined });
  assert.strictEqual(R2.voucherAssetId('a.pdf:123:456'), R2.voucherAssetId('a.pdf:123:456'));
  assert.notStrictEqual(R2.voucherAssetId('a.pdf:123:456'), R2.voucherAssetId('b.pdf:123:456'));
  assert.ok(!/[\s/\\]/.test(R2.voucherAssetId('my statement (1).pdf:1:2')),
    '文件名里的空格/括号进了 assetId —— 存取时会对不上');
});

check('③c 存储写失败要说出来,不许静默', () => {
  assert.ok(/reportStorageDropped\(\)/.test(REC_CODE), '记录写失败被吞了 —— 人以为留痕了,其实什么都没有');
  assert.ok(/return null/.test(REC_CODE), '写失败要让调用方知道(返回 null),不能假装成功');
});

check('③d 凭证失败**不回滚已入账** —— 但必须给可见提示', () => {
  const at = SHEET_CODE.indexOf('async function saveSelected');
  assert.ok(at > 0, 'saveSelected 不见了 —— 测试锚点失效,请更新');
  const fn = SHEET_CODE.slice(at);
  const vAt = fn.indexOf('putLocalFile');
  assert.ok(vAt > 0, '面板没存凭证');
  assert.ok(fn.indexOf('setPhase(\'saved\')') < vAt,
    '凭证存在入账之前 —— 凭证失败会把已经记好的账一起挡掉,那是本末倒置');
  assert.ok(/账已经记好了,但原件没存下来/.test(SHEET),
    '凭证没存上却不说 —— 人以为原件留下了,三个月后要查凭证时才发现没有');
});

check('③d2 凭证失败的提示要在**入账成功那一屏**渲染出来', () => {
  // 凭证/记录的失败发生在 setPhase('saved') 之后。只在 review 那一屏渲染 err 的话,
  // 这些提示 set 了却永远看不到 —— 本仓反复出现的「写了没接上」。第二遍自查抓到的。
  const at = SHEET_CODE.indexOf("phase === 'saved'");
  assert.ok(at > 0, 'saved 分支不见了 —— 测试锚点失效,请更新');
  const branch = SHEET_CODE.slice(at, at + 1200);
  assert.ok(/\{err && /.test(branch),
    '入账成功那一屏没渲染 err —— 凭证没存下来这件事你永远不会知道');
});

check('③e 凭证要先告诉人文件去哪了,再让他选', () => {
  assert.ok(/存在这台设备上,会进你自己的备份,不上任何服务器/.test(SHEET),
    'statement 是最敏感的文件之一 —— 留不留凭证得让人先知道它去哪再决定');
  assert.ok(/keepVoucher/.test(SHEET_CODE), '没给「不留凭证」的出口');
});

check('③f 超出本机文件上限时说清是「太大」,不是笼统的失败', () => {
  // ⚠️ 第一版只查了「MAX_FILE_BYTES 和那句文案在不在源码里」—— 那钉不住任何东西:
  // 把判断条件改成 false,两样都还在,契约照样绿。自查反证时抓到的。
  // 现在钉**那个判断本身**。
  assert.ok(/f\.size\s*>\s*MAX_FILE_BYTES/.test(SHEET_CODE),
    '大文件的前置判断没了 —— 会走到 putLocalFile 然后报一个通用失败,人会反复重试同一个存不下的文件');
  assert.ok(/太大存不下凭证/.test(SHEET), '没有专门的「太大」文案');
});

// ── ④ 退款配对面板接线 ─────────────────────────────────────────────────────
const PAIRS = read('components/portal/finance/RefundPairs.tsx');
const PAIRS_CODE = PAIRS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

check('④a 建议 + 确认,**不自动配**', () => {
  assert.ok(/就是它/.test(PAIRS) && /不是/.test(PAIRS), '两颗按钮不齐 —— 没有确认就是自动配');
  // linkRefund 只许出现在 confirm 里(那是「就是它」的 handler)
  const at = PAIRS_CODE.indexOf('function confirm');
  assert.ok(at > 0, 'confirm 不见了 —— 测试锚点失效,请更新');
  assert.ok(!/linkRefund\(/.test(PAIRS_CODE.slice(0, at)),
    'confirm 之外出现了写关联 —— 那就是自动配,退款关系会让月度数字自己变(QA #21 那一类)');
});

check('④b 关联写失败要说出来', () => {
  assert.ok(/if \(!linkRefund\(/.test(PAIRS_CODE) && /role="alert"/.test(PAIRS_CODE),
    '写失败被吞了 —— 人会看到「我明明关联了,月支出怎么没变」');
});

check('④c 「不是」进否决记忆,不只是从列表里消失', () => {
  assert.ok(/rejectRefundPair\(/.test(PAIRS_CODE),
    '否决没落盘 —— 刷新一下同一条建议又回来了,人会怀疑「不是」有没有生效');
});

check('④d 超额退款要提前说,不靠净额钳到 0 兜底', () => {
  assert.ok(/wouldOverRefund\(/.test(PAIRS_CODE), '没查超额 —— 人看到的会是「这笔花了 $0」而不是「你可能挂错了」');
  assert.ok(/超出原额/.test(PAIRS), '没有说清超了多少的文案');
});

check('④e 够硬 / 不够硬要显示出来', () => {
  assert.ok(/refundSuggestionIsStrong\(/.test(PAIRS_CODE), '所有建议长一个样 —— 人无从判断该不该信');
  // 弱建议必须说清差在哪(部分退 / 相隔天数),不许只剩「不完全确定」空话
  assert.ok(/部分退|Partial amount/.test(PAIRS), '部分退款没有具体提示');
  assert.ok(/!best\.exact/.test(PAIRS_CODE), '弱提示要按 exact/dayGap 分支,不能所有弱建议同一句');
});

check('④f 算的部分不在组件里重写', () => {
  assert.ok(!/dayDiff|merchantStem\s*=|windowDays\s*=/.test(PAIRS_CODE),
    '面板里出现了配对算法 —— 那必须留在纯函数层,否则改一次要改两处、且契约管不住');
});

check('④g 颜色全走 token', () => {
  const bad = (PAIRS.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []).filter((h) => h !== '#fff' && h !== '#FFF');
  assert.deepStrictEqual(bad, [], `硬编码色值:${bad.join(', ')}`);
});

check('④h 挂在财务·交易页', () => {
  const tab = read('components/portal/finance/FinanceTab.tsx');
  assert.ok(/<RefundPairs\b/.test(tab), '面板没挂上去 —— 又是一个看不见的功能');
});

const fails = results.filter((r) => r[0] === 'FAIL');
if (fails.length) {
  assert.fail(`ledger-refund/allocation 有 ${fails.length} 条不过:\n  - `
    + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
}
console.log(`ledger-refund-allocation: OK(${results.length} 条,配对保守且要确认 / 否决记忆 / 分摊差一分都不许 / 不改原分录)`);
