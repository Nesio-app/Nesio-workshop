import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 自供给:契约不依赖机器上未版本化的本地 sqlite。
// dec-data-api 每次调用时解析 BAOHE_DB_PATH,先建临时库再触发读取。
const decMetricsDbDir = mkdtempSync(path.join(tmpdir(), 'dec-metrics-'));
process.env.BAOHE_DB_PATH = path.join(decMetricsDbDir, 'treasurebox-local.db');
execFileSync('node', ['scripts/db-local.mjs', 'migrate'], { env: process.env, stdio: 'ignore' });
execFileSync('node', ['scripts/db-local.mjs', 'seed-demo'], { env: process.env, stdio: 'ignore' });

import {
  getDecArtifactsPayload,
  getDecEventsPayload,
  getDecExternalBridgePayload,
  getDecGatesPayload,
  getDecHandoffsPayload,
  getDecNetworkPayload,
  getDecOpsPayload,
  getDecUsageMetricsPayload,
  getDecModulesPayload,
} from '../lib/portal/dec-data-api.mjs';

// Trigger DEC readers to generate usage counters.
getDecNetworkPayload({});
getDecModulesPayload({ format: 'full' });
getDecExternalBridgePayload({});
getDecOpsPayload({});
getDecArtifactsPayload({ options: { limit: 1 } });
getDecHandoffsPayload({ options: { limit: 1 } });
getDecGatesPayload({ options: { limit: 1 } });
getDecEventsPayload({ options: { limit: 1 } });

const firstArtifactPage = getDecArtifactsPayload({ options: { limit: 1 }, force: true });
assert.equal(firstArtifactPage.ok, true, 'first artifact page should load');
assert.equal(firstArtifactPage.page.limit, 1, 'artifact page limit should be honored');
if (firstArtifactPage.page.nextCursor) {
  const secondArtifactPage = getDecArtifactsPayload({
    options: { limit: 1, cursor: firstArtifactPage.page.nextCursor },
    force: true,
  });
  assert.equal(secondArtifactPage.ok, true, 'second artifact cursor page should load');
  assert.equal(secondArtifactPage.page.paginationStrategy, 'cursor', 'cursor page should report cursor strategy');
  assert.notEqual(
    secondArtifactPage.items[0]?.artifactId,
    firstArtifactPage.items[0]?.artifactId,
    'cursor page should advance beyond the first item',
  );
}

const summaryPayload = getDecUsageMetricsPayload({
  includeZero: true,
  summary: true,
  top: 3,
});
assert.equal(summaryPayload.ok, true, 'metrics payload should be successful');
assert.equal(typeof summaryPayload.summary.metricCount, 'number', 'metricCount should be numeric');
assert.equal(Array.isArray(summaryPayload.metrics), true, 'metrics array should exist');
assert.equal(Array.isArray(summaryPayload.summary.byCategory), true, 'byCategory should be present when summary requested');
assert.equal(Array.isArray(summaryPayload.summary.topByCalls), true, 'topByCalls should be present when summary requested');
assert.equal(Array.isArray(summaryPayload.summary.topByErrorRate), true, 'topByErrorRate should be present when summary requested');
assert.equal(summaryPayload.summary.totalCategories, summaryPayload.summary.byCategory.length, 'totalCategories should align');
assert.equal(summaryPayload.summary.totalSignatures, summaryPayload.summary.bySignature.length, 'totalSignatures should align');

const networkSignaturePayload = getDecUsageMetricsPayload({ signature: 'ops', includeZero: true });
assert.equal(networkSignaturePayload.ok, true, 'signature filter payload should be successful');
assert.equal(networkSignaturePayload.metrics.every((entry) => entry.signature === 'ops'), true, 'signature filter should apply');

const moduleOnly = getDecUsageMetricsPayload({ category: 'modules', summary: true, includeZero: true, top: 5 });
assert.equal(moduleOnly.ok, true, 'category filter payload should be successful');
if (moduleOnly.metrics.length > 0) {
  assert.equal(moduleOnly.metrics[0].category, 'modules', 'category filter should apply');
}

console.log('dec-usage-metrics-summary.test passed');
