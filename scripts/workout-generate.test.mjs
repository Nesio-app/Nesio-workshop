/**
 * 行为契约:「今天练什么」两问生成器(workout-generate)。
 * 锁死:器械过滤取值、槽位抽样不重复且不硬凑、剂量规则(abs 3×12/静态按秒/默认 3×10)、
 * 「换一个」同目标肌不重复、回溯归因与轮换建议、真实目录下五个部位×常见器械都配得出一套。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Date, Math, Number, Array, Object, String, RegExp, JSON, Set, Map, parseFloat, process: { env: {} } });
  return mod.exports;
}

const g = loadTs('../lib/portal/workout-generate.ts');
const rngOf = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

// ── 合成小目录 ──
const mk = (id, target, equipment, name = id, nameZh = '') => ({ id, name, nameZh, category: '', bodyPart: '', equipment, target, secondary: [], muscleGroup: target, media: '', cues: [] });
const SYN = [
  mk('p1', 'pectorals', 'body weight', 'Push-Up', '俯卧撑'),
  mk('p2', 'pectorals', 'dumbbell', 'Dumbbell Press'),
  mk('p3', 'pectorals', 'dumbbell', 'Dumbbell Fly'),
  mk('d1', 'delts', 'dumbbell', 'Lateral Raise'),
  mk('t1', 'triceps', 'body weight', 'Bench Dip'),
  mk('t2', 'triceps', 'dumbbell', 'Kickback'),
  mk('l1', 'lats', 'body weight', 'Pull-Up'),
  mk('l2', 'lats', 'dumbbell', 'One-Arm Row'),
  mk('u1', 'upper back', 'dumbbell', 'Reverse Fly'),
  mk('tr1', 'traps', 'dumbbell', 'Shrug'),
  mk('b1', 'biceps', 'dumbbell', 'Curl'),
  mk('b2', 'biceps', 'band', 'Band Curl'),
  mk('b3', 'biceps', 'resistance band', 'RB Curl'),
  mk('q1', 'quads', 'body weight', 'Squat'),
  mk('g1', 'glutes', 'body weight', 'Glute Bridge'),
  mk('h1', 'hamstrings', 'dumbbell', 'RDL'),
  mk('c1', 'calves', 'body weight', 'Calf Raise'),
  mk('a1', 'abs', 'body weight', 'Crunch'),
  mk('a2', 'abs', 'body weight', 'Plank', '平板支撑'),
  mk('s1', 'spine', 'body weight', 'Superman'),
];

// ── 器械过滤 ──
assert.deepEqual(g.equipPool(SYN, ['gym']).length, SYN.length, 'gym = 全量');
assert.ok(g.equipPool(SYN, ['band']).every((e) => e.equipment === 'band' || e.equipment === 'resistance band'), 'band 并入 resistance band');
assert.equal(g.equipPool(SYN, ['band']).length, 2, 'band 池 2 条');
assert.equal(g.equipPool(SYN, ['kettlebell']).length, 0, '无壶铃动作 → 空池');
assert.ok(g.equipPool(SYN, ['body', 'dumbbell']).length > g.equipPool(SYN, ['body']).length, '多选取并集');

// ── 生成:不重复、不硬凑 ──
const pull6 = g.generateWorkout(SYN, { equips: ['body', 'dumbbell'], focus: 'pull', count: 6, rng: rngOf([0]) });
assert.ok(pull6.length >= 4, `pull 至少 4 个,实际 ${pull6.length}`);
assert.equal(new Set(pull6.map((it) => it.exercise.id)).size, pull6.length, '无重复动作');
assert.ok(pull6.every((it) => g.TARGET_BUCKET[it.exercise.target] === 'pull'), '全部落在拉的目标肌');
const none = g.generateWorkout(SYN.filter((e) => e.target === 'pectorals'), { equips: ['body'], focus: 'pull', count: 6, rng: rngOf([0]) });
assert.equal(none.length, 0, '池里没有拉的动作 → 如实返回空,不硬凑胸的动作');

// ── 剂量规则 ──
const abs = g.generateWorkout(SYN, { equips: ['body'], focus: 'core', count: 4, rng: rngOf([0]) });
const crunch = abs.find((it) => it.exercise.id === 'a1');
assert.ok(crunch && crunch.sets === 3 && crunch.reps === 12 && crunch.unit === 'reps', 'abs 默认 3×12');
assert.ok(g.isTimedExercise({ name: 'Plank', nameZh: '平板支撑' }), 'plank 判静态');
assert.ok(g.isTimedExercise({ name: 'Wall Sit Hold', nameZh: '' }), 'hold 判静态');
assert.ok(!g.isTimedExercise({ name: 'Squat', nameZh: '深蹲' }), '深蹲非静态');
const balanced = g.generateWorkout(SYN, { equips: ['body', 'dumbbell'], focus: 'balanced', count: 6, rng: rngOf([0]) });
assert.ok(balanced.every((it) => it.sets === 3), '默认 3 组');

// ── 换一个:同目标肌、不与整套重复 ──
const before = g.generateWorkout(SYN, { equips: ['body', 'dumbbell'], focus: 'push', count: 4, rng: rngOf([0]) });
const idx = before.findIndex((it) => it.exercise.target === 'pectorals');
assert.ok(idx >= 0, '有胸的槽');
const swapped = g.swapAlternative(SYN, before, idx, { equips: ['body', 'dumbbell'], rng: rngOf([0]) });
assert.ok(swapped, '有替代可换');
assert.equal(swapped.exercise.target, before[idx].exercise.target, '换后同目标肌');
assert.ok(!before.some((it) => it.exercise.id === swapped.exercise.id), '不与整套已有重复');
const noswap = g.swapAlternative(SYN, [{ exercise: mk('x', 'traps', 'body weight'), sets: 3, reps: 10, unit: 'reps' }], 0, { equips: ['body'] });
assert.equal(noswap, null, '无候选 → null(UI 显式提示,不静默)');

// ── 回溯归因 + 轮换建议 ──
assert.equal(g.inferFocus(['pectorals', 'delts', 'lats']), 'push', '多数票归 push');
assert.equal(g.inferFocus(['cardiovascular system']), null, '归不了因 → null');
assert.equal(g.suggestNextFocus('push'), 'pull');
assert.equal(g.suggestNextFocus('pull'), 'legs');
assert.equal(g.suggestNextFocus('legs'), 'push');
assert.equal(g.suggestNextFocus('core'), 'balanced');
assert.equal(g.suggestNextFocus(null), 'balanced', '无历史 → 均衡');

// ── 时长估算 ──
assert.equal(g.estimateMinutes([{ sets: 3 }, { sets: 3 }, { sets: 3 }, { sets: 3 }]), 20, '4 动作约 20 分钟');

// ── 真实目录:五个部位 × 常见器械组合都配得出一套 ──
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'public', 'exercise-catalog.json'), 'utf8'));
for (const focus of ['balanced', 'push', 'pull', 'legs', 'core']) {
  for (const equips of [['body'], ['body', 'dumbbell'], ['gym']]) {
    const out = g.generateWorkout(doc.exercises, { equips, focus, count: 6, rng: rngOf([0.1, 0.5, 0.9]) });
    assert.ok(out.length >= 4, `${focus} × ${equips.join('+')} 至少 4 个,实际 ${out.length}`);
  }
}

// ── 静态钉:UI 侧关键约定 ──
const sheetSrc = fs.readFileSync(path.join(root, 'components', 'portal', 'fitness', 'WorkoutGenSheet.tsx'), 'utf8');
assert.ok(/nesio-start-workout/.test(sheetSrc), '开始跟练走现有 nesio-start-workout 事件');
assert.ok(/saveWorkout/.test(sheetSrc), '存为我的训练走现有 workout-store');
assert.ok(/catch|失败/.test(sheetSrc), '目录加载有失败分支(异步红线)');

console.log('workout-generate.test.mjs ✓ 全部通过');
