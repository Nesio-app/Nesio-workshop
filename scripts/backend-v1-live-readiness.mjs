#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const VERSION = 'backend-v1-live-readiness-v1';
const CANONICAL_STORAGE_BUCKET = 'nesio-product-assets';
const APP_AUTH_CALLBACKS = [
  'https://www.nesio.app/api/auth/callback',
  'https://treasurebox-nu.vercel.app/api/auth/callback',
];
const REQUIRED_VERCEL_ENV = [
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
];
const PRODUCT_BACKEND_SURFACE_SPECS = [
  {
    id: 'auth_session',
    label: 'Supabase Auth session',
    routeFile: 'app/api/auth/session/route.ts',
    clientFile: 'lib/portal/auth/auth-client.ts',
    schemaTables: ['user_profiles'],
    postgresBacked: true,
    storageBacked: false,
    requiredMarkers: [
      'fetchSupabaseUser',
      'refreshSupabaseSession',
      'bootstrapCloudAccountProfile',
      'baohe_auth_access',
    ],
  },
  {
    id: 'account_profile',
    label: 'Account profile',
    routeFile: 'app/api/cloud/account/route.ts',
    clientFile: 'lib/portal/app-api-client.ts',
    schemaTables: ['user_profiles'],
    postgresBacked: true,
    storageBacked: false,
    requiredMarkers: [
      '/rest/v1/user_profiles',
      'deriveCloudIdentity',
      'fetchCloudAccountProfile',
      'saveCloudAccountProfile',
    ],
  },
  {
    id: 'profile_settings',
    label: 'Profile settings',
    routeFile: 'app/api/cloud/profile-settings/route.ts',
    clientFile: 'lib/portal/app-api-client.ts',
    schemaTables: ['profile_settings'],
    postgresBacked: true,
    storageBacked: false,
    requiredMarkers: [
      '/rest/v1/profile_settings',
      'avatarStoragePath',
      'fetchCloudProfileSettings',
      'saveCloudProfileSettings',
    ],
  },
  {
    id: 'memory_graph',
    label: 'Memory graph',
    routeFile: 'app/api/cloud/memory/route.ts',
    clientFile: 'lib/portal/app-api-client.ts',
    schemaTables: ['memory_nodes', 'memory_edges', 'memory_assets'],
    postgresBacked: true,
    storageBacked: true,
    requiredMarkers: [
      '/rest/v1/memory_nodes',
      '/rest/v1/memory_edges',
      '/rest/v1/memory_assets',
      'fetchCloudMemorySnapshot',
      'saveCloudMemorySnapshot',
    ],
  },
  {
    id: 'cloud_assets',
    label: 'Cloud assets',
    routeFile: 'app/api/cloud/assets/route.ts',
    clientFile: 'lib/portal/app-api-client.ts',
    // 存储签名(/storage/v1/object/sign)在共享服务端运行时里,route 委托调用
    runtimeFile: 'lib/portal/cloud-server-runtime.ts',
    schemaTables: ['storage.objects'],
    postgresBacked: false,
    storageBacked: true,
    requiredMarkers: [
      '/storage/v1/object',
      '/storage/v1/object/sign',
      'isStoragePathOwnedByIdentity',
      'uploadCloudAsset',
      'fetchCloudAssetReadUrl',
    ],
  },
  {
    id: 'product_events',
    label: 'Product events',
    routeFile: 'app/api/cloud/events/route.ts',
    clientFile: 'lib/portal/app-api-client.ts',
    schemaTables: ['product_events'],
    postgresBacked: true,
    storageBacked: false,
    requiredMarkers: [
      '/rest/v1/product_events',
      'deriveCloudIdentity',
      'product_event_recorded',
      'fetchCloudProductEvents',
      'recordCloudProductEvent',
    ],
  },
  {
    id: 'user_data_export',
    label: 'User data export',
    routeFile: 'app/api/user-data/export/route.ts',
    clientFile: 'lib/portal/app-api-client.ts',
    schemaTables: [
      'user_profiles',
      'profile_settings',
      'memory_nodes',
      'memory_edges',
      'memory_assets',
      'product_events',
    ],
    postgresBacked: true,
    storageBacked: true,
    requiredMarkers: [
      'memory_assets',
      'storageObjects',
      'supabase-postgres-storage',
      'storagePathFromJson',
    ],
  },
  {
    id: 'user_data_delete',
    label: 'User data delete',
    routeFile: 'app/api/user-data/delete/route.ts',
    clientFile: 'lib/portal/app-api-client.ts',
    schemaTables: [
      'user_profiles',
      'profile_settings',
      'memory_nodes',
      'memory_edges',
      'memory_assets',
      'product_events',
    ],
    postgresBacked: true,
    storageBacked: true,
    requiredMarkers: [
      'memory_assets',
      'deleteCloudStorageObjects',
      'storageDeletionReady',
      'supabase-postgres-storage',
    ],
  },
];

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function envValue(key) {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readSupabasePreflight({ live }) {
  const args = ['scripts/supabase-cloud-preflight.mjs', '--json'];
  if (live) {
    args.push('--live');
  } else {
    args.push('--offline');
  }
  const output = execFileSync('node', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  });
  return JSON.parse(output);
}

