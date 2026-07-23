/**
 * 行为契约:扩展动作库(1324,exercises-dataset MIT 元数据)。
 * 锁死:public/exercise-catalog.json 结构完整、含中文分步、不含媒体二进制;
 * catalogAnimFrames/filterCatalog 纯函数正确。
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Date, Math, Number, Array, Object, String, RegExp, parseFloat, fetch: () => Promise.reject(new Error('no-net')) });
  return mod.exports;
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'public', 'exercise-catalog.json'), 'utf8'));

// ── 数据完整性 ──
assert.equal(doc.count, doc.exercises.length, 'count 与数组长度一致');
assert.ok(doc.exercises.length >= 1300, `至少 1300 条,实际 ${doc.exercises.length}`);
assert.match(doc.dataLicense, /MIT/, '标注 MIT 数据授权');

// 不含媒体二进制/直链(只留 media 链接键)
const s = JSON.stringify(doc);
assert.ok(!/data:image|base64|gymvisual\.com/.test(s), '不含媒体 base64 或 Gym visual 直链');

// 每条字段齐 + 绝大多数含中文分步
let zh = 0;
for (const e of doc.exercises) {
  assert.ok(e.id && e.name, `${e.id} 有 id/name`);
  assert.ok(Array.isArray(e.cues), `${e.id} cues 是数组`);
  assert.ok(typeof e.media === 'string', `${e.id} 有 media 键`);
  assert.ok(!/\.(gif|mp4|jpg|png)$/i.test(e.media), `${e.id} media 是键非文件名`);
  if (e.cues[0] && /[一-鿿]/.test(e.cues[0])) zh += 1;
}
assert.ok(zh / doc.exercises.length > 0.9, `>90% 含中文分步,实际 ${zh}/${doc.exercises.length}`);

// ── 纯函数 helper ──
const cat = loadTs('../lib/portal/exercise-catalog.ts');
assert.equal(cat.catalogAnimDir('0001-abc'), '/exercise-anim/catalog/0001-abc');
const fr = cat.catalogAnimFrames('m1', 3);
assert.deepEqual([...fr], ['/exercise-anim/catalog/m1/f00.webp', '/exercise-anim/catalog/m1/f01.webp', '/exercise-anim/catalog/m1/f02.webp']);
assert.deepEqual([...cat.catalogAnimFrames('m1', 0)], [], '0 帧 → 空');
const sample = [{ name: 'Barbell Squat', category: 'upper legs', bodyPart: 'upper legs', equipment: 'barbell', target: 'quads' }];
assert.equal(cat.filterCatalog(sample, 'squat').length, 1, '名称命中');
assert.equal(cat.filterCatalog(sample, 'barbell').length, 1, '器械命中');
assert.equal(cat.filterCatalog(sample, 'zzz').length, 0, '无命中');

console.log(`exercise-catalog.test.mjs ✓ 全部通过 (${doc.exercises.length} 条, ${zh} 含中文)`);
