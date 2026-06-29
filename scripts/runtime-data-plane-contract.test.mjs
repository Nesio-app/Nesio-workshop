import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

assert.ok(exists('database/schema/supabase-signals-v1.sql'), 'Supabase signals schema must exist.');
assert.ok(exists('app/api/cloud/signals/route.ts'), 'Cloud signals API route must exist.');
assert.ok(exists('lib/life-domain/signal-search.ts'), 'Signal-aware semantic/fuzzy search module must exist.');
assert.ok(exists('lib/life-domain/signal-feedback.ts'), 'Feedback loop must have a signal writeback module.');

const signalSchema = read('database/schema/supabase-signals-v1.sql');
for (const marker of [
  'CREATE TABLE IF NOT EXISTS public.signals',
  'identity_key text NOT NULL',
  'signal_id text NOT NULL',
  'source text NOT NULL',
  'type text NOT NULL',
  'payload jsonb NOT NULL',
  'evidence jsonb NOT NULL',
  'retention_policy text NOT NULL',
  'sensitivity text NOT NULL',
  'embedding_text text',
  'feedback jsonb NOT NULL',
  'UNIQUE (identity_key, signal_id)',
  'ENABLE ROW LEVEL SECURITY',
]) {
  assert.ok(signalSchema.includes(marker), `signals schema missing marker: ${marker}`);
}

const createSignal = read('lib/life-domain/create-signal.ts');
for (const marker of [
  'writeCloudSignal',
  'signalWriteMode',
  'Signal@v1',
  'createSignal',
]) {
  assert.ok(createSignal.includes(marker), `createSignal path missing marker: ${marker}`);
}

const lifeGraph = read('lib/portal/life-graph.ts');
for (const marker of [
  'CLOUD_SIGNALS_ENDPOINT',
  'lifeNodeToCloudSignal',
  'syncLifeNodeSignalToCloud',
]) {
  assert.ok(lifeGraph.includes(marker), `legacy LifeGraph writes must mirror to Signal: ${marker}`);
}

const normalizers = read('lib/life-domain/normalizers.ts');
for (const marker of [
  'normalizeVoiceToSignal',
  'normalizePhotoToSignal',
  'normalizeCalendarToSignal',
  'normalizeGmailToSignal',
  'normalizeHealthToSignal',
  'normalizeTaskToSignal',
  'normalizeWeatherToSignal',
]) {
  assert.ok(normalizers.includes(marker), `normalizer missing marker: ${marker}`);
}

const ingest = read('app/api/portal/ingest/route.ts');
assert.match(ingest, /normalize\w+ToSignal/, 'Ingest route must normalize real input into Signal.');
assert.match(ingest, /createSignal/, 'Ingest route must write through createSignal.');

const analyze = read('app/api/portal/analyze/route.ts');
assert.match(analyze, /normalizePhotoToSignal|normalizeVoiceToSignal/, 'Analyze route must normalize capture results into Signal input.');
assert.match(analyze, /createSignal/, 'Analyze route must expose the Signal write path for captures.');

const feedback = read('lib/life-domain/signal-feedback.ts');
for (const marker of [
  'recordSignalFeedback',
  'feedbackSignalIds',
  'decEngineId',
  'preferencePatch',
]) {
  assert.ok(feedback.includes(marker), `feedback loop missing marker: ${marker}`);
}

const todayFeed = read('components/portal/TodayFeed.tsx');
assert.match(todayFeed, /recordSignalFeedback/, 'Today feedback must write back to the signal feedback loop.');
assert.match(todayFeed, /evidenceSignalIds/, 'Today feedback must preserve evidenceSignalIds.');

const signalSearch = read('lib/life-domain/signal-search.ts');
for (const marker of [
  'searchSignalsSemantically',
  'buildSignalSearchText',
  'scoreSignalForQuery',
  'getSignals',
]) {
  assert.ok(signalSearch.includes(marker), `signal search missing marker: ${marker}`);
}

const voiceSheet = read('components/portal/VoiceInputSheet.tsx');
assert.match(voiceSheet, /searchSignalsSemantically/, 'Ask mode must use signal-aware semantic/fuzzy search.');

const policy = read('lib/intelligence/dec-policy.ts');
for (const marker of [
  "'single_domain'",
  "'two_domain'",
  "'three_domain_lab_only'",
  "'user_confirmed_cross_domain'",
  "'agent_action'",
  'DEC_POLICY_REGISTRY',
  'requiresUserConfirmation',
  'labOnly',
]) {
  assert.ok(policy.includes(marker), `DEC policy registry missing marker: ${marker}`);
}

const pkg = JSON.parse(read('package.json'));
assert.equal(
  pkg.scripts['test:runtime-data-plane'],
  'node scripts/runtime-data-plane-contract.test.mjs',
  'package.json must expose test:runtime-data-plane',
);
assert.match(pkg.scripts['test:contracts'], /test:runtime-data-plane/, 'test:contracts must include runtime data plane contract.');

console.log('runtime-data-plane-contract: ok');