function deriveSupabaseProviderCallback() {
  const supabaseUrl = envValue('SUPABASE_URL') || envValue('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseUrl) {
    return '';
  }
  try {
    const url = new URL(supabaseUrl);
    return `${url.origin}/auth/v1/callback`;
  } catch {
    return '';
  }
}

function vercelEnvironmentReport() {
  const entries = REQUIRED_VERCEL_ENV.map((key) => ({
    key,
    present: Boolean(envValue(key)),
    enabled: key === 'CLOUD_DB_ENABLED' || key === 'CLOUD_STORAGE_ENABLED'
      ? envValue(key).toLowerCase() === 'true'
      : undefined,
    value: envValue(key) ? '[redacted]' : '',
  }));
  const missingKeys = entries.filter((entry) => !entry.present).map((entry) => entry.key);
  const disabledRuntimeFlags = entries
    .filter((entry) => entry.enabled === false)
    .map((entry) => entry.key);

  return {
    requiredKeys: REQUIRED_VERCEL_ENV,
    entries,
    missingKeys,
    disabledRuntimeFlags,
    valuesRedacted: true,
    ready: missingKeys.length === 0 && disabledRuntimeFlags.length === 0,
  };
}

function readSourceFile(relativePath) {
  const absolutePath = join(process.cwd(), relativePath);
  if (!existsSync(absolutePath)) {
    return '';
  }
  return readFileSync(absolutePath, 'utf8');
}

function productBackendSurfacesReport() {
  const surfaces = PRODUCT_BACKEND_SURFACE_SPECS.map((spec) => {
    const routeSource = readSourceFile(spec.routeFile);
    const clientSource = spec.clientFile ? readSourceFile(spec.clientFile) : '';
    const runtimeSource = spec.runtimeFile ? readSourceFile(spec.runtimeFile) : '';
    const combinedSource = `${routeSource}\n${clientSource}\n${runtimeSource}`;
    const missingMarkers = spec.requiredMarkers.filter((marker) => !combinedSource.includes(marker));
    const routeExists = Boolean(routeSource);
    const clientExists = spec.clientFile ? Boolean(clientSource) : true;
    const ready = routeExists && clientExists && missingMarkers.length === 0;

    return {
      id: spec.id,
      label: spec.label,
      routeFile: spec.routeFile,
      clientFile: spec.clientFile,
      routeExists,
      clientExists,
      schemaTables: spec.schemaTables,
      postgresBacked: spec.postgresBacked,
      storageBacked: spec.storageBacked,
      requiredMarkers: spec.requiredMarkers,
      missingMarkers,
      ready,
    };
  });

  return {
    version: 'product-backend-surfaces-v1',
    ready: surfaces.every((surface) => surface.ready),
    surfaceCount: surfaces.length,
    readySurfaceCount: surfaces.filter((surface) => surface.ready).length,
    surfaces,
  };
}

function buildBlockers({ vercelEnvironment, productBackendSurfaces, supabasePostgres, supabaseStorage, liveSmoke }) {
  const blockers = [];
  if (!productBackendSurfaces.ready) {
    blockers.push({
      id: 'product_backend_surface_not_ready',
      severity: 'P0',
      reason: 'One or more Backend v1 product API/client/schema surfaces are missing source-level markers.',
      evidence: productBackendSurfaces.surfaces
        .filter((surface) => !surface.ready)
        .map((surface) => ({
          id: surface.id,
          routeFile: surface.routeFile,
          clientFile: surface.clientFile,
          missingMarkers: surface.missingMarkers,
        })),
    });
  }
  if (!vercelEnvironment.ready) {
    blockers.push({
      id: 'missing_vercel_env',
      severity: 'P0',
      reason: 'Required Backend v1 Vercel/Supabase environment values are missing or disabled.',
      evidence: {
        missingKeys: vercelEnvironment.missingKeys,
        disabledRuntimeFlags: vercelEnvironment.disabledRuntimeFlags,
      },
    });
  }
  if (!supabasePostgres.schemaReady) {
    blockers.push({
      id: 'supabase_postgres_schema_not_ready',
      severity: 'P0',
      reason: 'Supabase Postgres schema files are missing required Backend v1 markers.',
      evidence: supabasePostgres.blockedSchemaFiles,
    });
  }
  if (!supabaseStorage.schemaReady || !supabaseStorage.bucketConfigured) {
    blockers.push({
      id: 'supabase_storage_not_ready',
      severity: 'P0',
      reason: 'Supabase Storage private bucket contract is not ready or bucket env is missing.',
      evidence: {
        schemaReady: supabaseStorage.schemaReady,
        bucketConfigured: supabaseStorage.bucketConfigured,
        bucket: supabaseStorage.bucket,
      },
    });
  }
  if (!liveSmoke.checked) {
    blockers.push({
      id: 'live_smoke_not_run',
      severity: 'P0',
      reason: 'Live Supabase table/bucket reachability was not checked in this offline run.',
      evidence: {
        requiresExplicitLiveFlag: liveSmoke.requiresExplicitLiveFlag,
      },
    });
  } else if (!liveSmoke.ready) {
    blockers.push({
      id: 'live_smoke_failed',
      severity: 'P0',
      reason: 'Live Supabase table or bucket reachability is blocked.',
      evidence: liveSmoke.evidence,
    });
  }
  return blockers;
}

