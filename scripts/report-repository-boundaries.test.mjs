import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync('node', ['scripts/report-repository-boundaries.mjs'], {
  encoding: 'utf8',
});
const report = JSON.parse(output);

assert.equal(
  report.version,
  'repository-boundary-report-v0',
  'repository boundary report version must stay stable',
);
assert.ok(
  report.hygiene,
  'repository boundary report must expose local hygiene status',
);
assert.equal(
  typeof report.hygiene.localDuplicateNoiseCount,
  'number',
  'repository boundary report must count local duplicate noise files',
);
assert.ok(
  Array.isArray(report.hygiene.localDuplicateNoiseFiles),
  'repository boundary report must list local duplicate noise files',
);
assert.equal(
  report.hygiene.duplicateNoisePattern,
  'space-number-copy',
  'repository boundary report must name the duplicate-noise detection pattern',
);
assert.equal(
  report.boundaries.doesNotDeleteLocalNoise,
  true,
  'repository boundary report must be read-only and never delete local noise files',
);

console.log('Repository boundary report contract passed');

