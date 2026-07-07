/**
 * 行为契约:财务展示批(财务④)。
 * 锁死:环比百分比有基数下限(上月 <$50 不出数,免 +946% 小基数噪音);
 * 上月为零的类别标 isNew(UI 出「新增」而非百分比);
 * 金额小数位统一(整数无小数、带分恒两位);
 * warm-coach:支出涨幅不用 --status-risk 红(红仅真实风险)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const caches = { tx: null, accounts: null, holdings: null };
let storeIdx = 0;
const fakeCreateBlobStore = () => {
  const key = ['tx', 'accounts', 'holdings'][storeIdx++] ?? 'holdings'; // bank-tx 内建 store 顺序:tx → accounts → holdings
  return { load: () => caches[key], save: (v) => { caches[key] = v; }, ready: async () => {} };
};

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, console, Math, Date, Set, Map, Object, JSON, Number, Array });
  return mod.exports;
}
const txCategory = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bank = loadTs('../lib/portal/bank-tx.ts', (p) =>
  p === './storage-health' ? { reportStorageDropped() {} }
  : p === './tx-category' ? txCategory
  : p === './idb-blob-store' ? { createBlobStore: fakeCreateBlobStore } : ({}));

const tx = (id, date, amount, category) => ({ id, date, name: id, amount, currency: 'USD', category, accountId: 'a1' });

// ── categoryBreakdown:环比基数下限 ──
const txs = [
  // 餐饮:上月 300 → 本月 450(基数够,出 +50%)
  tx('f1', '2026-05-10', 300, 'FOOD_AND_DRINK'), tx('f2', '2026-06-10', 450, 'FOOD_AND_DRINK'),
  // 娱乐:上月 30 → 本月 314(小基数,+946% 是噪音 → 不出百分比,也不算「新增」)
  tx('e1', '2026-05-11', 30, 'ENTERTAINMENT'), tx('e2', '2026-06-11', 314, 'ENTERTAINMENT'),
  // 交通:上月无 → 本月 80(新增)
  tx('t1', '2026-06-12', 80, 'TRANSPORTATION'),
];
const cats = bank.categoryBreakdown(txs, '2026-06');
const byCat = (c) => cats.find((x) => x.category === c);

assert.equal(byCat('FOOD_AND_DRINK').deltaPct, 50, '基数够 → 正常出环比');
assert.equal(byCat('FOOD_AND_DRINK').isNew, false);
assert.equal(byCat('ENTERTAINMENT').deltaPct, null, '上月 <$50 → 小基数噪音不出百分比');
assert.equal(byCat('ENTERTAINMENT').isNew, false, '上月有痕迹就不算「新增」');
assert.equal(byCat('TRANSPORTATION').deltaPct, null, '上月无数据 → 无环比');
assert.equal(byCat('TRANSPORTATION').isNew, true, '上月为零 → 标新增');

// ── formatMoney:小数位统一 ──
assert.equal(bank.formatMoney(500), '$500', '整数不带小数');
assert.equal(bank.formatMoney(100.8), '$100.80', '带分恒两位(不再 $100.8)');
assert.equal(bank.formatMoney(1234.5), '$1,234.50', '千分位 + 两位小数');
assert.equal(bank.formatMoney(0.05), '$0.05');
assert.equal(bank.formatMoney(88, 'CNY'), '¥88');

// ── warm-coach:支出涨幅不用风险红;新增标中性 ──
const css = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const upRule = css.split('\n').find((l) => l.includes('.nesio-fin-delta.up'));
assert.ok(upRule && !upRule.includes('--status-risk'), '涨幅不用 --status-risk(红仅真实风险)');
assert.ok(upRule.includes('--status-gentle'), '涨幅用琥珀 --status-gentle');
assert.ok(css.includes('.nesio-fin-delta.is-new'), '「新增」标有中性样式');

// ── 净支出 KPI 同样有基数下限(源码级,防回潮) ──
const tab = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
assert.ok(/prevSummary\.net >= 50/.test(tab), '净支出环比有 $50 基数下限');

// ── 财务⑤:statement credit 语义(返还/报销 ≠ 商户退款) ──
const ftx = (name, amount, category = 'TRAVEL') => ({ id: name, date: '2026-06-20', name, amount, currency: 'USD', category, accountId: 'a1' });

assert.equal(bank.txFlow(ftx('AMEX GLOBAL ENTRY CREDIT', -120), {}), 'rebate', '卡权益 credit → 返还');
assert.equal(bank.txFlow(ftx('CASHBACK REBATE', -25), {}), 'rebate', 'rebate/cashback → 返还');
assert.equal(bank.txFlow(ftx('Amazon.com', -35, 'GENERAL_MERCHANDISE'), {}), 'refund', '普通商户负数仍是退款(不误伤)');
assert.equal(bank.txFlow(ftx('NAVY FEDERAL CREDIT UNION', -500, 'GENERAL_SERVICES'), {}), 'refund', 'CREDIT UNION 是机构名,不当返还');
assert.equal(bank.txFlow(ftx('GLOBAL ENTRY CREDIT', 120), {}), 'expense', '正数照旧是支出');
assert.equal(bank.txFlow(ftx('SOME CREDIT', -50, ''), {}), 'transfer', '无分类负数照旧 transfer(不计收支)');
assert.equal(bank.txFlow(ftx('AMEX GLOBAL ENTRY CREDIT', -120), { 'AMEX GLOBAL ENTRY CREDIT': 'income' }), 'income', '用户手动规则仍最高优先');

// 金额口径:返还与退款同样冲抵支出(净额不因语义细分而变)
const mixed = [ftx('Coffee', 200, 'FOOD_AND_DRINK'), ftx('AMEX GLOBAL ENTRY CREDIT', -120)];
const sum = bank.summarizeMonth(mixed, '2026-06');
assert.equal(sum.refunds, 120, '返还进退款/返还桶');
assert.equal(sum.net, 80, '净支出 = 支出 - 返还');

// UI:分流选项与标签齐备
assert.ok(bank.TX_FLOW_LABELS.rebate, 'TX_FLOW_LABELS 有 rebate');
const tab2 = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
assert.ok(tab2.includes("'rebate'"), '分流纠正选项含「返还/报销」');

// ── 财务⑨:定期识别 —— 间隔规律性门 + 账单词整词匹配 ──
const rtx = (id, date, name, amount, category = 'GENERAL_SERVICES') =>
  ({ id, date, name, amount, currency: 'USD', category, accountId: 'a1' });

// 真月度账单:间隔规整 → 识别
const netflix = [rtx('n1', '2026-04-05', 'Netflix', 15.99), rtx('n2', '2026-05-05', 'Netflix', 15.99), rtx('n3', '2026-06-05', 'Netflix', 15.99)];
assert.ok(bank.detectRecurring(netflix).some((r) => r.name === 'Netflix'), '规整月度订阅识别');

// 3 笔碰巧散落(gap 20/39,中位 29.5 落月档但极不规整)→ 不算周期
const scattered = [rtx('s1', '2026-04-01', 'Some Vendor', 50), rtx('s2', '2026-04-21', 'Some Vendor', 50), rtx('s3', '2026-05-30', 'Some Vendor', 50)];
assert.equal(bank.detectRecurring(scattered).length, 0, '间隔散乱不算定期(金额再稳也不行)');

// "diffeRENT" 不该命中账单词 rent:购物类 + 金额飘 → 不算账单
const boutique = [rtx('b1', '2026-04-10', 'Different Boutique', 100, 'GENERAL_MERCHANDISE'), rtx('b2', '2026-05-10', 'Different Boutique', 180, 'GENERAL_MERCHANDISE'), rtx('b3', '2026-06-10', 'Different Boutique', 60, 'GENERAL_MERCHANDISE')];
assert.equal(bank.detectRecurring(boutique).length, 0, '词界:diffeRENT 不再误当账单词');

// 整词 rent 照常命中(金额小幅波动的房租仍是账单)
const rent = [rtx('r1', '2026-04-01', 'Apartment Rent', 1500, 'RENT_AND_UTILITIES'), rtx('r2', '2026-05-01', 'Apartment Rent', 1500, 'RENT_AND_UTILITIES'), rtx('r3', '2026-06-01', 'Apartment Rent', 1580, 'RENT_AND_UTILITIES')];
assert.ok(bank.detectRecurring(rent).some((r) => /rent/i.test(r.name)), '整词 rent 照常识别');

// ── 财务⑰:早识别(对齐 Plaid early detection;默认调用不含,统计不受污染) ──
// 2 笔同额月间隔 → predicted;默认(mature-only)不出
const two = [rtx('t1', '2026-05-05', 'Hulu', 12.99), rtx('t2', '2026-06-05', 'Hulu', 12.99)];
assert.equal(bank.detectRecurring(two).length, 0, '默认只回成熟流(≥3 笔)');
const pred = bank.detectRecurring(two, { includePredicted: true });
assert.equal(pred.length, 1, '2 笔规律 → 待确认');
assert.equal(pred[0].status, 'predicted');
assert.equal(pred[0].count, 2);
// 2 笔金额差大且非账单词 → 不出(巧合不算)
const twoLoose = [rtx('l1', '2026-05-05', 'Corner Store', 12), rtx('l2', '2026-06-05', 'Corner Store', 55)];
assert.equal(bank.detectRecurring(twoLoose, { includePredicted: true }).length, 0, '金额不一致且非账单词不预测');
// 2 笔间隔不落周期档、非先验商户 → 不出(金额一致的巧合不算)
const twoOdd = [rtx('o1', '2026-05-05', 'Acme Widgets Co', 12.99), rtx('o2', '2026-05-25', 'Acme Widgets Co', 12.99)];
assert.equal(bank.detectRecurring(twoOdd, { includePredicted: true }).length, 0, '非先验商户间隔不成周期不预测');
// 知名订阅品牌 1 笔 → 按月假设的待确认;非知名品牌 1 笔不出
const one = [rtx('k1', '2026-06-20', 'Spotify USA', 11.99)];
const onePred = bank.detectRecurring(one, { includePredicted: true });
assert.equal(onePred.length, 1, '知名品牌 1 笔即预识别');
assert.equal(onePred[0].status, 'predicted');
assert.match(onePred[0].cadenceLabel[1], /assumed/i, '按月假设有明示');
assert.equal(bank.detectRecurring([rtx('u1', '2026-06-20', 'Random Shop LLC', 11.99, 'GENERAL_SERVICES')], { includePredicted: true }).length, 0, '非知名品牌 1 笔不预测');
// 3 笔仍是 mature
assert.equal(bank.detectRecurring(rent)[0].status, 'mature', '≥3 笔标 mature');

// ── 财务⑱:已知订阅商户先验库(核心信号) ──
assert.ok(bank.KNOWN_SUBSCRIPTIONS.length >= 55, '先验库要够广(≥55 条)');
assert.ok(bank.matchKnownSubscription('Netflix.com 866-579-7172'), '带尾巴的真实描述符也命中');
assert.ok(bank.matchKnownSubscription('CHATGPT SUBSCRIPTION OPENAI'), 'AI 订阅命中');
assert.equal(bank.matchKnownSubscription('Calm Springs Hotel'), null, '歧义词锚定域名,不误伤同名实体店');
assert.equal(bank.matchKnownSubscription('Costco Annual Membership')?.cadenceDays, 365, '会员制先验带年付周期');
// 先验免周期证据:知名品牌 2 笔间隔怪(重订阅)→ 仍预识别,周期用先验默认并明示推测
const huluOdd = [rtx('h1', '2026-05-05', 'Hulu', 12.99), rtx('h2', '2026-05-25', 'Hulu', 12.99)];
const huluPred = bank.detectRecurring(huluOdd, { includePredicted: true });
assert.equal(huluPred.length, 1, '先验商户 2 笔不需要周期证据');
assert.match(huluPred[0].cadenceLabel[1], /assumed/i, '间隔不成周期时用先验默认并明示');
// 先验分类兜底:无 Plaid 分类时用库里默认分类
const spotifyNoCat = [{ ...rtx('s0', '2026-06-20', 'Spotify USA', 11.99), category: '' }];
assert.equal(bank.detectRecurring(spotifyNoCat, { includePredicted: true })[0]?.category, 'ENTERTAINMENT', '先验默认分类兜底');

// ── 财务⑳:utility 账单先验(分类先验 + 服务商品牌) ──
// 3 笔市政电费,金额浮动大(CV>0.2)、名字无关键词 → 类别先验兜住,仍是账单
const cityPower = [
  rtx('cp1', '2026-04-03', 'City of Springfield Util', 80, 'RENT_AND_UTILITIES'),
  rtx('cp2', '2026-05-03', 'City of Springfield Util', 145, 'RENT_AND_UTILITIES'),
  rtx('cp3', '2026-06-03', 'City of Springfield Util', 60, 'RENT_AND_UTILITIES'),
];
assert.equal(bank.detectRecurring(cityPower).length, 1, '水电类金额浮动也算账单(CV 不设限)');
// 2 笔电费金额差 30% → 类别先验免金额一致性
const twoUtil = [rtx('tu1', '2026-05-10', 'Metro Water Dept', 70, 'RENT_AND_UTILITIES'), rtx('tu2', '2026-06-10', 'Metro Water Dept', 95, 'RENT_AND_UTILITIES')];
assert.equal(bank.detectRecurring(twoUtil, { includePredicted: true }).length, 1, '水电 2 笔金额浮动 → 待确认');
// 1 笔水电类 → 按月假设的待确认
const oneUtil = [rtx('ou1', '2026-06-15', 'Township Sewer', 42, 'RENT_AND_UTILITIES')];
const ouPred = bank.detectRecurring(oneUtil, { includePredicted: true });
assert.equal(ouPred.length, 1, '水电类 1 笔即预识别');
assert.match(ouPred[0].cadenceLabel[1], /assumed/i);
// 服务商品牌先验:Duke Energy 1 笔、Geico 2 笔
assert.ok(bank.matchKnownSubscription('DUKE ENERGY PAYMENT'), '公用事业品牌入先验库');
assert.ok(bank.matchKnownSubscription('GEICO INS PREM'), '保险品牌入先验库');
assert.equal(bank.detectRecurring([rtx('de1', '2026-06-12', 'DUKE ENERGY', 132, '')], { includePredicted: true }).length, 1, '品牌 1 笔即预识别(无分类也行)');

// ── 财务⑲:Plaid 商户实体 id 归并(先验数据 > 字符串归一) ──
assert.equal(bank.merchantKey({ name: 'NETFLIX.COM 866-579-7172', merchantId: 'ent-1' }), 'ent-1', 'entity id 优先');
assert.equal(bank.merchantKey({ name: 'Netflix Inc' }), bank.merchantKey({ name: 'Netflix Inc  ' }), '无 id 回退字符串归一');
// 同 entity 不同描述符 → 归并成同一条定期流(3 笔即 mature)
const entTxs = [
  { ...rtx('e1', '2026-04-05', 'NETFLIX.COM 866-579', 15.99, 'ENTERTAINMENT'), merchantId: 'ent-nfx' },
  { ...rtx('e2', '2026-05-05', 'Netflix Inc', 15.99, 'ENTERTAINMENT'), merchantId: 'ent-nfx' },
  { ...rtx('e3', '2026-06-05', 'NETFLIX', 15.99, 'ENTERTAINMENT'), merchantId: 'ent-nfx', merchantLogo: 'https://logo/nfx.png' },
];
const entRec = bank.detectRecurring(entTxs);
assert.equal(entRec.length, 1, '同 entity 不同描述符归并为一条流');
assert.equal(entRec[0].status, 'mature');
assert.equal(entRec[0].logo, 'https://logo/nfx.png', '定期流带商户 logo');
// 退款证据跨描述符:支出与退款描述符不同但同 entity → 仍认作退款
const evEnt = bank.expenseMerchants([{ ...rtx('p1', '2026-06-01', 'AMZN Mktp US*1X2', 60, 'GENERAL_MERCHANDISE'), merchantId: 'ent-amzn' }]);
assert.equal(bank.txFlow({ ...rtx('p2', '2026-06-10', 'Amazon.com Refund', -25, 'GENERAL_MERCHANDISE'), merchantId: 'ent-amzn' }, {}, evEnt), 'refund', '同 entity 跨描述符退款证据成立');
// 商户 Top 按 entity 归并
assert.equal(bank.topMerchants([...entTxs, { ...rtx('e4', '2026-06-20', 'Netflix LLC', 10, 'ENTERTAINMENT'), merchantId: 'ent-nfx' }], '2026-06', 5).length, 1, '商户 Top 同 entity 合一行');

// ── 财务⑪:退款证据门 —— 没买过的商户进账不是退款 ──
const evTxs = [
  ftx('Amazon.com', 60, 'GENERAL_MERCHANDISE'),                  // 买过 Amazon
  ftx('Amazon.com Refund', -25, 'GENERAL_MERCHANDISE'),          // 有证据(归一同名)→ 退款…见下
  { ...ftx('Friend Payment', -55, 'GENERAL_SERVICES'), id: 'fp', date: '2026-06-21' }, // 没买过 → 转账
];
const ev = bank.expenseMerchants(evTxs);
assert.equal(bank.txFlow(evTxs[2], {}, ev), 'transfer', '无购买证据的进账 → 转账不计收支');
assert.equal(bank.txFlow({ ...ftx('Amazon.com', -25), category: 'GENERAL_MERCHANDISE' }, {}, ev), 'refund', '买过的商户进账 → 退款');
assert.equal(bank.txFlow(ftx('AMEX GLOBAL ENTRY CREDIT', -120), {}, ev), 'rebate', '返还不需要购买证据');
assert.equal(bank.txFlow(evTxs[2], { 'Friend Payment': 'refund' }, ev), 'refund', '用户手动规则仍最高优先');
// summarizeMonth 内建证据:PayPal 式无证据进账不再倒扣净支出
const evSum = bank.summarizeMonth([ftx('Coffee Shop', 100, 'FOOD_AND_DRINK'), { ...ftx('Friend Payment', -55, 'GENERAL_SERVICES'), id: 'fp2' }], '2026-06');
assert.equal(evSum.refunds, 0, '无证据进账不进退款桶');
assert.equal(evSum.net, 100, '净支出不被虚减');

// ── hooks 纪律(财务⑪回归教训):空态早退之后不得再出现任何 hook ──
// refundEvidence 的 useMemo 曾写在 `if (txs.length === 0) return` 之后:首渲染空态早退
// hook 没执行,数据水合后 hook 数量变多 → React 整页抛错(用户「整个财务页面挂了」)。
{
  const src = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
  const earlyReturn = src.indexOf('if (txs.length === 0)');
  assert.ok(earlyReturn > 0, '空态早退存在');
  const after = src.slice(earlyReturn);
  for (const h of ['useMemo(', 'useState(', 'useEffect(', 'useCallback(', 'useRef(']) {
    assert.ok(!after.includes(h), `空态早退之后不得出现 ${h}(hooks 顺序会随渲染变化,整页崩)`);
  }
}

// ── 财务⑩:账户类型友好名 + 资产小结口径 ──
assert.equal(bank.accountTypeLabel({ type: 'depository', subtype: 'checking' })[0], '支票', 'subtype 优先');
assert.equal(bank.accountTypeLabel({ type: 'credit', subtype: 'credit card' })[1], 'Credit card');
assert.equal(bank.accountTypeLabel({ type: 'investment' })[0], '投资', 'type 兜底');
assert.equal(bank.accountTypeLabel({ type: 'brokerage' })[0], '投资', 'brokerage 归投资');
assert.equal(bank.accountTypeLabel({ type: 'weird-new', subtype: 'weird-sub' })[0], 'weird-sub', '未知类型原样不吞');
assert.equal(bank.accountTypeLabel({})[0], '账户', '全缺兜底');

const accts = [
  { id: 'c1', name: 'Chk', type: 'depository', subtype: 'checking', balance: 5000, currency: 'USD' },
  { id: 's1', name: 'Sav', type: 'depository', subtype: 'savings', balance: 3000, currency: 'USD' },
  { id: 'i1', name: 'Brk', type: 'investment', balance: 10000, currency: 'USD' },
  { id: 'cc', name: 'Card', type: 'credit', subtype: 'credit card', balance: 2000, currency: 'USD' },
  { id: 'eu', name: 'Euro', type: 'depository', balance: 999, currency: 'EUR' },   // 外币不进 USD 口径
  { id: 'nb', name: 'NoBal', type: 'depository', currency: 'USD' },                // 无余额跳过
];
const assets = bank.assetSummary(accts);
assert.equal(assets.deposits, 8000, '存款合计(checking+savings)');
assert.equal(assets.investments, 10000, '投资合计');
assert.equal(assets.creditOwed, 2000, '信用卡欠款');
assert.equal(assets.net, 16000, '净资产 = 存款 + 投资 − 欠款');
assert.equal(bank.assetSummary([]).net, 0, '空账户表 → 全零');

console.log('fin-display: OK');