function buildOperatorActions({ blockers }) {
  const actions = [];
  if (blockers.some((blocker) => blocker.id === 'missing_vercel_env')) {
    actions.push({
      action: 'set_vercel_backend_env',
      owner: 'operator',
      requiresCeoGate: true,
      reason: 'Set Backend v1 env in Vercel/Supabase runtime before production use.',
    });
  }
  if (blockers.some((blocker) => blocker.id === 'supabase_postgres_schema_not_ready')) {
    actions.push({
      action: 'apply_supabase_postgres_schema',
      owner: 'operator',
      requiresCeoGate: true,
      reason: 'Apply Backend v1 SQL schema to Supabase Postgres.',
    });
  }
  if (blockers.some((blocker) => blocker.id === 'supabase_storage_not_ready')) {
    actions.push({
      action: 'create_private_supabase_storage_bucket',
      owner: 'operator',
      requiresCeoGate: true,
      reason: `Create private Supabase Storage bucket ${CANONICAL_STORAGE_BUCKET} and policies.`,
    });
  }
  if (blockers.some((blocker) => blocker.id === 'live_smoke_not_run')) {
    actions.push({
      action: 'run_live_backend_smoke',
      owner: 'operator',
      requiresCeoGate: true,
      reason: 'Run explicit live Supabase readiness check after env/schema/bucket are applied.',
    });
  }
  return actions;
}

