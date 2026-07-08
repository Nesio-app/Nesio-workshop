import { readFileSync, readdirSync } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { buildModuleRegistry } from '../lib/portal/module-manager-core.mjs';
import { MODULE_DATA_KEY_OWNERSHIP_V1 } from '../lib/portal/module-manager-core.mjs';
import { loadExternalBridgeContract } from '../lib/portal/contracts/external-bridge-contract.mjs';

const dbPath = process.env.BAOHE_DB_PATH || join(process.cwd(), 'database', 'treasurebox-local.db');
const migrationsRoot = join(process.cwd(), 'database', 'migrations');

const usage = `
Usage:
  node scripts/db-local.mjs migrate          # apply pending migrations
  node scripts/db-local.mjs down             # rollback last applied migration
  node scripts/db-local.mjs seed-demo        # seed demo module registry + demo rows
  node scripts/db-local.mjs status           # print db file + applied migrations
  node scripts/db-local.mjs probe            # alias of status for quick health check
  node scripts/db-local.mjs flow             # print module-level data flow graph from sqlite
  node scripts/db-local.mjs queue            # print operational queue snapshot (needsCeo/handoff/gate)
  node scripts/db-local.mjs sync-artifact-records # sync artifact/handoff/gate records from local report
`;

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function parseString(value) {
  return typeof value === 'string' ? value : '';
}

function shellModeAvailabilityForModule(module, hasGateKeys) {
  const availability = module.ready ? 'available' : 'not_ready';
  const gated = hasGateKeys ? 'gated' : availability;
  return {
    personal: gated,
    demo: availability,
    market: availability,
  };
}

function shellEntryStatusForModule(module, hasGateKeys) {
  if (!module.id) return 'unconnected';
  if (!module.ready) return 'not_ready';
  if (module.origin === 'external') return 'external';
  if (hasGateKeys) return 'gated';
  return 'ready';
}

function shellEmptyStateForRoute(entryStatus) {
  if (entryStatus === 'unconnected') return 'module_not_connected';
  if (entryStatus === 'not_ready') return 'module_not_ready';
  if (entryStatus === 'external') return 'external_module';
  if (entryStatus === 'gated') return 'approval_required';
  return null;
}

function shellRouteEvidenceLinks() {
  return [
    { kind: 'module_manager', artifact: 'lib/portal/module-manager-core.mjs' },
    { kind: 'spec', artifact: 'outputs/2026-06-15-shell-route-contract-v0-spec.md' },
  ];
}

function buildShellRoutePayload(module) {
  const approvalGateKeys = uniqueSorted((module.approvalRequiredActions || []).map(parseString).filter(Boolean));
  const hasGateKeys = approvalGateKeys.length > 0;
  const entryStatus = shellEntryStatusForModule(module, hasGateKeys);
  const modeAvailability = shellModeAvailabilityForModule(module, hasGateKeys);

  return {
    routeKey: `${module.id}_open`,
    moduleId: module.id,
    labelZh: parseString(module.name),
    labelEn: parseString(module.nameEn),
    personalModeAvailability: modeAvailability.personal,
    demoModeAvailability: modeAvailability.demo,
    marketModeAvailability: modeAvailability.market,
    entryStatus,
    emptyStateKey: shellEmptyStateForRoute(entryStatus),
    requiredCapabilities: uniqueSorted([
      ...(module.allowedActions || []).map(parseString),
      ...(module.consumedData || []).map(parseString),
    ].filter(Boolean)),
    approvalGateKeys,
    evidenceLinks: shellRouteEvidenceLinks(),
  };
}

function sortedSqlFiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => !name.endsWith('_down.sql'))
    .sort();
}

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function connectDb() {
  ensureDir(dirname(dbPath));
  return new DatabaseSync(dbPath);
}

function ensureMigrationMeta(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function appliedMigrations(db) {
  const rows = db.prepare('SELECT filename FROM schema_migrations ORDER BY rowid ASC').all();
  return rows.map((row) => row.filename);
}

function runSqlFile(db, path) {
  const sql = readFileSync(path, 'utf8');
  db.exec(sql);
}

function commandMigrate() {
  const db = connectDb();
  try {
    ensureMigrationMeta(db);
    const existing = new Set(appliedMigrations(db));
    const files = sortedSqlFiles(migrationsRoot);
    const toApply = files.filter((name) => !existing.has(name));

    if (toApply.length === 0) {
      console.log('database: no pending migrations');
      return;
    }

    const mark = db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)');
    for (const name of toApply) {
      const filePath = join(migrationsRoot, name);
      runSqlFile(db, filePath);
      mark.run(name);
      console.log(`database: migrated ${name}`);
    }
    console.log('database: migrate complete');
  } finally {
    db.close();
  }
}

