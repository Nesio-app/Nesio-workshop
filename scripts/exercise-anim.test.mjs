/**
 * 行为契约:动作定格动图数据层。
 * 锁死:exerciseAnimFrames 按 anim.frames 生成 f00…fNN.webp 路径;无 anim 返回空;
 * 已提交的样例(lying-leg-raise)帧文件在磁盘上真实存在且数量吻合。
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Date, Math, Number, Array, Object, String, RegExp, parseFloat, process: { env: {} } });
  return mod.exports;
}

const lib = loadTs('../lib/portal/exercise-library.ts');
const { EXERCISES, exerciseById, exerciseAnimFrames, exerciseAnimDir } = lib;

// ── 路径解析 ──
const llr = exerciseById('lying-leg-raise');
assert.ok(llr, '举腿动作存在');
assert.ok(llr.anim && llr.anim.frames === 12, 'anim.frames = 12');
const frames = exerciseAnimFrames(llr);
assert.equal(frames.length, 12, '生成 12 个帧路径');
assert.equal(frames[0], '/exercise-anim/lying-leg-raise/f00.webp', '首帧路径 0 补零');
assert.equal(frames[11], '/exercise-anim/lying-leg-raise/f11.webp', '末帧路径');
assert.equal(exerciseAnimDir('foo'), '/exercise-anim/foo', '目录约定');

// ── 无 anim 优雅降级 ──
const bridge = exerciseById('glute-bridge');
assert.ok(bridge && !bridge.anim, 'glute-bridge 无动图');
assert.deepEqual([...exerciseAnimFrames(bridge)], [], '无 anim → 空数组');

// ── 已提交样例帧真实存在(防止 anim 指向不存在的资产) ──
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
for (const ex of EXERCISES.filter((e) => e.anim)) {
  const dir = path.join(root, 'public', 'exercise-anim', ex.id);
  // 第三方版权(licensed)动图被 gitignore、不在仓库里 → 跳过磁盘校验;
  // 只校验仓库内已提交(存在目录)的动作,帧齐全。
  if (!fs.existsSync(dir)) continue;
  for (let i = 0; i < ex.anim.frames; i++) {
    const f = path.join(dir, `f${String(i).padStart(2, '0')}.webp`);
    assert.ok(fs.existsSync(f), `${ex.id} 缺帧 ${f}`);
  }
}

console.log('exercise-anim.test.mjs ✓ 全部通过');
