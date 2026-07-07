import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const output = execFileSync('node', [join(scriptDir, 'report-module-registry.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});
const report = JSON.parse(output);

assert.equal(report.toolDataVersioning.version, 'tool-data-versioning-contract-v0');
assert.equal(report.toolDataVersioning.implementation, 'report-only');
assert.equal(report.toolDataVersioning.boundaries.readsRealUserData, false);
assert.equal(report.toolDataVersioning.boundaries.writesRealUserData, false);
assert.equal(report.toolDataVersioning.boundaries.runsRealMigrations, false);
assert.equal(report.toolDataVersioning.boundaries.cloudDbMigrationEnabled, false);
assert.equal(report.toolDataVersioning.boundaries.backgroundMigrationWorkerEnabled, false);
assert.equal(report.toolDataVersioning.boundaries.realDataMigrationRequiresCeoGate, true);

assert.equal(report.summary.toolDataVersioningContractVersion, 'tool-data-versioning-contract-v0');
assert.equal(report.summary.toolDataMigrationPlanCoverageCount, report.summary.moduleCount);
assert.equal(report.summary.toolDataRealMigrationEnabledCount, 0);
assert.equal(report.summary.toolDataCeoGateRequiredForRealMigration, true);

const versionByModule = new Map(report.toolDataVersioning.modules.map((entry) => [entry.moduleId, entry]));
assert.equal(versionByModule.size, report.summary.moduleCount);

for (const tool of report.tools) {
  const entry = versionByModule.get(tool.id);
  assert.ok(entry, `${tool.id} must have tool data version entry`);
  assert.equal(typeof entry.schemaVersion, 'string', `${tool.id} must declare schemaVersion`);
  assert.equal(typeof entry.dataVersion, 'string', `${tool.id} must declare dataVersion`);
  assert.equal(typeof entry.demoDataVersion, 'string', `${tool.id} must declare demoDataVersion`);
  assert.equal(entry.manifestDeclaresSchemaVersion, true, `${tool.id} manifest must declare schemaVersion`);
  assert.equal(entry.runsRealMigration, false, `${tool.id} must not run real migration`);
  assert.equal(entry.cloudDbMigrationEnabled, false, `${tool.id} must not enable cloud migration`);
  assert.equal(entry.backgroundWorkerEnabled, false, `${tool.id} must not enable migration worker`);
  assert.ok(
    entry.migrationRequired === false || entry.migrationStatus === 'future_migration_needed',
    `${tool.id} must explicitly mark migrationRequired=false or future_migration_needed`,
  );
  assert.ok(entry.rollbackMetadata, `${tool.id} must include rollback metadata`);
  assert.equal(entry.rollbackMetadata.rollbackSupported, true, `${tool.id} must support local rollback metadata`);
}

// inventory 已原生化(life-graph object 节点),数据版本契约随静态 app 解绑移除
assert.equal(versionByModule.has('inventory'), false);

for (const moduleId of ['finance', 'health', 'psychoanalysis']) {
  const entry = versionByModule.get(moduleId);
  assert.equal(entry.migrationStatus, 'future_migration_needed', `${moduleId} must park future migration`);
  assert.equal(entry.needsCeoGateForRealMigration, true, `${moduleId} must require CEO gate for real migration`);
}

console.log('report-module-registry tool data versioning tests passed');
