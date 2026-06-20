import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const targets = [
  {
    label: 'storage-web',
    dir: path.join(root, 'storage-web'),
  },
  {
    label: 'public/storage',
    dir: path.join(root, 'public', 'storage'),
  },
];

const appMarkers = [
  'INVENTORY_INDEXEDDB_NAME',
  'INVENTORY_INDEXEDDB_STORE',
  'function openInventoryIndexedDb(',
  'function saveRootStoreToIndexedDb(',
  'function restoreRootStoreFromIndexedDb(',
  'function bootstrapRootStoreFromIndexedDb(',
  'function registerInventoryServiceWorker(',
  'indexedDbMirrorEnabled: true',
  'localStorageCompatibility: true',
  'cloudSyncEnabled: false',
];

const htmlMarkers = [
  '<script src="/storage/app.js"></script>',
];

const swMarkers = [
  'baohe-storage-pwa-cache-v1',
  'storage-web/index.html',
  'storage-web/app.js',
  'self.addEventListener(\'install\'',
  'self.addEventListener(\'fetch\'',
  'event.respondWith',
];

const manifestMarkers = [
  '"display": "standalone"',
  '"start_url": "."',
];

const failures = [];

for (const target of targets) {
  const appPath = path.join(target.dir, 'app.js');
  const htmlPath = path.join(target.dir, 'index.html');
  const swPath = path.join(target.dir, 'sw.js');
  const manifestPath = path.join(target.dir, 'manifest.json');

  const app = fs.existsSync(appPath) ? fs.readFileSync(appPath, 'utf8') : '';
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const sw = fs.existsSync(swPath) ? fs.readFileSync(swPath, 'utf8') : '';
  const manifest = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : '';

  for (const marker of appMarkers) {
    if (!app.includes(marker)) failures.push(`${target.label}/app.js missing marker: ${marker}`);
  }
  for (const marker of htmlMarkers) {
    if (!html.includes(marker)) failures.push(`${target.label}/index.html missing marker: ${marker}`);
  }
  for (const marker of swMarkers) {
    if (!sw.includes(marker)) failures.push(`${target.label}/sw.js missing marker: ${marker}`);
  }
  for (const marker of manifestMarkers) {
    if (!manifest.includes(marker)) failures.push(`${target.label}/manifest.json missing marker: ${marker}`);
  }
}

if (failures.length) {
  console.error('PWA offline IndexedDB contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PWA offline IndexedDB contract passed');
