BEGIN;

DROP INDEX IF EXISTS idx_artifact_record_owner_state;
DROP INDEX IF EXISTS idx_artifact_record_state_needs_ceo;
DROP INDEX IF EXISTS idx_artifact_record_needs_ceo_gate_updated;
DROP INDEX IF EXISTS idx_handoff_record_status_parsed_at;
DROP INDEX IF EXISTS idx_handoff_record_artifact_id;
DROP INDEX IF EXISTS idx_gate_decision_status_updated_at;
DROP INDEX IF EXISTS idx_gate_decision_ceo_status;
DROP INDEX IF EXISTS idx_event_log_module_type_created;
DROP INDEX IF EXISTS idx_event_log_type_created;
DROP INDEX IF EXISTS idx_event_log_artifact_path_created;

COMMIT;
