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
assert.equal(
  typeof report.hygiene.trackedDirtyFileCount,
  'number',
  'repository boundary report must count tracked dirty files',
);
assert.ok(
  Array.isArray(report.hygiene.trackedDirtyFiles),
  'repository boundary report must list tracked dirty files',
);
for (const entry of report.hygiene.trackedDirtyFiles) {
  assert.equal(
    typeof entry.category,
    'string',
    'tracked dirty file entries must expose a release hygiene category',
  );
  assert.equal(
    typeof entry.releaseRisk,
    'string',
    'tracked dirty file entries must expose release risk',
  );
  assert.equal(
    typeof entry.recommendedNextAction,
    'string',
    'tracked dirty file entries must expose a next action',
  );
}
assert.equal(
  report.hygiene.trackedDirtyPolicy,
  'report_only_no_restore',
  'repository boundary report must not restore tracked dirty files',
);
assert.equal(
  report.boundaries.doesNotRestoreTrackedDirtyFiles,
  true,
  'repository boundary report must never restore tracked dirty files',
);
assert.ok(
  report.releaseReadiness,
  'repository boundary report must expose release readiness separately from contract status',
);
assert.equal(
  typeof report.releaseReadiness.ready,
  'boolean',
  'release readiness must expose a boolean ready flag',
);
assert.ok(
  Array.isArray(report.releaseReadiness.blockers),
  'release readiness must list blockers',
);
if (report.hygiene.localDuplicateNoiseCount > 0 || report.hygiene.trackedDirtyFileCount > 0) {
  assert.equal(
    report.releaseReadiness.ready,
    false,
    'local hygiene noise must prevent local release readiness from being misreported',
  );
  assert.ok(
    report.releaseReadiness.blockers.includes('local_hygiene_needs_cleanup'),
    'release readiness must identify local hygiene cleanup as the blocker',
  );
}

console.log('Repository boundary report contract passed');
