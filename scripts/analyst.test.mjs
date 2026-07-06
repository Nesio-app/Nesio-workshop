/**
 * 分析师规则 + 学习测试 —— 判断确定、冷启动/基线切换正确、反馈静音生效。
 */
import assert from 'node:assert/strict';
import { buildDailyReport, extractSignals, summarizeFeedback, renderReportText, buildAnalystPrompt } from '../lib/portal/analyst.mjs';

const stableMetrics = (weekEvents) => ({
  windows: { week: { events: weekEvents, devices: 5 }, month: { events: 400 } },
  deltas: { weekVsPrevWeek: 2 },
  ai: { totals: { calls: 20, estCostUsd: 0.4, okRate: 0.99 } },
});
const gov = (extra = {}) => ({ snapshot: { dataBus: { dataKeyCount: 34, orphanedDataKeyCount: 27 }, ...extra }, summary: { byStatus: { enforced: 7, drifted: 0, dead: 0 } } });

// 1. 平稳:无预警,要点齐全
{
  const r = buildDailyReport(stableMetrics(100), gov(), { date: '2026-07-06' });
  assert.equal(r.status, 'go');
  assert.equal(r.alerts.length, 0);
  assert.ok(r.keyPoints.length >= 4);
}

// 2. 冷启动:无历史,靠环比 -45% 报活跃度(basis=static)
{
  const m = stableMetrics(40); m.deltas.weekVsPrevWeek = -45;
  const r = buildDailyReport(m, gov(), {});
  const a = r.alerts.find((x) => x.type === 'activity_drop');
  assert.ok(a, '应报活跃度下滑');
  assert.equal(a.basis, 'static');
  assert.equal(a.severity, 'risk');
}

// 3. 学到基线后:历史稳定在 ~100,今日 40 暴跌 → 基线判定(basis=learned),即使环比没触发
{
  const history = Array.from({ length: 20 }, (_, i) => extractSignals(stableMetrics(98 + (i % 5)), gov()));
  const m = stableMetrics(40); m.deltas.weekVsPrevWeek = -5; // 环比不足 30%,固定阈值不会报
  const r = buildDailyReport(m, gov(), { history });
  const a = r.alerts.find((x) => x.type === 'activity_drop');
  assert.ok(a, '基线应捕捉到暴跌');
  assert.equal(a.basis, 'learned');
  assert.match(a.explain, /σ/);
  assert.ok(r.learning.learnedAlerts >= 1);
}

// 4. AI 成功率绝对底线永远在(无历史也报 <90%)
{
  const m = stableMetrics(100); m.ai.totals.okRate = 0.8; m.ai.totals.calls = 50;
  const r = buildDailyReport(m, gov(), {});
  assert.ok(r.alerts.some((x) => x.type === 'ai_okrate' && x.severity === 'risk'));
}

// 5. 反馈学习:同类预警被标 4 次没用 → 静音(gentle 可静音)
{
  const feedbackRecords = Array.from({ length: 4 }, () => ({ alertType: 'gov_drift', reaction: 'dismiss' }));
  const r = buildDailyReport(stableMetrics(100), gov({}), { feedbackRecords });
  // 制造一个 gov_drift:drifted>0
  const r2 = buildDailyReport(stableMetrics(100), { snapshot: { dataBus: { orphanedDataKeyCount: 27 } }, summary: { byStatus: { drifted: 1 } } }, { feedbackRecords });
  assert.ok(!r2.alerts.some((x) => x.type === 'gov_drift'), 'gov_drift 应被反馈静音');
  assert.ok(r2.learning.mutedByFeedback >= 1);
}

// 6. risk 永不被反馈静音(安全底线)
{
  const feedbackRecords = Array.from({ length: 6 }, () => ({ alertType: 'ai_okrate', reaction: 'wrong' }));
  const m = stableMetrics(100); m.ai.totals.okRate = 0.7; m.ai.totals.calls = 50;
  const r = buildDailyReport(m, gov(), { feedbackRecords });
  assert.ok(r.alerts.some((x) => x.type === 'ai_okrate'), 'risk 级不能被静音');
}

// 7. summarizeFeedback 统计正确
{
  const s = summarizeFeedback([
    { alertType: 'ai_cost', reaction: 'useful' }, { alertType: 'ai_cost', reaction: 'useful' },
    { alertType: 'ai_cost', reaction: 'dismiss' },
  ]);
  assert.equal(s.ai_cost.total, 3);
  assert.ok(Math.abs(s.ai_cost.usefulRate - 2 / 3) < 1e-9);
  assert.equal(s.ai_cost.muted, false);
}

// 8. 渲染/提示健壮
{
  const r = buildDailyReport({}, {});
  assert.ok(renderReportText(r).includes('分析师日报'));
  assert.ok(buildAnalystPrompt(r).includes('产品分析师'));
}

console.log('analyst: OK (规则 + 基线 + 反馈学习验证通过)');
