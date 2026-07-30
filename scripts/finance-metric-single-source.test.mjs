/**
 * 财务口径单一源契约(bug2「检查正确性」的防回潮锁)。
 *
 * 用户在真机上同时看到「应急金 1.5 个月」和「现金流跑道 1.3 个月」—— 同一份存款、
 * 同一个问题,两张卡给了两个答案,而 1.3 恰好跨过 <1.5 的 flag 门槛,凭空多出一条红色预警。
 * 根因是函数级双实现:两处各自算「月支出基线」,一处 6 个完整月 + net,一处 3 个月含残月 + gross。
 *
 * 同类根因还有两处:涨价判定曾有两份实现(风险预警那份漏了水电排除,于是市政水费被报成
 * 「涨价 63%」并染红),费用体检是全仓唯一不过 txFlow 的聚合(于是投资账户的代扣税被算成
 * 「银行费用」,还配上「多数可申请减免」)。
 *
 * 这个测试是静态源码断言:不跑业务逻辑,只钉死「这些口径只能有一个出处」。
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const features = read('lib/portal/finance-features.ts');
const insight = read('lib/portal/finance-insight.ts');
const risk = read('lib/portal/finance-risk.ts');

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

// ── ① 月支出基线只有一处实现,两个消费点都调它 ──
check(
  /export function monthlyNetSpendBaseline\(/.test(features),
  'finance-features 必须导出 monthlyNetSpendBaseline —— 月支出基线的唯一出处',
);
check(
  /monthlyNetSpendBaseline\(/.test(risk),
  '财务体检(应急金)必须调 monthlyNetSpendBaseline,不许自己再算一套月支出中位数',
);
check(
  /monthlyNetSpendBaseline\(/.test(insight),
  '现金流跑道必须调 monthlyNetSpendBaseline —— 它与应急金回答的是同一个问题,不能两个口径',
);
check(
  !/const\s+avgMonthly\s*=\s*median\(grosses\)/.test(insight),
  'finance-insight 里那套「3 个月 gross 中位数」的私有基线必须已删(它算出的 1.3 与应急金的 1.5 打架)',
);

// ── ② 涨价判定只有一处实现 ──
check(
  /if \(r\.category === 'RENT_AND_UTILITIES'\) continue;/.test(features),
  'recurringPriceHikes 必须排除 RENT_AND_UTILITIES —— 水电市政费金额天然浮动,不是涨价',
);
check(
  /recurringPriceHikes\(/.test(insight),
  '风险预警的涨价条必须复用 recurringPriceHikes,不许自己重算(重算那份漏了水电排除)',
);
check(
  !/r\.latestAmount < r\.baselineAmount \* 1\.05/.test(insight),
  'finance-insight 里那套私有涨幅判定必须已删(它把市政水费报成 flag 红条)',
);
check(
  /if \(to <= r\.baselineMax\) continue;/.test(features),
  '涨价判定必须挡掉双档账单:latest ≤ 历史最大值 = 这个价位以前出现过 = 不是涨价(AT&T 假涨 170% 的根因)',
);

// ── ③ 费用体检与其余聚合同口径(过 txFlow,排除投资账户)──
const feeBlock = insight.slice(
  insight.indexOf('function feeAuditFindings'),
  insight.indexOf('function newRecurringFindings'),
);
check(feeBlock.length > 0, '找不到 feeAuditFindings —— 测试锚点失效,请更新此测试');
check(
  /txFlow\(/.test(feeBlock),
  '费用体检必须过 txFlow(全仓其余聚合都过)—— 否则投资账户的代扣税会被算成银行费用,与 KPI 支出永远对不上账',
);
check(
  /investmentAccountIds\(\)/.test(feeBlock),
  '费用体检必须传 investmentAccountIds() 给 txFlow,把投资账户排除',
);

// ── ④ 订阅负担只算可退订的那类,分母与储蓄率同源 ──
check(
  /excludeCategories/.test(features) && /excludeCategories/.test(risk),
  '订阅负担必须能排除固定支出(房租水电/贷款)—— 否则「订阅负担」这个名字和「哪些还在用」的文案都是错的',
);
check(
  !/load\.monthly \/ income\.monthlyIncome/.test(risk),
  '订阅负担的分母不许再用 detectIncome 月化(它只认规整流,漏奖金 → 收入低估 → 负担率虚高),要与储蓄率同源',
);
check(
  /monthlyIncomeMedian/.test(risk),
  '储蓄率展示的收入必须是参与计算那几个月的入账中位数,不能展示 detectIncome 月化而分母用另一个数',
);

if (fail.length) {
  console.error('finance-metric-single-source: FAILED');
  for (const m of fail) console.error(`  ✗ ${m}`);
  process.exit(1);
}
console.log('finance-metric-single-source: OK');
