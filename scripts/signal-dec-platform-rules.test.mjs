import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const signal = read('lib/life-domain/signal.ts');
const createSignal = read('lib/life-domain/create-signal.ts');
const normalizers = read('lib/life-domain/normalizers.ts');
const dec = read('lib/intelligence/dec.ts');
const policy = read('lib/intelligence/dec-policy.ts');
const domains = read('lib/intelligence/domains.ts');
const connectors = read('lib/portal/providers/connectors.ts');
const reasoning = read('lib/portal/reasoning-engine.ts');
const recommendation = read('lib/life-domain/recommendation.ts');
const pkg = JSON.parse(read('package.json'));

assert.match(signal, /export type SignalType = string;/, 'Signal type must allow domain-specific atomic keys.');
assert.match(signal, /payload\?: Record<string, unknown>/, 'Signal must carry canonical lightweight payload.');
assert.match(signal, /signalSource/, 'LifeNode adapter must preserve original Signal source.');

assert.match(createSignal, /export function createSignal/, 'createSignal must be the canonical write path.');
assert.match(createSignal, /buildSignalId/, 'Signal ids must be stable and source/timestamp/hash shaped.');
assert.match(createSignal, /signalId/, 'createSignal must persist the canonical Signal id.');
assert.match(createSignal, /signalType/, 'createSignal must persist the canonical Signal type.');
assert.match(createSignal, /signalSource/, 'createSignal must persist the canonical Signal source.');

[
  'normalizeVoiceToSignal',
  'normalizePhotoToSignal',
  'normalizeCalendarToSignal',
  'normalizeGmailToSignal',
  'normalizeHealthToSignal',
  'normalizeTaskToSignal',
  'normalizeWeatherToSignal',
].forEach((name) => assert.match(normalizers, new RegExp(`export function ${name}`), `${name} must exist.`));

assert.match(connectors, /createSignal\(normalizeWeatherToSignal/, 'Weather connector must write through createSignal.');
assert.match(connectors, /createSignal\(normalizeCalendarToSignal/, 'Calendar connector must write through createSignal.');
assert.doesNotMatch(connectors, /addLifeNode\(\{/, 'Connectors must not bypass Signal normalization with direct addLifeNode writes.');

assert.match(policy, /DEC_EVIDENCE_POLICIES/, 'DEC must expose policy registry, not only hard-coded checks.');
[
  /\['health', 'calendar'\]/,
  /\['health', 'weather'\]/,
  /\['task', 'calendar'\]/,
].forEach((re) => assert.match(policy, re, `DEC policy missing ${re}.`));
assert.match(policy, /requiredEvidenceDomains/, 'DEC policies must declare required evidence domains.');
assert.match(policy, /silenceWhenMissingEvidence/, 'DEC policies must support design silence on missing evidence.');
assert.match(policy, /policyHasEvidence/, 'DEC must check real evidence for policy domains.');
assert.match(policy, /canRunDomain/, 'DEC must centralize runtime gate decisions.');

assert.match(dec, /canRunDomain/, 'DEC runtime must use the shared policy gate.');
assert.match(dec, /withEvidenceSignalIds/, 'DEC runtime must attach evidenceSignalIds.');
assert.match(dec, /cardHasSignalEvidence/, 'DEC runtime must reject cards without Signal evidence.');

assert.match(reasoning, /evidenceSignalIds\?: string\[\]/, 'Today cards must expose evidenceSignalIds.');
assert.match(recommendation, /card\.evidenceSignalIds/, 'Canonical Recommendation must use card evidenceSignalIds.');
assert.doesNotMatch(recommendation, /`\$\{e\.source\}:\$\{e\.value\}`/, 'Recommendation evidence must not fall back to untraceable source:value refs.');

assert.match(domains, /const energyCalendarDomain/, 'Health x Calendar engine must exist.');
assert.match(domains, /const weatherDomain/, 'Health x Weather engine must exist.');
assert.match(domains, /const workDomain/, 'Task x Calendar engine must exist.');
assert.match(domains, /evidenceSignalIds/, 'Domain cards must carry evidenceSignalIds.');
assert.match(domains, /if \(!activeHealth \|\| !weatherSignal\) return \[\];/, 'Health x Weather must stand down unless both domains have evidence.');
assert.match(domains, /if \(!taskSignal \|\| !next\) return \[\];/, 'Task x Calendar must stand down unless both domains have evidence.');
assert.match(domains, /if \(!healthSignal \|\| calendarEvents\.length < 2\) return \[\];/, 'Health x Calendar must stand down unless both domains have evidence.');

assert.match(pkg.scripts['test:signal-dec-platform-rules'], /signal-dec-platform-rules\.test\.mjs/, 'package.json must expose signal/DEC platform test.');
assert.match(pkg.scripts['test:contracts'], /test:signal-dec-platform-rules/, 'test:contracts must include signal/DEC platform rules.');

console.log('signal-dec-platform-rules: ok');
