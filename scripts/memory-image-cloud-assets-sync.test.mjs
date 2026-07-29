#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const cameraSheet = readFileSync(resolve(repoRoot, 'components/portal/CameraSheet.tsx'), 'utf8');
const shareSheet = readFileSync(resolve(repoRoot, 'components/portal/ShareSheet.tsx'), 'utf8');
const memoryNodeDetail = readFileSync(resolve(repoRoot, 'components/portal/MemoryNodeDetail.tsx'), 'utf8');
const lifeGraph = readFileSync(resolve(repoRoot, 'lib/portal/life-graph.ts'), 'utf8');

function assertImageAssetCloudSync(source, label) {
  assert.match(
    source,
    /createAppApiClient/,
    `${label} should use the shared app API client for cloud asset sync`,
  );
  assert.match(
    source,
    /uploadCloudAsset\(\{\s*file[,:]/s, // 允许 ES 简写 { file, ... }(e331fd8 起)
    `${label} should upload image/file input through /api/cloud/assets before or while saving Memory`,
  );
  assert.match(
    source,
    /purpose:\s*['"]memory['"]/,
    `${label} should mark uploaded image assets with purpose="memory"`,
  );
  assert.match(
    source,
    /saveCloudMemorySnapshot\(\{\s*nodes:/s,
    `${label} should persist cloud Memory nodes and assets together`,
  );
  assert.match(
    source,
    /assets:\s*\[/,
    `${label} should include a memory_assets payload instead of saving only nodes`,
  );
  assert.match(
    source,
    /storagePath:\s*upload\.storagePath/,
    `${label} should keep the Supabase Storage path on the Memory asset record`,
  );
  assert.match(
    source,
    /mimeType:\s*upload\.mimeType/,
    `${label} should keep uploaded asset MIME type for recovery/export`,
  );
  assert.match(
    source,
    /updateLifeNode/,
    `${label} should echo uploaded asset metadata back to the local Memory node`,
  );
  assert.match(
    source,
    /assets:\s*\[[^\n]*assetRecord\s*\]/, // 允许追加式 [...(existing || []), assetRecord](e331fd8 起,保留本地 asset 是改进)
    `${label} should store the cloud asset reference on the local LifeNode`,
  );
}

assertImageAssetCloudSync(cameraSheet, 'CameraSheet');
assertImageAssetCloudSync(shareSheet, 'ShareSheet');

assert.match(
  lifeGraph,
  /export interface LifeNodeAsset/,
  'Life Graph should define a first-class LifeNodeAsset contract',
);
assert.match(
  lifeGraph,
  /assets\?:\s*LifeNodeAsset\[\]/,
  'LifeNode should keep optional local asset metadata for private signed reads',
);

assert.match(
  memoryNodeDetail,
  /createAppApiClient/,
  'MemoryNodeDetail should use the shared app API client for private asset reads',
);
assert.match(
  memoryNodeDetail,
  /fetchCloudAssetReadUrl\(\{\s*storagePath:\s*asset\.storagePath\s*\}\)/s,
  'MemoryNodeDetail should resolve private Memory assets through signed read URLs',
);
assert.match(
  memoryNodeDetail,
  /<img[\s\S]+src=\{previewUrl\}/,
  'MemoryNodeDetail should render image previews only through resolved signed URLs',
);
assert.doesNotMatch(
  memoryNodeDetail,
  /storagePath\}<\/span>|storagePath\}<\/p>|asset\.storagePath\}<\/span>|asset\.storagePath\}<\/p>/,
  'MemoryNodeDetail should not expose raw Supabase storage paths in production UI',
);

console.log('memory image cloud asset sync contract ok');
