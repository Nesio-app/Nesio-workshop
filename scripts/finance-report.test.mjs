/**
 * 行为契约:财务月报(财务㉓)。
 * 锁死:报告分节齐全(速览/收入构成/分类vs基线/定期/体检/口径说明);数字与
 * summarizeMonth 同口径;存入记忆同月更新不重复;中英文标题;口径落款恒在。
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
const lsData = new Map();
const fakeLocalStorage = { getItem: (k) => lsData.get(k) ?? null, setItem: (k, v) => lsData.set(k, String(v)), removeItem: (k) => lsData.delete(k) };
// life-graph 桩:内存节点表
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
const txCategory = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bank = loadTs('../lib/portal/bank-tx.ts', (p) =>
  p === './storage-health' ? { reportStorageDropped() {} }
  : p === './tx-category' ? txCategory
  : p === './idb-blob-store' ? { createBlobStore: fakeCreateBlobStore } : ({}));
const features = loadTs('../lib/portal/finance-features.ts', (p) => (p === './bank-tx' ? bank : ({})));
const insight = loadTs('../lib/portal/finance-insight.ts', (p) => (p === './bank-tx' ? bank : p === './tx-category' ? txCategory : p === './finance-features' ? features : ({})));
const risk = loadTs('../lib/portal/finance-risk.ts', (p) => (p === './bank-tx' ? bank : p === './finance-features' ? features : ({})));
const budget = loadTs('../lib/portal/finance-budget.ts', (p) =>
  p === './bank-tx' ? bank : p === './finance-features' ? features : p === './tx-category' ? txCategory : p === './storage-health' ? { reportStorageDropped() {} } : ({}));
const report = loadTs('../lib/portal/finance-report.ts', (p) =>
  p === './bank-tx' ? bank
  : p === './finance-features' ? features
  : p === './finance-insight' ? insight
  : p === './finance-risk' ? risk
  : p === './finance-budget' ? budget
  : p === './tx-category' ? txCategory
  : p === './life-graph' ? lifeGraphStub : ({}));

const NOW = new Date('2026-07-02T12:00:00Z');
const tx = (id, date, name, amount, category) => ({ id, date, name, amount, currency: 'USD', category, accountId: 'a1' });
const txs = [];
for (let m = 1; m <= 5; m++) {
  txs.push(tx(`f${m}`, `2026-0${m}-10`, 'Grocer', 200, 'FOOD_AND_DRINK'));
  txs.push(tx(`p${m}`, `2026-0${m}-01`, 'ACME PAYROLL', -4000, 'INCOME'));
}
txs.push({ ...tx('p6', '2026-06-01', 'ACME PAYROLL', -4000, 'INCOME'), categoryDetail: 'INCOME_WAGES' });
txs.push(tx('cur1', '2026-06-08', 'Grocer', 260, 'FOOD_AND_DRINK'));
txs.push(tx('n1', '2026-04-05', 'Netflix', 15.99, 'ENTERTAINMENT'));
txs.push(tx('n2', '2026-05-05', 'Netflix', 15.99, 'ENTERTAINMENT'));
txs.push(tx('n3', '2026-06-05', 'Netflix', 15.99, 'ENTERTAINMENT'));
const accounts = [{ id: 'a1', name: 'Checking', type: 'depository', subtype: 'checking', balance: 8000, currency: 'USD', institution: 'Chase', mask: '1234' }];

const r = report.buildMonthlyReport(txs, accounts, '2026-06', 'zh', NOW);
assert.equal(r.title, '2026-06 财务月报');
for (const sec of ['## 本月速览', '## 收入构成', '## 支出分类', '## 定期与订阅', '## 财务体检', '## 资产小结', '## 口径说明']) {
  assert.ok(r.markdown.includes(sec), `分节存在:${sec}`);
}
// 数字同口径
const s = bank.summarizeMonth(txs, '2026-06');
assert.equal(r.summary.net, s.net, 'summary.net 与 summarizeMonth 一致');
assert.equal(r.summary.income, s.income);
assert.ok(r.markdown.includes(bank.formatMoney(s.net, 'USD')), '正文含净支出金额');
assert.ok(r.markdown.includes('工资'), '收入构成带细分');
assert.ok(r.markdown.includes('习惯约'), '分类对比个人基线');
assert.ok(r.markdown.includes('Netflix'), '定期项在列');
assert.ok(r.markdown.includes('不构成投资建议') || r.markdown.includes('not investment advice'), '免责落款恒在');
// 英文标题
assert.match(report.buildMonthlyReport(txs, accounts, '2026-06', 'en', NOW).title, /Finance monthly report/);

// ── 财务㉗:投资持仓分节(有持仓才出;无持仓不出) ──
assert.ok(!r.markdown.includes('## 投资持仓'), '无持仓 → 不出分节');
caches.holdings = [
  { accountId: 'inv1', name: 'Apple Inc', ticker: 'AAPL', type: 'equity', quantity: 10, value: 3000, costBasis: 2400, currency: 'USD' },
  { accountId: 'inv1', name: 'Cash', type: 'cash', quantity: 500, value: 500, currency: 'USD' },
];
const rInv = report.buildMonthlyReport(txs, accounts, '2026-06', 'zh', NOW);
assert.ok(rInv.markdown.includes('## 投资持仓'), '有持仓 → 出分节');
assert.ok(rInv.markdown.includes('AAPL'), '持仓明细在列');
assert.ok(rInv.markdown.includes('+$600'), '浮动盈亏 = 市值 − 成本');
assert.ok(rInv.markdown.includes('股票'), '组合结构中文标签');
assert.ok(rInv.markdown.includes('占组合'), '单一持仓 >30% → 集中度提示');
caches.holdings = null; // 复位,不影响后续存记忆断言

// ── 存入记忆:同月更新不重复 ──
assert.equal(report.persistReportToMemory(r), 'created');
assert.equal(nodes.length, 1, '首次创建节点');
assert.equal(nodes[0].rawInput, r.markdown, 'rawInput = 全文(问一问可检索)');
assert.equal(nodes[0].attributes.ym, '2026-06');
const r2 = report.buildMonthlyReport(txs, accounts, '2026-06', 'zh', NOW);
assert.equal(report.persistReportToMemory(r2), 'updated');
assert.equal(nodes.length, 1, '同月不产生重复节点');
// 另一个月 → 新节点
const r3 = report.buildMonthlyReport(txs, accounts, '2026-05', 'zh', NOW);
assert.equal(report.persistReportToMemory(r3), 'created');
assert.equal(nodes.length, 2);

// ── 财务㉔:月初自动存记忆(幂等)──
const NOW_JULY = new Date('2026-07-03T10:00:00Z'); // 上月 = 2026-06,有数据
assert.equal(report.autoPersistLastMonthReport(txs, accounts, NOW_JULY), 'updated', '上月已有节点 → 更新');
assert.equal(report.autoPersistLastMonthReport(txs, accounts, NOW_JULY), 'skipped', '同月第二次 → 幂等跳过');
lsData.delete('nesio-fin-report-auto-v1');
assert.equal(report.autoPersistLastMonthReport([], accounts, NOW_JULY), 'skipped', '无数据 → 跳过');
assert.equal(report.autoPersistLastMonthReport(txs.filter((t) => !t.date.startsWith('2026-06')), accounts, new Date('2026-07-03')), 'skipped', '上月无交易 → 跳过');

// ── 财务㉔:打印 HTML(Markdown 子集转换 + 转义)──
const html = report.reportHtml(r);
assert.ok(html.includes('<h1>2026-06 财务月报</h1>'), 'h1');
assert.ok(html.includes('<h2>') && html.includes('<table>') && html.includes('<li>'), '分节/表格/列表都转换');
assert.ok(!html.includes('| ---'), '表格分隔行不残留');
const evil = { ...r, markdown: '# t\n- <script>alert(1)</script>' };
assert.ok(!report.reportHtml(evil).includes('<script>alert'), '内容转义,不注入');

console.log('finance-report: OK');
