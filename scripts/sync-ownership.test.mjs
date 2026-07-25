/**
 * 行为契约:同步归属登记(单一真源,根治「多引擎抢同一份数据」)。
 * 锁死:
 *  - 有专属引擎的 key(记忆图 / 头像身份 / 学习态 / 邮件全文行)= dedicated → 通用 module-sync 让路。
 *  - 普通 durable key(健康/足迹/物品…)= 非 dedicated → 默认走通用 module-sync(加新功能零同步代码)。
 * 这条契约保证:以后加功能默认合规,专属引擎新增 key 必须在此登记、通用同步据此让路。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/sync-ownership.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, {
  module: mod, exports: mod.exports, console, Set, Array,
  require: (p) => (p === './cloud-email-sync' ? { EMAIL_BODY_MODULE_PREFIX: 'email-body:' } : {}),
});
const { isDedicatedSyncKey, DEDICATED_SYNC_KEYS } = mod.exports;

// 专属引擎负责的 key → dedicated(通用同步让路)
for (const k of [
  'nesio-life-graph-v1',                       // memory-sync(signals union)
  'treasurebox-profile-name', 'treasurebox-profile-avatar', 'treasurebox-profile-avatar-storage-path',
  'treasurebox-profile-updated-at', 'treasurebox-locale', 'treasurebox-coach-style', 'treasurebox-theme',
  'nesio-daily-report-enabled',                // profile-sync(身份 LWW)
  'nesio-ranker-trainlog-v1', 'nesio-preference-v1', // learning-sync(无损 union)
]) {
  assert.equal(isDedicatedSyncKey(k), true, `${k} 应由专属引擎负责(通用 module-sync 让路)`);
}
// per-record 专属引擎的行前缀:邮件全文 + 导入书籍
assert.equal(isDedicatedSyncKey('email-body:18c1aa'), true, '邮件全文行由 cloud-email-sync 负责');
assert.equal(isDedicatedSyncKey('reader-book:bk_123'), true, '导入书籍行由 cloud-reader-sync 负责');

// 普通 durable 数据 → 非 dedicated:默认走通用 module-sync(加功能零同步代码的那条默认路)
for (const k of ['nesio-health-v1', 'nesio-place-geo-v1', 'nesio-bank-tx-v1', 'nesio-inventory-v1', 'nesio-person-records-v1', 'nesio-rewards-v1']) {
  assert.equal(isDedicatedSyncKey(k), false, `${k} 是普通数据 → 默认走通用同步,不该被登记为专属`);
}

// 登记表非空且含记忆图(防误清空)
assert.ok(DEDICATED_SYNC_KEYS.has('nesio-life-graph-v1'), 'DEDICATED_SYNC_KEYS 含记忆图');

console.log('sync-ownership: OK');
