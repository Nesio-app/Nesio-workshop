import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredAppMarkers = [
  'baohe_inventory_v01',
  'baohe_inventory_mode_v01',
  'baohe_inventory_first_launch_v01',
  'function switchDataMode(',
  'function chooseFirstLaunchMode(',
  'function exportAllLocalData(',
  'function importAllLocalDataPayload(',
  'function triggerLocalBackupImport(',
  'function handleLocalBackupFile(',
  'function clearPersonalData(',
  'function deleteAllLocalLaunchData(',
  'function resetDemoData(',
  'function restoreLatestBackup(',
  'function archiveItem(',
  'function deleteItem(',
  'function activeItems(',
  'locationHint',
  'createdAt',
  'updatedAt',
  'purchaseMemory',
  'dataBoundary',
  'userManagedFileBackup: true',
  'cloudSyncEnabled: false',
  'externalAuthEnabled: false',
  'demo',
  'personal',
];

const appPath = path.join(root, 'storage-web', 'app.js');
const htmlPath = path.join(root, 'storage-web', 'index.html');
const cssPath = path.join(root, 'storage-web', 'styles.css');
const configPath = path.join(root, 'storage-web', 'config.js');
const publicAppPath = path.join(root, 'public', 'storage', 'app.js');
const publicHtmlPath = path.join(root, 'public', 'storage', 'index.html');
const publicCssPath = path.join(root, 'public', 'storage', 'styles.css');
const publicConfigPath = path.join(root, 'public', 'storage', 'config.js');

const app = fs.readFileSync(appPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const config = fs.readFileSync(configPath, 'utf8');
const publicApp = fs.existsSync(publicAppPath) ? fs.readFileSync(publicAppPath, 'utf8') : '';
const publicHtml = fs.existsSync(publicHtmlPath) ? fs.readFileSync(publicHtmlPath, 'utf8') : '';
const publicCss = fs.existsSync(publicCssPath) ? fs.readFileSync(publicCssPath, 'utf8') : '';
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

for (const [label, source] of [
  ['storage-web/index.html', html],
  ['public/storage/index.html', publicHtml],
]) {
  for (const marker of [
    'id="firstLaunch"',
    'href="/storage/styles.css"',
    'src="/storage/app.js"',
    'src="/storage/config.js"',
    'src="/storage/qr.js"',
    'src="/storage/guard.js"',
    "chooseFirstLaunchMode('demo')",
    "chooseFirstLaunchMode('personal')",
    'id="mMemory"',
    'id="fMemory"',
    'id="mWorth"',
    'id="fWorth"',
    'portal-back-link',
    'href="../index.html"',
    'deleteAllLocalLaunchData()',
    'id="localBackupFile"',
    'triggerLocalBackupImport()',
    'handleLocalBackupFile(this)',
  ]) {
    if (!source.includes(marker)) failures.push(`${label} missing marker: ${marker}`);
  }
}

for (const [label, source] of [
  ['storage-web/styles.css', css],
  ['public/storage/styles.css', publicCss],
]) {
  for (const marker of ['.first-launch', '.first-launch.show', '.memory-card', '.ta', '.no-data-state']) {
    if (!source.includes(marker)) failures.push(`${label} missing marker: ${marker}`);
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
