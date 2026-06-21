import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLaunchReadinessSummary,
  filterToolsForLaunchSurface,
  resolveTesterCohort,
  resolveLaunchSurfaceState,
} from '../lib/portal/launch-surface.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');

const sampleTools = [
  {
    id: 'inventory',
    name: '收纳',
    ready: true,
    launchStatus: 'launchable',
    prodExposure: 'public',
    toolLifecycle: 'launchable',
    entitlementPolicy: { paywallState: 'free' },
    approvalRequiredActions: [],
  },
  {
    id: 'plan',
    name: '待办',
    ready: true,
    launchStatus: 'launchable',
    prodExposure: 'public',
    toolLifecycle: 'launchable',
    entitlementPolicy: { paywallState: 'free' },
    approvalRequiredActions: [],
  },
  {
    id: 'finance',
    name: '财务',
    ready: false,
    launchStatus: 'hidden',
    prodExposure: 'hidden',
    toolLifecycle: 'sandbox',
    entitlementPolicy: { paywallState: 'locked' },
    approvalRequiredActions: ['payment-or-billing'],
  },
  {
    id: 'health',
    name: '溯',
    ready: false,
    launchStatus: 'gated',
    prodExposure: 'hidden',
    toolLifecycle: 'sandbox',
    entitlementPolicy: { paywallState: 'locked' },
    approvalRequiredActions: ['open_sensitive_health_context'],
  },
];

assert.equal(resolveLaunchSurfaceState(sampleTools[0], { viewerRole: 'public' }).visible, true);
assert.equal(resolveLaunchSurfaceState(sampleTools[0], { viewerRole: 'public' }).shellAction, 'open');

const publicPlan = resolveLaunchSurfaceState(sampleTools[1], { viewerRole: 'public' });
assert.equal(publicPlan.visible, true);
assert.equal(publicPlan.reason, 'public_launch');
assert.equal(publicPlan.paywallState, 'free');
assert.equal(publicPlan.shellAction, 'open');

const testerPlan = resolveLaunchSurfaceState(sampleTools[1], {
  viewerRole: 'tester',
  testerAllowlist: ['plan'],
});
assert.equal(testerPlan.visible, true);
assert.equal(testerPlan.shellAction, 'open');
assert.equal(testerPlan.betaBadgeRequired, false);

const testerCohort = resolveTesterCohort('reading-lab');
assert.deepEqual(testerCohort.moduleIds, ['reading', 'plan', 'inventory']);
assert.equal(testerCohort.source, 'local_cohort_code');

const personalLabPlan = resolveLaunchSurfaceState(sampleTools[1], { viewerRole: 'personal_lab' });
assert.equal(personalLabPlan.visible, true);
assert.equal(personalLabPlan.shellAction, 'open_lab_preview');
assert.equal(personalLabPlan.betaBadgeRequired, false);
assert.equal(personalLabPlan.reason, 'personal_lab');

const personalLabFinance = resolveLaunchSurfaceState(sampleTools[2], { viewerRole: 'personal_lab' });
assert.equal(personalLabFinance.visible, true);
assert.equal(personalLabFinance.shellAction, 'open_lab_preview');
assert.equal(personalLabFinance.blockedByApprovalGate, true);
assert.equal(personalLabFinance.appStoreMentionAllowed, false);

const publicFinance = resolveLaunchSurfaceState(sampleTools[2], { viewerRole: 'public' });
assert.equal(publicFinance.visible, false);
assert.equal(publicFinance.approvalGateState, 'required');
assert.equal(publicFinance.shellAction, 'hide_for_public');
assert.equal(publicFinance.approvalGateOverridesPaywallGate, true);

