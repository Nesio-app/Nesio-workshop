BEGIN;

CREATE TABLE IF NOT EXISTS local_profile (
  profile_id TEXT PRIMARY KEY,
  profile_kind TEXT NOT NULL DEFAULT 'local_profile' CHECK (profile_kind IN ('local_profile', 'demo_profile')),
  display_name TEXT NOT NULL,
  auth_provider TEXT NOT NULL DEFAULT 'none',
  source_kind TEXT NOT NULL DEFAULT 'local_fixture' CHECK (source_kind IN ('local_fixture', 'demo_seed')),
  reads_real_user_data INTEGER NOT NULL DEFAULT 0,
  writes_real_user_data INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS modules (
  module_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled', 'gated', 'contract_only')),
  ai_enabled INTEGER NOT NULL DEFAULT 0,
  data_scope TEXT NOT NULL DEFAULT 'local_contract',
  source_kind TEXT NOT NULL DEFAULT 'local_fixture' CHECK (source_kind IN ('local_fixture', 'demo_seed', 'registry_projection')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_items (
  item_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  location_hint TEXT,
  notes TEXT,
  purchase_memory_json TEXT NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL DEFAULT 'demo' CHECK (mode IN ('demo', 'personal_local')),
  source_kind TEXT NOT NULL DEFAULT 'demo_seed' CHECK (source_kind IN ('local_fixture', 'demo_seed')),
  reads_real_user_data INTEGER NOT NULL DEFAULT 0,
  writes_real_user_data INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES local_profile (profile_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entitlements (
  entitlement_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  plan_key TEXT NOT NULL DEFAULT 'local_demo',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'gated')),
  source_kind TEXT NOT NULL DEFAULT 'local_fixture' CHECK (source_kind IN ('local_fixture', 'demo_seed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES local_profile (profile_id) ON DELETE CASCADE,
  FOREIGN KEY (module_id) REFERENCES modules (module_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id TEXT PRIMARY KEY,
  profile_id TEXT,
  module_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'local-system',
  payload_json TEXT NOT NULL DEFAULT '{}',
  source_kind TEXT NOT NULL DEFAULT 'local_fixture' CHECK (source_kind IN ('local_fixture', 'demo_seed', 'contract_probe')),
  contains_real_user_data INTEGER NOT NULL DEFAULT 0,
  writes_real_user_data INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES local_profile (profile_id) ON DELETE SET NULL,
  FOREIGN KEY (module_id) REFERENCES modules (module_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_profile_mode
  ON inventory_items (profile_id, mode, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_entitlements_profile_status
  ON entitlements (profile_id, status);

CREATE INDEX IF NOT EXISTS idx_audit_events_profile_created
  ON audit_events (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_module_type_created
  ON audit_events (module_id, event_type, created_at DESC);

INSERT OR REPLACE INTO local_profile (
  profile_id, profile_kind, display_name, auth_provider, source_kind,
  reads_real_user_data, writes_real_user_data
) VALUES (
  'local_profile_demo', 'local_profile', 'Baohe Local Demo', 'none', 'local_fixture', 0, 0
);

INSERT OR REPLACE INTO modules (module_id, name, status, ai_enabled, data_scope, source_kind)
VALUES
  ('shell', 'Shell', 'enabled', 0, 'local_contract', 'local_fixture'),
  ('inventory', 'Inventory', 'enabled', 0, 'demo_inventory', 'local_fixture'),
  ('plan', 'Plan', 'enabled', 0, 'local_contract', 'local_fixture'),
  ('fitness', 'Fitness', 'enabled', 0, 'local_contract', 'local_fixture'),
  ('health', 'Health', 'gated', 0, 'contract_only', 'local_fixture'),
  ('reading', 'Reading', 'enabled', 0, 'local_contract', 'local_fixture'),
  ('finance', 'Finance', 'gated', 0, 'contract_only', 'local_fixture');

INSERT OR REPLACE INTO inventory_items (
  item_id, profile_id, name, category, location_hint, notes,
  purchase_memory_json, mode, source_kind, reads_real_user_data, writes_real_user_data
) VALUES
  (
    'demo-inventory-001',
    'local_profile_demo',
    'Travel cable pouch',
    'electronics',
    'Entry cabinet, second drawer',
    'Demo fixture only.',
    '{"purchasedAt":"2026-05-08","reason":"Needed one place for USB-C cables and adapters.","worthIt":"yes","memoryNote":"Useful every week; do not buy another pouch."}',
    'demo',
    'demo_seed',
    0,
    0
  ),
  (
    'demo-inventory-002',
    'local_profile_demo',
    'Blue notebook',
    'stationery',
    'Desk shelf',
    'Demo fixture only.',
    '{"purchasedAt":"2026-04-22","reason":"Wanted a single notebook for product decisions.","worthIt":"yes","memoryNote":"Still active; keep it in the work bag."}',
    'demo',
    'demo_seed',
    0,
    0
  );

INSERT OR REPLACE INTO entitlements (entitlement_id, profile_id, module_id, plan_key, status, source_kind)
VALUES
  ('entitlement:local:shell', 'local_profile_demo', 'shell', 'local_demo', 'active', 'local_fixture'),
  ('entitlement:local:inventory', 'local_profile_demo', 'inventory', 'local_demo', 'active', 'local_fixture');

INSERT OR REPLACE INTO audit_events (
  audit_event_id, profile_id, module_id, event_type, actor, payload_json,
  source_kind, contains_real_user_data, writes_real_user_data
) VALUES (
  'audit:api-contract-v0-seed',
  'local_profile_demo',
  'shell',
  'api_contract.seed',
  'Du',
  '{"contract":"api-contract-v0","realUserData":false}',
  'contract_probe',
  0,
  0
);

COMMIT;
