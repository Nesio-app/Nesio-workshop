// 统一仲裁器(架构审查 #2)契约:presence 唯一裁决点的优先级与排重规则。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'lib/platform/today-arbiter.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}) });
const { arbitrateTodayPresence } = mod.exports;

// 1. 置顶赢复访:复访候选被置顶 → 复访卡不出
let v = arbitrateTodayPresence({ pinnedId: 'a', dormantCandidateId: 'a', taskIds: ['a', 'b'], guidanceClaims: [] });
assert.equal(v.showDormant, false);
assert.deepEqual(v.taskIds, ['b'], '置顶节点不再出现在任务列表');

// 2. 置顶赢引导卡:引导卡认领的节点被置顶 → 该卡进 suppress 集合
v = arbitrateTodayPresence({ pinnedId: 'a', dormantCandidateId: null, taskIds: ['b'], guidanceClaims: ['a', 'c'] });
assert.equal(v.suppressGuidanceNodeIds.has('a'), true);
assert.equal(v.suppressGuidanceNodeIds.has('c'), false);
assert.deepEqual(v.taskIds, ['b'].filter((x) => x !== 'c'), '未被抢占的引导卡认领节点不影响 b');

// 3. 每节点一天一个槽位:复访候选 + 引导卡认领的节点都从任务列表排除
v = arbitrateTodayPresence({ pinnedId: null, dormantCandidateId: 'd', taskIds: ['d', 'e', 'f'], guidanceClaims: ['e'] });
assert.equal(v.showDormant, true);
assert.deepEqual(v.taskIds, ['f'], '复访候选 d 与引导卡认领 e 均排除');

// 4. 无冲突时全通过
v = arbitrateTodayPresence({ pinnedId: 'x', dormantCandidateId: 'y', taskIds: ['z'], guidanceClaims: ['w'] });
assert.equal(v.showDormant, true);
assert.deepEqual(v.taskIds, ['z']);
assert.equal(v.suppressGuidanceNodeIds.size, 0);

// 5. 图5 24h 分界:≤24h → 时间线赢(压引导卡,任务列表保留);>24h → 引导卡赢(任务列表剔除)
const now = 1_000_000_000_000;
v = arbitrateTodayPresence({
  pinnedId: null, dormantCandidateId: null,
  taskIds: ['near', 'far'],
  guidanceClaims: ['near', 'far'],
  claimAtMs: { near: now + 3_600_000, far: now + 2 * 86_400_000 },
  nowMs: now,
});
assert.equal(v.suppressGuidanceNodeIds.has('near'), true, '≤24h 压引导卡');
assert.equal(v.suppressGuidanceNodeIds.has('far'), false);
assert.deepEqual(v.taskIds, ['near'], '>24h 从时间线剔除,≤24h 保留');

console.log('today-arbiter contract: OK');