function commandDown() {
  const db = connectDb();
  try {
    ensureMigrationMeta(db);
    const rows = db.prepare('SELECT filename FROM schema_migrations ORDER BY rowid DESC').all();
    if (rows.length === 0) {
      console.log('database: no migrations to rollback');
      return;
    }

    const latest = rows[0].filename;
    const downName = `${basename(latest, '.sql')}_down.sql`;
    const downPath = join(migrationsRoot, downName);
    if (!existsSync(downPath)) {
      throw new Error(`missing rollback file: ${downName}`);
    }

    runSqlFile(db, downPath);
    db.prepare('DELETE FROM schema_migrations WHERE filename = ?').run(latest);
    console.log(`database: rolled back ${latest}`);
  } finally {
    db.close();
  }
}

function commandSeedDemo() {
  const db = connectDb();
  const config = JSON.parse(readFileSync('public/portal-config.json', 'utf8'));
  const moduleRegistry = buildModuleRegistry(config);
  const modules = moduleRegistry.modules || [];
  const ownership = MODULE_DATA_KEY_OWNERSHIP_V1.keys || {};
  const externalBridgeContract = loadExternalBridgeContract(process.cwd());
  const externalModules = externalBridgeContract.modules || [];

  const stmtModule = db.prepare(`
    INSERT INTO module_registry (
      module_id, name, name_en, description, zone, hotkey, command, featured, icon,
      owner, maintainer, responsible_agent, evidence_owner, gate_owner, ready,
      origin, route_kind, configured_url, normalized_path, open_href, return_href, public_index_path
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(module_id) DO UPDATE SET
      name = excluded.name,
      name_en = excluded.name_en,
      description = excluded.description,
      zone = excluded.zone,
      hotkey = excluded.hotkey,
      command = excluded.command,
      featured = excluded.featured,
      icon = excluded.icon,
      owner = excluded.owner,
      maintainer = excluded.maintainer,
      responsible_agent = excluded.responsible_agent,
      evidence_owner = excluded.evidence_owner,
      gate_owner = excluded.gate_owner,
      ready = excluded.ready,
      origin = excluded.origin,
      route_kind = excluded.route_kind,
      configured_url = excluded.configured_url,
      normalized_path = excluded.normalized_path,
      open_href = excluded.open_href,
      return_href = excluded.return_href,
      public_index_path = excluded.public_index_path,
      updated_at = CURRENT_TIMESTAMP
  `);
  const stmtCap = db.prepare(`
    INSERT INTO module_data_contract (module_id, contract_type, value)
    VALUES (?, ?, ?)
    ON CONFLICT(module_id, contract_type, value) DO NOTHING
  `);
  const stmtOwnership = db.prepare(`
    INSERT INTO data_key_ownership (
      data_key, owner_module_id, sharing_kind, scope,
      expected_producers_json, expected_consumers_json, policy_source, rationale
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_key) DO UPDATE SET
      owner_module_id = excluded.owner_module_id,
      sharing_kind = excluded.sharing_kind,
      scope = excluded.scope,
      expected_producers_json = excluded.expected_producers_json,
      expected_consumers_json = excluded.expected_consumers_json,
      policy_source = excluded.policy_source,
      rationale = excluded.rationale,
      updated_at = CURRENT_TIMESTAMP
  `);
  const stmtArtifact = db.prepare(`
    INSERT INTO artifact_record (
      artifact_id, artifact_path, title, artifact_kind, owner, state, next_owner,
      next_step, resume_action, blocker, needs_ceo_gate, primary_action_kind,
      visibility_priority, source_verified, handoff_parsed, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_path) DO UPDATE SET
      title = excluded.title,
      owner = excluded.owner,
      state = excluded.state,
      next_owner = excluded.next_owner,
      next_step = excluded.next_step,
      resume_action = excluded.resume_action,
      blocker = excluded.blocker,
      needs_ceo_gate = excluded.needs_ceo_gate,
      primary_action_kind = excluded.primary_action_kind,
      visibility_priority = excluded.visibility_priority,
      source_verified = excluded.source_verified,
      handoff_parsed = excluded.handoff_parsed,
      updated_at = CURRENT_TIMESTAMP
  `);
  const stmtArtifactDedup = db.prepare(`
    INSERT OR IGNORE INTO handoff_record (
      handoff_id, artifact_id, artifact_path, artifact_title, status, from_agent,
      to_agents_json, next_owner, reason, resume_action, blocker, needs_ceo_gate,
      source_verified, parsed_at, dedupe_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtGate = db.prepare(`
    INSERT OR IGNORE INTO gate_decision (
      gate_id, artifact_id, source, category, status, owner, reason, blocker,
      needs_ceo_gate, source_verified, qa_status, dedupe_key, evidence_ref
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtSprint = db.prepare(`
    INSERT OR IGNORE INTO sprint_status (
      sprint_id, module_id, sprint_name, status, owner, summary, queue_rank
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtEvent = db.prepare(`
    INSERT OR REPLACE INTO event_log (event_id, module_id, event_type, actor, payload_json, artifact_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const stmtPreference = db.prepare(`
    INSERT OR REPLACE INTO user_preference (scope, owner, preference_key, preference_value, sensitive_level)
    VALUES (?, ?, ?, ?, ?)
  `);
  const stmtDemoSeed = db.prepare(`
    INSERT OR REPLACE INTO demo_seed (seed_id, seed_scope, seed_key, seed_value, owner)
    VALUES (?, ?, ?, ?, ?)
  `);
  const stmtExternal = db.prepare(`
    INSERT OR REPLACE INTO external_connection (connection_id, provider, connection_type, status, environment, is_enabled, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtShellRoute = db.prepare(`
    INSERT INTO shell_route_registry (
      route_key, module_id, label_zh, label_en,
      personal_mode_availability, demo_mode_availability, market_mode_availability,
      entry_status, empty_state_key, required_capabilities_json, approval_gate_keys_json,
      evidence_links_json, is_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(route_key) DO UPDATE SET
      module_id = excluded.module_id,
      label_zh = excluded.label_zh,
      label_en = excluded.label_en,
      personal_mode_availability = excluded.personal_mode_availability,
      demo_mode_availability = excluded.demo_mode_availability,
      market_mode_availability = excluded.market_mode_availability,
      entry_status = excluded.entry_status,
      empty_state_key = excluded.empty_state_key,
      required_capabilities_json = excluded.required_capabilities_json,
      approval_gate_keys_json = excluded.approval_gate_keys_json,
      evidence_links_json = excluded.evidence_links_json,
      is_active = excluded.is_active,
      updated_at = CURRENT_TIMESTAMP
  `);

  try {
    // Clear old module contracts before reseed to avoid stale keys.
    db.exec('DELETE FROM module_data_contract;');
    db.exec('DELETE FROM artifact_record;');
    db.exec('DELETE FROM handoff_record;');
    db.exec('DELETE FROM gate_decision;');
    db.exec('DELETE FROM external_connection;');
    db.exec('DELETE FROM shell_route_registry;');

    for (const module of modules) {
      stmtModule.run(
        module.id,
        module.name,
        module.nameEn || null,
        module.description || null,
        module.zone || null,
        module.hotkey || null,
        module.command || null,
        module.featured === true ? 1 : 0,
        module.icon || null,
        module.owner || null,
        module.maintainer || null,
        module.responsibleAgent || module.responsible_agent || null,
        module.evidenceOwner || module.evidence_owner || null,
        module.gateOwner || module.gate_owner || null,
        module.ready === true ? 1 : 0,
        module.origin || 'local',
        module.routeKind || module.route_kind || 'local-static-module',
        module.configuredUrl || null,
        module.normalizedPath || null,
        module.openHref || null,
        module.returnHref || null,
        module.publicIndexPath || null,
      );

      for (const value of [...new Set(module.ownedData || [])]) {
        stmtCap.run(module.id, 'owned_data', value.toLowerCase());
      }
      for (const value of [...new Set(module.consumedData || [])]) {
        stmtCap.run(module.id, 'consumed_data', value.toLowerCase());
      }
      for (const value of [...new Set(module.emittedEvents || [])]) {
        stmtCap.run(module.id, 'emitted_event', value);
      }
      for (const value of [...new Set(module.allowedActions || [])]) {
        stmtCap.run(module.id, 'allowed_action', value);
      }
      for (const value of [...new Set(module.approvalRequiredActions || [])]) {
        stmtCap.run(module.id, 'approval_required_action', value);
      }

      const route = buildShellRoutePayload(module);
      stmtShellRoute.run(
        route.routeKey,
        module.id,
        route.labelZh || null,
        route.labelEn || null,
        route.personalModeAvailability,
        route.demoModeAvailability,
        route.marketModeAvailability,
        route.entryStatus,
        route.emptyStateKey || null,
        JSON.stringify(route.requiredCapabilities),
        JSON.stringify(route.approvalGateKeys),
        JSON.stringify(route.evidenceLinks),
        1,
      );
    }

    for (const [dataKey, item] of Object.entries(ownership)) {
      stmtOwnership.run(
        dataKey,
        item.ownerModuleId,
        item.sharingKind,
        item.scope,
        JSON.stringify(item.expectedProducers || []),
        JSON.stringify(item.expectedConsumers || []),
        item.source || 'explicit',
        item.rationale || null,
      );
    }

    stmtArtifact.run(
      'artifact:local-db-seed',
      '2026-06-16/baohe-module-data-db-seed',
      'Baohe module-data network DB seed',
      'report',
      'du',
      'active',
      'qiao',
      'Use schema v1 as local fixture',
      'Seed minimal module-data network entities for local DB.',
      0,
      'view_detail',
      0,
      1,
      1,
      new Date().toISOString(),
      new Date().toISOString(),
    );

    stmtArtifactDedup.run(
      'handoff:seed:artifact:local-db-seed',
      'artifact:local-db-seed',
      '2026-06-16/baohe-module-data-db-seed',
      'Baohe module-data network DB seed',
      'queued',
      'du',
      JSON.stringify(['qiao']),
      'qiao',
      'Continue local db-backed dashboard integration.',
      null,
      0,
      1,
      new Date().toISOString(),
      'artifact:local-db-seed:qiao',
    );

    stmtGate.run(
      'gate:seed:module-data-db',
      'artifact:local-db-seed',
      'artifact_status_visibility_v02',
      'real_db',
      'waiting_ceo',
      'CEO',
      'No external DB writes; local sqlite only.',
      'Local db proof of concept only.',
      1,
      1,
      'needs_ceo_decision',
      'gate:seed:module-data-db',
      'artifactStatusVisibility:local-db-seed',
    );

    stmtSprint.run('sprint:module-data-db', modules[0]?.id || 'system', 'Local DB Seed Sprint', 'active', 'Du', 'Keep schema + seed fresh.', 1);
    stmtEvent.run(
      'event:seed:module-data-db',
      modules[0]?.id || null,
      'db.seed',
      'Du',
      JSON.stringify({ command: 'db-local.seed-demo', moduleCount: modules.length }),
      '2026-06-16/baohe-module-data-db-seed',
    );
    stmtPreference.run('demo', 'du', 'demo_mode', 'enabled', 'low');
    stmtDemoSeed.run('seed:module:data', 'module-network', 'owner', 'du', 'du');
    for (const module of externalModules) {
      const connectionId = `conn:${module.moduleId}`;
      stmtExternal.run(
        connectionId,
        module.providerId,
        module.connectionType,
        'disabled',
        'local',
        0,
        JSON.stringify({
          moduleId: module.moduleId,
          moduleLabel: module.moduleLabel,
          moduleUrl: module.moduleUrl || null,
          authModel: module.authModel,
          expectedSurface: module.expectedSurface || [],
          notes: module.notes || null,
          source: 'external-bridge-contract-v0',
        }),
      );
    }
    console.log(`database: seeded demo data for ${modules.length} modules`);
    if (externalModules.length > 0) {
      console.log(`database: seeded ${externalModules.length} external connection profiles`);
    }
  } finally {
    db.close();
  }
}

function commandStatus() {
  const exists = existsSync(dbPath);
  if (!exists) {
    console.log(`database: not initialized at ${dbPath}`);
    return;
  }
  const db = connectDb();
  try {
    const metaRows = db.prepare('SELECT value FROM db_meta WHERE key = ?').all('schema_version');
    const migrationRows = db.prepare('SELECT filename, applied_at FROM schema_migrations ORDER BY rowid ASC').all();
    const moduleCount = db.prepare('SELECT COUNT(*) AS c FROM module_registry').get().c;
    const artifactCount = db.prepare('SELECT COUNT(*) AS c FROM artifact_record').get().c;
    const gateCount = db.prepare('SELECT COUNT(*) AS c FROM gate_decision').get().c;
    console.log(`database: path=${dbPath}`);
    console.log(`database: schema_version=${metaRows[0]?.value || 'unknown'}`);
    console.log(`database: migrations=${migrationRows.length}`);
    console.log(`database: modules=${moduleCount}, artifacts=${artifactCount}, gates=${gateCount}`);
    if (migrationRows.length > 0) {
      console.log('database: migration list:');
      for (const row of migrationRows) {
        console.log(`- ${row.filename} @ ${row.applied_at}`);
      }
    }
  } finally {
    db.close();
  }
}

function commandProbe() {
  commandStatus();
}

function commandFlow() {
  const db = connectDb();
  try {
    const moduleRows = db.prepare('SELECT module_id, name, origin FROM module_registry ORDER BY module_id').all();
    const dataOwnershipRows = db.prepare(`
      SELECT data_key, sharing_kind, scope
      FROM data_key_ownership
    `).all();

    const ownershipMap = new Map(dataOwnershipRows.map((row) => [
      row.data_key,
      {
        sharingKind: row.sharing_kind,
        scope: row.scope,
      },
    ]));

    const edgesRaw = db.prepare(`
      SELECT
        owner.module_id AS from_module_id,
        consumer.module_id AS to_module_id,
        owner.value AS data_key,
        COALESCE(owner_registry.origin, 'local') AS from_origin,
        COALESCE(consumer_registry.origin, 'local') AS to_origin
      FROM module_data_contract owner
      JOIN module_data_contract consumer
        ON consumer.contract_type = 'consumed_data'
       AND consumer.value = owner.value
      LEFT JOIN module_registry owner_registry
        ON owner_registry.module_id = owner.module_id
      LEFT JOIN module_registry consumer_registry
        ON consumer_registry.module_id = consumer.module_id
      WHERE owner.contract_type = 'owned_data'
        AND owner.module_id != consumer.module_id
      ORDER BY owner.value, owner.module_id, consumer.module_id
    `).all();

    const moduleDegreeMap = new Map();
    for (const module of moduleRows) {
      moduleDegreeMap.set(module.module_id, {
        moduleId: module.module_id,
        name: module.name,
        origin: module.origin,
        out: 0,
        in: 0,
      });
    }

    const edges = edgesRaw.map((edge) => {
      const ownership = ownershipMap.get(edge.data_key);
      const sharingKind = ownership?.sharingKind || 'inferred';
      const scope = ownership?.scope || 'owned_or_local_contract';
      const fromNode = moduleDegreeMap.get(edge.from_module_id);
      const toNode = moduleDegreeMap.get(edge.to_module_id);

      if (fromNode) fromNode.out += 1;
      if (toNode) toNode.in += 1;

      const risk = edge.from_origin === 'external' || edge.to_origin === 'external'
        ? 'cross_boundary'
        : 'local_contract';

      return {
        fromModuleId: edge.from_module_id,
        toModuleId: edge.to_module_id,
        dataKey: edge.data_key,
        fromOrigin: edge.from_origin,
        toOrigin: edge.to_origin,
        sharingKind,
        scope,
        relation: 'producer_to_consumer',
        risk,
      };
    });

    const modules = [...moduleDegreeMap.values()]
      .sort((a, b) => a.moduleId.localeCompare(b.moduleId));

    const sharedEdges = edges.filter((edge) => edge.sharingKind === 'shared');
    const sharedDataKeys = [...new Set(sharedEdges.map((edge) => edge.dataKey))].sort();

    const interconnectPlan = {
      version: 'db-flow-v0',
      nodeCount: modules.length,
      edgeCount: edges.length,
      sharedEdgeCount: sharedEdges.length,
      sharedDataKeyCount: sharedDataKeys.length,
      criticalGapCount: edges.length === 0 ? 1 : 0,
      connectionReadyKeyCount: sharedEdges.length,
    };

    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      interconnectPlan,
      modules,
      sharedDataKeys,
      edges,
    }, null, 2));
  } finally {
    db.close();
  }
}

function commandQueue() {
  const db = connectDb();
  try {
    const needsCeoArtifacts = db.prepare(`
      SELECT
        artifact_id,
        artifact_path,
        title,
        owner,
        state,
        next_owner,
        next_step,
        resume_action,
        blocker,
        visibility_priority,
        source_verified,
        handoff_parsed,
        updated_at
      FROM artifact_record
      WHERE needs_ceo_gate = 1
      ORDER BY visibility_priority DESC, datetime(updated_at) DESC
    `).all();

    const handoffQueue = db.prepare(`
      SELECT
        h.handoff_id,
        h.artifact_path,
        h.artifact_title,
        h.from_agent,
        h.to_agents_json,
        h.status,
        h.next_owner,
        h.reason,
        h.blocker,
        h.needs_ceo_gate,
        h.source_verified,
        h.parsed_at,
        h.evidence_ref,
        a.state AS artifact_state,
        a.owner AS artifact_owner,
        a.title AS linked_artifact_title
      FROM handoff_record h
      JOIN artifact_record a
        ON a.artifact_id = h.artifact_id
      ORDER BY datetime(h.parsed_at) DESC, h.handoff_id ASC
    `).all();

    const gateQueue = db.prepare(`
      SELECT
        g.gate_id,
        g.artifact_id,
        g.category,
        g.status,
        g.owner,
        g.reason,
        g.blocker,
        g.needs_ceo_gate,
        g.qa_status,
        g.source_verified,
        g.evidence_ref,
        g.dedupe_key,
        g.updated_at,
        a.artifact_path,
        a.title AS artifact_title,
        a.owner AS artifact_owner,
        a.state AS artifact_state
      FROM gate_decision g
      JOIN artifact_record a
        ON a.artifact_id = g.artifact_id
      ORDER BY datetime(g.updated_at) DESC, g.gate_id ASC
    `).all();

    const handoffPending = handoffQueue.filter((entry) => entry.status !== 'closed').map((entry) => ({
      ...entry,
      to_agents: parseJsonArray(entry.to_agents_json, []),
    }));

    const handoffStatusCount = new Map();
    for (const entry of handoffQueue) {
      handoffStatusCount.set(entry.status, (handoffStatusCount.get(entry.status) || 0) + 1);
    }
    const gateStatusCount = new Map();
    for (const entry of gateQueue) {
      gateStatusCount.set(entry.status, (gateStatusCount.get(entry.status) || 0) + 1);
    }
    const needsCeoGateCount = gateQueue.filter((entry) => entry.needs_ceo_gate).length;

    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      counts: {
        needsCeoArtifactCount: needsCeoArtifacts.length,
        handoffCount: handoffQueue.length,
        handoffPendingCount: handoffPending.length,
        gateCount: gateQueue.length,
        needsCeoGateCount,
      },
      needsCeoArtifacts,
      handoffQueue: handoffPending.slice(0, 25),
      gateQueue,
      handoffStatusCount: Object.fromEntries(handoffStatusCount),
      gateStatusCount: Object.fromEntries(gateStatusCount),
    }, null, 2));
  } finally {
    db.close();
  }
}

function toDbBool(rawValue) {
  return rawValue === true || rawValue === 1 || rawValue === '1' || rawValue === 'true' ? 1 : 0;
}

function safeNow() {
  return new Date().toISOString();
}

function parseJsonArray(rawValue, fallback = []) {
  if (typeof rawValue !== 'string') return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return fallback;
    return parsed.map((entry) => (typeof entry === 'string' ? entry : '')).filter(Boolean);
  } catch {
    return fallback;
  }
}

const ALLOWED_ARTIFACT_STATES = new Set(['needs_ceo', 'blocked', 'QA', 'active', 'archived']);
const ALLOWED_ARTIFACT_KINDS = new Set(['engineering', 'qa', 'plan', 'spec', 'audit', 'inventory', 'report', 'archive', 'unknown']);
const DB_ARTIFACT_KINDS = new Set(['engineering', 'qa', 'plan', 'spec', 'audit', 'inventory', 'report', 'archive', 'unknown']);
const ALLOWED_HANDOFF_STATUS = new Set(['queued', 'waiting_ceo', 'open', 'closed']);
const ALLOWED_GATE_STATUS = new Set(['waiting_ceo', 'needs_attention', 'closed']);

function normalizeArtifactState(rawValue) {
  return ALLOWED_ARTIFACT_STATES.has(rawValue) ? rawValue : 'active';
}

function normalizeArtifactKind(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (normalized === 'inventory') return DB_ARTIFACT_KINDS.has('inventory') ? 'inventory' : 'unknown';
  return ALLOWED_ARTIFACT_KINDS.has(normalized) && DB_ARTIFACT_KINDS.has(normalized) ? normalized : 'unknown';
}

function normalizeStatus(rawValue, allowedValues, fallbackValue) {
  return allowedValues.has(rawValue) ? rawValue : fallbackValue;
}

function buildArtifactId(record) {
  const id = String(record?.id || record?.artifactId || '').trim();
  if (id) return id;
  const artifactPath = String(record?.artifactPath || '').trim();
  return artifactPath ? `artifact:${artifactPath}` : `artifact:${safeNow()}`;
}

function commandSyncArtifactRecords() {
  const reportResult = spawnSync('node', ['scripts/report-module-registry.mjs'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (reportResult.status !== 0) {
    throw new Error(`local report generation failed: ${reportResult.status} ${(reportResult.stderr || '').trim()}`);
  }

  let report;
  try {
    report = JSON.parse(reportResult.stdout);
  } catch {
    throw new Error('local report output is not valid JSON');
  }
  const localDataRecords = report?.localDataRecords;
  const artifactRecords = Array.isArray(localDataRecords?.artifactRecords) ? localDataRecords.artifactRecords : [];
  const handoffRecords = Array.isArray(localDataRecords?.handoffRecords) ? localDataRecords.handoffRecords : [];
  const gateRecords = Array.isArray(localDataRecords?.gateRecords) ? localDataRecords.gateRecords : [];

  if (artifactRecords.length === 0) {
    console.log('database: sync-artifact-records skipped (no artifact records in report)');
    return;
  }

  const db = connectDb();
  try {
    db.exec('BEGIN IMMEDIATE TRANSACTION;');

    const artifactByPath = new Map();
    for (const record of artifactRecords) {
      artifactByPath.set(String(record?.artifactPath || '').trim(), record);
    }
    const artifactIds = artifactRecords.map((record) => buildArtifactId(record));
    const syncAt = safeNow();

    const stmtArtifact = db.prepare(`
      INSERT INTO artifact_record (
        artifact_id, artifact_path, title, artifact_kind, owner, state, next_owner,
        next_step, resume_action, blocker, needs_ceo_gate, primary_action_kind,
        visibility_priority, source_verified, handoff_parsed, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(artifact_id) DO UPDATE SET
        artifact_path = excluded.artifact_path,
        title = excluded.title,
        artifact_kind = excluded.artifact_kind,
        owner = excluded.owner,
        state = excluded.state,
        next_owner = excluded.next_owner,
        next_step = excluded.next_step,
        resume_action = excluded.resume_action,
        blocker = excluded.blocker,
        needs_ceo_gate = excluded.needs_ceo_gate,
        primary_action_kind = excluded.primary_action_kind,
        visibility_priority = excluded.visibility_priority,
        source_verified = excluded.source_verified,
        handoff_parsed = excluded.handoff_parsed,
        updated_at = excluded.updated_at
    `);
    const stmtArtifactDelete = db.prepare('DELETE FROM handoff_record WHERE artifact_id = ?');
    const stmtHandoff = db.prepare(`
      INSERT INTO handoff_record (
        handoff_id, artifact_id, source, artifact_path, artifact_title, status, from_agent,
        to_agents_json, next_owner, reason, resume_action, blocker, needs_ceo_gate,
        source_verified, parsed_at, dedupe_key, evidence_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(handoff_id) DO UPDATE SET
        source = excluded.source,
        artifact_path = excluded.artifact_path,
        artifact_title = excluded.artifact_title,
        status = excluded.status,
        from_agent = excluded.from_agent,
        to_agents_json = excluded.to_agents_json,
        next_owner = excluded.next_owner,
        reason = excluded.reason,
        resume_action = excluded.resume_action,
        blocker = excluded.blocker,
        needs_ceo_gate = excluded.needs_ceo_gate,
        source_verified = excluded.source_verified,
        parsed_at = excluded.parsed_at,
        evidence_ref = excluded.evidence_ref,
        updated_at = CURRENT_TIMESTAMP
    `);
    const stmtGateDelete = db.prepare('DELETE FROM gate_decision WHERE artifact_id = ?');
    const stmtGate = db.prepare(`
      INSERT INTO gate_decision (
        gate_id, artifact_id, source, category, status, owner, reason, blocker,
        needs_ceo_gate, source_verified, qa_status, dedupe_key, evidence_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(gate_id) DO UPDATE SET
        source = excluded.source,
        category = excluded.category,
        status = excluded.status,
        owner = excluded.owner,
        reason = excluded.reason,
        blocker = excluded.blocker,
        needs_ceo_gate = excluded.needs_ceo_gate,
        source_verified = excluded.source_verified,
        qa_status = excluded.qa_status,
        evidence_ref = excluded.evidence_ref,
        updated_at = CURRENT_TIMESTAMP
    `);
    const stmtEvent = db.prepare(`
      INSERT INTO event_log (event_id, module_id, event_type, actor, payload_json, artifact_path)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        actor = excluded.actor,
        artifact_path = excluded.artifact_path,
        created_at = CURRENT_TIMESTAMP
    `);

    for (const record of artifactRecords) {
      const artifactPath = String(record.artifactPath || '').trim();
      if (!artifactPath) continue;
      const artifactId = buildArtifactId(record);
      stmtArtifact.run(
        artifactId,
        artifactPath,
        record.title || record.artifactPath,
        normalizeArtifactKind(record.artifactKind),
        record.owner || 'unknown',
        normalizeArtifactState(record.state),
        record.nextOwner || null,
        record.nextStep || null,
        record.resumeAction || null,
        record.blocker || null,
        toDbBool(record.needsCeoGate),
        record.primaryActionKind || 'view_detail',
        Number.isInteger(record.visibilityPriority) ? record.visibilityPriority : 0,
        toDbBool(record.sourceVerified),
        toDbBool(record.handoffParsed),
        safeNow(),
      );
    }

    // Derive linked queue tables from current artifact snapshot.
    // Keep one-to-one refresh to avoid stale queue artifacts for inactive handoff/gate states.
    const handledArtifactIds = [...new Set(artifactIds)];
    for (const artifactId of handledArtifactIds) {
      stmtArtifactDelete.run(artifactId);
      stmtGateDelete.run(artifactId);
    }

    for (const handoff of handoffRecords) {
      const artifactPath = String(handoff.artifactPath || '').trim();
      if (!artifactPath) continue;
      const sourceRecord = artifactByPath.get(artifactPath);
      if (!sourceRecord) {
        continue;
      }
      const artifactId = buildArtifactId(sourceRecord);
      stmtHandoff.run(
        handoff.id || `handoff:${handoff.dedupeKey || `${artifactPath}:${handoff.from || 'unknown'}:${(handoff.to || []).join(',')}`}`,
        artifactId,
        handoff.source || 'artifact_status_visibility_v02',
        artifactPath,
        handoff.artifactTitle || sourceRecord.title || artifactPath,
        normalizeStatus(handoff.status, ALLOWED_HANDOFF_STATUS, 'open'),
        handoff.from || 'unknown',
        JSON.stringify(Array.isArray(handoff.to) ? handoff.to : []),
        handoff.nextOwner || null,
        handoff.reason || null,
        handoff.resumeAction || null,
        handoff.blocker || null,
        toDbBool(handoff.needsCeoGate),
        toDbBool(handoff.sourceVerified),
        handoff.parsedAt || safeNow(),
        handoff.dedupeKey || `${handoff.artifactPath}:${handoff.from}:${handoff.to?.[0] || ''}`,
        handoff.evidenceRef || null,
      );
    }

    for (const gate of gateRecords) {
      const artifactPath = String(gate.artifactPath || '').trim();
      if (!artifactPath) continue;
      const sourceRecord = artifactByPath.get(artifactPath);
      if (!sourceRecord) {
        continue;
      }
      const artifactId = buildArtifactId(sourceRecord);
      const category = `${gate.category || inferGateCategoryFromString(`${gate.reason || ''} ${gate.blocker || ''}`)}`;
      const status = normalizeStatus(gate.status, ALLOWED_GATE_STATUS, 'needs_attention');
      stmtGate.run(
        gate.id || `gate:${gate.dedupeKey || `${artifactPath}:needs_ceo`}`,
        artifactId,
        gate.source || 'artifact_status_visibility_v02',
        category,
        status,
        gate.owner || 'CEO',
        gate.reason || 'Missing reason for gate decision.',
        gate.blocker || null,
        toDbBool(gate.needsCeoGate),
        toDbBool(gate.sourceVerified),
        gate.qaStatus || null,
        gate.dedupeKey || `${gate.artifactPath}:needs_ceo`,
        gate.evidenceRef || `artifactStatusVisibility:${gate.artifactPath}`,
      );
    }

    for (const [index, artifact] of artifactRecords.entries()) {
      const artifactPath = String(artifact?.artifactPath || '').trim();
      if (!artifactPath) continue;
      const artifactId = buildArtifactId(artifact);
      stmtEvent.run(
        `event:db-sync:${syncAt}:${artifactId}:${index}`,
        null,
        'db.artifact_sync',
        artifact.owner || 'local-db',
        JSON.stringify({
          artifactPath,
          state: artifact.state,
          needsCeoGate: artifact.needsCeoGate,
          sourceVerified: artifact.sourceVerified,
        }),
        artifactPath,
      );
    }

    db.exec('COMMIT;');
    console.log(`database: synced ${artifactRecords.length} artifact records`);
    if (handoffRecords.length > 0) {
      console.log(`database: synced ${handoffRecords.length} handoff records`);
    }
    if (gateRecords.length > 0) {
      console.log(`database: synced ${gateRecords.length} gate records`);
    }
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.close();
  }
}

function inferGateCategoryFromString(rawText) {
  const normalized = String(rawText || '').toLowerCase();
  if (/(notion|mirror)/.test(normalized)) return 'notion_mirror';
  if (/(real\\s+db|sqlite|database|migration|migrate|restore|backup)/.test(normalized)) return 'real_data_migration';
  if (/(external|service|provider|api|webhook)/.test(normalized)) return 'external_service';
  if (/(notification|notify|push|email|ding|wechat)/.test(normalized)) return 'notification';
  if (/(deploy|release|production|publish|go-live|launch)/.test(normalized)) return 'production_deploy';
  return 'other';
}

const command = process.argv[2] || '';
switch (command) {
  case 'migrate': {
    commandMigrate();
    break;
  }
  case 'down': {
    commandDown();
    break;
  }
  case 'seed-demo': {
    commandSeedDemo();
    break;
  }
  case 'status': {
    commandStatus();
    break;
  }
  case 'probe': {
    commandProbe();
    break;
  }
  case 'flow': {
    commandFlow();
    break;
  }
  case 'queue': {
    commandQueue();
    break;
  }
  case 'sync-artifact-records': {
    commandSyncArtifactRecords();
    break;
  }
  default: {
    console.error(usage.trim());
    process.exitCode = 1;
  }
}
