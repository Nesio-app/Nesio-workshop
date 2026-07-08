/**
 * 周报测试 —— 趋势聚合(本周 vs 一周前、均值、变化幅度)、notable 排序、数据不足提示。
 */
import assert from 'node:assert/strict';
import { buildWeeklyReport, renderWeeklyText, buildWeeklyPrompt } from '../lib/portal/learning/analyst-weekly.mjs';

const row = (date, weekEvents, aiCost) => ({ date, signals: { weekEvents, aiCost, aiOkRate: 0.98, errTotal: 0, orphanedKeys: 27 } });

// 7 天:活跃从 80 → 120(recent-first 顺序),应识别为上升趋势
{
  const rows = [
    row('2026-07-07', 120, 1.2), row('2026-07-06', 115, 1.1), row('2026-07-05', 110, 1.0),
    row('2026-07-04', 100, 0.9), row('2026-07-03', 95, 0.8), row('2026-07-02', 88, 0.7), row('2026-07-01', 80, 0.6),
  ];
  const w = buildWeeklyReport(rows);
  assert.equal(w.days, 7);
  const act = w.trends.find((t) => t.key === 'weekEvents');
  assert.equal(act.latest, 120);
  assert.equal(act.weekAgo, 80);
  assert.equal(act.deltaPct, 50); // (120-80)/80
  assert.ok(w.notable[0]); // 有最大变化项
  assert.match(w.headline, /本周关注|平稳/);
  assert.ok(renderWeeklyText(w).includes('周报'));
  assert.ok(buildWeeklyPrompt(w).includes('产品分析师'));
}

// 数据不足(<3 天)→ 明确提示
{
  const w = buildWeeklyReport([row('2026-07-07', 100, 1)]);
  assert.match(w.headline, /数据不足/);
  assert.equal(w.days, 1);
}

// 空输入不炸
{
  const w = buildWeeklyReport([]);
  assert.equal(w.days, 0);
  assert.ok(Array.isArray(w.trends));
}

console.log('analyst-weekly: OK');
