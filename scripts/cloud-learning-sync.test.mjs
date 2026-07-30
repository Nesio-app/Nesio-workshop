/**
 * 行为契约:学习态跨端银行(批次199 P2;2026-07-29 硬拆改版 —— ranker 已随规则管线物理删除,
 * 学习态只剩「偏好」)。
 *
 * 钉死:
 *  - sync 两跳不变:载荷进 assets(purpose=learning)、指针进 profile_settings.learningRef;
 *  - 旧端 blob 兼容:trainLog 字段读时忽略(不炸、不复活 ranker);
 *  - 偏好回灌**非覆盖** seed(不盖本地已学 —— 反回归的命门);
 *  - P3 免费:不查付费权益门;
 *  - 指针写云检查结果不吞错(批次204 的坑);
 *  - profile-settings 路由 allowlist 放行 learningRef。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const sync = read('../lib/portal/cloud-learning-sync.ts');
assert.match(sync, /purpose'?,\s*'learning'|append\('purpose', 'learning'\)/, '载荷进 assets purpose=learning');
assert.match(sync, /learningRef/, '指针进 profile_settings.learningRef');
assert.ok(!/importRankerTrainLog|exportRankerTrainLog|guidance-ranker/.test(sync), 'ranker 已物理拆除:不再 import 训练日志');
assert.match(sync, /trainLog\?/, '旧端 blob 的 trainLog 保留为可选遗留字段(读时忽略,不炸)');
assert.match(sync, /restorePreferenceState/, '偏好回灌');
assert.ok(!/hasCloudEntitlement|Entitlement/.test(sync), 'P3:不查付费权益门');
assert.match(sync, /saved\?\.ok/, '批次204:learning 指针写云检查结果,不吞错');

const pref = read('../lib/platform/personalization/preference-store.ts');
const restoreRegion = pref.slice(pref.indexOf('export function restorePreferenceState'), pref.indexOf('export function resetPreferenceDimension'));
assert.match(restoreRegion, /overwrite:\s*false/, '偏好回灌非覆盖(不盖本地已学)');

const route = read('../app/api/cloud/profile-settings/route.ts');
const allowlist = route.slice(route.indexOf('const stringSettingsKeys'), route.indexOf('] as const', route.indexOf('const stringSettingsKeys')));
assert.match(allowlist, /'learningRef'/, 'profile-settings allowlist 放行 learningRef');

console.log('cloud-learning-sync: OK(偏好唯一学习态 · 旧 blob 兼容 · 非覆盖 seed)');
