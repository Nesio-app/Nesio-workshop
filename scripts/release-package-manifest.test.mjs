import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'docs', 'release', 'release-package-manifest-v01.json');
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : null;

const failures = [];

if (!manifest) {
  failures.push('docs/release/release-package-manifest-v01.json is missing');
} else {
  if (manifest.canonicalDomain !== 'www.nesio.app') failures.push('canonicalDomain must be www.nesio.app');
  if (manifest.launchSku !== 'shell_inventory_purchase_memory') failures.push('launchSku must be shell_inventory_purchase_memory');
  if (manifest.canonicalIosProject !== 'treasurebox-ios') failures.push('canonicalIosProject must be treasurebox-ios');

  for (const entry of ['storage-web', 'public/storage', 'treasurebox-ios']) {
    if (!manifest.includedRuntimeSurfaces?.includes(entry)) failures.push(`includedRuntimeSurfaces missing: ${entry}`);
  }

  for (const entry of ['notebooks', 'prototype', 'historical-ios', 'independent-memory-app']) {
    if (!manifest.excludedSurfaceKinds?.includes(entry)) failures.push(`excludedSurfaceKinds missing: ${entry}`);
  }

  const memoryApp = manifest.independentApps?.find((entry) => entry.path === 'memory');
  if (!memoryApp) failures.push('independentApps must classify memory');
  if (memoryApp?.releasePackageIncluded !== false) failures.push('memory must not be included in Baohe release package');

  for (const gate of ['TestFlight', 'App Store submission', 'real user external distribution', 'real data sync', 'payment', 'external authorization']) {
    if (!manifest.ceoGateRequiredFor?.includes(gate)) failures.push(`ceoGateRequiredFor missing: ${gate}`);
  }
}

if (failures.length) {
  console.error('Release package manifest contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Release package manifest contract passed');
