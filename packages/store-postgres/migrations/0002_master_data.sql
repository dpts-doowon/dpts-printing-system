-- Cadastros (máquinas, peças, turnos, usuários). Registros com histórico são inativados, não excluídos (E-014).
CREATE TABLE master_data (
  kind        text NOT NULL CHECK (kind IN ('machines', 'parts', 'shifts', 'users')),
  id          text NOT NULL,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);
