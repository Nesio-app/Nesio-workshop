/**
 * 行为契约:免费最大化·Plaid B —— 免费字段收割。
 * 锁死:sync 请求开 include_original_description + PFCv2;PlaidTx 声明富化字段;
 * tx 映射透传 authorizedDate/paymentChannel/origDesc/website/city/lat/lon/lowConfidence;
 * BankTx interface 承接这些可选字段(老数据无值不炸)。源码级——路由依赖 cookie/plaidPost,
 * 整路由跑成本高,锁请求形状与字段透传即可。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const route = fs.readFileSync(new URL('../app/api/portal/plaid/transactions/route.ts', import.meta.url), 'utf8');
const bank = fs.readFileSync(new URL('../lib/portal/providers/bank-tx.ts', import.meta.url), 'utf8');

// ── sync 请求:开原始描述 + PFCv2 ──
assert.ok(/include_original_description\s*:\s*true/.test(route), 'sync 请求 include_original_description:true');
assert.ok(/personal_finance_category_version\s*:\s*['"]2['"]/.test(route), 'sync 请求 PFCv2');

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