assert.deepEqual(
  filterToolsForLaunchSurface(sampleTools, { viewerRole: 'public' }).map((tool) => tool.id),
  ['inventory', 'plan'],
);
assert.deepEqual(
  filterToolsForLaunchSurface(sampleTools, { viewerRole: 'tester', testerAllowlist: ['plan'] }).map((tool) => tool.id),
  ['inventory', 'plan'],
);
assert.deepEqual(
  filterToolsForLaunchSurface(sampleTools, { viewerRole: 'personal_lab' }).map((tool) => tool.id),
  ['inventory', 'plan', 'finance', 'health'],
);

const readiness = buildLaunchReadinessSummary(sampleTools, { testerAllowlist: ['plan'] });
assert.equal(readiness.firstLaunchPromise, 'Shell + Inventory / purchase-memory + Todo');
assert.deepEqual(readiness.publicVisibleModuleIds, ['inventory', 'plan']);
assert.deepEqual(readiness.testerVisibleSandboxModuleIds, []);
assert.deepEqual(readiness.personalLabVisibleModuleIds.sort(), ['finance', 'health', 'inventory', 'plan']);
assert.equal(readiness.personalLabRealRuntimeEnabled, false);
assert.deepEqual(readiness.publicHiddenHighRiskModuleIds.sort(), ['finance', 'health']);
assert.equal(readiness.approvalGateOverridesPaywallGate, true);
assert.equal(readiness.realPurchaseEnabled, false);

const reportOutput = execFileSync('node', [join(scriptDir, 'report-module-registry.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
});
const report = JSON.parse(reportOutput);

assert.equal(report.launchSurface.version, 'launch-surface-v0');
assert.equal(report.launchSurface.summary.firstLaunchPromise, 'Shell + Inventory / purchase-memory + Todo');
assert.deepEqual(report.launchSurface.summary.publicVisibleModuleIds, ['plan', 'inventory']);
assert.equal(report.launchSurface.summary.publicVisibleModuleCount, 2);
assert.equal(report.launchSurface.summary.personalLabVisibleModuleCount, report.summary.moduleCount);
assert.equal(report.launchSurface.summary.personalLabRealRuntimeEnabled, false);
assert.ok(report.launchSurface.summary.testerVisibleSandboxModuleCount > 0, 'tester allowlist should expose sandbox tools in report');
assert.equal(report.launchSurface.summary.testerVisibleSandboxModuleIds.includes('plan'), false);
assert.equal(report.launchSurface.summary.testerVisibleSandboxModuleIds.includes('reading'), true);
assert.equal(report.launchSurface.summary.publicHiddenHighRiskModuleIds.includes('finance'), true);
assert.equal(report.launchSurface.summary.publicHiddenHighRiskModuleIds.includes('health'), true);
assert.equal(report.launchSurface.summary.approvalGateOverridesPaywallGate, true);
assert.equal(report.launchSurface.summary.realPurchaseEnabled, false);
assert.equal(report.launchSurface.summary.storeKitEnabled, false);
assert.equal(report.launchSurface.summary.launchReadinessStatus, 'candidate_not_release_ready');
assert.equal(report.summary.launchSurfacePublicVisibleModuleCount, 2);
assert.equal(report.summary.launchSurfaceAppStoreReady, false);

const reportInventory = report.launchSurface.entries.find((entry) => entry.moduleId === 'inventory');
const reportPlan = report.launchSurface.entries.find((entry) => entry.moduleId === 'plan');
const reportFinance = report.launchSurface.entries.find((entry) => entry.moduleId === 'finance');
assert.equal(reportInventory.visibleForPublic, true);
assert.equal(reportInventory.shellAction, 'open');
assert.equal(reportPlan.visibleForPublic, true);
assert.equal(reportPlan.shellAction, 'open');
assert.equal(reportFinance.visibleForPublic, false);
assert.equal(reportFinance.visibleForPersonalLab, true);
assert.equal(reportFinance.personalLabShellAction, 'open_lab_preview');
assert.equal(reportFinance.approvalGateOverridesPaywallGate, true);

console.log('launch surface resolver tests passed');
