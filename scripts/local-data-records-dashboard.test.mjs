import assert from 'node:assert/strict';

import {
  buildLocalDataRecordsDashboardPack,
  buildLocalDataRecordsV0,
} from '../lib/portal/contracts/local-data-records.mjs';

const source = buildLocalDataRecordsV0([
  {
    artifactPath: '2026-06-16/du-a.md',
    title: 'du artifact a',
    owner: 'du',
    state: 'needs_ceo',
    handoffFrom: 'du',
    handoffTo: 'Sina',
    needsCeoGate: true,
    primaryActionKind: 'decide',
    modifiedAt: '2026-06-16T00:00:00.000Z',
    blocker: 'Needs Notion mirror review before handoff.',
    sourceVerified: true,
    handoffParsed: true,
  },
  {
    artifactPath: '2026-06-16/qiao-b.md',
    title: 'qiao artifact b',
    owner: 'qiao',
    artifactKind: 'plan',
    state: 'active',
    handoffFrom: 'qiao',
    handoffTo: 'Atlas',
    needsCeoGate: false,
    primaryActionKind: 'view_detail',
    modifiedAt: '2026-06-16T00:05:00.000Z',
    sourceVerified: true,
    handoffParsed: true,
  },
], { generatedAt: '2026-06-16T00:10:00.000Z' });

const dashboard = buildLocalDataRecordsDashboardPack(source, { topN: 2 });

assert.equal(dashboard.generatedAt, '2026-06-16T00:10:00.000Z');
assert.equal(dashboard.summary.artifactRecordCount, 2);
assert.equal(dashboard.metrics.byArtifactKind.unknown, 1);
assert.equal(dashboard.metrics.byArtifactKind.plan, 1);
assert.equal(dashboard.metrics.byOwner.du, 1);
assert.equal(dashboard.metrics.byOwner.qiao, 1);
assert.equal(dashboard.metrics.byGateCategory.notion_mirror, 1);
assert.equal(dashboard.metrics.byGateCategory.other || 0, 0);
assert.equal(dashboard.metrics.byHandoffStatus.queued, 1);
assert.equal(dashboard.queues.needsCeoArtifacts.length, 1);
assert.equal(dashboard.queues.needsCeoArtifacts[0].owner, 'du');
assert.equal(dashboard.queues.handoffQueue.length, 1);
assert.equal(dashboard.queues.handoffQueue[0].to.includes('atlas'), true);
assert.equal(dashboard.queues.gateQueue.length, 1);
assert.equal(dashboard.queues.gateQueue[0].artifactPath, '2026-06-16/du-a.md');
assert.equal(dashboard.implementation, source.implementation);

console.log('local-data-records dashboard tests passed');
