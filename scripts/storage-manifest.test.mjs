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
const { isAppKey, keyKind, keysForBackup, isBackupKey, purgeLocalData, isLocalOnly } = mod.exports;

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
// 足迹主数据键:裸 `geo` 的缓存正则曾误伤 `nesio-place-geo-v1`(`-geo-` 命中)→ 从备份剔除 →
// 换浏览器足迹永远同步不过去。必须是 durable + 进备份。回归钉死。
assert.equal(keyKind('nesio-place-geo-v1'), 'durable', '足迹主数据 = durable(不可被 geo 缓存正则误伤)');
assert.equal(isBackupKey('nesio-place-geo-v1'), true, '足迹必须进备份(否则换机丢足迹)');
assert.equal(keyKind('nesio-place-cat-v1'), 'durable', '足迹分类 = durable');
// 但真正的地理缓存仍要判成 cache(不进备份)
assert.equal(keyKind('nesio-revgeo-cache-v1'), 'cache', '反向地理编码缓存 = cache');
assert.equal(keyKind('nesio-place-geocode-enabled'), 'cache', 'geocode 开关/缓存 = cache');
assert.equal(keyKind('analyst_feedback'), 'durable', '学习态 = durable(进备份)');
assert.equal(keyKind('nesio-mirror-profile-v1'), 'durable', 'mirror-profile 不该被误判成 auth');
// A 计划学习态(localStorage 侧)全部 durable —— 进备份、「彻底删除」要清。
// (IDB 侧 feedback-log/ranker-trainlog 由 collectIdbBlobs/purgeIdbBlobs 按后端枚举自动覆盖。)
for (const k of ['nesio-preference-v1', 'nesio-baseline-v1', 'nesio-recency-v1', 'nesio-guidance-ranker-v1']) {
  assert.equal(keyKind(k), 'durable', `${k} 学习态必须 durable(导出/删除收口)`);
  assert.equal(isBackupKey(k), true, `${k} 必须进备份`);
}

// workshop:一切数据跨端一致 —— 积分/地点照片/阅读高亮 + 按人数据(含医疗/药物/健康)全部改为
// **云端同步**(durable + 进备份/同步,仅本人账号内、不进 AI);靠 cloud-module-sync 的反遮盖闸防
// 「被空状态盖掉」,不再靠 local-only 隔离。故 LOCAL_ONLY_KEYS 现为空集。
for (const k of ['nesio-rewards-v1', 'nesio-place-photos-v1', 'nesio-reader-highlights-v1', 'nesio-person-records-v1']) {
  assert.equal(isLocalOnly(k), false, `${k} 不再 local-only(改云端同步)`);
  assert.equal(isBackupKey(k), true, `${k} 进备份/同步(跨端一致)`);
}

// 各同步引擎「自己的簿记/水位」= cache:绝不进备份/模块同步(否则每轮 churn 上云 + 新设备被别端水位污染)。
for (const k of ['nesio-module-sync-state-v1', 'nesio-email-sync-state-v1', 'nesio-backup-synced-entrycount-v1', 'nesio-cloud-backup-last-v1']) {
  assert.equal(keyKind(k), 'cache', `${k} = cache(同步簿记不该被当数据同步)`);
  assert.equal(isBackupKey(k), false, `${k} 不进备份/同步`);
}

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
