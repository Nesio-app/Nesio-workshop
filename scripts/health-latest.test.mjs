/**
 * 行为契约:健康"最新"数字不被当天半日导出污染。
 *
 * 修「🔴 健康"最新"数字被当天半日导出污染 —— Apple 常在一天进行到一半时导出,
 * 最后一天(= 导入当天)残缺,当"最新"会显示偏低值 + 吓人的负 delta」。
 */
import assert from 'node:assert/strict';
import { pickLatestCompleteDay } from '../lib/portal/health-latest.mjs';

const TODAY = '2026-07-06';

// ── 最后一天正好是今天(残缺)→ 跳过它,用前一个完整日,delta 用再前一天 ──────
{
  const days = [
    ['2026-07-04', 9000],
    ['2026-07-05', 10000],
    ['2026-07-06', 3200], // 半日导出,残缺
  ];
  const r = pickLatestCompleteDay(days, TODAY);
  assert.deepEqual(r.last, ['2026-07-05', 10000], '跳过残缺的今天,用最后一个完整日。');
  assert.equal(r.prev, 9000, 'delta 基准是完整日的前一天,不是残缺当天。');
  // 关键:不会出现 10000 → 3200 的 −6800 假暴跌
  assert.ok(r.last[1] - r.prev > 0, '完整日之间是正常涨幅,不是吓人的负 delta。');
}

// ── 最后一天不是今天(历史导入,已完整)→ 照常用最后一天 ────────────────────
{
  const days = [
    ['2026-07-03', 8000],
    ['2026-07-04', 9000],
    ['2026-07-05', 10000],
  ];
  const r = pickLatestCompleteDay(days, TODAY);
  assert.deepEqual(r.last, ['2026-07-05', 10000], '最后一天不是今天 → 就是最新完整日。');
  assert.equal(r.prev, 9000);
}

// ── 只有今天一天数据 → 仍要显示它(不能因为"残缺"就返回空) ──────────────────
{
  const days = [['2026-07-06', 3200]];
  const r = pickLatestCompleteDay(days, TODAY);
  assert.deepEqual(r.last, ['2026-07-06', 3200], '唯一一天即便是今天也要显示。');
  assert.equal(r.prev, null, '没有前一天 → 无 delta。');
}

// ── 空序列 → null(调用方 continue) ────────────────────────────────────────
assert.equal(pickLatestCompleteDay([], TODAY), null);
assert.equal(pickLatestCompleteDay(null, TODAY), null);

console.log('health-latest: OK');
