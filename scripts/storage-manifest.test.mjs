/**
 * 行为契约:本机存储清单(分类 + 导出/删除收口)。
 * 验证:auth 绝不进备份、cache 不进备份、durable 进备份且覆盖 baohe_/analyst_(此前漏);
 * purgeLocalData 清 durable+cache、默认保留 auth、includeAuth 时连票据一起清。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../lib/portal/storage-manifest.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console });
const { isAppKey, keyKind, keysForBackup, isBackupKey, purgeLocalData } = mod.exports;

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
  };
}

// isAppKey:三套前缀都认,外来 key 不认
assert.equal(isAppKey('nesio-health-v1'), true);
assert.equal(isAppKey('treasurebox-theme'), true);
assert.equal(isAppKey('baohe_auth_access'), true, 'baohe_ 也是本应用 key');
assert.equal(isAppKey('analyst_feedback'), true);
assert.equal(isAppKey('unrelated-key'), false);

// keyKind 三分
assert.equal(keyKind('baohe_auth_access'), 'auth', '登录票据 = auth');
assert.equal(keyKind('nesio-auth-session-ready'), 'auth');
assert.equal(keyKind('baohe_wechat_openid'), 'auth');
assert.equal(keyKind('nesio-email-signals-cache'), 'cache');
assert.equal(keyKind('nesio-ai-cache-v1'), 'cache');
assert.equal(keyKind('nesio-health-v1'), 'durable', '健康数据 = durable');
assert.equal(keyKind('nesio-bank-tx-v1'), 'durable');
assert.equal(keyKind('analyst_feedback'), 'durable', '学习态 = durable(进备份)');
assert.equal(keyKind('nesio-mirror-profile-v1'), 'durable', 'mirror-profile 不该被误判成 auth');

// 备份:durable 进、auth/cache 不进;覆盖 baohe_/analyst_(修此前漏)
assert.equal(isBackupKey('nesio-bank-tx-v1'), true);
assert.equal(isBackupKey('baohe_auth_access'), false, '票据绝不进备份文件(安全)');
assert.equal(isBackupKey('nesio-ai-cache-v1'), false);
assert.equal(isBackupKey('analyst_feedback'), true, 'analyst_ 学习态此前被漏,现进备份');

const store = fakeStorage({
  'nesio-health-v1': '{}', 'nesio-bank-tx-v1': '[]', 'analyst_feedback': '{}',
  'nesio-email-signals-cache': 'x', 'baohe_auth_access': 'tok', 'unrelated-key': 'z',
});
const backup = keysForBackup(store).sort();
assert.equal(JSON.stringify(backup), JSON.stringify(['analyst_feedback', 'nesio-bank-tx-v1', 'nesio-health-v1']), '备份只含 durable、覆盖 analyst_');

// 删除收口:默认清 durable+cache,保留 auth;外来 key 不动
const r1 = purgeLocalData(store);
assert.equal(store.has('nesio-health-v1'), false, 'durable 被清');
assert.equal(store.has('nesio-email-signals-cache'), false, 'cache 被清');
assert.equal(store.has('baohe_auth_access'), true, '默认保留 auth(不登出)');
assert.equal(store.has('unrelated-key'), true, '非本应用 key 不动');
assert.ok(r1.removed >= 3);

// includeAuth:连票据一起清
purgeLocalData(store, { includeAuth: true });
assert.equal(store.has('baohe_auth_access'), false, 'includeAuth 时票据也清');

console.log('storage-manifest: OK');
