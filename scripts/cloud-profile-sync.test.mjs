/**
 * 行为契约:Profile(名字/头像)跨端同步(批次200)。
 *
 * 核心行为(profile.ts 的 identity LWW 时间戳):
 *  - 改 displayName / avatarStoragePath → 更新 identityUpdatedAt(该推云、参与 LWW);
 *  - **只改 avatarUrl(签名 URL 刷新)→ 不更新** —— 否则每次换签都误判本地新改 → 跨端乒乓;
 *  - cloud-apply 传入 opts.identityUpdatedAt → 用云端时刻(不当成本地新改)。
 *
 * 源码契约(cloud-profile-sync.ts):按 identityUpdatedAt(非 row updatedAt)LWW、换头像清 avatarUrl、
 * 免费(无付费门);profile-settings 路由 + 客户端 allowlist 放行 identityUpdatedAt。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 行为:profile.ts 的时间戳 bump 规则 ──
function loadProfile() {
  const src = read('../lib/portal/profile.ts');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const sandbox = {
    module: mod, exports: mod.exports,
    require: () => ({ reportStorageDropped: () => {} }),
    window: { dispatchEvent: () => {} },
    document: { documentElement: {} },
    localStorage,
    CustomEvent: class { constructor(t) { this.type = t; } },
    Date, JSON, String, Object,
  };
  vm.runInNewContext(js, sandbox);
  return { m: mod.exports, store };
}

const { m, store } = loadProfile();
const KEY = 'treasurebox-profile-updated-at';

// 只改 avatarUrl(签名 URL 刷新)→ 不 bump
m.saveProfileSettings({ avatarUrl: 'https://signed/x' });
assert.equal(store.get(KEY), undefined, '只改 avatarUrl(换签)不更新 identity 时间戳');

// 改名字 → bump
m.saveProfileSettings({ displayName: 'Alice' });
const t1 = store.get(KEY);
assert.ok(t1, '改 displayName → 更新时间戳');

// 再存同名字 → 不变(未真正改变)
m.saveProfileSettings({ displayName: 'Alice' });
assert.equal(store.get(KEY), t1, '同名字重存不刷新时间戳');

// 改头像 storagePath → bump
m.saveProfileSettings({ avatarStoragePath: 'user/avatar/1.png' });
assert.ok(store.get(KEY) >= t1, '改 avatarStoragePath → 更新时间戳');

// cloud-apply:传入云端时刻 → 用之(不当本地新改)
m.saveProfileSettings({ displayName: 'Bob' }, { identityUpdatedAt: '2020-01-01T00:00:00.000Z' });
assert.equal(store.get(KEY), '2020-01-01T00:00:00.000Z', 'cloud-apply 用云端 identityUpdatedAt');

// ── 源码契约:sync 模块 ──
const sync = read('../lib/portal/cloud-profile-sync.ts');
assert.match(sync, /identityUpdatedAt/, '按 identityUpdatedAt 做 LWW');
assert.ok(!/\.updatedAt\b/.test(sync), '不用 row 的 updatedAt(会被 learningRef 等写刷新)');
assert.match(sync, /cloudAt > localAt/, '云更新才采纳');
assert.match(sync, /localAt > cloudAt/, '本地更新才反推');
assert.match(sync, /avatarUrl\s*=\s*''/, '采纳云头像时清本地旧签名 URL');
assert.ok(!/Entitlement/.test(sync), 'P3:不查付费门');
// 批次204:老头像自动迁移 + 写入结果检查
assert.match(sync, /uploadCloudAsset/, '批次204:无 storagePath 的本地头像自动上传迁移');
assert.match(sync, /startsWith\(['"]data:['"]\)/, '仅迁移本地 dataURL 头像(签名 URL 不重传)');
assert.match(sync, /res\?\.ok\s*&&\s*res\?\.writesCloud/, 'push 检查写云真成功,不吞错');

// ── allowlist 放行 identityUpdatedAt ──
const route = read('../app/api/cloud/profile-settings/route.ts');
const allow = route.slice(route.indexOf('const stringSettingsKeys'), route.indexOf('] as const', route.indexOf('const stringSettingsKeys')));
assert.match(allow, /'identityUpdatedAt'/, 'profile-settings 路由 allowlist 放行 identityUpdatedAt');

console.log('cloud-profile-sync: OK');
