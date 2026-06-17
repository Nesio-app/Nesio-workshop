import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredAppMarkers = [
  'baohe_inventory_v01',
  'baohe_inventory_mode_v01',
  'function switchDataMode(',
  'function exportAllLocalData(',
  'function clearPersonalData(',
  'function resetDemoData(',
  'function restoreLatestBackup(',
  'dataBoundary',
  'demo',
  'personal',
];

const appPath = path.join(root, 'storage-web', 'app.js');
const configPath = path.join(root, 'storage-web', 'config.js');
const publicAppPath = path.join(root, 'public', 'storage', 'app.js');
const publicConfigPath = path.join(root, 'public', 'storage', 'config.js');

const app = fs.readFileSync(appPath, 'utf8');
const config = fs.readFileSync(configPath, 'utf8');
const publicApp = fs.existsSync(publicAppPath) ? fs.readFileSync(publicAppPath, 'utf8') : '';
const publicConfig = fs.existsSync(publicConfigPath) ? fs.readFileSync(publicConfigPath, 'utf8') : '';

const failures = [];

for (const marker of requiredAppMarkers) {
  if (!app.includes(marker)) {
    failures.push(`storage-web/app.js missing marker: ${marker}`);
  }
  if (!publicApp.includes(marker)) {
    failures.push(`public/storage/app.js missing marker: ${marker}`);
  }
}

if (!config.includes("window.STORAGE_API = window.STORAGE_API || ''")) {
  failures.push('storage-web/config.js must default STORAGE_API to empty string for offline-first launch');
}
if (!publicConfig.includes("window.STORAGE_API = window.STORAGE_API || ''")) {
  failures.push('public/storage/config.js must default STORAGE_API to empty string for offline-first launch');
}

if (config.includes('https://storage-kohl.vercel.app')) {
  failures.push('storage-web/config.js must not default to external storage-kohl API');
}
if (publicConfig.includes('https://storage-kohl.vercel.app')) {
  failures.push('public/storage/config.js must not default to external storage-kohl API');
}

if (failures.length) {
  console.error('Inventory offline v0.1 precheck failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Inventory offline v0.1 precheck passed');
