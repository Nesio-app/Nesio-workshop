/**
 * 行为契约:Plaid 投资拉取可见失败态(修「有投资账户却没数据、且静默吞错、连日志都没有」)。
 *
 * 根:/investments/transactions/get 与 /investments/holdings/get 的两个 catch 全空,
 * Plaid 回 error_code(PRODUCTS_NOT_SUPPORTED / ADDITIONAL_CONSENT_REQUIRED / 产品未开通)时
 * 既不显示也不落日志 → 用户只看到"投资为空",无从知道原因。违反可见失败态。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const route = fs.readFileSync(new URL('../app/api/portal/plaid/transactions/route.ts', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../lib/portal/providers/connector-sync.ts', import.meta.url), 'utf8');
const hub = fs.readFileSync(new URL('../components/portal/ConnectorsHub.tsx', import.meta.url), 'utf8');

// ── 路由:捕获 error_code + 落日志 + 透出诊断 ──
assert.ok(/invErrorCode/.test(route), '记录投资 error_code');
assert.ok(/console\.error\('\[plaid\] investments\/transactions'/.test(route), 'investments/transactions 的 error_code 落日志');
assert.ok(/console\.error\('\[plaid\] investments\/holdings'/.test(route), 'investments/holdings 的 error_code 落日志');
assert.ok(/investments:\s*\{[\s\S]{0,200}accounts:\s*invAccountsTotal/.test(route), '响应透出 investments 诊断(账户数)');
assert.ok(/error:\s*invErrorCode/.test(route), '诊断带 error_code');
// 旧的空 catch 注释「保持现状 / 不阻断」不该再原样存在(改成捕获日志)
assert.ok(!/catch \{ \/\* investments 产品不可用/.test(route), '投资流水的空 catch 已去除');

// ── 同步层透传 ──
assert.ok(/investments\?:\s*\{[\s\S]{0,120}error\?:\s*string/.test(sync), 'PlaidSyncResult 带 investments 诊断');

// ── 前端可见失败态 ──
assert.ok(/inv\.accounts > 0 && inv\.holdings === 0 && inv\.transactions === 0/.test(hub), '有投资账户但无数据 → 提示');
assert.ok(/断开重连.*券商|re-link the brokerage/i.test(hub), '给出「断开重连券商」出路');

console.log('plaid-investments-diag: OK');
