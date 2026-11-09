import pg from "pg";
import type {
  AgentInfo,
  AuditEvent,
  Label,
  PrintAttempt,
  PrintJob,
  PrintStore,
  PrintStoreTx,
} from "@doowon/domain";

// bigint (int8) chega como string; os tempos do domínio são epoch em ms, dentro do intervalo seguro.
pg.types.setTypeParser(20, (v) => Number(v));

/** Serializa as transações de escrita, como o store em memória (uma por vez). */
const WRITE_LOCK = 727_001;

type Q = Pick<pg.Pool, "query">;
type Row = Record<string, unknown>;

const jobFrom = (r: Row): PrintJob => ({
  id: r["id"] as string,
  kind: r["kind"] as PrintJob["kind"],
  quantity: r["quantity"] as number,
  stationId: r["station_id"] as string,
  machineId: r["machine_id"] as string,
  printerId: r["printer_id"] as string,
  operatorId: r["operator_id"] as string,
  idempotencyKey: r["idempotency_key"] as string,
  requestFingerprint: r["request_fingerprint"] as string,
  correlationId: r["correlation_id"] as string,
  ...(r["reason"] !== null ? { reason: r["reason"] as string } : {}),
  createdAt: r["created_at"] as number,
});

const labelFrom = (r: Row): Label => ({
  labelId: r["label_id"] as string,
  printJobId: r["print_job_id"] as string,
  sequenceInJob: r["sequence_in_job"] as number,
  snapshot: r["snapshot"] as Label["snapshot"],
  snapshotHash: r["snapshot_hash"] as string,
  payloadHash: r["payload_hash"] as string,
});

const attemptFrom = (r: Row): PrintAttempt => ({
  id: r["id"] as string,
  printJobId: r["print_job_id"] as string,
  labelId: r["label_id"] as string,
  printerId: r["printer_id"] as string,
  stationId: r["station_id"] as string,
  attemptNo: r["attempt_no"] as number,
  order: r["ord"] as number,
  state: r["state"] as PrintAttempt["state"],
  version: r["version"] as number,
  holdReason: r["hold_reason"] as PrintAttempt["holdReason"],
  evidenceType: r["evidence_type"] as PrintAttempt["evidenceType"],
  failureClass: r["failure_class"] as string | null,
  lease: r["lease"] as PrintAttempt["lease"],
  resolvedBy: r["resolved_by"] as string | null,
  resolvedAt: r["resolved_at"] as number | null,
  correlationId: r["correlation_id"] as string,
  payloadHash: r["payload_hash"] as string,
  templateVersion: r["template_version"] as number,
  qrSchemaVersion: r["qr_schema_version"] as string,
  renderSnapshot: r["render_snapshot"] as PrintAttempt["renderSnapshot"],
  createdAt: r["created_at"] as number,
});

const auditFrom = (r: Row): AuditEvent => ({
  id: r["id"] as string,
  at: r["at"] as number,
  action: r["action"] as string,
  actorId: r["actor_id"] as string | null,
  stationId: r["station_id"] as string | null,
  targetType: r["target_type"] as AuditEvent["targetType"],
  targetId: r["target_id"] as string | null,
  result: r["result"] as AuditEvent["result"],
  correlationId: r["correlation_id"] as string,
  ...(r["details"] !== null ? { details: r["details"] as Record<string, unknown> } : {}),
});

const agentFrom = (r: Row): AgentInfo & { lastHeartbeatAt: number } => ({
  agentId: r["agent_id"] as string,
  stationId: r["station_id"] as string,
  printerId: r["printer_id"] as string,
  agentVersion: r["agent_version"] as string,
  protocolVersion: r["protocol_version"] as number,
  clockSkewMs: r["clock_skew_ms"] as number,
  printerStatus: r["printer_status"] as AgentInfo["printerStatus"],
  lastHeartbeatAt: r["last_heartbeat_at"] as number,
});

