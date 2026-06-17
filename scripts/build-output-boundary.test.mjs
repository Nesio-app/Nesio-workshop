import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const nextConfig = readFileSync(join(repoRoot, 'next.config.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

assert.match(
  nextConfig,
  /process\.env\.NEXT_OUTPUT_MODE\s*===\s*['"]export['"]/,
  'static export must be explicit via NEXT_OUTPUT_MODE=export, not implicit for every production build',
);
assert.doesNotMatch(
  packageJson.scripts.build,
  /NEXT_OUTPUT_MODE=export/,
  'default npm run build must not force static export while dynamic API routes exist',
);
assert.ok(
  packageJson.scripts['build:server'],
  'server build script must exist for release precheck with dynamic API routes',
);

console.log('build output boundary tests passed');
