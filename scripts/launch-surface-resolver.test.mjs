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
assert.deepEqual(report.launchSurface.summary.publicVisibleModuleIds, []);
assert.equal(report.launchSurface.summary.publicVisibleModuleCount, 0);
// 轻量退休:退休模块即便 personal_lab 也不露(治理声明仍在,只是运行时不 surface),
// 所以 personal_lab 不再看到「全部」——可见数 = 总数 − 退休(lab 不可见)数。
const labInvisibleCount = report.launchSurface.entries.filter((e) => e.visibleForPersonalLab === false).length;
assert.ok(labInvisibleCount > 0, '应有退休模块使 personal_lab 不再看到全部');
assert.equal(report.launchSurface.summary.personalLabVisibleModuleCount, report.summary.moduleCount - labInvisibleCount);
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
assert.equal(report.summary.launchSurfacePublicVisibleModuleCount, 0);
assert.equal(report.summary.launchSurfaceAppStoreReady, false);

const reportFinance = report.launchSurface.entries.find((entry) => entry.moduleId === 'finance');
assert.equal(report.launchSurface.entries.some((entry) => entry.moduleId === 'inventory'), false);
assert.equal(reportFinance.visibleForPublic, false);
assert.equal(reportFinance.visibleForPersonalLab, true);
assert.equal(reportFinance.personalLabShellAction, 'open_lab_preview');
assert.equal(reportFinance.approvalGateOverridesPaywallGate, true);

// ── 逐模块本地覆盖(moduleOverrides)优先于默认 SKU/viewerRole ──
{
  // 关掉本来对公众可见的模块
  const invOff = resolveLaunchSurfaceState({ id: 'inventory' }, { viewerRole: 'public', moduleOverrides: { inventory: 'off' } });
  assert.equal(invOff.visible, false, 'override off 隐藏本来公开的 inventory');
  assert.equal(invOff.reason, 'user_disabled');
  assert.equal(invOff.userOverride, 'off');

  // 开启本来对公众隐藏的门控模块(无需开 Lab 总闸)
  const finOn = resolveLaunchSurfaceState({ id: 'finance' }, { viewerRole: 'public', moduleOverrides: { finance: 'on' } });
  assert.equal(finOn.visible, true, 'override on 开启本来门控的 finance');
  assert.equal(finOn.reason, 'user_enabled');
  assert.equal(finOn.userOverride, 'on');

  // 无覆盖 → 默认行为完全不变(既有契约不受影响)
  const invDefault = resolveLaunchSurfaceState({ id: 'inventory' }, { viewerRole: 'public' });
  assert.equal(invDefault.visible, true, '无覆盖:inventory 默认公开可见');
  assert.equal(invDefault.userOverride, null);
  const finDefault = resolveLaunchSurfaceState({ id: 'finance' }, { viewerRole: 'public' });
  assert.equal(finDefault.visible, false, '无覆盖:finance 默认对公众隐藏');
  assert.equal(finDefault.userOverride, null);

  // 覆盖对 Lab 视角同样生效:Lab 全开时也能单独关掉某个不想要的工具
  const invOffLab = resolveLaunchSurfaceState({ id: 'inventory' }, { viewerRole: 'personal_lab', moduleOverrides: { inventory: 'off' } });
  assert.equal(invOffLab.visible, false, 'Lab 下 override off 仍隐藏该模块');
}

// ── 提审构建(APPSTORE_BUILD=1):v1 隐藏集不可达,盖过 personal_lab / 用户强制开 ──
{
  process.env.NEXT_PUBLIC_APPSTORE_BUILD = '1';
  try {
    for (const id of ['finance', 'health', 'places', 'experiment', 'people']) {
      const rLab = resolveLaunchSurfaceState({ id }, { viewerRole: 'personal_lab' });
      assert.equal(rLab.visible, false, `提审构建:${id} 即便 personal_lab 也不可达`);
      assert.equal(rLab.reason, 'appstore_hidden', `${id} reason=appstore_hidden`);
      const rForce = resolveLaunchSurfaceState({ id }, { viewerRole: 'public', moduleOverrides: { [id]: 'on' } });
      assert.equal(rForce.visible, false, `提审构建:${id} 用户强制开也盖不过`);
    }
    // 非隐藏集不受影响
    const inv = resolveLaunchSurfaceState({ id: 'inventory' }, { viewerRole: 'public' });
    assert.equal(inv.visible, true, '提审构建:inventory 仍公开可见');
  } finally {
    delete process.env.NEXT_PUBLIC_APPSTORE_BUILD;
  }
}

console.log('launch surface resolver tests passed');
