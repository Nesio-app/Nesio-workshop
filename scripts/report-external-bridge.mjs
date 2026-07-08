import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadExternalBridgeContract } from '../lib/portal/contracts/external-bridge-contract.mjs';

const DB_PATH = process.env.BAOHE_DB_PATH
  || join(process.cwd(), 'database', 'treasurebox-local.db');

function parseMetadata(rawValue, fallback = {}) {
  if (typeof rawValue !== 'string') return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function loadConnectionState() {
  if (!existsSync(DB_PATH)) {
    return {
      ok: false,
      reason: 'sqlite file not found, run db:migrate/seed first',
      providerStates: [],
    };
  }

  let db = null;
  try {
    db = new DatabaseSync(DB_PATH, { readonly: true });
    const rows = db.prepare(`
      SELECT
        connection_id,
        provider,
        connection_type,
        status,
        environment,
        is_enabled,
        metadata_json
      FROM external_connection
      ORDER BY connection_id
    `).all();

    const providerStates = rows.map((row) => ({
      id: row.connection_id,
      provider: row.provider,
      connectionType: row.connection_type,
      status: row.status,
      environment: row.environment,
      isEnabled: Boolean(row.is_enabled),
      metadata: parseMetadata(row.metadata_json, {}),
    }));

    return {
      ok: true,
      reason: 'loaded',
      providerStates,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'unknown sqlite read error',
      providerStates: [],
    };
  } finally {
    db?.close();
  }
}

function enrichWithDbState(contract) {
  const state = loadConnectionState();
  if (!state.ok) return contract;
  const stateMap = new Map(state.providerStates.map((entry) => [entry.provider, entry]));

  const externalModules = contract.modules.map((module) => ({
    ...module,
    dbConnection: stateMap.get(module.providerId) || null,
  }));

  return {
    ...contract,
    boundaries: {
      ...contract.boundaries,
      dbBacked: state.ok,
    },
    dbState: {
      ok: state.ok,
      reason: state.reason,
      providerStates: state.providerStates,
    },
    modules: externalModules,
  };
}

function toMarkdown(contract) {
  const lines = [];
  lines.push(`# External Bridge Contract Snapshot`);
  lines.push('');
  lines.push(`Generated: ${contract.generatedAt}`);
  lines.push(`Implementation: ${contract.implementation}`);
  lines.push(`External modules: ${contract.summary.moduleCount}`);
  lines.push(`Owned external keys: ${contract.summary.externalDataKeyOwnedCount}`);
  lines.push(`Consumed external keys: ${contract.summary.externalDataKeyConsumedCount}`);
  lines.push('');
  lines.push('## Phase plan');
  for (const phase of contract.phases) {
    lines.push(`- ${phase.phase}/${phase.name}: ${phase.goal} (${phase.done ? 'done' : 'planned'})`);
  }
  lines.push('');
  lines.push('## Modules');
  for (const module of contract.modules) {
    const owned = module.ownsData.length ? module.ownsData.join(', ') : 'none';
    const consumed = module.consumesData.length ? module.consumesData.join(', ') : 'none';
    const dbState = module.dbConnection
      ? `${module.dbConnection.status} (${module.dbConnection.environment}, enabled=${module.dbConnection.isEnabled})`
      : 'missing';
    lines.push(`- **${module.moduleId}** / ${module.providerLabel} (${module.connectionType}, ${module.authModel})`);
    lines.push(`  - owned: ${owned}`);
    lines.push(`  - consumed: ${consumed}`);
    if (module.moduleUrl) {
      lines.push(`  - entry url: ${module.moduleUrl}`);
    }
    lines.push(`  - db state: ${dbState}`);
    lines.push(`  - next: ${module.notes}`);
  }

  lines.push('');
  lines.push('## Boundary guardrails');
  lines.push(`- local-first: ${contract.boundaries.localFirst}`);
  lines.push(`- offline default: ${contract.boundaries.offlineDefault}`);
  lines.push(`- writes real external data: ${contract.boundaries.writesRealExternalData}`);
  lines.push(`- needs explicit CEO gate: ${contract.boundaries.requiresExplicitCeoGate}`);
  lines.push(`- runtime auth required: ${contract.boundaries.requiresRuntimeAuth}`);

  if (contract.risk && contract.risk.length > 0) {
    lines.push('');
    lines.push('## Risks');
    for (const risk of contract.risk) {
      lines.push(`- ${risk}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const contract = loadExternalBridgeContract(process.cwd());
  const merged = enrichWithDbState(contract);
  const out = process.argv.includes('--markdown')
    ? toMarkdown(merged)
    : JSON.stringify(merged, null, 2);
  console.log(out);
}

main();
