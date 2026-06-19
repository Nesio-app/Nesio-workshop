import assert from 'node:assert/strict';
import { openToolHref } from '../lib/portal/open-tool.mjs';

const inventory = {
  id: 'inventory',
  name: '收纳',
  url: '/storage/',
  ready: true,
  launchStatus: 'launchable',
  prodExposure: 'public',
  toolLifecycle: 'launchable',
  entitlementPolicy: { paywallState: 'free' },
  approvalRequiredActions: [],
};

const plan = {
  id: 'plan',
  name: '今日',
  url: '/adhd-flow/',
  ready: true,
  launchStatus: 'launchable',
  prodExposure: 'public',
  toolLifecycle: 'launchable',
  entitlementPolicy: { paywallState: 'free' },
  approvalRequiredActions: [],
};

const finance = {
  id: 'finance',
  name: '财务',
  url: 'https://finance.example.test/',
  ready: true,
  launchStatus: 'hidden',
  prodExposure: 'hidden',
  toolLifecycle: 'sandbox',
  entitlementPolicy: { paywallState: 'locked' },
  approvalRequiredActions: ['payment-or-billing'],
};

const health = {
  id: 'health',
  name: '健康',
  url: 'https://health.example.test/',
  ready: true,
  launchStatus: 'gated',
  prodExposure: 'hidden',
  toolLifecycle: 'sandbox',
  entitlementPolicy: { paywallState: 'locked' },
  approvalRequiredActions: ['open_sensitive_health_context'],
};

assert.equal(openToolHref(inventory, { viewerRole: 'public' }), '/storage/');
assert.equal(openToolHref(plan, { viewerRole: 'public' }), '/adhd-flow/');
assert.equal(openToolHref(plan, { viewerRole: 'tester', testerAllowlist: ['plan'] }), '/adhd-flow/');
assert.equal(openToolHref(plan, { viewerRole: 'personal_lab' }), '/adhd-flow/');
assert.equal(openToolHref(finance, { viewerRole: 'tester', testerAllowlist: ['finance'] }), '');
assert.equal(openToolHref(finance, { viewerRole: 'personal_lab' }), 'https://finance.example.test/');
assert.equal(openToolHref(health, { viewerRole: 'tester', testerAllowlist: ['health'] }), '');
assert.equal(openToolHref(health, { viewerRole: 'personal_lab' }), 'https://health.example.test/');
assert.equal(openToolHref({ ...inventory, featureControl: { killed: true } }, { viewerRole: 'public' }), '');

console.log('open-tool runtime enforcement tests passed');
