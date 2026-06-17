BEGIN;

CREATE INDEX IF NOT EXISTS idx_artifact_record_state_priority_updated
  ON artifact_record (state, visibility_priority DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifact_record_state_kind_priority_updated
  ON artifact_record (state, artifact_kind, visibility_priority DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifact_record_owner_needs_updated
  ON artifact_record (owner, needs_ceo_gate, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifact_record_priority_updated
  ON artifact_record (visibility_priority DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_handoff_record_status_needs_parsed
  ON handoff_record (status, needs_ceo_gate, datetime(parsed_at) DESC);

CREATE INDEX IF NOT EXISTS idx_handoff_record_owner_status_parsed_updated
  ON handoff_record (next_owner, status, datetime(parsed_at) DESC);

CREATE INDEX IF NOT EXISTS idx_handoff_record_artifact_status_parsed
  ON handoff_record (artifact_id, status, datetime(parsed_at) DESC);

CREATE INDEX IF NOT EXISTS idx_gate_decision_status_needs_updated
  ON gate_decision (status, needs_ceo_gate, datetime(updated_at) DESC);

CREATE INDEX IF NOT EXISTS idx_gate_decision_category_status_updated
  ON gate_decision (category, status, datetime(updated_at) DESC);

CREATE INDEX IF NOT EXISTS idx_gate_decision_owner_status_updated
  ON gate_decision (owner, status, datetime(updated_at) DESC);

CREATE INDEX IF NOT EXISTS idx_event_log_module_type_artifact_created
  ON event_log (module_id, event_type, artifact_path, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_log_artifact_event_type_created
  ON event_log (artifact_path, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_module_data_contract_module_contract
  ON module_data_contract (module_id, contract_type);

CREATE INDEX IF NOT EXISTS idx_data_key_ownership_scope_owner
  ON data_key_ownership (scope, owner_module_id);

CREATE INDEX IF NOT EXISTS idx_data_key_ownership_sharing_kind_scope
  ON data_key_ownership (sharing_kind, scope);

COMMIT;