function buildReadinessReport() {
  const live = hasFlag('--live');
  const preflight = readSupabasePreflight({ live });
  const vercelEnvironment = vercelEnvironmentReport();
  const schemaFiles = preflight.schemaFiles || {};
  const postgresSchemaFiles = Object.values(schemaFiles).filter((entry) => entry.table !== 'storage.objects');
  const storageSchema = schemaFiles.storageAssets || {};
  const blockedSchemaFiles = postgresSchemaFiles
    .filter((entry) => !entry.ready)
    .map((entry) => ({
      table: entry.table,
      path: entry.path,
      missingMarkerCount: entry.missingMarkers?.length || 0,
    }));
  const storageBucket = envValue('SUPABASE_STORAGE_BUCKET') || CANONICAL_STORAGE_BUCKET;
  const supabasePostgres = {
    implementation: 'supabase-postgres',
    schemaReady: postgresSchemaFiles.length > 0 && blockedSchemaFiles.length === 0,
    envReady: Boolean(preflight.summary?.databaseEnvReady),
    liveChecked: Boolean(preflight.network?.checked),
    liveReady: Boolean(preflight.summary?.databaseNetworkReady),
    ready: Boolean(preflight.summary?.databaseEnvReady)
      && postgresSchemaFiles.length > 0
      && blockedSchemaFiles.length === 0
      && (!preflight.network?.checked || Boolean(preflight.summary?.databaseNetworkReady)),
    blockedSchemaFiles,
  };
  const supabaseStorage = {
    implementation: 'supabase-storage',
    bucket: storageBucket,
    canonicalBucket: CANONICAL_STORAGE_BUCKET,
    privateBucketRequired: true,
    bucketConfigured: Boolean(envValue('SUPABASE_STORAGE_BUCKET')),
    schemaReady: storageSchema.ready === true,
    envReady: Boolean(preflight.summary?.storageEnvReady),
    liveChecked: Boolean(preflight.network?.storage?.checked),
    liveReady: Boolean(preflight.summary?.storageNetworkReady),
    ready: Boolean(preflight.summary?.storageEnvReady)
      && storageSchema.ready === true
      && Boolean(envValue('SUPABASE_STORAGE_BUCKET'))
      && (!preflight.network?.storage?.checked || Boolean(preflight.summary?.storageNetworkReady)),
  };
  const liveSmoke = {
    checked: Boolean(preflight.network?.checked),
    requiresExplicitLiveFlag: true,
    ready: Boolean(preflight.network?.checked)
      && Boolean(preflight.summary?.databaseNetworkReady)
      && Boolean(preflight.summary?.storageNetworkReady),
    evidence: {
      tables: preflight.network?.tables || [],
      storage: preflight.network?.storage || { checked: false, status: 'offline' },
    },
  };
  const authCallbacks = {
    appRedirectUrls: APP_AUTH_CALLBACKS,
    googleCloudAuthorizedRedirectUri: deriveSupabaseProviderCallback(),
    requiresSupabaseUrl: true,
    configuredInThisRun: false,
  };
  const ceoGate = {
    requiredForLiveMutation: true,
    approvalState: 'not_applied_in_this_run',
    gatedActions: [
      'apply_supabase_schema_sql',
      'create_or_modify_supabase_storage_bucket',
      'set_or_rotate_vercel_env',
      'run_live_cloud_smoke_against_real_project',
      'enable_real_user_cloud_persistence',
    ],
  };
  const productBackendSurfaces = productBackendSurfacesReport();
  const blockers = buildBlockers({
    vercelEnvironment,
    productBackendSurfaces,
    supabasePostgres,
    supabaseStorage,
    liveSmoke,
  });

  return {
    version: VERSION,
    mode: live ? 'live' : 'offline',
    safePublicStatus: true,
    secretsRedacted: true,
    sideEffects: false,
    productionReady: false,
    schemaFiles,
    productBackendSurfaces,
    supabasePostgres,
    supabaseStorage,
    authCallbacks,
    vercelEnvironment,
    liveSmoke,
    ceoGate,
    blockers,
    operatorActions: buildOperatorActions({ blockers }),
    summary: {
      offlineSchemaReady: supabasePostgres.schemaReady && supabaseStorage.schemaReady,
      envReady: vercelEnvironment.ready,
      liveSmokeReady: liveSmoke.ready,
      productBackendSourceReady: productBackendSurfaces.ready && supabasePostgres.schemaReady && supabaseStorage.schemaReady,
      productBackendLiveReady: false,
    },
  };
}

function toMarkdown(report) {
  const lines = [
    '# Backend v1 Live Readiness',
    '',
    `- version: ${report.version}`,
    `- mode: ${report.mode}`,
    `- productionReady: ${report.productionReady}`,
    `- sideEffects: ${report.sideEffects}`,
    `- Supabase Postgres schemaReady: ${report.supabasePostgres.schemaReady}`,
    `- Supabase Storage bucket: ${report.supabaseStorage.bucket}`,
    `- Supabase Storage schemaReady: ${report.supabaseStorage.schemaReady}`,
    `- Product backend surfaces ready: ${report.productBackendSurfaces.ready} (${report.productBackendSurfaces.readySurfaceCount}/${report.productBackendSurfaces.surfaceCount})`,
    `- Vercel env ready: ${report.vercelEnvironment.ready}`,
    `- Live smoke checked: ${report.liveSmoke.checked}`,
    '',
    '## Auth Callback Requirements',
    '',
    ...report.authCallbacks.appRedirectUrls.map((url) => `- App callback: ${url}`),
    `- Google Cloud Authorized redirect URI: ${report.authCallbacks.googleCloudAuthorizedRedirectUri || '(derive after SUPABASE_URL is set)'}`,
    '',
    '## Product Backend Surfaces',
    '',
    ...report.productBackendSurfaces.surfaces.map((surface) => (
      `- ${surface.id}: ready=${surface.ready}; postgres=${surface.postgresBacked}; storage=${surface.storageBacked}; route=${surface.routeFile}`
    )),
    '',
    '## Blockers',
    '',
  ];

  if (report.blockers.length === 0) {
    lines.push('- none in static manifest; live production still requires CEO-gated apply/smoke.');
  } else {
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker.severity} ${blocker.id}: ${blocker.reason}`);
    }
  }

  lines.push(
    '',
    '## Boundary',
    '',
    '- This command does not mutate Supabase, Vercel, Google, or real user data.',
    '- productionReady remains false until live env/schema/storage are applied and verified under CEO gate.',
  );

  return `${lines.join('\n')}\n`;
}

const report = buildReadinessReport();

if (hasFlag('--json')) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
  process.stdout.write(toMarkdown(report));
}

if (hasFlag('--strict') && report.blockers.length > 0) {
  process.exitCode = 1;
}
