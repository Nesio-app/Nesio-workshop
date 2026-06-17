BEGIN;

DROP INDEX IF EXISTS idx_artifact_record_owner_updated;
DROP INDEX IF EXISTS idx_artifact_record_artifact_path;
DROP INDEX IF EXISTS idx_handoff_record_owner_status_parsed;
DROP INDEX IF EXISTS idx_handoff_record_artifact_path;
DROP INDEX IF EXISTS idx_gate_decision_owner_status_updated;
DROP INDEX IF EXISTS idx_gate_decision_artifact_id;
DROP INDEX IF EXISTS idx_event_log_artifact_created;

COMMIT;
