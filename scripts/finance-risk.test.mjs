/**
 * 行为契约:财务 L3 评分层 + 知识层(财务⑮)。
 * 锁死:应急金/储蓄率/订阅负担 分级与口径;数据不齐的项不出(不硬算);
 * 每项带出处;知识检索按 id 主题命中且去重。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const caches = { tx: null, accounts: null };
let storeIdx = 0;
const fakeCreateBlobStore = () => {
  const key = storeIdx++ === 0 ? 'tx' : 'accounts';
  return { load: () => caches[key], save: (v) => { caches[key] = v; }, ready: async () => {} };
};
function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, process: { env: {} }, console, Date, Math, Set, Map, JSON, Number, Array, Object, String });
  return mod.exports;
}
const txCategory = loadTs('../lib/portal/tx-category.ts', () => ({}));
const bank = loadTs('../lib/portal/bank-tx.ts', (p) =>
  p === './storage-health' ? { reportStorageDropped() {} }
  : p === './tx-category' ? txCategory
  : p === './idb-blob-store' ? { createBlobStore: fakeCreateBlobStore } : ({}));
const features = loadTs('../lib/portal/finance-features.ts', (p) => (p === './bank-tx' ? bank : ({})));
const risk = loadTs('../lib/portal/finance-risk.ts', (p) => (p === './bank-tx' ? bank : p === './finance-features' ? features : ({})));
const gl = loadTs('../lib/portal/finance-guidelines.ts', () => ({}));

const day = 86_400_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);
const tx = (id, date, name, amount, category = 'GENERAL_MERCHANDISE') =>
  ({ id, date, name, amount, currency: 'USD', category, accountId: 'a1' });

// 合成:双周发薪 2000(月化 ~4349)+ 每完整月支出 2000 + 月度订阅 100
const world = [];
for (let d = 120; d >= 7; d -= 14) world.push(tx(`pay${d}`, iso(d * day), 'ACME PAYROLL', -2000, 'INCOME'));
for (let m = 1; m <= 4; m++) {
  const dt = new Date(); dt.setMonth(dt.getMonth() - m); dt.setDate(12);
  world.push(tx(`sp${m}`, dt.toISOString().slice(0, 10), 'Grocer Store', 2000, 'FOOD_AND_DRINK'));
}
world.push(...[70, 40, 10].map((d, i) => tx(`sub${i}`, iso(d * day), 'Netflix', 100, 'ENTERTAINMENT')));

// ── 应急金:存款 10000 ÷ 月净支出 ~2100 ≈ 4.x 月 → low ──
const acct = (bal) => [{ id: 'd1', name: 'Chk', type: 'depository', balance: bal, currency: 'USD' }];
const scores1 = risk.computeFinanceScores(world, acct(10000));
const ef1 = scores1.find((s) => s.id === 'finance-score-emergency-fund');
assert.ok(ef1, '应急金分项存在');
assert.equal(ef1.category, 'low', '~4-6 月 → low');
assert.ok(ef1.source.length > 0, '带出处');
const ef2 = risk.computeFinanceScores(world, acct(1500)).find((s) => s.id === 'finance-score-emergency-fund');
assert.equal(ef2.category, 'high', '<1 月 → high(真实风险)');
assert.ok(!risk.computeFinanceScores(world, []).some((s) => s.id === 'finance-score-emergency-fund'), '无存款余额不出该项');

// ── 储蓄率:收入 ~4349、净支出 ~2100 → ~52% → info;高支出世界 → 更差 ──
const sr = scores1.find((s) => s.id === 'finance-score-savings-rate');
assert.ok(sr, '储蓄率分项存在');
assert.equal(sr.category, 'info', '≥20% → info');
const spendy = world.map((t) => (t.id.startsWith('sp') ? { ...t, amount: 4200 } : t));
const sr2 = risk.computeFinanceScores(spendy, acct(10000)).find((s) => s.id === 'finance-score-savings-rate');
assert.ok(sr2 && (sr2.category === 'moderate' || sr2.category === 'high'), '结余微薄/为负 → moderate/high');
// 没有可靠收入流 → 不出储蓄率
const noIncome = world.filter((t) => !t.id.startsWith('pay'));
assert.ok(!risk.computeFinanceScores(noIncome, acct(10000)).some((s) => s.id === 'finance-score-savings-rate'), '无收入流不硬算');

// ── 订阅负担:100/月 ÷ 4349 ≈ 2% → info ──
const sub = scores1.find((s) => s.id === 'finance-score-subscription-load');
assert.ok(sub, '订阅负担分项存在');
assert.equal(sub.category, 'info', '~2% → info');

// 排序:更差的分级排前面
const spendyScores = risk.computeFinanceScores(spendy, acct(1500));
const rank = { high: 0, moderate: 1, low: 2, info: 3 };
assert.ok(spendyScores.every((s, i) => i === 0 || rank[s.category] >= rank[spendyScores[i - 1].category]), '差的排前');

// ── 知识层:按 id 主题命中、去重、带出处 ──
const hits = gl.findFinanceGuidelines(['finance-cat-drift-FOOD_AND_DRINK', 'finance-score-emergency-fund', 'finance-cat-drift-TRAVEL', 'unknown-topic']);
assert.equal(hits.length, 2, '前缀命中 + 去重 + 未知主题不出');
assert.ok(hits.every((h) => h.source && h.url && h.text[0] && h.text[1]), '每条带双语要点/出处/链接');
assert.ok(gl.findFinanceGuidelines(['finance-balance-risk']).length === 1, '余额风险主题有据可引');

console.log('finance-risk: OK');
