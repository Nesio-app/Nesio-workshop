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
  'LOCAL_BACKUP_METADATA_KEY',
  'LOCAL_BACKUP_REMINDER_DAYS',
  'function buildLocalBackupPayload(',
  'function importAllLocalDataPayload(',
  'function triggerLocalBackupImport(',
  'function handleLocalBackupFile(',
  "backupKind: 'baohe-local-backup-v1'",
  'restoreSupported: true',
  'filesAppRecommended: true',
  'userManagedFileBackup: true',
  'cloudSyncEnabled: false',
  'externalAuthEnabled: false',
  'serverAccountEnabled: false',
  'paymentIntegrationEnabled: false',
];

const requiredHtmlMarkers = [
  'id="settingsProfile"',
  'id="settingsLastSaved"',
  'id="settingsLastBackup"',
  'id="settingsBackupReminder"',
  'class="card local-recovery-warning"',
  '浏览器清理缓存可能移除本地数据',
  'id="localBackupFile"',
  'accept="application/json,.json"',
  'triggerLocalBackupImport()',
  'handleLocalBackupFile(this)',
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
  console.error('PWA local account backup contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PWA local account backup contract passed');
