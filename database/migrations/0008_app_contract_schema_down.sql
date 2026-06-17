BEGIN;

DROP INDEX IF EXISTS idx_audit_events_module_type_created;
DROP INDEX IF EXISTS idx_audit_events_profile_created;
DROP INDEX IF EXISTS idx_entitlements_profile_status;
DROP INDEX IF EXISTS idx_inventory_items_profile_mode;

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS entitlements;
DROP TABLE IF EXISTS inventory_items;
DROP TABLE IF EXISTS modules;
DROP TABLE IF EXISTS local_profile;

COMMIT;
