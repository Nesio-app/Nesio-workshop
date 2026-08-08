/**
 * 拍摄管线云同步契约:记一餐/衣帽间照片必须走「本机 + uploadCloudAsset」
 * (与记忆照片同构),不能只塞 IDB 指望 module-data 补缺。
 *
 * 病灶:文字(life-graph)立刻跨端,照片本体从不挂 storagePath → 换端永远没图。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const pipeline = read('lib/portal/capture-pipeline.ts');
const wardrobe = read('components/portal/insights/WardrobePanel.tsx');
const cooking = read('components/portal/cooking/CookingSheet.tsx');
const wardrobeLib = read('lib/portal/wardrobe.ts');

assert.match(pipeline, /uploadCloudAsset/, 'capture-pipeline 必须上传云 Storage');
assert.match(pipeline, /persistCapturedPhoto/, '统一落库入口 persistCapturedPhoto');
assert.match(pipeline, /resolveAssetDisplayUrl/, '换端读图走 resolveAssetDisplayUrl(本机→签名 URL)');
assert.match(pipeline, /storagePath/, '云上传成功要带回 storagePath');

assert.match(wardrobe, /storeWardrobeImageFull/, '衣帽间保存走 storeWardrobeImageFull(带 storagePath)');
assert.match(wardrobe, /resolveAssetDisplayUrl/, '衣帽间缩略图换端能读云图');
assert.match(wardrobe, /storagePath:\s*persisted\.storagePath|storagePath,\s*mimeType/, 'addGarment 要带上 storagePath');

assert.match(wardrobeLib, /storagePath/, 'Garment 投影暴露 storagePath');
assert.match(wardrobeLib, /input\.storagePath/, 'addGarment 接受并挂云孪生 asset');

assert.match(cooking, /persistCapturedPhoto/, '记一餐保存必须落照片');
assert.match(cooking, /purpose:\s*'meal'/, '记一餐照片 purpose=meal');
assert.match(cooking, /updateLifeNode\(mealId,\s*\{\s*assets:/, '照片 asset 挂到这一餐节点');

console.log('capture-pipeline-cloud: OK(本机+云 Storage · 记一餐/衣帽间同记忆路径)');
