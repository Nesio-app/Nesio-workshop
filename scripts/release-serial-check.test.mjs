import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scriptPath = path.join(root, 'scripts', 'release-serial-check.mjs');
const source = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';

const failures = [];

if (packageJson.scripts?.['test:release:serial'] !== 'node scripts/release-serial-check.mjs') {
  failures.push('package.json must expose test:release:serial through scripts/release-serial-check.mjs');
}

if (!source) {
  failures.push('scripts/release-serial-check.mjs is missing');
} else {
  const orderedMarkers = [
    'test:qa:static',
    'build',
    'test:e2e',
    'precheck:mobile-app',
  ];
  let lastIndex = -1;
  for (const marker of orderedMarkers) {
    const index = source.indexOf(marker);
    if (index === -1) failures.push(`release serial script missing step: ${marker}`);
    if (index !== -1 && index < lastIndex) failures.push(`release serial step is out of order: ${marker}`);
    if (index !== -1) lastIndex = index;
  }

  for (const marker of ['.next', 'rmSync', 'spawnSync']) {
    if (!source.includes(marker)) failures.push(`release serial script missing marker: ${marker}`);
  }

  for (const forbidden of ['Promise.all', 'concurrently', ' & ']) {
    if (source.includes(forbidden)) failures.push(`release serial script must not run release checks concurrently: ${forbidden}`);
  }
}

if (failures.length) {
  console.error('Release serial check contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Release serial check contract passed');
