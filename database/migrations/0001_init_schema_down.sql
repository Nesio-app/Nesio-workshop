BEGIN;

DROP TABLE IF EXISTS external_connection;
DROP TABLE IF EXISTS demo_seed;
DROP TABLE IF EXISTS user_preference;
DROP TABLE IF EXISTS event_log;
DROP TABLE IF EXISTS sprint_status;
DROP TABLE IF EXISTS gate_decision;
DROP TABLE IF EXISTS handoff_record;
DROP TABLE IF EXISTS artifact_record;
DROP TABLE IF EXISTS data_key_ownership;
DROP TABLE IF EXISTS module_data_contract;
DROP TABLE IF EXISTS module_registry;
DROP TABLE IF EXISTS agent;
DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS db_meta;

COMMIT;
