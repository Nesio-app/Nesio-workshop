/**
 * 行为契约:训练计划改写层的合并逻辑(lib/platform/training-overrides.ts)。
 * 不变式 —— 种子计划不被改脏、删空的训练日/阶段不留空壳、没改过的自动吃种子新版、组次数夹在合理区间。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/platform/training-overrides.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  // 存储模块现在会 import storage-health(全局「存储满了」横幅)。测的是纯逻辑,
  // 这里给个空壳 require,免得为了跑纯函数把整条 DOM 依赖拖进来。
  const require = (id) => (id.includes('storage-health') ? { reportStorageDropped() {}, logDropped() {} } : {});
  // 没有 window → 存储那半段自动走 SSR 分支,合并逻辑照常可测
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require, Set, Array, Number, Object, Math, JSON, String });
  return mod.exports;
}
const M = load();

const base = () => ({
  id: 'strength_3day',
  name: { zh: '力量', en: 'Strength' },
  goal: 'strength',
  sessionsPerWeek: 3,
  phases: [{
    name: { zh: '基础期', en: 'Base' },
    weeks: 4,
    sessions: [
      { id: 'lowerA', name: { zh: '下肢 A', en: 'Lower A' }, items: [{ exerciseId: 'squat', sets: 3, reps: 5 }] },
      { id: 'upperB', name: { zh: '上肢 B', en: 'Upper B' }, items: [{ exerciseId: 'bench', sets: 3, reps: 5 }] },
    ],
  }],
});

// ── 没有改写:原样返回 ──
{
  const b = base();
  const out = M.mergeProtocol(b, {});
  assert.equal(out.phases[0].sessions.length, 2);
  assert.equal(out.phases[0].sessions[0].items[0].sets, 3);
}

// ── 改组数/次数:只换这一天,别的不动 ──
{
  const b = base();
  const ov = { 'strength_3day:lowerA': { items: [{ exerciseId: 'squat', sets: 5, reps: 3 }] } };
  const out = M.mergeProtocol(b, ov);
  assert.equal(out.phases[0].sessions[0].items[0].sets, 5);
  assert.equal(out.phases[0].sessions[0].items[0].reps, 3);
  assert.equal(out.phases[0].sessions[1].items[0].sets, 3, '没改的那天不动');
  // 种子计划本身没被改脏 —— 这是这一层存在的全部意义
  assert.equal(b.phases[0].sessions[0].items[0].sets, 3, 'base 必须保持不可变');
}

// ── 删掉一个训练日 ──
{
  const out = M.mergeProtocol(base(), { 'strength_3day:upperB': { hidden: true } });
  assert.equal(out.phases[0].sessions.length, 1);
  assert.equal(out.phases[0].sessions[0].id, 'lowerA');
}

// ── 动作删光 = 这天没内容,不留空壳 ──
{
  const out = M.mergeProtocol(base(), { 'strength_3day:lowerA': { items: [] } });
  assert.equal(out.phases[0].sessions.length, 1, '空 items 的训练日不显示');
  assert.equal(out.phases[0].sessions[0].id, 'upperB');
}

// ── 一个阶段被删空 → 阶段本身也不显示 ──
{
  const out = M.mergeProtocol(base(), {
    'strength_3day:lowerA': { hidden: true },
    'strength_3day:upperB': { hidden: true },
  });
  assert.equal(out.phases.length, 0, '空阶段不留');
}

// ── 别的计划的改写不串台 ──
{
  const out = M.mergeProtocol(base(), { 'run_base:easyRun': { hidden: true } });
  assert.equal(out.phases[0].sessions.length, 2, '另一个计划的 key 不该影响这个');
}

// ── 种子计划升级:没被改过的训练日自动吃到新版 ──
{
  const b = base();
  b.phases[0].sessions[1].items = [{ exerciseId: 'bench', sets: 4, reps: 6 }]; // 假装种子升级了
  const out = M.mergeProtocol(b, { 'strength_3day:lowerA': { items: [{ exerciseId: 'squat', sets: 5, reps: 3 }] } });
  assert.equal(out.phases[0].sessions[1].items[0].sets, 4, '没改过的吃新版');
  assert.equal(out.phases[0].sessions[0].items[0].sets, 5, '改过的仍用用户的');
}

// ── hasOverrides:按计划前缀判断 ──
{
  assert.equal(M.hasOverrides('strength_3day', {}), false);
  assert.equal(M.hasOverrides('strength_3day', { 'strength_3day:lowerA': { hidden: true } }), true);
  assert.equal(M.hasOverrides('strength_3day', { 'run_base:x': { hidden: true } }), false);
}

// ── 组数/次数夹在合理区间(防手滑点成 0 组 / 999 次)──
{
  assert.equal(M.clampSets(0), 1);
  assert.equal(M.clampSets(99), 10);
  assert.equal(M.clampSets(3.4), 3);
  assert.equal(M.clampReps(0), 1);
  assert.equal(M.clampReps(999), 50);
  assert.equal(M.clampReps(999, 'min'), 120, '有氧按分钟,上限放宽');
}

console.log('training-overrides: OK');
