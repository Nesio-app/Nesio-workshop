/**
 * 行为契约:订阅定价 + StoreKit 桥(批次215,#40 定价落地)。
 * - PRO_MONTHLY:productId=nesio_pro_monthly,展示价含 9.9,trialDays 复用 entitlement.TRIAL_DAYS(=21,单一真源)。
 * - StoreKit 桥:无原生 → startSubscription 明确 web_unavailable(不假装能买);
 *   applyVerifiedPurchase / 原生校验通过 → 调 setProEntitlement 授予 Pro。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
function compile(path, requireImpl, globals = {}) {
  const js = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: requireImpl, console, Date, JSON, Object, String, Number, Boolean, Array, Math, ...globals });
  return mod.exports;
}

// ── 定价配置 ──
const sub = compile('../lib/portal/subscription.ts', (id) =>
  id.includes('entitlement') ? { TRIAL_DAYS: 21 } : {});
assert.equal(sub.PRO_MONTHLY.productId, 'nesio_pro_monthly', 'productId 一致(与 App Store Connect 对齐)');
assert.equal(sub.PRO_MONTHLY.billingPeriod, 'monthly', '月付');
assert.ok(sub.PRO_MONTHLY.priceDisplay[0].includes('9.9'), '展示价含 9.9');
assert.equal(sub.PRO_MONTHLY.trialDays, 21, 'trialDays 复用 TRIAL_DAYS=21');
assert.ok(sub.pricingLine()[0].includes('21') && sub.pricingLine()[0].includes('9.9'), '定价一句话含 21天 + 9.9');

// 单一真源:subscription 从 entitlement 取 TRIAL_DAYS;entitlement 本体是 21
assert.match(read('../lib/portal/subscription.ts'), /import \{ TRIAL_DAYS \} from '\.\/entitlement'/, 'trialDays 单一真源');
assert.match(read('../lib/portal/entitlement.ts'), /TRIAL_DAYS\s*=\s*21/, 'entitlement.TRIAL_DAYS = 21');

// ── StoreKit 桥 ──
let granted = null;
const bridgeRequire = (id) =>
  id.includes('entitlement') ? { setProEntitlement: (v) => { granted = v; }, TIER_UPDATED_EVENT: 'nesio-tier-updated' }
  : id.includes('subscription') ? { PRO_MONTHLY: { productId: 'nesio_pro_monthly' } }
  : id.includes('storage-health') ? { logDropped: () => {} }
  : {};

// 无 window/原生 → null + web_unavailable
const bridge = compile('../lib/portal/storekit-bridge.ts', bridgeRequire); // window 未定义
assert.equal(bridge.getNativeStoreKit(), null, '无原生 → getNativeStoreKit null');
const web = await bridge.startSubscription();
assert.deepEqual({ ok: web.ok, reason: web.reason }, { ok: false, reason: 'web_unavailable' }, 'web 上明确不可用,不假装能买');

// applyVerifiedPurchase → 授予
granted = null;
bridge.applyVerifiedPurchase(true);
assert.equal(granted, true, 'applyVerifiedPurchase(true) → setProEntitlement(true)');

// 有原生 + 校验通过 → 授予 Pro
granted = null;
const fakeWin = { Capacitor: { Plugins: { StoreKit: { purchase: async () => ({ verified: true }), restore: async () => ({ verified: true }) } } } };
const bridgeNative = compile('../lib/portal/storekit-bridge.ts', bridgeRequire, { window: fakeWin });
const bought = await bridgeNative.startSubscription();
assert.equal(bought.ok, true, '原生校验通过 → 购买成功');
assert.equal(granted, true, '购买成功 → 授予 Pro');

console.log('subscription-storekit: OK');
