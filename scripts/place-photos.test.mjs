/**
 * 行为契约:地点封面照就近匹配。
 * 锁死:25km 内取最近的一张带图记忆(并列取最近记的);超出范围返回 null;空输入 null。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function loadModule(rel, requireImpl = () => ({})) {
  const mod = { exports: {} };
  vm.runInNewContext(compile(rel), {
    module: mod, exports: mod.exports, console, JSON, Object, Array, Math, Date, Number, String,
    window: undefined, localStorage: undefined,
    require: requireImpl,
  });
  return mod.exports;
}
const geo = loadModule('../lib/portal/geo.ts');
const countryNorm = loadModule('../lib/portal/country-normalize.ts');
const pp = loadModule('../lib/portal/place-photos.ts', (p) => {
  if (p.includes('/geo')) return geo;
  if (p.includes('country-normalize')) return countryNorm;
  if (p.includes('image-compress')) return { compressToDataUrl: async () => '', putLocalImage: async () => {} };
  return {};
});

const raleigh = { lat: 35.78, lon: -78.64 };
const nodes = [
  { assetId: 'near', lat: 35.79, lon: -78.65, ts: 100 },   // ~1.3km
  { assetId: 'far', lat: 40.71, lon: -74.0, ts: 200 },     // NYC, ~600km
];
assert.equal(pp.matchPlacePhotoAsset([raleigh], nodes), 'near', '取 25km 内最近');

// 并列(同坐标)取最近记的
const tie = [
  { assetId: 'old', lat: 35.78, lon: -78.64, ts: 1 },
  { assetId: 'new', lat: 35.78, lon: -78.64, ts: 9 },
];
assert.equal(pp.matchPlacePhotoAsset([raleigh], tie), 'new', '并列取最近记的');

// 全都超出 25km → null
assert.equal(pp.matchPlacePhotoAsset([raleigh], [{ assetId: 'far', lat: 40.71, lon: -74.0, ts: 1 }]), null, '超范围 null');
// 空输入 → null
assert.equal(pp.matchPlacePhotoAsset([], nodes), null, '无坐标 null');
assert.equal(pp.matchPlacePhotoAsset([raleigh], []), null, '无带图节点 null');

console.log('place-photos: OK');
