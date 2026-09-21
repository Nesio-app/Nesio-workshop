/**
 * 图 1 / 9 / 10 / 11:交易细分类规则契约。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/finance-classify.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console });
const {
  classifyBankTx, shouldSkipRefundMatch, incomeDetailBucket, isFundTradeTx,
} = mod.exports;

const hit = (name, amount, extra = {}) => classifyBankTx({ name, amount, ...extra });

// 图 9
assert.equal(hit('DIRECT DEBIT ELAN WEB PYMT (Cash)', 240.23)?.reason, 'atm_out');
assert.equal(hit('ADJUST FEE CHARGED ATM FEE REBATE (Cash)', -4)?.reason, 'atm_fee_rebate');
assert.equal(hit('DIRECT DEPOSIT PAYPAL TRANSFER (Cash)', -81)?.reason, 'paypal_cashback');
assert.equal(hit('DIRECT DEPOSIT Fidelity Tec50183 (Cash)', -2007.84)?.reason, 'salary');

// 图 10:基金买卖不识别为收入/退款
assert.equal(isFundTradeTx('YOU SOLD PERSONAL WITHDRAWAL FIDELITY GOVERNMENT'), true);
assert.equal(hit('YOU SOLD PERSONAL WITHDRAWAL FIDELITY 500 INDEX', -27.17)?.reason, 'fund_trade');
assert.equal(shouldSkipRefundMatch('FIDELITY GOVERNMENT CASH RESERVES (FDRXX) REDEMPTION'), true);

// 图 11
assert.equal(hit('DIRECT DEBIT AMEX EPAYMENT ACH PMT (Cash)', 1410.79)?.detail, 'TRANSFER_CC_PAYMENT');
assert.equal(hit('TRANSFERRED TO VS 238-509643 REDEMPTION', 200)?.detail, 'TRANSFER_BANK');
assert.equal(hit('DIRECT DEPOSIT CHASE CREDITRWRD RDM (Cash)', -166.71)?.reason, 'reward');
assert.equal(hit('TRANSFERRED FROM VS 236-495017-1 CASH (Cash)', -279)?.reason, 'hsa_transfer');

// 图 1 收入桶
assert.equal(incomeDetailBucket('INCOME_WAGES'), 'wages');
assert.equal(incomeDetailBucket('INCOME_DIVIDENDS'), 'finance');
assert.equal(incomeDetailBucket('INCOME_INVEST_CONTRIB'), 'invest');
assert.equal(incomeDetailBucket('INCOME_RESALE_VENMO'), 'resale');
assert.equal(incomeDetailBucket('INCOME_AMZN_CASHBACK'), 'amzn');
assert.equal(hit('Venmo Payment from Alex', -40)?.detail, 'INCOME_RESALE_VENMO');
assert.equal(hit('FDIC INSURED DEPOSIT AT C', -13.98)?.reason, 'interest');
assert.equal(hit('RHRP INT BEARING - dividend', -33.67)?.reason, 'dividend');

console.log('finance-classify: OK');
