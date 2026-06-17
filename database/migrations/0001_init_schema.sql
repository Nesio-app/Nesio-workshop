BEGIN;

CREATE TABLE IF NOT EXISTS db_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent (
  agent_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'module_owner',
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS module_registry (
  module_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  zone TEXT,
  hotkey TEXT,
  command TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  owner TEXT,
  maintainer TEXT,
  responsible_agent TEXT,
  evidence_owner TEXT,
  gate_owner TEXT,
  ready INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'local',
  route_kind TEXT NOT NULL DEFAULT 'local-static-module',
  configured_url TEXT,
  normalized_path TEXT,
  open_href TEXT,
  return_href TEXT,
  public_index_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS module_data_contract (
  module_id TEXT NOT NULL,
  contract_type TEXT NOT NULL CHECK (
    contract_type IN (
      'owned_data',
      'consumed_data',
      'emitted_event',
      'allowed_action',
      'approval_required_action'
    )
  ),
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (module_id, contract_type, value),
  FOREIGN KEY (module_id) REFERENCES module_registry (module_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS data_key_ownership (
  data_key TEXT PRIMARY KEY,
  owner_module_id TEXT NOT NULL,
  sharing_kind TEXT NOT NULL CHECK (sharing_kind IN ('shared', 'module_private', 'external_domain')),
  scope TEXT NOT NULL,
  expected_producers_json TEXT NOT NULL DEFAULT '[]',
  expected_consumers_json TEXT NOT NULL DEFAULT '[]',
  policy_source TEXT NOT NULL DEFAULT 'explicit',
  rationale TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artifact_record (
  artifact_id TEXT PRIMARY KEY,
  artifact_path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('engineering', 'qa', 'plan', 'spec', 'audit', 'report', 'archive', 'unknown')),
  owner TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('needs_ceo', 'blocked', 'QA', 'active', 'archived')),
  next_owner TEXT,
  next_step TEXT,
  resume_action TEXT,
  blocker TEXT,
  needs_ceo_gate INTEGER NOT NULL DEFAULT 0,
  primary_action_kind TEXT NOT NULL DEFAULT 'view_detail',
  visibility_priority INTEGER DEFAULT 0,
  source_verified INTEGER NOT NULL DEFAULT 0,
  handoff_parsed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS handoff_record (
  handoff_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'artifact_status_visibility_v02',
  artifact_path TEXT NOT NULL,
  artifact_title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'waiting_ceo', 'open', 'closed')),
  from_agent TEXT NOT NULL,
  to_agents_json TEXT NOT NULL DEFAULT '[]',
  next_owner TEXT,
  reason TEXT,
  resume_action TEXT,
  blocker TEXT,
  needs_ceo_gate INTEGER NOT NULL DEFAULT 0,
  source_verified INTEGER NOT NULL DEFAULT 0,
  parsed_at TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  evidence_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artifact_id) REFERENCES artifact_record (artifact_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gate_decision (
  gate_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'artifact_status_visibility_v02',
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting_ceo', 'needs_attention', 'closed')),
  owner TEXT NOT NULL,
  reason TEXT NOT NULL,
  blocker TEXT,
  needs_ceo_gate INTEGER NOT NULL DEFAULT 1,
  source_verified INTEGER NOT NULL DEFAULT 0,
  qa_status TEXT,
  dedupe_key TEXT NOT NULL,
  evidence_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artifact_id) REFERENCES artifact_record (artifact_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sprint_status (
  sprint_id TEXT PRIMARY KEY,
  module_id TEXT,
  sprint_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed', 'blocked', 'archived')),
  owner TEXT,
  summary TEXT,
  queue_rank INTEGER DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (module_id) REFERENCES module_registry (module_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_log (
  event_id TEXT PRIMARY KEY,
  module_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  artifact_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (module_id) REFERENCES module_registry (module_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_preference (
  preference_id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK (scope IN ('local', 'demo', 'personal', 'market')),
  owner TEXT NOT NULL,
  preference_key TEXT NOT NULL,
  preference_value TEXT NOT NULL,
  sensitive_level TEXT NOT NULL DEFAULT 'low' CHECK (sensitive_level IN ('low', 'medium', 'high')),
  source TEXT NOT NULL DEFAULT 'local-contract',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scope, owner, preference_key)
);

CREATE TABLE IF NOT EXISTS demo_seed (
  seed_id TEXT PRIMARY KEY,
  seed_scope TEXT NOT NULL,
  seed_key TEXT NOT NULL,
  seed_value TEXT NOT NULL,
  owner TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (seed_scope, seed_key)
);

CREATE TABLE IF NOT EXISTS external_connection (
  connection_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('api', 'sdk', 'webhook', 'placeholder')),
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled', 'connecting', 'connected', 'failed', 'revoked')),
  environment TEXT NOT NULL DEFAULT 'local',
  is_enabled INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_module_data_contract_type_value
  ON module_data_contract (contract_type, value);

CREATE INDEX IF NOT EXISTS idx_module_data_contract_module
  ON module_data_contract (module_id, contract_type);

CREATE INDEX IF NOT EXISTS idx_data_key_ownership_owner
  ON data_key_ownership (owner_module_id);

CREATE INDEX IF NOT EXISTS idx_artifact_owner_state
  ON artifact_record (owner, state);

CREATE INDEX IF NOT EXISTS idx_handoff_status
  ON handoff_record (status);

CREATE INDEX IF NOT EXISTS idx_gate_status
  ON gate_decision (status);

CREATE INDEX IF NOT EXISTS idx_event_module_type
  ON event_log (module_id, event_type);

CREATE INDEX IF NOT EXISTS idx_external_provider_status
  ON external_connection (provider, status);

INSERT OR REPLACE INTO db_meta (key, value)
  VALUES ('schema_version', '1.0.0');

COMMIT;
