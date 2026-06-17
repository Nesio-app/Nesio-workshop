BEGIN;

PRAGMA foreign_keys=OFF;

CREATE TABLE shell_route_registry (
  route_key TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  label_zh TEXT NOT NULL,
  label_en TEXT,
  personal_mode_availability TEXT NOT NULL,
  demo_mode_availability TEXT NOT NULL,
  market_mode_availability TEXT NOT NULL,
  entry_status TEXT NOT NULL,
  empty_state_key TEXT,
  required_capabilities_json TEXT NOT NULL DEFAULT '[]',
  approval_gate_keys_json TEXT NOT NULL DEFAULT '[]',
  evidence_links_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (module_id) REFERENCES module_registry (module_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shell_route_registry_module_id
  ON shell_route_registry (module_id);

CREATE INDEX IF NOT EXISTS idx_shell_route_registry_entry_status
  ON shell_route_registry (entry_status);

PRAGMA foreign_keys=ON;
COMMIT;
