/**
 * 行为契约:冷冻仓走闭环 + 统一 gate + 现在不上线(freeze「卖了但不存在」修复)。
 * 锁死:
 *  - isFreezeLaunched() === false(现在免费/Pro 都不上);canOpenFreeze() 现为 false。
 *  - 所有入口走同一道门 canOpenFreeze:Portal 开门点 / PurchaseCoolingPanel 写入 / FinanceTab 入口。
 *  - ThawedReminder 不再自开 FreezeVaultSheet(旁路已除),改派发 nesio-open-freeze 走统一门。
 *  - FinanceTab 冷冻入口用 isFreezeLaunched 控渲染(未上线不出现)。
 *  - 闭环存在:FreezeVaultSheet 有 addToFreeze/resolveItem(加→冷静→决定)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, console, Date, Math, JSON, Number, window: undefined });
  return mod.exports;
}

const ent = loadTs('../lib/portal/entitlement.ts', (p) =>
  p.includes('storage-health') ? { logDropped: () => {} }
  : p.includes('app-build') ? { isAppStoreBuild: () => false }
  : ({}));

// ── 现在不上线:免费/Pro 都不上 ──
assert.equal(ent.isFreezeLaunched(), false, 'freeze 未上线');
assert.equal(ent.canOpenFreeze(), false, 'canOpenFreeze 现为 false(免费/Pro 都不上)');

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ── 统一 gate:各入口走 canOpenFreeze ──
{
  const portal = read('components/portal/Portal.tsx');
  assert.ok(/if \(!canOpenFreeze\(\)\)/.test(portal), 'Portal 开门点用 canOpenFreeze');
  const cooling = read('components/portal/PurchaseCoolingPanel.tsx');
  assert.ok(cooling.includes('canOpenFreeze') && !/canUse\('freeze'\)/.test(cooling), 'PurchaseCoolingPanel 全用 canOpenFreeze,无遗留 canUse(freeze)');
}

// ── ThawedReminder:旁路已除,走统一门 ──
{
  const thaw = read('components/portal/today/ThawedReminder.tsx');
  assert.ok(thaw.includes('canOpenFreeze'), 'ThawedReminder 接 canOpenFreeze');
  assert.ok(thaw.includes("new CustomEvent('nesio-open-freeze')"), 'ThawedReminder 派发 nesio-open-freeze');
  assert.ok(!thaw.includes('<FreezeVaultSheet') && !/import\(['"]\.\.\/FreezeVaultSheet/.test(thaw), 'ThawedReminder 不再自开 FreezeVaultSheet(旁路已除)');
}

// ── FinanceTab 入口:isFreezeLaunched 控渲染 + 派发统一门 ──
{
  const fin = read('components/portal/finance/FinanceTab.tsx');
  assert.ok(/isFreezeLaunched\(\) &&/.test(fin), 'FinanceTab 冷冻入口用 isFreezeLaunched 控渲染');
  assert.ok(fin.includes("new CustomEvent('nesio-open-freeze')"), 'FinanceTab 入口派发 nesio-open-freeze');
}

// ── 闭环齐:加 → 决定 ──
{
  const vault = read('components/portal/FreezeVaultSheet.tsx');
  assert.ok(vault.includes('addToFreeze') && vault.includes('resolveItem'), 'FreezeVaultSheet 有加入 + 决定(闭环)');
}

console.log('freeze-loop: OK');
