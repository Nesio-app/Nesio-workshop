BEGIN;

CREATE INDEX IF NOT EXISTS idx_artifact_record_owner_updated
  ON artifact_record (owner, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifact_record_artifact_path
  ON artifact_record (artifact_path);

CREATE INDEX IF NOT EXISTS idx_handoff_record_owner_status_parsed
  ON handoff_record (from_agent, status, parsed_at DESC);

CREATE INDEX IF NOT EXISTS idx_handoff_record_artifact_path
  ON handoff_record (artifact_path);

CREATE INDEX IF NOT EXISTS idx_gate_decision_owner_status_updated
  ON gate_decision (owner, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_gate_decision_artifact_id
  ON gate_decision (artifact_id);

CREATE INDEX IF NOT EXISTS idx_event_log_artifact_created
  ON event_log (artifact_path, created_at DESC);

COMMIT;
