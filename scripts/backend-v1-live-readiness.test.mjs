import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scriptPath = path.join(root, 'scripts', 'backend-v1-live-readiness.mjs');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.ok(fs.existsSync(scriptPath), 'expected scripts/backend-v1-live-readiness.mjs to exist');
assert.equal(
  pkg.scripts['report:backend-v1-readiness'],
  'node scripts/backend-v1-live-readiness.mjs',
  'package.json must expose report:backend-v1-readiness',
);
assert.equal(
  pkg.scripts['test:backend-v1-live-readiness'],
  'node scripts/backend-v1-live-readiness.test.mjs',
  'package.json must expose test:backend-v1-live-readiness',
);

const output = execFileSync('node', [scriptPath, '--offline', '--json'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    CLOUD_DB_ENABLED: 'true',
    CLOUD_STORAGE_ENABLED: 'true',
    SUPABASE_URL: 'https://vfxwyruitfefbftjzwbg.supabase.co',
    SUPABASE_ANON_KEY: 'anon-secret-value',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-value',
    SUPABASE_STORAGE_BUCKET: 'nesio-product-assets',
    NEXT_PUBLIC_SUPABASE_URL: 'https://vfxwyruitfefbftjzwbg.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-secret-value',
    NEXT_PUBLIC_SITE_URL: 'https://www.nesio.app',
    BAOHE_CANONICAL_DOMAIN: 'www.nesio.app',
  },
});
const report = JSON.parse(output);

assert.equal(report.version, 'backend-v1-live-readiness-v1');
assert.equal(report.mode, 'offline');
assert.equal(report.productionReady, false, 'offline readiness must never claim production is ready');
assert.equal(report.safePublicStatus, true);
assert.equal(report.secretsRedacted, true);
assert.equal(report.sideEffects, false);

for (const section of [
  'schemaFiles',
  'productBackendSurfaces',
  'supabasePostgres',
  'supabaseStorage',
  'authCallbacks',
  'vercelEnvironment',
  'liveSmoke',
  'ceoGate',
]) {
  assert.ok(report[section], `expected top-level ${section} section`);
}

assert.equal(report.productBackendSurfaces.ready, true, 'source-level product backend surfaces must be wired');
assert.equal(report.productBackendSurfaces.surfaceCount, 8, 'Backend v1 should track the full product backend surface set');
assert.equal(report.productBackendSurfaces.readySurfaceCount, 8, 'All source-level Backend v1 product surfaces should be ready');
for (const surfaceId of [
  'auth_session',
  'account_profile',
  'profile_settings',
  'memory_graph',
  'cloud_assets',
  'product_events',
  'user_data_export',
  'user_data_delete',
]) {
  const surface = report.productBackendSurfaces.surfaces.find((entry) => entry.id === surfaceId);
  assert.ok(surface, `missing product backend surface ${surfaceId}`);
  assert.equal(surface.ready, true, `product backend surface ${surfaceId} should be ready`);
  assert.ok(surface.routeFile, `product backend surface ${surfaceId} should expose a routeFile`);
  assert.ok(Array.isArray(surface.requiredMarkers), `product backend surface ${surfaceId} should list required markers`);
  assert.deepEqual(surface.missingMarkers, [], `product backend surface ${surfaceId} should have no missing markers`);
}
assert.equal(
  report.productBackendSurfaces.surfaces.find((entry) => entry.id === 'cloud_assets').storageBacked,
  true,
  'cloud assets surface must be marked storage-backed',
);
assert.equal(
  report.productBackendSurfaces.surfaces.find((entry) => entry.id === 'memory_graph').postgresBacked,
  true,
  'memory graph surface must be marked Postgres-backed',
);
assert.equal(
  report.productBackendSurfaces.surfaces.find((entry) => entry.id === 'product_events').postgresBacked,
  true,
  'product events surface must be marked Postgres-backed',
);

assert.equal(report.supabaseStorage.bucket, 'nesio-product-assets');
assert.equal(report.supabaseStorage.privateBucketRequired, true);
assert.equal(report.supabaseStorage.schemaReady, true);
assert.equal(report.supabasePostgres.schemaReady, true);
assert.equal(report.supabasePostgres.liveChecked, false);
assert.equal(report.liveSmoke.checked, false);
assert.equal(report.liveSmoke.requiresExplicitLiveFlag, true);
assert.equal(report.ceoGate.requiredForLiveMutation, true);
assert.equal(report.ceoGate.approvalState, 'not_applied_in_this_run');

assert.deepEqual(
  report.vercelEnvironment.requiredKeys,
  [
    'CLOUD_DB_ENABLED',
    'CLOUD_STORAGE_ENABLED',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_STORAGE_BUCKET',
    'NEXT_PUBLIC_SITE_URL',
    'BAOHE_CANONICAL_DOMAIN',
  ],
);
assert.equal(report.vercelEnvironment.ready, true);
assert.ok(report.vercelEnvironment.valuesRedacted, 'env values must be redacted');
assert.ok(!output.includes('anon-secret-value'));
assert.ok(!output.includes('service-role-secret-value'));
assert.ok(!output.includes('public-anon-secret-value'));

assert.ok(
  report.authCallbacks.appRedirectUrls.includes('https://www.nesio.app/api/auth/callback'),
  'www.nesio.app auth callback must be listed',
);
assert.ok(
  report.authCallbacks.appRedirectUrls.includes('https://treasurebox-nu.vercel.app/api/auth/callback'),
  'Vercel auth callback must be listed',
);
assert.equal(
  report.authCallbacks.googleCloudAuthorizedRedirectUri,
  'https://vfxwyruitfefbftjzwbg.supabase.co/auth/v1/callback',
  'Google Cloud redirect URI must derive from Supabase URL',
);

assert.ok(
  report.blockers.some((blocker) => blocker.id === 'live_smoke_not_run'),
  'offline report must keep live smoke as a blocker',
);
assert.ok(
  report.operatorActions.every((action) => action.requiresCeoGate === true),
  'live backend operator actions must remain CEO-gated',
);

const missingOutput = execFileSync('node', [scriptPath, '--offline', '--json'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    CLOUD_DB_ENABLED: '',
    CLOUD_STORAGE_ENABLED: '',
    SUPABASE_URL: '',
    NEXT_PUBLIC_SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_STORAGE_BUCKET: '',
    NEXT_PUBLIC_SITE_URL: '',
    BAOHE_CANONICAL_DOMAIN: '',
  },
});
const missingReport = JSON.parse(missingOutput);
assert.equal(missingReport.vercelEnvironment.ready, false);
assert.equal(missingReport.supabasePostgres.ready, false);
assert.equal(missingReport.supabaseStorage.ready, false);
assert.ok(
  missingReport.blockers.some((blocker) => blocker.id === 'missing_vercel_env'),
  'missing env report must expose missing_vercel_env blocker',
);
assert.ok(
  missingReport.operatorActions.some((action) => action.action === 'set_vercel_backend_env'),
  'missing env report must tell operator to set Vercel backend env',
);

const source = fs.readFileSync(scriptPath, 'utf8');
assert.match(source, /supabase-cloud-preflight\.mjs/, 'readiness script must reuse Supabase preflight knowledge');
assert.match(source, /nesio-product-assets/, 'readiness script must name the canonical private Storage bucket');
assert.match(source, /auth\/v1\/callback/, 'readiness script must expose Supabase provider callback requirement');
assert.match(source, /productionReady:\s*false/, 'readiness script must fail closed by default');

console.log('backend v1 live readiness tests passed');
