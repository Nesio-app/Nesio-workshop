import assert from 'node:assert/strict';

import {
  buildLocalDataRecordsV0,
  inferGateCategory,
  LOCAL_DATA_RECORD_STATE_PRIORITY,
  normalizeHandoffTo,
} from '../lib/portal/local-data-records.mjs';

const sampleRecords = [
  {
    artifactId: 'artifact-001',
    title: 'Artifact visibility local schema contract',
    artifactPath: '2026-06-16/artifact-visibility-local-schema-contract-v02-du.md',
    owner: 'du',
    state: 'needs_ceo',
    handoffFrom: 'Du',
    handoffTo: 'Sina',
    nextOwner: 'Sina',
    nextStep: 'Resolve CEO gate and archive after approval.',
    resumeAction: 'Add category labels and handoff evidence.',
    blocker: 'Needs Notion mirror strategy review before handoff.',
    needsCeoGate: true,
    primaryActionKind: 'decide',
    visibilityPriority: 0,
    modifiedAt: '2026-06-16T09:00:00.000Z',
    sourceVerified: true,
    handoffParsed: true,
  },
  {
    artifactId: 'artifact-002',
    title: 'Baohe app store data privacy plan',
    artifactPath: '2026-06-16/baohe-app-store-data-privacy-plan-du.md',
    owner: 'du',
    kind: 'plan',
    state: 'active',
    handoffFrom: 'Du',
    handoffTo: 'Qiao',
    nextOwner: 'Qiao',
    nextStep: 'Implement local schema table stubs.',
    resumeAction: null,
    blocker: null,
    needsCeoGate: false,
    primaryActionKind: 'view_detail',
    visibilityPriority: 2,
    modifiedAt: '2026-06-16T10:00:00.000Z',
    sourceVerified: true,
    handoffParsed: true,
  },
];

const result = buildLocalDataRecordsV0(sampleRecords, { generatedAt: '2026-06-16T12:00:00.000Z' });

assert.equal(result.implementation, 'local-report-projected-records-v0');
assert.equal(result.boundaries.readsArtifactFilesOnly, true);
assert.equal(result.boundaries.readsRealData, false);
assert.equal(result.summary.artifactRecordCount, 2);
assert.equal(result.summary.handoffRecordCount, 2);
assert.equal(result.summary.gateRecordCount, 1);
assert.equal(result.summary.byArtifactState.needs_ceo, 1);
assert.equal(result.summary.byArtifactState.active, 1);
assert.equal(result.implementation.includes('local-report-projected-records-v0'), true);
assert.equal(
  result.boundaries.createsDbRows,
  false,
  'Projection contract must keep DB persistence disabled.',
);

const [firstArtifact, secondArtifact] = result.artifactRecords;
assert.equal(firstArtifact.owner, 'du');
assert.equal(firstArtifact.state, 'needs_ceo');
assert.equal(firstArtifact.handoffTo[0], 'sina');
assert.equal(firstArtifact.updatedAt, '2026-06-16T09:00:00.000Z');
assert.equal(firstArtifact.qaStatus, 'needs_ceo_decision');
assert.equal(secondArtifact.artifactKind, 'plan');
assert.equal(secondArtifact.handoffParsed, true);

const [firstHandoff, secondHandoff] = result.handoffRecords;
assert.equal(firstHandoff.from, 'Du');
assert.equal(firstHandoff.status, 'waiting_ceo');
assert.equal(firstHandoff.dedupeKey, firstHandoff.id.replace('handoff:', ''));
assert.equal(secondHandoff.to[0], 'qiao');
assert.equal(secondHandoff.status, 'queued');

const [firstGate] = result.gateRecords;
assert.equal(firstGate.owner, 'CEO');
assert.equal(firstGate.category, 'notion_mirror');
assert.equal(firstGate.status, 'waiting_ceo');

assert.equal(LOCAL_DATA_RECORD_STATE_PRIORITY.length, 5);
assert.deepEqual(normalizeHandoffTo('Qiao, Sina, QA'), ['qiao', 'sina', 'qa']);
assert.equal(inferGateCategory({ blocker: 'Need real DB migration before archive.' }), 'real_data_migration');
assert.equal(inferGateCategory({ blocker: 'External provider webhook callback needed.' }), 'external_service');

console.log('local-data-records tests passed');
