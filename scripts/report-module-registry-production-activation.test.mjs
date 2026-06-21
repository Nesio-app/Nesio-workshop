import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const output = execFileSync('node', [join(scriptDir, 'report-module-registry.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});
const report = JSON.parse(output);
const pkg = JSON.parse(execFileSync('node', ['-e', 'process.stdout.write(JSON.stringify(require("./package.json")))'], {
  cwd: repoRoot,
  encoding: 'utf8',
}));

assert.equal(report.summary.productionActivationVersion, 'production-activation-v0');
assert.equal(report.summary.productionActivationCeoApproved, true);

assert.equal(
  report.summary.googleCalendarProviderStatus,
  'missing_env',
  'Google Calendar status should be visible in report summary when it is not configured.',
);
assert.equal(
  report.summary.googleCalendarConfigured,
  false,
  'Google Calendar configured flag should be visible in report summary.',
);
assert.equal(
  report.summary.googleCalendarRuntimeEnabled,
  false,
  'Google Calendar runtime enabled flag should be visible in report summary.',
);
assert.deepEqual(
  report.summary.googleCalendarMissingEnv,
  ['CALENDAR_PRIVATE_FEEDS_ENABLED', 'GOOGLE_CALENDAR_ICAL_URL'],
  'Google Calendar missing env should be visible in report summary for QA.',
);

assert.equal(
  report.summary.flomoProviderStatus,
  'missing_env',
  'Flomo status should be visible beside Google Calendar as a third-party provider.',
);
assert.equal(report.summary.flomoConfigured, false);
assert.equal(report.summary.flomoRuntimeEnabled, false);

assert.equal(
  pkg.scripts['test:production-activation-report'],
  'node scripts/report-module-registry-production-activation.test.mjs',
  'package.json must expose report production activation test.',
);
assert.match(
  pkg.scripts['test:contracts'],
  /test:production-activation-report/,
  'test:contracts must include report production activation coverage.',
);

console.log('report-module-registry production activation summary tests passed');
