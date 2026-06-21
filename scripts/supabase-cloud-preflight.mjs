import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const VERSION = 'supabase-cloud-preflight-v0';
const REQUIRED_ENV = [
  'CLOUD_DB_ENABLED',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const TABLES = [
  {
    id: 'profileSettings',
    table: 'profile_settings',
    endpoint: '/rest/v1/profile_settings',
    schemaPath: 'database/schema/supabase-profile-settings-v1.sql',
    requiredMarkers: ['identity_key text PRIMARY KEY', 'user_id uuid REFERENCES auth.users', 'settings jsonb'],
  },
  {
    id: 'inventoryItems',
    table: 'inventory_items',
    endpoint: '/rest/v1/inventory_items',
    schemaPath: 'database/schema/supabase-inventory-items-v1.sql',
    requiredMarkers: ['identity_key text NOT NULL', 'UNIQUE (identity_key, local_id)', 'item jsonb'],
  },
];

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function envValue(key) {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function envReport() {
  return REQUIRED_ENV.map((key) => ({
    key,
    present: Boolean(envValue(key)),
    enabled: key === 'CLOUD_DB_ENABLED' ? envValue(key).toLowerCase() === 'true' : undefined,
    value: envValue(key) ? '[redacted]' : '',
  }));
}

function schemaReport(root) {
  return Object.fromEntries(TABLES.map((entry) => {
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
  url.searchParams.set('select', 'identity_key');
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

async function networkReport(live) {
  if (!live) {
    return {
      checked: false,
      tables: [],
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

  return {
    checked: true,
    tables,
  };
}

function humanSummary(report) {
  const lines = [
    `${report.version}`,
    `mode: ${report.mode}`,
    `envReady: ${report.summary.envReady}`,
    `schemaFilesReady: ${report.summary.schemaFilesReady}`,
    `networkChecked: ${report.summary.networkChecked}`,
    `readyToEnableCloudDb: ${report.summary.readyToEnableCloudDb}`,
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
  return `${lines.join('\n')}\n`;
}

async function main() {
  const root = process.cwd();
  const live = hasFlag('--live');
  const schemaFiles = schemaReport(root);
  const requiredEnv = envReport();
  const network = await networkReport(live);
  const envReady = requiredEnv.every((entry) => (
    entry.key === 'CLOUD_DB_ENABLED' ? entry.present && entry.enabled === true : entry.present
  ));
  const schemaFilesReady = Object.values(schemaFiles).every((entry) => entry.ready);
  const networkReady = !network.checked || network.tables.every((entry) => entry.ok);
  const report = {
    version: VERSION,
    safePublicStatus: true,
    secretsRedacted: true,
    mode: live ? 'live' : 'offline',
    requiredEnv,
    schemaFiles,
    network,
    summary: {
      envReady,
      schemaFilesReady,
      networkChecked: network.checked,
      networkReady,
      readyToEnableCloudDb: envReady && schemaFilesReady && networkReady,
    },
  };

  if (hasFlag('--json')) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(humanSummary(report));
  }

  if (hasFlag('--strict') && !report.summary.readyToEnableCloudDb) {
    process.exitCode = 1;
  }
}

main();
