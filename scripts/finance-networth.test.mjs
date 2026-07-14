/**
 * 行为契约:免费最大化·Plaid A —— loan 计入净资产 + 投资未实现盈亏 + 历史窗口 730 天。
 * 锁死:assetSummary 把 loan 当负债从净资产减掉(修此前 loan 完全没进公式的 bug);
 * holdingsGainLoss = Σ市值−Σ成本(仅有成本的持仓,gainPct 相对成本);
 * link-token 请求 days_requested:730;FinanceTab/finance-report 源码级接线(loan 标欠款、贷款行、盈亏行)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, process: { env: {} }, console, Date, Math, Set, Map, JSON, Number, Array, Object, String });
  return mod.exports;
}
// bank-tx 只依赖 storage-health / idb-blob-store / tx-category —— 全部桩掉(纯函数不碰 store)。
const bank = loadTs('../lib/portal/providers/bank-tx.ts', (p) =>
  p.includes('storage-health') ? { reportStorageDropped: () => {} }
  : p.includes('idb-blob-store') ? { createBlobStore: () => ({ load: () => [], save: () => {} }) }
  : p.includes('tx-category') ? { normalizeCategory: (c) => c } : ({}));

// ── assetSummary:loan 当负债计入净资产 ──
{
  const accounts = [
    { id: 'a', type: 'depository', balance: 5000, currency: 'USD' },
    { id: 'b', type: 'investment', balance: 20000, currency: 'USD' },
    { id: 'c', type: 'credit', balance: 1500, currency: 'USD' },
    { id: 'd', type: 'loan', subtype: 'mortgage', balance: 300000, currency: 'USD' },
  ];
  const s = bank.assetSummary(accounts);
  assert.equal(s.deposits, 5000);
  assert.equal(s.investments, 20000);
  assert.equal(s.creditOwed, 1500);
  assert.equal(s.loanOwed, 300000, 'loan 余额计为负债');
  assert.equal(s.net, 5000 + 20000 - 1500 - 300000, '净资产 = 存款+投资−信用卡−贷款(此前 loan 被漏,虚高一整笔)');
  // 无 loan 时 loanOwed=0,不影响老口径
  const s2 = bank.assetSummary(accounts.slice(0, 3));
  assert.equal(s2.loanOwed, 0);
  assert.equal(s2.net, 5000 + 20000 - 1500);
}

// ── holdingsGainLoss:市值−成本,仅有成本的持仓,gainPct 相对成本 ──
{
  const gl = bank.holdingsGainLoss([
    { accountId: 'x', name: 'AAPL', quantity: 10, value: 2000, costBasis: 1500, currency: 'USD' },
    { accountId: 'x', name: 'MSFT', quantity: 5, value: 1000, costBasis: 1000, currency: 'USD' },
    { accountId: 'x', name: '无成本', quantity: 1, value: 9999, currency: 'USD' }, // 无 costBasis 不计
  ]);
  assert.equal(gl.value, 3000, '仅计有成本持仓的市值(2000+1000)');
  assert.equal(gl.cost, 2500);
  assert.equal(gl.gain, 500, '盈亏 = 3000−2500');
  assert.equal(gl.gainPct, 20, '盈亏% = 500/2500');
  const empty = bank.holdingsGainLoss([]);
  assert.equal(empty.gain, 0);
  assert.equal(empty.gainPct, 0, '空持仓不除零');
}

// ── link-token 请求 2 年历史 ──
{
  const src = fs.readFileSync(new URL('../app/api/portal/plaid/link-token/route.ts', import.meta.url), 'utf8');
  assert.ok(/days_requested\s*:\s*730/.test(src), 'link-token 请求 730 天历史(90→2年)');
}

// ── 源码级接线 ──
{
  const tab = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
  assert.ok(/\['credit',\s*'loan'\]\.includes/.test(tab), 'loan 账户余额标「欠款」(和信用卡同)');
  assert.ok(tab.includes('s.loanOwed') && tab.includes('负债'), '净资产计入贷款(负债分组)');
  assert.ok(tab.includes('浮动盈亏') && tab.includes('portfolio.gain'), '卡片页投资组显示浮动盈亏(未实现盈亏)');
  const rep = fs.readFileSync(new URL('../lib/portal/finance-report.ts', import.meta.url), 'utf8');
  assert.ok(rep.includes('loanOwed') && /\['credit',\s*'loan'\]/.test(rep), '月报文本也含贷款 + loan 标欠款');
}

console.log('finance-networth: OK');
