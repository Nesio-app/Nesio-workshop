/**
 * 行为契约:统一域洞察读出口(Cross-Insight Reader 核心)。
 * 锁死「单一判定源」不变量:computeDomainFindings 只筛一次(健康 flag/attention findings +
 * high/moderate risks;财务引擎已只出值得提示),gatherDomainInsights 是它的纯文本投影 ——
 * 两者条数一致(即 Today 与 问一问 同读一份、生成层不漂移)。
 * 用注入桩替掉底层引擎(不重测引擎本身)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/domain-insights.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function makeCtx(opts) {
  const ctx = {
    module: { exports: {} }, exports: {}, console,
    require: (p) => {
      if (p === './health-store') return { loadHealthMetrics: () => opts.hm };
      if (p === './health-clinical') return { evaluateHealthFindings: () => opts.findings };
      if (p === './health-risk') return { computeRiskScores: () => opts.risks };
      if (p === './bank-tx') return { loadBankTx: () => opts.txs, loadBankAccounts: () => [] };
      if (p === './finance-insight') return { financeFindings: () => opts.finance };
      if (p === './place-trail') return { loadPlaceTrail: () => opts.visits ?? [] };
      if (p === './place-insight') return { placeFindings: () => opts.place ?? [] };
      return {};
    },
  };
  ctx.module.exports = ctx.exports;
  vm.runInNewContext(js, ctx);
  return ctx.module.exports;
}

const FINDINGS = [
  { id: 'f1', severity: 'flag', title: ['血糖偏高', 'High glucose'], detail: ['空腹 7.2', 'fasting 7.2'], source: 'CGM' },
  { id: 'f2', severity: 'attention', title: ['睡眠不足', 'Low sleep'], detail: ['均 5.1h', 'avg 5.1h'], source: 'watch' },
  { id: 'f3', severity: 'info', title: ['正常', 'Normal'], detail: ['ok', 'ok'], source: 'x' },
];
const RISKS = [
  { id: 'r1', category: 'high', label: ['心血管风险', 'CVD'], value: '高', detail: ['多项偏高', 'multiple'], source: 'engine' },
  { id: 'r2', category: 'moderate', label: ['代谢', 'Metabolic'], value: '中', detail: ['偏高', 'elevated'], source: 'engine' },
  { id: 'r3', category: 'low', label: ['低', 'Low'], value: '低', detail: ['ok', 'ok'], source: 'engine' },
];
const FINANCE = [
  { id: 'net', severity: 'flag', title: ['净支出激增', 'Net surge'], detail: ['环比+40%', '+40%'] },
  { id: 'sub', severity: 'attention', title: ['订阅涨价', 'Sub hike'], detail: ['Netflix 17.99', 'Netflix 17.99'] },
];

const PLACE = [
  { id: 'place-range-narrow', severity: 'attention', title: ['这周的活动范围比平时小', 'Range smaller'], detail: ['本周 1 个(平时 5 个)', '1 vs ~5'] },
];

// 1. computeDomainFindings 只保留值得提示的(info finding / low risk 被筛掉)
{
  const mod = makeCtx({ hm: { glucose: [], sleepStages: [], metrics: [], profile: {} }, findings: FINDINGS, risks: RISKS, txs: [{ amount: 1 }], finance: FINANCE, visits: [{ ts: 'x', label: 'a', source: 'live' }], place: PLACE });
  const df = mod.computeDomainFindings();
  assert.equal(df.health.findings.length, 2, 'info finding 被筛掉');
  assert.equal(df.health.risks.length, 2, 'low risk 被筛掉');
  assert.equal(df.finance.length, 2, '财务两条');
  assert.equal(df.location.length, 1, '地图一条(Layer1② 扩域)');

  // 2. gatherDomainInsights 是 computeDomainFindings 的投影 —— 条数完全一致(不漂移)
  const insights = mod.gatherDomainInsights();
  assert.equal(insights.length, 7, '2 findings + 2 risks + 2 finance + 1 location');
  const healthCount = insights.filter((i) => i.domain === 'health').length;
  const financeCount = insights.filter((i) => i.domain === 'finance').length;
  const locationCount = insights.filter((i) => i.domain === 'location').length;
  assert.equal(healthCount, df.health.findings.length + df.health.risks.length, 'health 投影条数 == 判定源');
  assert.equal(financeCount, df.finance.length, 'finance 投影条数 == 判定源');
  assert.equal(locationCount, df.location.length, 'location 投影条数 == 判定源');

  // 3. 红旗优先:所有 flag 排在 attention 之前
  assert.equal(insights[0].severity, 'flag', 'flag 排最前');
  const sevs = insights.map((i) => i.severity);
  const lastFlag = sevs.lastIndexOf('flag');
  const firstAttn = sevs.indexOf('attention');
  assert.ok(firstAttn === -1 || lastFlag < firstAttn, 'flag 全在 attention 前');
  // moderate risk 映成 attention、high 映成 flag(投影口径)
  assert.ok(insights.some((i) => i.title.includes('心血管风险') && i.severity === 'flag'), 'high risk → flag');
  assert.ok(insights.some((i) => i.title.includes('代谢') && i.severity === 'attention'), 'moderate risk → attention');
}

// 4. 无数据返回空(域缺失不报错)
{
  const mod = makeCtx({ hm: null, findings: [], risks: [], txs: [], finance: [] });
  const df = mod.computeDomainFindings();
  assert.equal(df.health.findings.length, 0);
  assert.equal(df.finance.length, 0);
  assert.equal(mod.gatherDomainInsights().length, 0, '无数据返回空');
}

console.log('domain-insights: OK');
