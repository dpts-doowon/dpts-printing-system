-- Esquema inicial da persistência de impressão (PRINT_JOB -> LABEL -> PRINT_ATTEMPT).
-- Valores de tempo são epoch em milissegundos (bigint), como no domínio.

CREATE TABLE print_jobs (
  seq                  bigserial PRIMARY KEY,
  id                   text NOT NULL UNIQUE,
  kind                 text NOT NULL CHECK (kind IN ('ORIGINAL', 'RETRY', 'REPRINT')),
  quantity             integer NOT NULL CHECK (quantity > 0),
  station_id           text NOT NULL,
  machine_id           text NOT NULL,
  printer_id           text NOT NULL,
  operator_id          text NOT NULL,
  idempotency_key      text NOT NULL UNIQUE,
  request_fingerprint  text NOT NULL,
  correlation_id       text NOT NULL,
  reason               text,
  created_at           bigint NOT NULL
);

CREATE TABLE labels (
  seq              bigserial PRIMARY KEY,
  label_id         text NOT NULL UNIQUE,
  print_job_id     text NOT NULL REFERENCES print_jobs (id),
  sequence_in_job  integer NOT NULL,
  snapshot         jsonb NOT NULL,
  snapshot_hash    text NOT NULL,
  payload_hash     text NOT NULL
);
CREATE INDEX labels_job_idx ON labels (print_job_id);

CREATE TABLE print_attempts (
  seq                bigserial PRIMARY KEY,
  id                 text NOT NULL UNIQUE,
  print_job_id       text NOT NULL REFERENCES print_jobs (id),
  label_id           text NOT NULL REFERENCES labels (label_id),
  printer_id         text NOT NULL,
  station_id         text NOT NULL,
  attempt_no         integer NOT NULL CHECK (attempt_no > 0),
  ord                integer NOT NULL,
  state              text NOT NULL CHECK (state IN
    ('CREATED','QUEUED','CLAIMED','SENDING','PRINTED_CONFIRMED','FAILED','UNKNOWN_OUTCOME','CANCELLED')),
  version            integer NOT NULL,
  hold_reason        text,
  evidence_type      text,
  failure_class      text,
  lease              jsonb,
  resolved_by        text,
  resolved_at        bigint,
  correlation_id     text NOT NULL,
  payload_hash       text NOT NULL,
  template_version   integer NOT NULL,
  qr_schema_version  text NOT NULL,
  render_snapshot    jsonb NOT NULL,
  created_at         bigint NOT NULL,
  UNIQUE (label_id, attempt_no)
);
CREATE INDEX attempts_job_idx ON print_attempts (print_job_id);
CREATE INDEX attempts_label_idx ON print_attempts (label_id);
CREATE INDEX attempts_printer_idx ON print_attempts (printer_id);

-- Auditoria append-only: UPDATE e DELETE são bloqueados.
CREATE TABLE audit_events (
  seq             bigserial PRIMARY KEY,
  id              text NOT NULL UNIQUE,
  at              bigint NOT NULL,
  action          text NOT NULL,
  actor_id        text,
  station_id      text,
  target_type     text NOT NULL,
  target_id       text,
  result          text NOT NULL CHECK (result IN ('OK', 'REJECTED')),
  correlation_id  text NOT NULL,
  details         jsonb
);
CREATE INDEX audit_at_idx ON audit_events (at);

CREATE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events é append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();

CREATE TABLE agents (
  station_id         text PRIMARY KEY,
  agent_id           text NOT NULL,
  printer_id         text NOT NULL,
  agent_version      text NOT NULL,
  protocol_version   integer NOT NULL,
  clock_skew_ms      bigint NOT NULL,
  printer_status     text NOT NULL,
  last_heartbeat_at  bigint NOT NULL
);
