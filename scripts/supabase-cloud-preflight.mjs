import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const VERSION = 'supabase-cloud-preflight-v1';
const DATABASE_REQUIRED_ENV = [
  'CLOUD_DB_ENABLED',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const STORAGE_REQUIRED_ENV = [
  'CLOUD_STORAGE_ENABLED',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
];
const REQUIRED_ENV = Array.from(new Set([...DATABASE_REQUIRED_ENV, ...STORAGE_REQUIRED_ENV]));
const TABLES = [
  {
    id: 'userProfiles',
    table: 'user_profiles',
    endpoint: '/rest/v1/user_profiles',
    schemaPath: 'database/schema/supabase-user-profiles-v1.sql',
    selectColumn: 'identity_key',
    requiredMarkers: [
      'CREATE TABLE IF NOT EXISTS public.user_profiles',
      'identity_key text PRIMARY KEY',
      'user_id uuid REFERENCES auth.users',
      'profile jsonb',
      'ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY',
    ],
  },
  {
    id: 'profileSettings',
    table: 'profile_settings',
    endpoint: '/rest/v1/profile_settings',
    schemaPath: 'database/schema/supabase-profile-settings-v1.sql',
    selectColumn: 'identity_key',
    requiredMarkers: ['identity_key text PRIMARY KEY', 'user_id uuid REFERENCES auth.users', 'settings jsonb'],
  },
  {
    id: 'inventoryItems',
    table: 'inventory_items',
    endpoint: '/rest/v1/inventory_items',
    schemaPath: 'database/schema/supabase-inventory-items-v1.sql',
    selectColumn: 'identity_key',
    requiredMarkers: ['identity_key text NOT NULL', 'UNIQUE (identity_key, local_id)', 'item jsonb'],
  },
  {
    id: 'memoryNodes',
    table: 'memory_nodes',
    endpoint: '/rest/v1/memory_nodes',
    schemaPath: 'database/schema/supabase-memory-v1.sql',
    selectColumn: 'identity_key',
    requiredMarkers: [
      'CREATE TABLE IF NOT EXISTS public.memory_nodes',
      'identity_key text NOT NULL',
      'node jsonb NOT NULL DEFAULT',
      'ALTER TABLE public.memory_nodes ENABLE ROW LEVEL SECURITY',
    ],
  },
  {
    id: 'memoryEdges',
    table: 'memory_edges',
    endpoint: '/rest/v1/memory_edges',
    schemaPath: 'database/schema/supabase-memory-v1.sql',
    selectColumn: 'identity_key',
    requiredMarkers: [
      'CREATE TABLE IF NOT EXISTS public.memory_edges',
      'identity_key text NOT NULL',
      'source_node_local_id text',
      'target_node_local_id text',
      'ALTER TABLE public.memory_edges ENABLE ROW LEVEL SECURITY',
    ],
  },
  {
    id: 'memoryAssets',
    table: 'memory_assets',
    endpoint: '/rest/v1/memory_assets',
    schemaPath: 'database/schema/supabase-memory-v1.sql',
    selectColumn: 'identity_key',
    requiredMarkers: [
      'CREATE TABLE IF NOT EXISTS public.memory_assets',
      'identity_key text NOT NULL',
      'asset jsonb NOT NULL DEFAULT',
      'ALTER TABLE public.memory_assets ENABLE ROW LEVEL SECURITY',
    ],
  },
  {
    id: 'productEvents',
    table: 'product_events',
    endpoint: '/rest/v1/product_events',
    schemaPath: 'database/schema/supabase-product-events-v1.sql',
    selectColumn: 'identity_key',
    requiredMarkers: [
      'CREATE TABLE IF NOT EXISTS public.product_events',
      'identity_key text NOT NULL',
      'event_type text NOT NULL',
      'payload jsonb NOT NULL DEFAULT',
      'ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY',
    ],
  },
  {
    id: 'signals',
    table: 'signals',
    endpoint: '/rest/v1/signals',
    schemaPath: 'database/schema/supabase-signals-v1.sql',
    selectColumn: 'identity_key',
    requiredMarkers: [
      'CREATE TABLE IF NOT EXISTS public.signals',
      'identity_key text NOT NULL',
      'signal_id text NOT NULL',
      'payload jsonb NOT NULL',
      'retention_policy text NOT NULL',
      'UNIQUE (identity_key, signal_id)',
      'ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY',
      'CREATE POLICY "signals_select_own"',
      'CREATE POLICY "signals_insert_own"',
      'CREATE POLICY "signals_update_own"',
    ],
  },
];
const STORAGE_SCHEMA = {
  id: 'storageAssets',
  table: 'storage.objects',
  endpoint: '/storage/v1/object',
  schemaPath: 'database/schema/supabase-storage-v1.sql',
  requiredMarkers: [
    'INSERT INTO storage.buckets',
    "'nesio-product-assets'",
    'public = false',
    'CREATE POLICY "nesio_assets_select_own_prefix"',
    'CREATE POLICY "nesio_assets_insert_own_prefix"',
    'CREATE POLICY "nesio_assets_update_own_prefix"',
    'CREATE POLICY "nesio_assets_delete_own_prefix"',
  ],
};

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function envValue(key) {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function envReport(keys = REQUIRED_ENV) {
  return keys.map((key) => ({
    key,
    present: Boolean(envValue(key)),
    enabled: key === 'CLOUD_DB_ENABLED' || key === 'CLOUD_STORAGE_ENABLED'
      ? envValue(key).toLowerCase() === 'true'
      : undefined,
    value: envValue(key) ? '[redacted]' : '',
  }));
}

function envReady(report, enabledKey) {
  return report.every((entry) => (
    entry.key === enabledKey ? entry.present && entry.enabled === true : entry.present
  ));
}

function schemaReport(root) {
  const entries = [
    ...TABLES,
    STORAGE_SCHEMA,
  ];
  return Object.fromEntries(entries.map((entry) => {
    const absolutePath = path.join(root, entry.schemaPath);
    const exists = fs.existsSync(absolutePath);
    const source = exists ? fs.readFileSync(absolutePath, 'utf8') : '';
    const missingMarkers = entry.requiredMarkers.filter((marker) => !source.includes(marker));
    return [entry.id, {
      table: entry.table,
      endpoint: entry.endpoint,
      path: entry.schemaPath,
      exists,
      hasIdentityKey: source.includes('identity_key'),
      missingMarkers,
      ready: exists && missingMarkers.length === 0,
    }];
  }));
}

async function checkTable(config, entry) {
  const url = new URL(entry.endpoint, config.supabaseUrl);
  url.searchParams.set('select', entry.selectColumn || 'identity_key');
  url.searchParams.set('limit', '1');
  const response = await fetch(url, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  return {
    table: entry.table,
    ok: response.ok,
    status: response.status,
  };
}

async function checkStorageBucket(config) {
  const bucket = envValue('SUPABASE_STORAGE_BUCKET');
  const url = new URL(`/storage/v1/bucket/${encodeURIComponent(bucket)}`, config.supabaseUrl);
  const response = await fetch(url, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  return {
    ok: response.ok,
    status: response.status,
  };
}

async function networkReport(live) {
  if (!live) {
    return {
      checked: false,
      tables: [],
      storage: {
        checked: false,
        ok: true,
        status: 'offline',
      },
    };
  }

  const config = {
    supabaseUrl: envValue('SUPABASE_URL'),
    serviceRoleKey: envValue('SUPABASE_SERVICE_ROLE_KEY'),
  };

  if (!config.supabaseUrl || !config.serviceRoleKey) {
    return {
      checked: true,
      tables: TABLES.map((entry) => ({ table: entry.table, ok: false, status: 'missing_env' })),
      storage: {
        checked: true,
        ok: false,
        status: 'missing_env',
      },
    };
  }

  const tables = [];
  for (const entry of TABLES) {
    try {
      tables.push(await checkTable(config, entry));
    } catch {
      tables.push({ table: entry.table, ok: false, status: 'network_error' });
    }
  }

  let storage;
  if (!envValue('SUPABASE_STORAGE_BUCKET')) {
    storage = { checked: true, ok: false, status: 'missing_env' };
  } else {
    try {
      storage = { checked: true, ...(await checkStorageBucket(config)) };
    } catch {
      storage = { checked: true, ok: false, status: 'network_error' };
    }
  }

  return {
    checked: true,
    tables,
    storage,
  };
}

function storageReport() {
  return {
    bucket: envValue('SUPABASE_STORAGE_BUCKET') ? '[redacted]' : '',
    bucketConfigured: Boolean(envValue('SUPABASE_STORAGE_BUCKET')),
    implementation: 'supabase-storage',
    sideEffects: false,
  };
}

function buildIssueCounts({ requiredEnv, schemaFiles, network }) {
  const missingEnv = requiredEnv.filter((entry) => (
    !entry.present || (entry.enabled === false)
  )).length;
  const missingSchemaMarkers = Object.values(schemaFiles).reduce(
    (count, entry) => count + (entry.missingMarkers?.length || 0),
    0,
  );
  const blockedTables = network.checked
    ? network.tables.filter((entry) => !entry.ok).length
    : 0;
  const storageBlocked = network.storage?.checked && !network.storage.ok ? 1 : 0;

  return {
    missingEnv,
    missingSchemaMarkers,
    blockedTables,
    storageBlocked,
  };
}

function buildOperatorActions({ databaseEnvReady, storageEnvReady, schemaFilesReady, storage, network, issueCounts }) {
  const actions = [];
  const missingEnvKeys = REQUIRED_ENV.filter((key) => !envValue(key));
  const disabledRuntimeFlags = ['CLOUD_DB_ENABLED', 'CLOUD_STORAGE_ENABLED']
    .filter((key) => envValue(key) && envValue(key).toLowerCase() !== 'true');

  if (missingEnvKeys.length > 0) {
    actions.push({
      action: 'set_backend_env',
      reason: 'required Supabase backend env is missing',
      owner: 'operator',
      requiresCeoGate: true,
      evidence: {
        missingEnvKeys,
      },
    });
  }

  if (disabledRuntimeFlags.length > 0 || !databaseEnvReady || !storageEnvReady) {
    actions.push({
      action: 'enable_cloud_runtime_flags',
      reason: 'cloud database and storage runtime flags must be explicitly enabled',
      owner: 'operator',
      requiresCeoGate: true,
      evidence: {
        disabledRuntimeFlags,
        databaseEnvReady,
        storageEnvReady,
      },
    });
  }

  if (!schemaFilesReady) {
    const blockedSchemas = Object.values(schemaFiles)
      .filter((entry) => !entry.ready)
      .map((entry) => ({
        table: entry.table,
        path: entry.path,
        missingMarkerCount: entry.missingMarkers.length,
      }));
    actions.push({
      action: 'apply_supabase_schema_sql',
      reason: 'schema files are missing required Backend v1 markers',
      owner: 'operator',
      requiresCeoGate: true,
      evidence: {
        blockedSchemas,
        missingSchemaMarkers: issueCounts.missingSchemaMarkers,
      },
    });
  }

  if (!storage.bucketConfigured) {
    actions.push({
      action: 'create_supabase_storage_bucket',
      reason: 'Supabase Storage bucket name is not configured',
      owner: 'operator',
      requiresCeoGate: true,
      evidence: {
        bucketConfigured: false,
      },
    });
  }

  if (network.checked && issueCounts.blockedTables > 0) {
    actions.push({
      action: 'fix_supabase_table_reachability',
      reason: 'one or more Backend v1 tables are not reachable through Supabase REST',
      owner: 'operator',
      requiresCeoGate: true,
      evidence: {
        blockedTables: network.tables.filter((entry) => !entry.ok),
      },
    });
  }

  if (network.storage?.checked && !network.storage.ok) {
    actions.push({
      action: 'fix_supabase_storage_reachability',
      reason: 'configured Supabase Storage bucket is not reachable',
      owner: 'operator',
      requiresCeoGate: true,
      evidence: {
        storage: network.storage,
      },
    });
  }

  return actions;
}

function humanSummary(report) {
  const lines = [
    `${report.version}`,
    `mode: ${report.mode}`,
    `databaseEnvReady: ${report.summary.databaseEnvReady}`,
    `storageEnvReady: ${report.summary.storageEnvReady}`,
    `schemaFilesReady: ${report.summary.schemaFilesReady}`,
    `networkChecked: ${report.summary.networkChecked}`,
    `readyToEnableCloudDb: ${report.summary.readyToEnableCloudDb}`,
    `readyToEnableCloudStorage: ${report.summary.readyToEnableCloudStorage}`,
    `readyForProductBackend: ${report.summary.readyForProductBackend}`,
    `issueCounts: missingEnv=${report.issueCounts.missingEnv}, missingSchemaMarkers=${report.issueCounts.missingSchemaMarkers}, blockedTables=${report.issueCounts.blockedTables}, storageBlocked=${report.issueCounts.storageBlocked}`,
  ];
  for (const env of report.requiredEnv) {
    lines.push(`env ${env.key}: ${env.present ? 'present' : 'missing'}`);
  }
  for (const schema of Object.values(report.schemaFiles)) {
    lines.push(`schema ${schema.table}: ${schema.ready ? 'ready' : `missing ${schema.missingMarkers.join(', ')}`}`);
  }
  for (const table of report.network.tables) {
    lines.push(`table ${table.table}: ${table.ok ? 'reachable' : `blocked ${table.status}`}`);
  }
  lines.push(`storage bucket: ${report.storage.bucketConfigured ? 'configured' : 'missing'}`);
  if (report.network.storage?.checked) {
    lines.push(`storage network: ${report.network.storage.ok ? 'reachable' : `blocked ${report.network.storage.status}`}`);
  }
  for (const action of report.operatorActions) {
    lines.push(`operatorAction ${action.action}: ${action.reason}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const root = process.cwd();
  const live = hasFlag('--live');
  const schemaFiles = schemaReport(root);
  const databaseRequiredEnv = envReport(DATABASE_REQUIRED_ENV);
  const storageRequiredEnv = envReport(STORAGE_REQUIRED_ENV);
  const requiredEnv = envReport();
  const network = await networkReport(live);
  const storage = storageReport();
  if (envValue('SUPABASE_STORAGE_BUCKET')) {
    storage.bucket = envValue('SUPABASE_STORAGE_BUCKET');
  }
  const databaseEnvReady = envReady(databaseRequiredEnv, 'CLOUD_DB_ENABLED');
  const storageEnvReady = envReady(storageRequiredEnv, 'CLOUD_STORAGE_ENABLED');
  const schemaFilesReady = Object.values(schemaFiles).every((entry) => entry.ready);
  const databaseNetworkReady = !network.checked || network.tables.every((entry) => entry.ok);
  const storageNetworkReady = !network.storage?.checked || network.storage.ok;
  const issueCounts = buildIssueCounts({ requiredEnv, schemaFiles, network });
  const operatorActions = buildOperatorActions({
    databaseEnvReady,
    storageEnvReady,
    schemaFilesReady,
    storage,
    network,
    issueCounts,
  });
  const report = {
    version: VERSION,
    safePublicStatus: true,
    secretsRedacted: true,
    mode: live ? 'live' : 'offline',
    requiredEnv,
    databaseRequiredEnv,
    storageRequiredEnv,
    schemaFiles,
    storage,
    network,
    issueCounts,
    operatorActions,
    summary: {
      databaseEnvReady,
      storageEnvReady,
      schemaFilesReady,
      networkChecked: network.checked,
      databaseNetworkReady,
      storageNetworkReady,
      networkReady: databaseNetworkReady && storageNetworkReady,
      readyToEnableCloudDb: databaseEnvReady && schemaFilesReady && databaseNetworkReady,
      readyToEnableCloudStorage: storageEnvReady && storage.bucketConfigured && storageNetworkReady,
      readyForProductBackend: databaseEnvReady
        && storageEnvReady
        && schemaFilesReady
        && databaseNetworkReady
        && storage.bucketConfigured
        && storageNetworkReady,
    },
  };

  if (hasFlag('--json')) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(humanSummary(report));
  }

  if (hasFlag('--strict') && !report.summary.readyForProductBackend) {
    process.exitCode = 1;
  }
}

main();
