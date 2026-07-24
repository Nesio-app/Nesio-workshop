/**
 * 行为契约:Tesla 充电花费进财务(兑现连接器「充电花费自动进财务」的承诺)。
 * 锁死:带真实花费的 vehicle.charge signal → BankTx(正数=支出、交通·加油类、合成账户);
 * 无花费(Supercharger/家充常无费用)不进财务;id 与信号 externalId 同式天然去重;
 * getSignals 抛错时安全返回空(不炸财务页)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadModule(fakeSignals, { throwOnGet = false } = {}) {
  const src = fs.readFileSync(new URL('../lib/portal/tesla-finance.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Number,
    require: (p) => p === '@/lib/life-domain/signal'
      ? { getSignals: () => { if (throwOnGet) throw new Error('signals down'); return fakeSignals; } }
      : ({}),
  });
  return mod.exports;
}

const sig = (over) => ({ source: 'tesla', type: 'vehicle.charge', occurredAt: '2026-07-10T18:30:00Z', capturedAt: '2026-07-10T18:31:00Z', title: 't', payload: {}, ...over });

// ── 带花费 → 进财务;无花费 → 不进 ──
{
  const mod = loadModule([
    sig({ payload: { costUsd: 12.4, energyAddedKwh: 30, location: 'Supercharger - SF', vehicleId: 'v1' } }),
    sig({ occurredAt: '2026-07-08T09:00:00Z', payload: { costUsd: null, energyAddedKwh: 20, vehicleId: 'v1' } }), // 无费用
    sig({ occurredAt: '2026-07-05T09:00:00Z', payload: { costUsd: 0, vehicleId: 'v1' } }), // 0 元不算
  ]);
  const txs = mod.loadTeslaChargeTx();
  assert.equal(txs.length, 1, '只有带真实花费的充电进财务');
  const t = txs[0];
  assert.equal(t.amount, 12.4, '金额=花费(正数=支出,与 Plaid 口径一致)');
  assert.equal(t.date, '2026-07-10', 'date 取 occurredAt 的 YYYY-MM-DD');
  assert.equal(t.category, 'TRANSPORTATION', '归类交通(categoryBreakdown 能桶进交通)');
  assert.equal(t.categoryDetail, 'TRANSPORTATION_GAS', '细分=加油等价');
  assert.equal(t.accountId, mod.TESLA_FIN_ACCOUNT_ID, '挂合成 Tesla 账户(可按账户筛选,不进 Plaid 存储)');
  assert.ok(t.name.includes('Supercharger - SF'), '带站点名,便于辨认');
  assert.equal(t.currency, 'USD');
  assert.equal(t.id, 'tesla-charge-v1-2026-07-10T18:30:00Z', 'id 与信号 externalId 同式(天然去重)');
}

// ── 同一次充电重复信号 → 去重 ──
{
  const one = sig({ payload: { costUsd: 5, vehicleId: 'v1' } });
  const mod = loadModule([one, { ...one }]);
  assert.equal(mod.loadTeslaChargeTx().length, 1, '同 id 只算一笔');
}

// ── 合成账户形状 ──
{
  const mod = loadModule([]);
  const a = mod.teslaFinAccount();
  assert.equal(a.id, mod.TESLA_FIN_ACCOUNT_ID);
  assert.equal(a.currency, 'USD');
  assert.ok(a.name && typeof a.name === 'string', '账户有可读名');
}

// ── getSignals 抛错 → 安全返回空(不炸财务页) ──
{
  const mod = loadModule([], { throwOnGet: true });
  assert.equal(mod.loadTeslaChargeTx().length, 0, 'signal 读取失败不抛,返回空');
}

// ── 客户端契约:FinanceTab 在显示层并入 Tesla 花费 + 监听 Tesla 刷新事件 ──
const fin = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
assert.ok(/loadTeslaChargeTx\(\)/.test(fin), 'FinanceTab 合并 Tesla 充电花费');
assert.ok(/teslaFinAccount\(\)/.test(fin), 'Tesla 花费带合成账户进账户表');
assert.ok(/nesio-connectors-refreshed/.test(fin), 'Tesla 同步后事件触发财务重读');

console.log('tesla-finance: OK');
