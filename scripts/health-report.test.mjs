/**
 * 行为契约:健康月报(对齐财务月报形态)。
 * 锁死:分节齐全(速览/指标档案/体检/口径)、缺数据分节不出、月聚合口径、
 * 存记忆同月更新不重复、月初自动幂等、彩色版自包含 + 转义 + 打印保色、
 * 客户端接线(下载 .html / 打印走富版)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const lsData = new Map();
const fakeLocalStorage = { getItem: (k) => lsData.get(k) ?? null, setItem: (k, v) => lsData.set(k, String(v)), removeItem: (k) => lsData.delete(k) };
const ingestStub = { ingestLifeNode: (n) => lifeGraphStub.addLifeNode(n) };
const nodes = [];
const lifeGraphStub = {
  getLifeGraph: () => nodes,
  addLifeNode: (n) => { const full = { ...n, id: `n${nodes.length + 1}`, createdAt: '2026-07-01' }; nodes.push(full); return full; },
  updateLifeNode: (id, patch) => { const i = nodes.findIndex((x) => x.id === id); if (i < 0) return false; nodes[i] = { ...nodes[i], ...patch }; return true; },
};
function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl, process: { env: {} },
    console, Date, Math, Set, Map, JSON, Number, Array, Object, String,
    window: {}, localStorage: fakeLocalStorage,
  });
  return mod.exports;
}
const domainRules = loadTs('../lib/portal/domain-rules.ts', () => ({}));
const clinical = loadTs('../lib/portal/health-clinical.ts', (q) => (q === './domain-rules' ? domainRules : ({})));
const risk = loadTs('../lib/portal/health-risk.ts', () => ({}));
const corr = loadTs('../lib/portal/health-correlations.ts', () => ({}));
const kit = loadTs('../lib/portal/report-visual-kit.ts', () => ({}));
const report = loadTs('../lib/portal/health-report.ts', (p) =>
  p === './health-clinical' ? clinical
  : p === './health-risk' ? risk
  : p === './health-correlations' ? corr
  : p === './life-graph' ? lifeGraphStub
  : p.includes('ingest-node') ? ingestStub : ({}));
const visual = loadTs('../lib/portal/health-report-visual.ts', (p) =>
  p === './health-clinical' ? clinical
  : p === './health-risk' ? risk
  : p === './health-correlations' ? corr
  : p === './health-report' ? report
  : p === './report-visual-kit' ? kit : ({}));

// ── 合成一个月的日事实 + 指标序列 ──
const daily = [];
for (let d = 1; d <= 28; d++) {
  const date = `2026-06-${String(d).padStart(2, '0')}`;
  daily.push({ date, sleepH: d % 5 === 0 ? 6.2 : 7.5, steps: 6000 + d * 100, restingHR: 58, hrv: 45 });
}
daily.push({ date: '2026-05-20', sleepH: 8, steps: 9000, restingHR: 61, hrv: 40 }); // 上月一天(对比用)
const metrics = [
  { key: 'restingHR', label: ['静息心率', 'Resting HR'], latest: 58, latestDate: '2026-06-28', prev: 61, unit: 'bpm', decimals: 0, group: 'heart', series: [{ ym: '2026-05', v: 61 }, { ym: '2026-06', v: 58 }] },
  { key: 'weight', label: ['体重', 'Weight'], latest: 70.2, latestDate: '2026-06-27', prev: 71, unit: 'kg', decimals: 1, group: 'body', series: [{ ym: '2026-05', v: 71 }, { ym: '2026-06', v: 70.2 }] },
];
const data = { metrics, workouts: 8, importedAt: '2026-07-01T00:00:00Z', daily };

const NOW = new Date('2026-07-02T12:00:00Z');
const r = report.buildMonthlyHealthReport(data, '2026-06', 'zh', NOW);
assert.equal(r.title, '2026-06 健康月报');
for (const sec of ['## 本月速览', '## 指标档案', '## 口径说明']) assert.ok(r.markdown.includes(sec), `分节存在:${sec}`);
assert.ok(r.markdown.includes('28 天'), '覆盖天数 = 该月日事实数');
assert.ok(r.markdown.includes('7–9h'), '睡眠参考口径在');
assert.equal(r.summary.restingHR, 58, '速览均值');
assert.ok(r.markdown.includes('不构成医疗建议'), '免责落款恒在');
assert.match(report.buildMonthlyHealthReport(data, '2026-06', 'en', NOW).title, /Health monthly report/);
// 缺数据分节不出:无 daily 的月份没有速览数值,也不硬编
const empty = report.buildMonthlyHealthReport({ ...data, daily: [] }, '2026-06', 'zh', NOW);
assert.ok(empty.markdown.includes('0 天'), '无日数据 → 覆盖 0 天,不硬编均值');
assert.ok(!empty.markdown.includes('睡眠:均'), '无睡眠数据不出睡眠行');

// ── 存记忆:同月更新不重复 ──
assert.equal(report.persistHealthReportToMemory(r), 'created');
assert.equal(nodes.length, 1);
assert.equal(nodes[0].attributes.kind, 'health-monthly-report');
assert.equal(nodes[0].rawInput, r.markdown, 'rawInput = 全文');
assert.equal(report.persistHealthReportToMemory(report.buildMonthlyHealthReport(data, '2026-06', 'zh', NOW)), 'updated');
assert.equal(nodes.length, 1, '同月不重复');

// ── 月初自动:幂等 + 无数据跳过 ──
assert.equal(report.autoPersistLastMonthHealthReport(data, new Date('2026-07-03')), 'updated', '上月有节点 → 更新');
assert.equal(report.autoPersistLastMonthHealthReport(data, new Date('2026-07-03')), 'skipped', '同月第二次幂等');
lsData.delete('nesio-health-report-auto-v1');
assert.equal(report.autoPersistLastMonthHealthReport({ ...data, daily: [] }, new Date('2026-07-03')), 'skipped', '上月无日事实 → 跳过');

// ── 彩色版:自包含 + SVG + 转义 + 打印保色 ──
const rich = visual.healthReportRichHtml(data, '2026-06', 'zh', NOW);
assert.ok(rich.includes('<h1>2026-06 健康月报</h1>'), '富版标题');
assert.ok((rich.match(/<svg/g) || []).length >= 2, '睡眠 + 步数至少两个图');
assert.ok(rich.includes('7h 参考'), '睡眠参考线');
assert.ok(rich.includes('print-color-adjust'), '打印保色');
assert.ok(!/src=["']?https?:/.test(rich) && !/url\(/.test(rich) && !rich.includes('<link'), '自包含无外部资源');
const evil = { ...data, metrics: [{ ...metrics[0], label: ['<script>alert(1)</script>', 'x'], series: [{ ym: '2026-06', v: 58 }] }] };
assert.ok(!visual.healthReportRichHtml(evil, '2026-06', 'zh', NOW).includes('<script>alert'), '指标名转义不注入');

// ── 客户端接线:下载 .html / 打印走富版 / hooks 在早退前(源码级) ──
const dash = fs.readFileSync(new URL('../components/portal/health/HealthDashboard.tsx', import.meta.url), 'utf8');
assert.ok(dash.includes('health-report-${ym}.html'), '下载彩色 .html');
assert.ok(dash.includes('healthReportRichHtml(data, ym, dict)'), '打印/下载走富版');
assert.ok(dash.includes('autoPersistLastMonthHealthReport'), '月初自动接线');
assert.ok(dash.indexOf('const [reportMsg') < dash.indexOf('if (!data || data.metrics.length === 0)'), 'hooks 在空态早退之前');

console.log('health-report: OK');
