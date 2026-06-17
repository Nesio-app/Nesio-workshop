BEGIN;

DROP INDEX IF EXISTS idx_module_data_contract_type_value;
CREATE UNIQUE INDEX IF NOT EXISTS idx_module_data_contract_type_value
  ON module_data_contract (module_id, contract_type, value);

COMMIT;
