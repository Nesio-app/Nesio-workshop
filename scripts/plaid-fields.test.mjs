/**
 * 行为契约:免费最大化·Plaid B —— 免费字段收割。
 * 锁死:sync 请求开 include_original_description(不加非法 PFCv2 顶层参数,断流回归的根因);
 * 附加参数被 Plaid 判 INVALID_* 时自愈重试(去掉附加参数),保证同步永不因富化中断;PlaidTx 声明富化字段;
 * tx 映射透传 authorizedDate/paymentChannel/origDesc/website/city/lat/lon/lowConfidence;
 * BankTx interface 承接这些可选字段(老数据无值不炸)。源码级——路由依赖 cookie/plaidPost,
 * 整路由跑成本高,锁请求形状与字段透传即可。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const route = fs.readFileSync(new URL('../app/api/portal/plaid/transactions/route.ts', import.meta.url), 'utf8');
const bank = fs.readFileSync(new URL('../lib/portal/providers/bank-tx.ts', import.meta.url), 'utf8');

// ── sync 请求:开原始描述;绝不再加非法 PFCv2 顶层参数(断流回归根因) ──
assert.ok(/include_original_description\s*:\s*true/.test(route), 'sync 请求 include_original_description:true');
assert.ok(!/personal_finance_category_version/.test(route), '不加 personal_finance_category_version(非法顶层参数会让 Plaid 400、每页静默 break、流水永远 0)');
// ── 自愈:附加参数被判 INVALID_* 时去掉附加参数重试同一页 ──
assert.ok(/error_code[\s\S]{0,40}startsWith\(['"]INVALID['"]\)/.test(route), 'INVALID_* 时自愈重试');
assert.ok(/plaidPost\('\/transactions\/sync',\s*syncBody\)/.test(route), '自愈重试用不带 options 的 syncBody');

// ── PlaidTx 声明富化字段(响应侧) ──
for (const f of ['authorized_date', 'payment_channel', 'original_description', 'website', 'location', 'counterparties', 'confidence_level']) {
  assert.ok(route.includes(f), `PlaidTx 声明 ${f}`);
}

// ── tx 映射透传(存储侧字段名) ──
for (const f of ['authorizedDate', 'paymentChannel', 'origDesc', 'website', 'city', 'lat', 'lon', 'lowConfidence']) {
  assert.ok(route.includes(`${f}:`), `tx 映射透传 ${f}`);
}
// 低置信度取自 confidence_level(LOW/UNKNOWN)
assert.ok(/confidence_level\s*===\s*['"]LOW['"]/.test(route), 'lowConfidence 由 confidence_level=LOW 判定');
// 刷卡日取 authorized_date
assert.ok(/authorizedDate:\s*t\.authorized_date/.test(route), 'authorizedDate 取 authorized_date');

// ── BankTx 承接可选字段 ──
const iface = bank.slice(bank.indexOf('export interface BankTx'), bank.indexOf('export interface BankTx') + 900);
for (const f of ['authorizedDate?', 'paymentChannel?', 'origDesc?', 'website?', 'city?', 'lat?', 'lon?', 'lowConfidence?']) {
  assert.ok(iface.includes(f), `BankTx 承接 ${f}`);
}

console.log('plaid-fields: OK');
