import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const files = [
  {
    label: 'storage-web',
    app: path.join(root, 'storage-web', 'app.js'),
    html: path.join(root, 'storage-web', 'index.html'),
  },
  {
    label: 'public/storage',
    app: path.join(root, 'public', 'storage', 'app.js'),
    html: path.join(root, 'public', 'storage', 'index.html'),
  },
];

const requiredAppMarkers = [
  'CLOUD_INVENTORY_ENDPOINT',
  "'/api/cloud/inventory'",
  'function buildCloudInventorySnapshotItems(',
  'function applyCloudInventorySnapshotItems(',
  'async function saveInventoryCloudSnapshot(',
  'async function restoreInventoryCloudSnapshot(',
  'fetch(CLOUD_INVENTORY_ENDPOINT',
  "method: 'POST'",
  'deleteMissing: true',
  "mode: 'personal'",
  "if (getActiveDataMode() !== 'personal')",
  'cloudSnapshotEnabled: true',
  'cloudSyncEnabled: false',
  'cloud_write_failed',
  'not_signed_in',
  'cloud_not_configured',
];

const requiredHtmlMarkers = [
  'id="settingsCloudSnapshot"',
  'id="settingsCloudSnapshotStatus"',
  'saveInventoryCloudSnapshot()',
  'restoreInventoryCloudSnapshot()',
  '保存 Personal 到云端',
  '从云端恢复 Personal',
];

const failures = [];

for (const file of files) {
  const app = fs.existsSync(file.app) ? fs.readFileSync(file.app, 'utf8') : '';
  const html = fs.existsSync(file.html) ? fs.readFileSync(file.html, 'utf8') : '';

  for (const marker of requiredAppMarkers) {
    if (!app.includes(marker)) failures.push(`${file.label}/app.js missing marker: ${marker}`);
  }

  for (const marker of requiredHtmlMarkers) {
    if (!html.includes(marker)) failures.push(`${file.label}/index.html missing marker: ${marker}`);
  }
}

if (failures.length) {
  console.error('Storage cloud inventory snapshot contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Storage cloud inventory snapshot contract passed');
