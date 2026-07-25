/**
 * 行为契约:重云同步绝不在「跟练中」或「交互那一帧」抢主线程(修真机「跟练卡死」根因)。
 *
 * 根因:云同步的 gzip/JSON/base64/contentHash 全在主线程同步执行,全数据上云后 blob 变大,单个调用就能
 * 卡住主线程数秒;而同步批次会在每次回到前台(visibilitychange)整批重跑,跟练浮层期间该监听仍活着 →
 * 跟练中一回前台就冻死。修法:跟练全程暂停重同步 + 同步批次统一推到浏览器空闲(whenIdle),永不落在交互帧。
 *
 * 锁死:
 *  1) WorkoutPlayer 挂载即 suspendCloudSync()(effect 返回其 release 作清理)。
 *  2) Portal 的重同步批次受 isCloudSyncSuspended() 闸门保护,且经 whenIdle 调度;
 *     可见性(visibilitychange)回调里不得再同步直呼 autoSyncModulesWithCloud()。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const wp = fs.readFileSync(path.join(root, 'components', 'portal', 'fitness', 'WorkoutPlayer.tsx'), 'utf8');
const portal = fs.readFileSync(path.join(root, 'components', 'portal', 'Portal.tsx'), 'utf8');

// 1) 跟练全程暂停重云同步。
assert.match(wp, /import\s*\{[^}]*\bsuspendCloudSync\b[^}]*\}\s*from\s*'@\/lib\/portal\/sync-suspend'/, 'WorkoutPlayer 需从 sync-suspend 引入 suspendCloudSync');
assert.match(wp, /useEffect\(\s*\(\)\s*=>\s*suspendCloudSync\(\)\s*,\s*\[\s*\]\s*\)/, 'WorkoutPlayer 挂载即 suspendCloudSync()(effect 返回 release 作清理)');

// 2) Portal 的重同步批次:闸门 + 空闲调度。
assert.match(portal, /import\s*\{[^}]*\bisCloudSyncSuspended\b[^}]*\bwhenIdle\b[^}]*\}\s*from\s*'@\/lib\/portal\/sync-suspend'/, 'Portal 需从 sync-suspend 引入 isCloudSyncSuspended + whenIdle');
assert.match(portal, /if\s*\(\s*isCloudSyncSuspended\(\)\s*\)\s*\{?\s*return/, '重同步批次开头需被 isCloudSyncSuspended() 闸门早退');
assert.match(portal, /whenIdle\(/, '同步批次需经 whenIdle 调度,不在交互帧同步跑');

// 3) 可见性回调不得再同步直呼最重的模块同步(必须走被闸门+空闲保护的批次)。
const onVisibleMatch = portal.match(/const onVisible = \(\) => \{[^}]*\}/);
assert.ok(onVisibleMatch, '找不到 onVisible 可见性回调');
assert.ok(!/autoSyncModulesWithCloud\(\)/.test(onVisibleMatch[0]), 'onVisible 里不得直呼 autoSyncModulesWithCloud();须走 scheduleHeavySyncBatch()');

console.log('workout-sync-suspend: OK(跟练暂停重同步 + 空闲调度,绝不抢交互帧主线程)');
