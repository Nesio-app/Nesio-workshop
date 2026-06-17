BEGIN;

CREATE INDEX IF NOT EXISTS idx_artifact_record_owner_state
  ON artifact_record (owner, state);

CREATE INDEX IF NOT EXISTS idx_artifact_record_state_needs_ceo
  ON artifact_record (needs_ceo_gate, state);

CREATE INDEX IF NOT EXISTS idx_artifact_record_needs_ceo_gate_updated
  ON artifact_record (needs_ceo_gate, updated_at);

CREATE INDEX IF NOT EXISTS idx_handoff_record_status_parsed_at
  ON handoff_record (status, parsed_at DESC);

CREATE INDEX IF NOT EXISTS idx_handoff_record_artifact_id
  ON handoff_record (artifact_id);

CREATE INDEX IF NOT EXISTS idx_gate_decision_status_updated_at
  ON gate_decision (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_gate_decision_ceo_status
  ON gate_decision (needs_ceo_gate, status);

CREATE INDEX IF NOT EXISTS idx_event_log_module_type_created
  ON event_log (module_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_log_type_created
  ON event_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_log_artifact_path_created
  ON event_log (artifact_path, created_at DESC);

COMMIT;
