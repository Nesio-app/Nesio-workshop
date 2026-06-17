BEGIN;

PRAGMA foreign_keys=OFF;

CREATE TABLE artifact_record_new (
  artifact_id TEXT PRIMARY KEY,
  artifact_path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artifact_kind TEXT NOT NULL CHECK (
    artifact_kind IN (
      'engineering',
      'qa',
      'plan',
      'spec',
      'audit',
      'report',
      'archive',
      'unknown'
    )
  ),
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

INSERT INTO artifact_record_new
SELECT
  artifact_id,
  artifact_path,
  title,
  CASE
    WHEN artifact_kind = 'inventory' THEN 'unknown'
    ELSE artifact_kind
  END,
  owner,
  state,
  next_owner,
  next_step,
  resume_action,
  blocker,
  needs_ceo_gate,
  primary_action_kind,
  visibility_priority,
  source_verified,
  handoff_parsed,
  updated_at,
  created_at
FROM artifact_record;

DROP TABLE artifact_record;
ALTER TABLE artifact_record_new RENAME TO artifact_record;

PRAGMA foreign_keys=ON;
COMMIT;
