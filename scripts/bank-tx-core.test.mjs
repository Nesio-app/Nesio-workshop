/**
 * 行为契约:财务两个 HIGH 修复(直接 import 并执行 bank-tx-core,非钉字符串)。
 *
 * ① 货币作用域:聚合前先按主币种分组,$10 与 ¥10 不再相加成 20。
 * ② 定期检测:间隔 CV 门 + 最小样本,挡下「间隔 [1,59] 中位数 30 → 误判每月」
 *    从噪声造出的账单;同时不误伤真正规律的月度账单、不放过样本太少的。
 */
import assert from 'node:assert/strict';
import {
  dominantCurrency,
  inCurrency,
  evaluateRecurringGroup,
  median,
  coeffVar,
} from '../lib/portal/bank-tx-core.mjs';

const PAST_NOW = Date.parse('2000-01-01'); // 注入的 now:早于所有测试日期,nextEstimate 确定

// ── ① 货币作用域 ────────────────────────────────────────────────────────────
{
  const txs = [
    { amount: 10, currency: 'USD' },
    { amount: 10, currency: 'USD' },
    { amount: 10, currency: 'USD' },
    { amount: 10, currency: 'CNY' },
  ];
  assert.equal(dominantCurrency(txs), 'USD', '主币种应取出现最多的 USD。');

  const cur = dominantCurrency(txs);
  const scopedSum = txs.filter((t) => inCurrency(t, cur)).reduce((s, t) => s + t.amount, 0);
  const naiveSum = txs.reduce((s, t) => s + t.amount, 0);
  assert.equal(scopedSum, 30, '按主币种作用域求和 = 3×$10 = 30。');
  assert.equal(naiveSum, 40, '(对照)不分币种直接相加 = 40 —— 正是被修掉的错误口径。');
  assert.notEqual(scopedSum, naiveSum, '货币作用域必须改变结果,否则修复无效。');

  // 缺省币种按 USD;大小写归一化
  assert.equal(dominantCurrency([{ amount: 1 }, { amount: 1 }]), 'USD', '无 currency 字段缺省 USD。');
  assert.ok(inCurrency({ amount: 1, currency: 'usd' }, 'USD'), 'inCurrency 应大小写不敏感。');
}

// ── 小工具正确性 ────────────────────────────────────────────────────────────
{
  assert.equal(median([1, 59]), 30, 'median([1,59]) = 30(正是会触发误判的中位数)。');
  assert.equal(median([30, 28, 31]), 30, 'median 奇数取中。');
  assert.ok(coeffVar([1, 59]) > 0.9, '[1,59] 间隔极不规律,CV 很高。');
  assert.ok(coeffVar([31, 28, 31]) < 0.1, '规律月度间隔 CV 很低。');
}

// ── ② 定期检测:回归用例 —— 间隔 [1,59] 不再被判「每月」 ──────────────────────
{
  // Netflix(关键词账单,最小样本 3):3 笔但间隔 1、59 天 —— 中位数 30 落在月度窗口,
  // 旧逻辑会误判每月;新的间隔 CV 门必须挡下。
  const noisy = [
    { date: '2026-01-01', amount: 15, name: 'Netflix', currency: 'USD' },
    { date: '2026-01-02', amount: 15, name: 'Netflix', currency: 'USD' },
    { date: '2026-03-02', amount: 15, name: 'Netflix', currency: 'USD' },
  ];
  assert.equal(
    evaluateRecurringGroup(noisy, { category: 'Services', now: PAST_NOW }),
    null,
    '间隔不规律([1,59])的三笔不能被判为定期账单 —— 这是从噪声造账单的回归。',
  );
}

// ── ② 真正规律的月度账单仍被正确识别 ────────────────────────────────────────
{
  const monthly = [
    { date: '2026-01-01', amount: 15.99, name: 'Netflix', currency: 'USD' },
    { date: '2026-02-01', amount: 15.99, name: 'Netflix', currency: 'USD' },
    { date: '2026-03-01', amount: 15.99, name: 'Netflix', currency: 'USD' },
  ];
  const rec = evaluateRecurringGroup(monthly, { category: 'Services', now: PAST_NOW });
  assert.ok(rec, '规律月度 Netflix 应被识别为定期。');
  assert.deepEqual(rec.cadenceLabel, ['每月', 'Monthly'], '周期应为每月。');
  assert.equal(rec.count, 3, 'count = 3。');
  assert.equal(rec.avgAmount, 15.99, '均额正确。');
  assert.equal(rec.currency, 'USD', '币种透传。');
  assert.match(rec.nextEstimate, /^\d{4}-\d{2}-\d{2}$/, 'nextEstimate 是日期串。');
}

// ── ② 最小样本:非关键词商户不足 4 笔 → 不判定期 ───────────────────────────
{
  const base = (n) => ({ date: n, amount: 42, name: 'Acme Widgets', currency: 'USD' });
  const three = [base('2026-01-01'), base('2026-02-01'), base('2026-03-01')];
  assert.equal(
    evaluateRecurringGroup(three, { category: 'Services', now: PAST_NOW }),
    null,
    '非关键词商户仅 3 笔(2 个间隔)样本不足,不判定期。',
  );
  const four = [...three, base('2026-04-01')];
  const rec = evaluateRecurringGroup(four, { category: 'Services', now: PAST_NOW });
  assert.ok(rec, '非关键词商户满 4 笔且规律稳定 → 识别为定期。');
  assert.deepEqual(rec.cadenceLabel, ['每月', 'Monthly']);
}

// ── ② 常去超市不误判:非账单类别 + 金额飘 → 排除 ───────────────────────────
{
  const grocery = [
    { date: '2026-01-03', amount: 54, name: 'Whole Foods', currency: 'USD' },
    { date: '2026-01-10', amount: 88, name: 'Whole Foods', currency: 'USD' },
    { date: '2026-01-17', amount: 31, name: 'Whole Foods', currency: 'USD' },
    { date: '2026-01-24', amount: 120, name: 'Whole Foods', currency: 'USD' },
  ];
  assert.equal(
    evaluateRecurringGroup(grocery, { category: 'Food', now: PAST_NOW }),
    null,
    '每周去的超市(食品类 + 金额飘)不该被判成定期账单。',
  );
}

// ── ② BILL_RE 裸词误判:"Premium Outlets"(商场)不再被当会员费 ──────────────
{
  // 规律月度、金额飘(商场消费),类别非购物 —— 唯一可能让它过的是被删掉的裸词 premium。
  const mall = [
    { date: '2026-01-05', amount: 45, name: 'Premium Outlets', currency: 'USD' },
    { date: '2026-02-05', amount: 180, name: 'Premium Outlets', currency: 'USD' },
    { date: '2026-03-05', amount: 22, name: 'Premium Outlets', currency: 'USD' },
    { date: '2026-04-05', amount: 300, name: 'Premium Outlets', currency: 'USD' },
  ];
  assert.equal(
    evaluateRecurringGroup(mall, { category: 'Services', now: PAST_NOW }),
    null,
    '"Premium Outlets" 金额飘 + premium 裸词已移除 → 不该被判成定期会员费。',
  );
}

console.log('bank-tx-core: OK');
