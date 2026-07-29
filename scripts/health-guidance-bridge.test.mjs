/**
 * 行为契约:健康判定 → Today 的链路(2026-07-29 硬拆后新形态)。
 * 旧 bridge(healthFindingsToGuidanceEvents,规则分类+封顶)已随 8 层管线物理拆除;
 * 现在健康判定经 gatherDomainInsights 文本投影 → AI 判决(收敛与出卡契约见
 * test:guidance-judge / test:guidance-gates)。这里钉链路不断:
 *   ① domain-insights 仍聚合健康 findings/risks(单一判定源不变);
 *   ② Today 编排层把 domainInsights 喂进判决批。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const di = fs.readFileSync(new URL('../lib/portal/domain-insights.ts', import.meta.url), 'utf8');
assert.match(di, /evaluateHealthFindings/, '域聚合仍读健康判定引擎');
assert.match(di, /computeRiskScores/, '域聚合仍读健康风险引擎');
assert.match(di, /gatherDomainInsights/, '文本投影出口存在(判决批的输入)');

const td = fs.readFileSync(new URL('../components/portal/today/useTodayData.ts', import.meta.url), 'utf8');
assert.match(td, /domainInsights: gatherDomainInsights\(\)/, 'Today 把全域判定(含健康)喂进 AI 判决批');

console.log('health-guidance-bridge: OK(判定源不变 · 经判决批流入 Today)');
