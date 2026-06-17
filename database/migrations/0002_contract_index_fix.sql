BEGIN;

DROP INDEX IF EXISTS idx_module_data_contract_type_value;
CREATE INDEX IF NOT EXISTS idx_module_data_contract_type_value
  ON module_data_contract (contract_type, value);

COMMIT;
