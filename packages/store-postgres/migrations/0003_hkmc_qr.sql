-- QR no padrão H/KMC: contador sequencial do Trace Number e configurações globais (Supplier Code, Área do Fornecedor).
CREATE TABLE trace_counter (
  id    smallint PRIMARY KEY CHECK (id = 1),
  value bigint NOT NULL CHECK (value >= 0)
);

ALTER TABLE master_data DROP CONSTRAINT master_data_kind_check;
ALTER TABLE master_data
  ADD CONSTRAINT master_data_kind_check CHECK (kind IN ('machines', 'parts', 'shifts', 'users', 'settings'));
