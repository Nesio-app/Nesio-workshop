/**
 * 分析师规则测试 —— 保证「什么算预警」是确定的、可靠的(不依赖 LLM)。
 */
import assert from 'node:assert/strict';
import { buildDailyReport, renderReportText, buildAnalystPrompt } from '../lib/portal/analyst.mjs';

// 1. 平稳日:无预警,但要点齐全
{
  const r = buildDailyReport(
    { windows: { week: { events: 100, devices: 5 }, month: { events: 400 } }, deltas: { weekVsPrevWeek: 3 },
      ai: { totals: { calls: 20, estCostUsd: 0.4, okRate: 0.99 } } },
    { snapshot: { dataBus: { dataKeyCount: 34, orphanedDataKeyCount: 27 } }, summary: { byStatus: { enforced: 7, drifted: 0, dead: 0 } } },
    { date: '2026-07-06' },
  );
  assert.equal(r.status, 'go');
  assert.equal(r.alerts.length, 0);
  assert.ok(r.keyPoints.length >= 4, '要点至少 4 条');
  assert.match(r.headline, /平稳/);
}

// 2. 活跃度暴跌 + AI 失败 + 治理漂移 → 触发对应预警
{
  const r = buildDailyReport(
    { windows: { week: { events: 40, devices: 4 }, month: { events: 300 } }, deltas: { weekVsPrevWeek: -45 },
      ai: { totals: { calls: 50, estCostUsd: 6.2, okRate: 0.8 } },
      clientErrors: [{ kind: 'TypeError', count: 30, devices: 5 }] },
    { snapshot: { dataBus: { dataKeyCount: 34, orphanedDataKeyCount: 27 }, driftGuardWarnings: 0 },
      summary: { byStatus: { enforced: 7, 'report-only': 17, dormant: 3, drifted: 1, dead: 1 } } },
  );
  const titles = r.alerts.map((a) => a.title).join(' | ');
  assert.equal(r.status, 'risk', '有 risk 级预警时总体应为 risk');
  assert.match(titles, /活跃度环比掉 45%/);
  assert.match(titles, /AI 成功率 80%/);
  assert.match(titles, /客户端报错/);
  assert.match(titles, /治理漂移 1 项/);
  assert.match(titles, /死代码 1 项/);
  assert.ok(r.alerts.some((a) => a.severity === 'risk'), '应有 risk 预警');
}

// 3. 小样本不误报:月事件太少时不报活跃度
{
  const r = buildDailyReport(
    { windows: { week: { events: 3, devices: 1 }, month: { events: 8 } }, deltas: { weekVsPrevWeek: -60 } },
    { snapshot: {}, summary: { byStatus: {} } },
  );
  assert.ok(!r.alerts.some((a) => /活跃度/.test(a.title)), '样本不足不应报活跃度预警');
}

// 4. 渲染与提示不炸
{
  const r = buildDailyReport({}, {});
  assert.ok(renderReportText(r).includes('分析师日报'));
  assert.ok(buildAnalystPrompt(r).includes('产品分析师'));
  assert.ok(Array.isArray(r.keyPoints) && r.keyPoints.length > 0);
}

console.log('analyst: OK (规则确定性验证通过)');
