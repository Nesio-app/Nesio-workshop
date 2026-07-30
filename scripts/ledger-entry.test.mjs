/**
 * ledger-entry — 账目分录核心的契约(L1)。真跑纯函数,不断言源码长相。
 *
 * 这一层最贵的三条错误,各有断言:
 *   ① 同步顺手覆盖人字段 —— 一次重同步把用户的分类/备注全抹掉。
 *      ingest-node.ts:120 那条血泪注释(云 AI 富化抹掉本地抽取字段,「所有邮件都是今天」)
 *      就是这个病的上一次发作。
 *   ② 存净额而不是算净额 —— 跨月退款会让上月数字在本月悄悄变(QA #21「财务数据跳变」)。
 *   ③ 冻结档判错 —— 要么该拦的没拦(已报税的数字被改),要么不该拦的拦了
 *      (连备注都不让写,人没法整理自己的账)。
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
    module: m, exports: m.exports, JSON, Array, Object, Set, Map, Number, Math, String, Boolean, require: () => ({}),
  });
  return m.exports;
}
const L = load('lib/portal/ledger-entry.ts');
const AT = '2026-07-30T12:00:00.000Z';

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

const entry = (over = {}) => ({
  amount: 91.69, currency: 'USD', occurredAt: '2026-07-12', merchant: 'AMAZON',
  accountId: 'acct-1', direction: 'outflow', ledgerSource: 'plaid', externalId: 'plaid:tx1',
  category: '购物', note: '给 Linda 买的', reconState: 'open',
  ...over,
});

// ── ① 字段分层 ─────────────────────────────────────────────────────────────
check('①a 源字段与人字段不重叠,且各自完整', () => {
  const src = [...L.LEDGER_SOURCE_FIELDS];
  const hum = [...L.LEDGER_HUMAN_FIELDS];
  assert.ok(src.length && hum.length);
  for (const f of src) assert.ok(!hum.includes(f), `${f} 同时在两个名单里 —— 归属含糊会让同步行为不可预测`);
  for (const f of ['amount', 'occurredAt', 'accountId']) assert.ok(L.isLedgerSourceField(f), `${f} 必须是源字段`);
  for (const f of ['category', 'note', 'reconState']) assert.ok(L.isLedgerHumanField(f), `${f} 必须是人字段`);
});

check('①b reconState 归**人字段** —— 对账状态是人的动作,不该被一次重同步抹掉', () => {
  assert.ok(L.isLedgerHumanField('reconState'));
});

// ── ② 三档冻结 ─────────────────────────────────────────────────────────────
check('②a 三档判定', () => {
  assert.strictEqual(L.ledgerFreezeTier(entry()), 'open');
  assert.strictEqual(L.ledgerFreezeTier(entry({ reconState: 'reconciled' })), 'reconciled');
  assert.strictEqual(L.ledgerFreezeTier(entry({ lockedPeriod: '2026-07' })), 'locked');
});

check('②b 锁定优先于已对账(更强的约束赢)', () => {
  assert.strictEqual(
    L.ledgerFreezeTier(entry({ reconState: 'reconciled', lockedPeriod: '2026-07' })),
    'locked',
  );
});

check('②c 人字段**任何档**都能改 —— 连备注都冻住,人没法整理自己的账', () => {
  for (const attrs of [entry(), entry({ reconState: 'reconciled' }), entry({ lockedPeriod: '2026-07' })]) {
    for (const f of ['category', 'note', 'txFlow']) {
      assert.ok(L.canEditLedgerField(attrs, f).allowed, `${L.ledgerFreezeTier(attrs)} 档不该拦人字段 ${f}`);
    }
  }
});

check('②d 已对账改源字段 → 要求先解除对账(不是硬拒)', () => {
  const v = L.canEditLedgerField(entry({ reconState: 'reconciled' }), 'amount');
  assert.strictEqual(v.allowed, false);
  assert.strictEqual(v.reason, 'needs_unreconcile');
  assert.strictEqual(v.unreconcileUnlocks, true, 'UI 要能据此给「先解除对账」而不是死路');
});

check('②e 已锁定改源字段 → 只能冲正', () => {
  const v = L.canEditLedgerField(entry({ lockedPeriod: '2026-07' }), 'amount');
  assert.strictEqual(v.allowed, false);
  assert.strictEqual(v.reason, 'locked_use_reversal');
  assert.ok(!v.unreconcileUnlocks, '锁定期不该暗示「解除对账就能改」');
});

check('②g 锁定可以被自己解开,但必须留痕 —— 单用户产品里没人来批准重开期间', () => {
  // 有意的设计选择:锁做成谁都打不开,只会逼人「删了重记」,那才真的丢审计线索。
  // 代价是「已锁定」不是硬墙 —— 所以解锁这一步必须在变更历史里留下来。
  const patch = L.editLedgerField(entry({ lockedPeriod: '2026-07' }), 'lockedPeriod', null, AT);
  assert.ok(patch, '锁定期无法重开 —— 人只能删了重记,反而丢线索');
  assert.strictEqual(patch.lockedPeriod, null);
  const log = L.readChangeLog(patch);
  assert.strictEqual(log[log.length - 1].from, '2026-07', '解锁没留痕 —— 那锁就等于从来没存在过');
});

check('②f 名单外的字段一律不认(不猜)', () => {
  assert.strictEqual(L.canEditLedgerField(entry(), 'whatever').reason, 'unknown_field');
});

// ── ③ 变更历史 ─────────────────────────────────────────────────────────────
check('③a 改一次留一条,原值在里面', () => {
  const patch = L.editLedgerField(entry(), 'amount', 55.92, AT);
  assert.strictEqual(patch.amount, 55.92);
  const log = L.readChangeLog(patch);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].from, 91.69, '原值没留下 —— 审计痕迹的意义就没了');
  assert.strictEqual(log[0].to, 55.92);
});

check('③b 值没变不记一笔(免得历史被重复写噪音淹掉)', () => {
  const patch = L.editLedgerField(entry(), 'amount', 91.69, AT);
  looseDeepEqual(Object.keys(patch), []);
});

check('③c 不允许改时返回 null(调用方必须显式处理,不许静默吞掉)', () => {
  assert.strictEqual(L.editLedgerField(entry({ lockedPeriod: '2026-07' }), 'amount', 1, AT), null);
});

check('③d 历史有上限,超了丢**最旧**的', () => {
  let attrs = entry();
  for (let i = 0; i < L.LEDGER_CHANGELOG_MAX + 5; i++) {
    const p = L.editLedgerField(attrs, 'note', `第 ${i} 版`, AT);
    attrs = { ...attrs, ...p };
  }
  const log = L.readChangeLog(attrs);
  assert.strictEqual(log.length, L.LEDGER_CHANGELOG_MAX);
  assert.strictEqual(log[log.length - 1].to, `第 ${L.LEDGER_CHANGELOG_MAX + 4} 版`, '最新的必须留着');
  assert.ok(!log.some((c) => c.to === '第 0 版'), '丢的应该是最旧的,不是最新的');
});

check('③e 坏掉的历史 JSON 不炸,当空处理', () => {
  looseDeepEqual(L.readChangeLog({ changeLog: '{坏了' }), []);
});

// ── ④ 解除对账 ─────────────────────────────────────────────────────────────
check('④a 解除对账只动状态,**不碰任何源字段**', () => {
  const patch = L.unreconcileLedger(entry({ reconState: 'reconciled' }), AT);
  assert.strictEqual(patch.reconState, 'open');
  for (const f of L.LEDGER_SOURCE_FIELDS) {
    assert.ok(!(f in patch), `解除对账动了源字段 ${f} —— 它只该让后续修改成为可能,自己不是修改`);
  }
  assert.strictEqual(L.readChangeLog(patch)[0].kind, 'unreconcile');
});

check('④b 锁定期不许解除对账(只能冲正)', () => {
  assert.strictEqual(L.unreconcileLedger(entry({ lockedPeriod: '2026-07', reconState: 'reconciled' }), AT), null);
});

check('④c 本来就没对账 → 幂等空 patch', () => {
  looseDeepEqual(Object.keys(L.unreconcileLedger(entry(), AT)), []);
});

// ── ⑤ 作废 ─────────────────────────────────────────────────────────────────
check('⑤a 作废保留记录与原值,不动源字段', () => {
  const patch = L.voidLedgerEntry(entry(), '银行撤销', AT);
  assert.strictEqual(patch.voided, true);
  assert.strictEqual(patch.voidReason, '银行撤销');
  for (const f of L.LEDGER_SOURCE_FIELDS) assert.ok(!(f in patch), `作废动了源字段 ${f} —— 金额/日期要原样留着供追溯`);
  assert.strictEqual(L.readChangeLog(patch)[0].kind, 'void');
});

check('⑤b 锁定期也能作废 —— 已报税期间发现一笔根本不存在的交易必须能处理', () => {
  const patch = L.voidLedgerEntry(entry({ lockedPeriod: '2026-07' }), '这笔不存在', AT);
  assert.strictEqual(patch.voided, true);
});

check('⑤c 重复作废幂等', () => {
  looseDeepEqual(Object.keys(L.voidLedgerEntry(entry({ voided: true }), 'x', AT)), []);
});

// ── ⑥ 同步合并:最贵的一条 ──────────────────────────────────────────────────
check('⑥a 同步更新源字段,**人字段一个都不动**', () => {
  const existing = entry();
  const { patch, changedFields } = L.mergeSyncedLedger(existing, {
    amount: 92.5, merchant: 'AMAZON MKTPL',
    category: 'Plaid 猜的分类', note: '',      // ← 这两个必须被忽略
  }, AT);
  assert.strictEqual(patch.amount, 92.5);
  assert.strictEqual(patch.merchant, 'AMAZON MKTPL');
  assert.ok(!('category' in patch), '同步覆盖了用户的分类 —— 这正是 ingest-node:120 那条注释记的病');
  assert.ok(!('note' in patch), '同步覆盖了用户的备注');
  looseDeepEqual(changedFields.sort(), ['amount', 'merchant']);
});

check('⑥b 锁定期的分录:源字段也不动', () => {
  const { patch, changedFields, skippedLocked } = L.mergeSyncedLedger(
    entry({ lockedPeriod: '2026-07' }), { amount: 999 }, AT,
  );
  assert.strictEqual(skippedLocked, true);
  looseDeepEqual(changedFields, []);
  assert.ok(!('amount' in patch), '已报出去的数字被一次重同步改掉了');
});

check('⑥b-noop 锁定期但银行没给新数字 → 不许报「被锁挡下」的假警报', () => {
  const { changedFields, skippedLocked } = L.mergeSyncedLedger(
    entry({ lockedPeriod: '2026-07' }), { amount: 91.69, merchant: 'AMAZON' }, AT,
  );
  looseDeepEqual(changedFields, []);
  assert.strictEqual(skippedLocked, false,
    '什么都没变也报 skippedLocked,UI 会挂一条「银行的新数字没写进来」的假警报,'
    + '人会去查一个根本不存在的差异');
});

check('⑥b2 白名单是唯一真防线:非源字段一个都进不来', () => {
  // 自查反证发现的:代码里「人字段 continue」那行是冗余的双保险(单独去掉行为不变),
  // 真正起作用的是源字段白名单。所以这条直接钉白名单的**性质** ——
  // 拿人字段名 + 未知字段一起打进来,一个都不许出现在 patch 里。
  const noise = {};
  for (const f of L.LEDGER_HUMAN_FIELDS) noise[f] = '同步瞎猜的值';
  noise.mystery = 'x';
  const { patch, changedFields } = L.mergeSyncedLedger(entry(), noise, AT);
  looseDeepEqual(changedFields, [], '非源字段被同步写进来了');
  for (const f of [...L.LEDGER_HUMAN_FIELDS, 'mystery']) {
    assert.ok(!(f in patch), `${f} 出现在了同步 patch 里`);
  }
});

check('⑥c 名单外字段不猜、空值不写、同值不记', () => {
  const { changedFields } = L.mergeSyncedLedger(entry(), {
    mystery: 'x', amount: null, merchant: 'AMAZON',
  }, AT);
  looseDeepEqual(changedFields, [], '未知字段/空值/同值都不该产生变更');
});

check('⑥d 同步的改动也进变更历史(可追溯是谁改的)', () => {
  const { patch } = L.mergeSyncedLedger(entry(), { amount: 92.5 }, AT);
  const log = L.readChangeLog(patch);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].from, 91.69);
});

// ── ⑦ 净额:算出来,不存 ────────────────────────────────────────────────────
check('⑦a 一单多退:净额 = 原额 − Σ退款', () => {
  assert.strictEqual(L.netLedgerAmount({ amount: 91.69 }, [{ amount: 10.71 }, { amount: 25.06 }]), 55.92);
});

check('⑦b 作废的退款不计入', () => {
  assert.strictEqual(L.netLedgerAmount({ amount: 91.69 }, [{ amount: 10.71, voided: true }]), 91.69);
});

check('⑦c 作废的分录净额为 0(不再进任何聚合)', () => {
  assert.strictEqual(L.netLedgerAmount({ amount: 91.69, voided: true }, []), 0);
});

check('⑦d 退款超过原额 → 钳到 0,不许出现负的「花费」', () => {
  assert.strictEqual(L.netLedgerAmount({ amount: 10 }, [{ amount: 25 }]), 0,
    '负的花费会悄悄流进月度合计,让人查不出哪里错;钳到 0 并由对账去暴露差异更诚实');
});

check('⑦e 没有退款时就是原额;分为单位不出浮点毛刺', () => {
  assert.strictEqual(L.netLedgerAmount({ amount: 0.1 }, [{ amount: 0.02 }]), 0.08);
});

// ── ⑧ 「存净额」这条路必须堵死(源码层)────────────────────────────────────
check('⑧ 核心层不许把净额写回属性', () => {
  const src = fs.readFileSync(`${ROOT}lib/portal/ledger-entry.ts`, 'utf8');
  const fn = src.slice(src.indexOf('export function netLedgerAmount'));
  assert.ok(!/patch|attrs\[/.test(fn),
    'netLedgerAmount 里出现了写属性的动作 —— 净额必须是算出来的。存下来就会有「上月数字这月才变」那类跳变');
});

const fails = results.filter((r) => r[0] === 'FAIL');
if (fails.length) {
  assert.fail(`ledger-entry 有 ${fails.length} 条不过:\n  - `
    + fails.map(([, n, m]) => `${n}${m ? ` → ${m}` : ''}`).join('\n  - '));
}
console.log(`ledger-entry: OK(${results.length} 条,字段分层 / 三档冻结 / 变更历史 / 作废 / 同步不覆盖人字段 / 净额算不存)`);
