import assert from 'node:assert/strict';
import {
  resolveShellRuntimeState,
  resolveShellRuntimeTools,
  shouldShellOpenTool,
} from '../lib/portal/shell-runtime-resolver.mjs';

const tools = [
  {
    id: 'inventory',
    name: '收纳',
    url: '/storage/',
    ready: true,
    launchStatus: 'launchable',
    prodExposure: 'public',
    toolLifecycle: 'launchable',
    entitlementPolicy: { paywallState: 'free' },
    approvalRequiredActions: [],
  },
  {
    id: 'plan',
    name: '今日',
    url: '/adhd-flow/',
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
    url: 'https://finance.example.test/',
    ready: true,
    launchStatus: 'hidden',
    prodExposure: 'hidden',
    toolLifecycle: 'sandbox',
    entitlementPolicy: { paywallState: 'locked' },
    approvalRequiredActions: ['payment-or-billing'],
  },
  {
    id: 'health',
    name: '溯',
    url: 'https://health.example.test/',
    ready: true,
    launchStatus: 'gated',
    prodExposure: 'hidden',
    toolLifecycle: 'sandbox',
    entitlementPolicy: { paywallState: 'locked' },
    approvalRequiredActions: ['open_sensitive_health_context'],
  },
];

const publicInventory = resolveShellRuntimeState(tools[0], { viewerRole: 'public' });
assert.equal(publicInventory.visible, true);
assert.equal(publicInventory.openEnabled, true);
assert.equal(publicInventory.reason, 'public_launch');
assert.equal(shouldShellOpenTool(publicInventory), true);

const publicPlan = resolveShellRuntimeState(tools[1], { viewerRole: 'public' });
assert.equal(publicPlan.visible, true);
assert.equal(publicPlan.openEnabled, true);
assert.equal(publicPlan.shellAction, 'open');

const testerPlan = resolveShellRuntimeState(tools[1], {
  viewerRole: 'tester',
  testerAllowlist: ['plan'],
});
assert.equal(testerPlan.visible, true);
assert.equal(testerPlan.openEnabled, true);
assert.equal(testerPlan.shellAction, 'open');
assert.equal(testerPlan.betaBadgeRequired, false);
assert.equal(shouldShellOpenTool(testerPlan), true);

const personalLabPlan = resolveShellRuntimeState(tools[1], { viewerRole: 'personal_lab' });
assert.equal(personalLabPlan.visible, true);
assert.equal(personalLabPlan.openEnabled, true);
assert.equal(personalLabPlan.shellAction, 'open_lab_preview');
assert.equal(personalLabPlan.personalLabMode, true);
assert.equal(shouldShellOpenTool(personalLabPlan), true);

const personalLabFinance = resolveShellRuntimeState(tools[2], { viewerRole: 'personal_lab' });
assert.equal(personalLabFinance.visible, true);
assert.equal(personalLabFinance.openEnabled, true);
assert.equal(personalLabFinance.blockedByApprovalGate, true);
assert.equal(personalLabFinance.realRuntimeEnabled, false);

const publicFinance = resolveShellRuntimeState(tools[2], { viewerRole: 'public' });
assert.equal(publicFinance.visible, false);
assert.equal(publicFinance.openEnabled, false);
assert.equal(publicFinance.blockedByApprovalGate, true);
assert.equal(publicFinance.approvalGateOverridesPaywallGate, true);

const publicHealth = resolveShellRuntimeState(tools[3], { viewerRole: 'public' });
assert.equal(publicHealth.visible, false);
assert.equal(publicHealth.openEnabled, false);
assert.equal(publicHealth.blockedByApprovalGate, true);

assert.deepEqual(
  resolveShellRuntimeTools(tools, { viewerRole: 'public' }).visibleTools.map((tool) => tool.id),
  ['inventory', 'plan'],
);
assert.deepEqual(
  resolveShellRuntimeTools(tools, {
    viewerRole: 'tester',
    testerAllowlist: ['plan'],
  }).visibleTools.map((tool) => tool.id),
  ['inventory', 'plan'],
);
assert.deepEqual(
  resolveShellRuntimeTools(tools, { viewerRole: 'personal_lab' }).openableTools.map((tool) => tool.id),
  ['inventory', 'plan', 'finance', 'health'],
);

console.log('shell runtime resolver tests passed');
