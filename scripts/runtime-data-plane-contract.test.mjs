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
assert.ok(exists('lib/life-domain/signal-embedding.ts'), 'Signal embedding runtime module must exist.');
assert.ok(exists('scripts/apply-supabase-signals-migration.mjs'), 'Executable Supabase signals migration script must exist.');

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
  'CREATE EXTENSION IF NOT EXISTS vector',
  'embedding_vector vector(768)',
  'embedding_model text',
  'idx_signals_embedding_vector',
  'vector_cosine_ops',
  'feedback jsonb NOT NULL',
  'idx_signals_feedback_gin',
  'DROP POLICY IF EXISTS "signals_select_own"',
  'match_own_signals',
  'match_identity_key text',
  'GRANT EXECUTE ON FUNCTION public.match_own_signals',
  'UNIQUE (identity_key, signal_id)',
  'ENABLE ROW LEVEL SECURITY',
]) {
  assert.ok(signalSchema.includes(marker), `signals schema missing marker: ${marker}`);
}

assert.ok(exists('lib/platform/runtime/cloud-signals-server.ts'), 'Cloud signal server runtime adapter must exist.');
const cloudSignalsServer = read('lib/platform/runtime/cloud-signals-server.ts');
assert.doesNotMatch(
  cloudSignalsServer,
  /next\/headers/,
  'Cloud signal server adapter must not import next/headers directly.',
);
assert.doesNotMatch(
  cloudSignalsServer,
  /SUPABASE_SERVICE_ROLE_KEY/,
  'Cloud signal server adapter must not read SUPABASE_SERVICE_ROLE_KEY directly.',
);
assert.match(
  cloudSignalsServer,
  /cloud-server-runtime/,
  'Cloud signal server adapter must use the shared cloud-server-runtime kernel.',
);
assert.match(
  cloudSignalsServer,
  /embedSignalText/,
  'Cloud signal server adapter must generate embeddings for server-side dual writes when runtime is enabled.',
);
assert.match(
  cloudSignalsServer,
  /embedding_vector/,
  'Cloud signal server adapter must preserve embedding_vector for server-side dual writes.',
);
assert.match(
  cloudSignalsServer,
  /Promise\.all\(signals\.map/,
  'Cloud signal server adapter must await async Signal row preparation before writing.',
);

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

const gmail = read('app/api/portal/gmail/route.ts');
assert.match(gmail, /metadataOnly/, 'Gmail route must preserve metadata-only default.');
assert.match(gmail, /includeBody\s*&&\s*shouldAnalyze/, 'Gmail body reads and analysis must stay explicit opt-in.');
assert.match(gmail, /normalizeGmailToSignal/, 'Gmail explicit analysis path must normalize into Signal input.');
assert.match(gmail, /createSignal/, 'Gmail explicit analysis path must write through createSignal.');
assert.match(gmail, /signalIds/, 'Gmail response must expose signal evidence ids for analyzed mail.');

const connectors = read('lib/portal/providers/connectors.ts');
assert.match(connectors, /normalizeWeatherToSignal/, 'Weather connector must normalize refresh output into Signal input.');
assert.match(connectors, /normalizeCalendarToSignal/, 'Calendar connector must normalize refresh output into Signal input.');
assert.match(connectors, /createSignal/, 'Connector refresh paths must write through createSignal.');

const cloudSignals = read('app/api/cloud/signals/route.ts');
assert.match(cloudSignals, /not_signed_in/, 'Cloud signals route must reject anonymous writes.');
assert.match(cloudSignals, /embedding_text/, 'Cloud signals route must persist embedding_text for later semantic search upgrade.');
assert.match(cloudSignals, /embedding_vector/, 'Cloud signals route must preserve embedding_vector contract fields.');
assert.match(cloudSignals, /embedSignalText/, 'Cloud signals route must generate embeddings when runtime is enabled.');
assert.match(cloudSignals, /signal_vector_pgvector/, 'Cloud signals route must expose pgvector search mode when available.');
assert.match(cloudSignals, /signal_text_scoring/, 'Cloud signals route must expose first-stage Signal text scoring search.');
assert.match(cloudSignals, /own_user_signals_only/, 'Cloud signals search must stay scoped to the signed-in user.');
assert.match(cloudSignals, /pgvectorSchemaReady/, 'Cloud signals route must report pgvector schema readiness.');
assert.match(cloudSignals, /embeddingVectorRuntimeReady/, 'Cloud signals route must report embedding runtime readiness.');
assert.match(cloudSignals, /PATCH/, 'Cloud signals route must support authenticated feedback writeback.');
assert.match(cloudSignals, /feedback_update_failed/, 'Cloud feedback writeback must fail closed.');

const feedback = read('lib/life-domain/signal-feedback.ts');
for (const marker of [
  'recordSignalFeedback',
  'feedbackSignal',
  "schemaVersion: 'Signal@v1'",
  'feedbackSignalIds',
  'decEngineId',
  'preferencePatch',
  'writeCloudSignalFeedback',
  '/api/cloud/signals',
]) {
  assert.ok(feedback.includes(marker), `feedback loop missing marker: ${marker}`);
}

// Today 表面已按工程 PRD 拆分(容器 + today/);反馈环活在 today/ 里
const todayFeed = [
  read('components/portal/TodayFeed.tsx'),
  read('components/portal/today/useTodayData.ts'),
  read('components/portal/today/ProactiveGuidanceCard.tsx'),
  read('components/portal/today/proactive-types.ts'),
].join('\n');
assert.match(todayFeed, /recordSignalFeedback/, 'Today feedback must write back to the signal feedback loop.');
assert.match(todayFeed, /evidenceSignalIds/, 'Today feedback must preserve evidenceSignalIds.');
assert.match(todayFeed, /registerDecCards/, 'Today pipeline must register full DEC cards so feedback can rejoin the signal loop.');

const signalSearch = read('lib/life-domain/signal-search.ts');
for (const marker of [
  'searchSignalsSemantically',
  'searchSignalsWithCloudFallback',
  'buildSignalSearchText',
  'scoreSignalForQuery',
  'signal_vector_pgvector',
  'getSignals',
]) {
  assert.ok(signalSearch.includes(marker), `signal search missing marker: ${marker}`);
}

const signalMainFact = read('lib/life-domain/signal-main-fact-contract.ts');
for (const marker of [
  'signal_read_preferred',
  'primary_cloud_fact_candidate_with_projection_fallback',
  'compat_projection_during_dual_write',
  'cloud_signals',
  'pgvectorSchemaReady',
  'vectorRpcReady',
  'runtimeEmbeddingProvider',
]) {
  assert.ok(signalMainFact.includes(marker), `Signal main-fact contract missing marker: ${marker}`);
}

const signalEmbedding = read('lib/life-domain/signal-embedding.ts');
for (const marker of [
  'SIGNAL_EMBEDDINGS_ENABLED',
  'SIGNAL_VECTOR_SEARCH_ENABLED',
  "resolveAiKey('gemini')",
  'text-embedding-004',
  'outputDimensionality',
]) {
  assert.ok(signalEmbedding.includes(marker), `Signal embedding runtime missing marker: ${marker}`);
}

const migrationScript = read('scripts/apply-supabase-signals-migration.mjs');
for (const marker of [
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  '--dry-run',
  '--print-sql',
  'psql',
  'ON_ERROR_STOP=1',
]) {
  assert.ok(migrationScript.includes(marker), `Supabase signals migration script missing marker: ${marker}`);
}

const voiceSheet = read('components/portal/VoiceInputSheet.tsx');
assert.match(
  voiceSheet,
  /searchSignalsWithCloudFallback|searchSignalsSemantically/,
  'Ask mode must use signal-aware semantic/fuzzy search.',
);

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
assert.equal(
  pkg.scripts['cloud:supabase:migrate:signals'],
  'node scripts/apply-supabase-signals-migration.mjs',
  'package.json must expose cloud:supabase:migrate:signals',
);
assert.match(pkg.scripts['test:contracts'], /test:runtime-data-plane/, 'test:contracts must include runtime data plane contract.');

assert.ok(exists('database/migration-plans/signal-main-table-switch-v1.md'), 'Signal main-table switch plan must exist and stay CEO-gated.');
const switchPlan = read('database/migration-plans/signal-main-table-switch-v1.md');
for (const marker of [
  'CEO Gate',
  'dual-write',
  'Memory / LifeGraph projection',
  'rollback',
  'no destructive migration',
]) {
  assert.ok(switchPlan.includes(marker), `Signal main-table switch plan missing marker: ${marker}`);
}

console.log('runtime-data-plane-contract: ok');
