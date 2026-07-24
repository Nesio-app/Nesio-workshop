/**
 * 行为契约:上身试穿的服务端输入钳制(不信客户端)。
 * 锁死:人物图必需(缺/太短 → null)、衣服图过滤非法项且封顶 5、mime 白名单否则回落 jpeg。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../app/api/portal/wardrobe-tryon/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Number, String, Boolean, RegExp,
    require: () => ({}), // 只测 clampTryonInput 纯函数
  });
  return mod.exports;
}

const M = load();
const img = (n) => 'x'.repeat(n);

// 人物图必需
{
  const r = M.clampTryonInput({ garments: [{ base64: img(200), mime: 'image/png' }] });
  assert.equal(r.person, null, '缺人物图 → person null');
}
{
  const r = M.clampTryonInput({ person: { base64: img(10), mime: 'image/png' }, garments: [] });
  assert.equal(r.person, null, '人物图太短 → null');
}

// 正常:人物 + 衣服
{
  const r = M.clampTryonInput({ person: { base64: img(200), mime: 'image/jpeg' }, garments: [{ base64: img(200), mime: 'image/png' }, { base64: img(200), mime: 'image/webp' }] });
  assert.ok(r.person, '有效人物图');
  assert.equal(r.garments.length, 2, '两件衣服');
}

// 衣服封顶 5、非法项过滤
{
  const g = Array.from({ length: 8 }, () => ({ base64: img(200), mime: 'image/jpeg' }));
  g.push({ base64: img(5), mime: 'image/png' }); // 太短,应被过滤
  const r = M.clampTryonInput({ person: { base64: img(200), mime: 'image/jpeg' }, garments: g });
  assert.equal(r.garments.length, 5, '衣服封顶 5');
}

// mime 白名单外 → 回落 jpeg
{
  const r = M.clampTryonInput({ person: { base64: img(200), mime: 'image/gif' }, garments: [] });
  assert.equal(r.person.mime, 'image/jpeg', '非白名单 mime 回落 jpeg');
}

console.log('✓ wardrobe-tryon 契约通过');
