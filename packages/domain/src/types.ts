export type Role = "OPERATOR" | "ADMIN";

export type JobKind = "ORIGINAL" | "RETRY" | "REPRINT";

export type AttemptState =
  | "CREATED"
  | "QUEUED"
  | "CLAIMED"
  | "SENDING"
  | "PRINTED_CONFIRMED"
  | "FAILED"
  | "UNKNOWN_OUTCOME"
  | "CANCELLED";

export type JobStatus =
  | "REQUIRES_REVIEW"
  | "AWAITING_DECISION"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type EvidenceType = "PRINTER_ACK" | "PRINTER_COUNTER" | "OPERATOR_CONFIRMATION";
export type HoldReason = "JOB_HELD" | "PRINTER_UNAVAILABLE";

/** Quantidades permitidas na V1 (REQ-005 / E-016). */
export const ALLOWED_QUANTITIES = [1, 10, 30] as const;
export type AllowedQuantity = (typeof ALLOWED_QUANTITIES)[number];

export interface Actor {
  id: string;
  role: Role;
  /** Nome exibido, congelado no snapshot. */
  displayName: string;
}

export interface LabelSnapshot {
  labelId: string;
  part: { id: string; description: string; partNumber: string };
  operator: { id: string; displayName: string };
  machine: { id: string; code: string };
  stationId: string;
  printerId: string;
  shift: { id: string; name: string };
  producedAtUtc: string;
  timezone: string;
  qrContent: string;
  qrSchemaVersion: string;
  templateId: string;
  templateVersion: number;
}

export interface Lease {
  agentId: string;
  expiresAt: number;
}

export interface PrintJob {
  id: string;
  kind: JobKind;
  quantity: number;
  stationId: string;
  machineId: string;
  printerId: string;
  operatorId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  correlationId: string;
  reason?: string;
  createdAt: number;
}

export interface Label {
  labelId: string;
  /** PRINT_JOB ORIGINAL que criou a etiqueta (INV-3). */
  printJobId: string;
  sequenceInJob: number;
  snapshot: LabelSnapshot;
  snapshotHash: string;
  payloadHash: string;
}

export interface PrintAttempt {
  id: string;
  printJobId: string;
  labelId: string;
  printerId: string;
  stationId: string;
  attemptNo: number;
  /** Ordem dentro do PRINT_JOB (determinística). */
  order: number;
  state: AttemptState;
  version: number;
  holdReason: HoldReason | null;
  evidenceType: EvidenceType | null;
  failureClass: string | null;
  lease: Lease | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  correlationId: string;
  payloadHash: string;
  templateVersion: number;
  qrSchemaVersion: string;
  renderSnapshot: LabelSnapshot;
  createdAt: number;
}

export interface AuditEvent {
  id: string;
  at: number;
  action: string;
  actorId: string | null;
  stationId: string | null;
  targetType: "PRINT_JOB" | "LABEL" | "PRINT_ATTEMPT" | "AGENT" | "SYSTEM";
  targetId: string | null;
  result: "OK" | "REJECTED";
  correlationId: string;
  details?: Record<string, unknown>;
}

export interface AgentInfo {
  agentId: string;
  stationId: string;
  printerId: string;
  agentVersion: string;
  protocolVersion: number;
  clockSkewMs: number;
  printerStatus: "READY" | "UNAVAILABLE" | "UNKNOWN";
}
