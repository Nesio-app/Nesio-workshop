/**
 * 拍摄管线云同步契约:记一餐/衣帽间必须走主相机同构三步,
 * 且通用 upsert 不能再把 assets 剥成空数组。
 *
 * 病灶:主相机能同步、其它入口不能 —— 因为只有主相机调了
 * saveCloudMemorySnapshot({ assets }),而 syncLifeGraphUpsertToCloud 一直发 assets:[].
 * 服务端 sanitizeMemoryNode 会剥掉 node.assets,图只进 memory_assets 表。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const pipeline = read('lib/portal/capture-pipeline.ts');
const lifeGraph = read('lib/portal/life-graph.ts');
const wardrobe = read('components/portal/insights/WardrobePanel.tsx');
const cooking = read('components/portal/cooking/CookingSheet.tsx');
const wardrobeLib = read('lib/portal/wardrobe.ts');

// ── 通用 upsert 必须带 assets(根因修复) ──
assert.match(
  lifeGraph,
  /syncLifeGraphUpsertToCloud[\s\S]{0,800}assets:\s*assets|body:\s*JSON\.stringify\(\{\s*nodes:\s*\[node\],\s*assets\s*\}\)/,
  'syncLifeGraphUpsertToCloud 必须把 node.assets(带 nodeId)推上云,不能再 assets:[]',
);
// 只查函数体里的 JSON.stringify 载荷,别误伤注释里提到的「以前 assets:[]」。
const upsertStart = lifeGraph.indexOf('async function syncLifeGraphUpsertToCloud');
assert.ok(upsertStart >= 0, '找不到 syncLifeGraphUpsertToCloud');
const upsertBody = lifeGraph.slice(upsertStart, lifeGraph.indexOf('\nasync function', upsertStart + 1));
assert.match(upsertBody, /assets\s*=\s*\(node\.assets/, 'upsert 从 node.assets 取出资产');
assert.match(upsertBody, /JSON\.stringify\(\{\s*nodes:\s*\[node\],\s*assets\s*\}\)/, 'upsert POST 体带 assets');
assert.doesNotMatch(upsertBody, /JSON\.stringify\(\{\s*nodes:\s*\[node\],\s*assets:\s*\[\s*\]\s*\}\)/, '禁止再写死 assets:[]');

// ── 管线三步同构主相机 ──
assert.match(pipeline, /purpose:\s*['"]memory['"]/, '云上传 purpose 必须是 memory(与主相机一致)');
assert.match(pipeline, /saveCloudMemorySnapshot/, '必须写 memory_assets(saveCloudMemorySnapshot)');
assert.match(pipeline, /attachPhotoToMemoryNode/, '挂节点入口 attachPhotoToMemoryNode');
assert.match(pipeline, /pushNodeAssetsToCloud/, '创建时已带图 → pushNodeAssetsToCloud');
assert.match(pipeline, /backfillMissingPhotoUploads/, '旧图补传 backfillMissingPhotoUploads');
assert.match(pipeline, /resolveAssetDisplayUrl/, '换端读图 resolveAssetDisplayUrl');

assert.match(wardrobe, /pushNodeAssetsToCloud/, '衣帽间保存后推 memory_assets');
assert.match(wardrobe, /storeWardrobeImageFull/, '衣帽间走 storeWardrobeImageFull');
assert.match(wardrobe, /resolveAssetDisplayUrl/, '衣帽间缩略图能读云图');
assert.match(wardrobeLib, /input\.storagePath/, 'addGarment 挂云孪生 asset');

assert.match(cooking, /attachPhotoToMemoryNode/, '记一餐保存必须 attachPhotoToMemoryNode');
assert.match(cooking, /kind:\s*'meal'/, '记一餐 kind=meal');

console.log('capture-pipeline-cloud: OK(upsert 带 assets · 主相机三步同构 · 旧图补传)');