function txOn(q: Q): PrintStoreTx {
  const one = async <T>(sql: string, params: unknown[], map: (r: Row) => T) => {
    const res = await q.query(sql, params);
    return res.rows[0] ? map(res.rows[0] as Row) : undefined;
  };
  const many = async <T>(sql: string, params: unknown[], map: (r: Row) => T) =>
    (await q.query(sql, params)).rows.map((r) => map(r as Row));

  return {
    getJob: (id) => one("SELECT * FROM print_jobs WHERE id = $1", [id], jobFrom),
    getJobByIdempotencyKey: (key) =>
      one("SELECT * FROM print_jobs WHERE idempotency_key = $1", [key], jobFrom),
    listJobs: () => many("SELECT * FROM print_jobs ORDER BY seq", [], jobFrom),
    getLabel: (id) => one("SELECT * FROM labels WHERE label_id = $1", [id], labelFrom),
    listLabelsByJob: (jobId) =>
      many("SELECT * FROM labels WHERE print_job_id = $1 ORDER BY seq", [jobId], labelFrom),
    getAttempt: (id) => one("SELECT * FROM print_attempts WHERE id = $1", [id], attemptFrom),
    listAttemptsByJob: (jobId) =>
      many(
        "SELECT * FROM print_attempts WHERE print_job_id = $1 ORDER BY seq",
        [jobId],
        attemptFrom,
      ),
    listAttemptsByLabel: (labelId) =>
      many("SELECT * FROM print_attempts WHERE label_id = $1 ORDER BY seq", [labelId], attemptFrom),
    listAttemptsByPrinter: (printerId) =>
      many(
        "SELECT * FROM print_attempts WHERE printer_id = $1 ORDER BY seq",
        [printerId],
        attemptFrom,
      ),
    listAttempts: () => many("SELECT * FROM print_attempts ORDER BY seq", [], attemptFrom),

    insertJob: async (j) => {
      await q.query(
        `INSERT INTO print_jobs (id, kind, quantity, station_id, machine_id, printer_id, operator_id,
           idempotency_key, request_fingerprint, correlation_id, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          j.id,
          j.kind,
          j.quantity,
          j.stationId,
          j.machineId,
          j.printerId,
          j.operatorId,
          j.idempotencyKey,
          j.requestFingerprint,
          j.correlationId,
          j.reason ?? null,
          j.createdAt,
        ],
      );
    },
    insertLabel: async (l) => {
      await q.query(
        `INSERT INTO labels (label_id, print_job_id, sequence_in_job, snapshot, snapshot_hash, payload_hash)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [l.labelId, l.printJobId, l.sequenceInJob, l.snapshot, l.snapshotHash, l.payloadHash],
      );
    },
    insertAttempt: async (a) => {
      await q.query(
        `INSERT INTO print_attempts (id, print_job_id, label_id, printer_id, station_id, attempt_no, ord,
           state, version, hold_reason, evidence_type, failure_class, lease, resolved_by, resolved_at,
           correlation_id, payload_hash, template_version, qr_schema_version, render_snapshot, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          a.id,
          a.printJobId,
          a.labelId,
          a.printerId,
          a.stationId,
          a.attemptNo,
          a.order,
          a.state,
          a.version,
          a.holdReason,
          a.evidenceType,
          a.failureClass,
          a.lease,
          a.resolvedBy,
          a.resolvedAt,
          a.correlationId,
          a.payloadHash,
          a.templateVersion,
          a.qrSchemaVersion,
          a.renderSnapshot,
          a.createdAt,
        ],
      );
    },
    updateAttempt: async (a, expectedVersion) => {
      // Grava todas as colunas (o domínio pode alterar qualquer campo via `patch`); a condição de
      // versão garante a atualização otimista.
      const res = await q.query(
        `UPDATE print_attempts SET print_job_id=$3, label_id=$4, printer_id=$5, station_id=$6,
           attempt_no=$7, ord=$8, state=$9, version=$10, hold_reason=$11, evidence_type=$12,
           failure_class=$13, lease=$14, resolved_by=$15, resolved_at=$16, correlation_id=$17,
           payload_hash=$18, template_version=$19, qr_schema_version=$20, render_snapshot=$21,
           created_at=$22
         WHERE id=$1 AND version=$2`,
        [
          a.id,
          expectedVersion,
          a.printJobId,
          a.labelId,
          a.printerId,
          a.stationId,
          a.attemptNo,
          a.order,
          a.state,
          a.version,
          a.holdReason,
          a.evidenceType,
          a.failureClass,
          a.lease,
          a.resolvedBy,
          a.resolvedAt,
          a.correlationId,
          a.payloadHash,
          a.templateVersion,
          a.qrSchemaVersion,
          a.renderSnapshot,
          a.createdAt,
        ],
      );
      if (res.rowCount !== 1) throw new Error("version conflict");
    },
    appendAudit: async (e) => {
      await q.query(
        `INSERT INTO audit_events (id, at, action, actor_id, station_id, target_type, target_id,
           result, correlation_id, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          e.id,
          e.at,
          e.action,
          e.actorId,
          e.stationId,
          e.targetType,
          e.targetId,
          e.result,
          e.correlationId,
          e.details ?? null,
        ],
      );
    },
    listAudit: () => many("SELECT * FROM audit_events ORDER BY seq", [], auditFrom),
    getAgent: (stationId) =>
      one("SELECT * FROM agents WHERE station_id = $1", [stationId], agentFrom),
    saveAgent: async (a) => {
      await q.query(
        `INSERT INTO agents (station_id, agent_id, printer_id, agent_version, protocol_version,
           clock_skew_ms, printer_status, last_heartbeat_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (station_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,
           printer_id=EXCLUDED.printer_id, agent_version=EXCLUDED.agent_version,
           protocol_version=EXCLUDED.protocol_version, clock_skew_ms=EXCLUDED.clock_skew_ms,
           printer_status=EXCLUDED.printer_status, last_heartbeat_at=EXCLUDED.last_heartbeat_at`,
        [
          a.stationId,
          a.agentId,
          a.printerId,
          a.agentVersion,
          a.protocolVersion,
          a.clockSkewMs,
          a.printerStatus,
          a.lastHeartbeatAt,
        ],
      );
    },
  };
}

export class PostgresPrintStore implements PrintStore {
  constructor(private pool: pg.Pool) {}

  read(): PrintStoreTx {
    return txOn(this.pool);
  }

  async transaction<T>(fn: (tx: PrintStoreTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
      try {
        const out = await fn(txOn(client));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    } finally {
      client.release();
    }
  }
}

/** Sem `connectionString`, o driver usa as variáveis PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT e PGSSLMODE. */
export const createPool = (connectionString?: string): pg.Pool =>
  new pg.Pool({ ...(connectionString ? { connectionString } : {}), max: 10 });
