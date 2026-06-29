import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const contracts = read('lib/intelligence/contracts.ts');
const todayViewModel = exists('lib/platform/view-models/today-view-model.ts')
  ? read('lib/platform/view-models/today-view-model.ts')
  : '';
const todayFeed = read('components/portal/TodayFeed.tsx');
const leakCheck = read('scripts/check-platform-leak.mjs');
const pkg = JSON.parse(read('package.json'));

[
  'SignalContract',
  'ActionContract',
  'InsightContract',
  'SimulationContract',
  'DomainCapabilityContracts',
].forEach((name) => assert.match(contracts, new RegExp(`export interface ${name}|export type ${name}`), `${name} must be a first-class contract.`));

[
  'publishSignals',
  'executeAction',
  'provideInsights',
  'runSimulation',
].forEach((method) => assert.match(contracts, new RegExp(method), `${method} capability must be declared atomically.`));

assert.ok(todayViewModel, 'TodayViewModel must exist as the Experience layer read model.');
assert.match(todayViewModel, /export interface TodayViewModel/, 'TodayViewModel type must be exported.');
assert.match(todayViewModel, /export function buildTodayViewModel/, 'TodayViewModel builder must be the single Today data entrypoint.');
assert.match(todayViewModel, /generateTodayCards/, 'TodayViewModel builder should own DEC card generation.');
assert.match(todayViewModel, /getRecentNodes/, 'TodayViewModel builder should own Memory/LifeGraph projection counts.');

assert.match(todayFeed, /buildTodayViewModel/, 'TodayFeed must consume TodayViewModel.');
assert.doesNotMatch(todayFeed, /generateTodayCards/, 'TodayFeed must not call DEC directly.');
assert.doesNotMatch(todayFeed, /getRecentNodes/, 'TodayFeed must not read LifeGraph directly.');

assert.match(leakCheck, /acorn/, 'Platform leak check must parse imports instead of regex-only scanning.');
assert.match(leakCheck, /LAYER_RULES/, 'Platform leak check must define global layer dependency rules.');
assert.match(leakCheck, /components\/portal\/\*\*/, 'Experience layer rule must cover all portal components.');
assert.match(leakCheck, /lib\/intelligence\/\*\*/, 'Intelligence layer rule must be enforced.');
assert.match(leakCheck, /lib\/life-domain\/\*\*/, 'Life Domain layer rule must be enforced.');
assert.match(leakCheck, /lib\/integrations\/\*\*/, 'Integration layer rule must be represented.');
assert.match(leakCheck, /TodayViewModel/, 'Today surface must be fused to TodayViewModel.');

assert.match(pkg.scripts['test:platform-boundaries'], /platform-boundary-contracts\.test\.mjs/, 'package.json must expose platform boundary contract test.');
assert.match(pkg.scripts['test:contracts'], /test:platform-boundaries/, 'test:contracts must include platform boundary contracts.');

console.log('platform-boundary-contracts: ok');
