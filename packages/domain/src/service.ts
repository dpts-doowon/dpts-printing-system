import { DomainError, MSG } from "./errors.js";
import { hashCanonical } from "./hash.js";
import { canTransition, deriveJobStatus, isActiveStatus } from "./states.js";
import type { PrintStore, PrintStoreTx } from "./store.js";
import {
  ALLOWED_QUANTITIES,
  type Actor,
  type AgentInfo,
  type AttemptState,
  type AuditEvent,
  type EvidenceType,
  type JobKind,
  type JobStatus,
  type Label,
  type LabelSnapshot,
  type PrintAttempt,
  type PrintJob,
} from "./types.js";

/**
 * Parâmetros operacionais. Todos os valores são PROPOSED — PENDING DOOWON VALIDATION
 * (printing-reliability.md §3) e devem ser configuráveis.
 */
export interface PrintServiceConfig {
  leaseMs: number;
  heartbeatMaxAgeMs: number;
  clockSkewBlockMs: number;
  protocolMin: number;
  protocolMax: number;
  /** PROPOSED: o operador pode informar o resultado de uma etiqueta desconhecida após conferir (D-031). */
  operatorMayResolveUnknown: boolean;
  /** Quantidades aceitas num pedido ORIGINAL (E-016). Em produção são as de ALLOWED_QUANTITIES; só os testes usam outras. */
  allowedQuantities: readonly number[];
}

export const DEFAULT_CONFIG: PrintServiceConfig = {
  leaseMs: 30_000,
  heartbeatMaxAgeMs: 30_000,
  clockSkewBlockMs: 10_000,
  protocolMin: 0,
  protocolMax: 0,
  operatorMayResolveUnknown: true,
  allowedQuantities: ALLOWED_QUANTITIES,
};

export interface Deps {
  store: PrintStore;
  clock: () => number;
  newId: () => string;
  config?: Partial<PrintServiceConfig>;
}

export interface CreateOriginalInput {
  idempotencyKey: string;
  quantity: number;
  actor: Actor;
  stationId: string;
  printerId: string;
  machine: { id: string; code: string };
  /** Máquinas permitidas para a estação (D-040: 1 linha se o vínculo for fixo 1:1). */
  allowedMachineIds: string[];
  part: { id: string; description: string; partNumber: string };
  shift: { id: string; name: string };
  templateId: string;
  templateVersion: number;
  timezone: string;
  correlationId: string;
}

export interface CreateFollowUpInput {
  idempotencyKey: string;
  labelIds: string[];
  actor: Actor;
  stationId: string;
  printerId: string;
  correlationId: string;
  reason?: string;
}

export interface RestartJobInput {
  idempotencyKey: string;
  jobId: string;
  /** RESUME = continuar de onde parou; ALL = reimprimir tudo. */
  mode: "RESUME" | "ALL";
  actor: Actor;
  stationId: string;
  printerId: string;
  correlationId: string;
  reason?: string;
  /** Conferência física da etiqueta de resultado desconhecido (obrigatória quando houver); vale para todas. */
  unknownOutcome?: "PRINTED" | "NOT_PRINTED";
  /** Conferência por tentativa (mídia com várias colunas: uma linha pode deixar várias etiquetas incertas). */
  unknownOutcomes?: Record<string, "PRINTED" | "NOT_PRINTED">;
}

export type AttemptResult =
  | { kind: "PRINTED"; evidence: EvidenceType }
  | { kind: "FAILED"; failureClass: string; provenNoOutput: boolean }
  | { kind: "UNKNOWN"; reason: string };

export interface JobView {
  job: PrintJob;
  status: JobStatus;
  attempts: PrintAttempt[];
  labels: Label[];
}

/**
 * QR provisório (D-009/D-036 em aberto): um único código com a carga da peça e da produção
 * (identificador, descrição, Part Number, operador, turno e data/hora UTC), em JSON compacto versionado.
 */
export const PROVISIONAL_QR_SCHEMA_VERSION = "2";
export const provisionalQr = (f: {
  labelId: string;
  description: string;
  partNumber: string;
  operator: string;
  shift: string;
  producedAtUtc: string;
}): string =>
  JSON.stringify({
    v: Number(PROVISIONAL_QR_SCHEMA_VERSION),
    id: f.labelId,
    d: f.description,
    pn: f.partNumber,
    op: f.operator,
    t: f.shift,
    ts: f.producedAtUtc,
  });

export class PrintService {
  private cfg: PrintServiceConfig;
  constructor(private deps: Deps) {
    this.cfg = { ...DEFAULT_CONFIG, ...deps.config };
  }

  private get now(): number {
    return this.deps.clock();
  }

  // ---------- auditoria ----------
  private async audit(
    tx: PrintStoreTx,
    e: Omit<AuditEvent, "id" | "at" | "result"> & { result?: AuditEvent["result"] },
  ): Promise<void> {
    await tx.appendAudit({ id: this.deps.newId(), at: this.now, result: "OK", ...e });
  }

  private async auditRejected(
    action: string,
    actor: Actor | null,
    stationId: string | null,
    correlationId: string,
    err: DomainError,
  ): Promise<void> {
    await this.deps.store.transaction((tx) =>
      this.audit(tx, {
        action,
        actorId: actor?.id ?? null,
        stationId,
        targetType: "SYSTEM",
        targetId: null,
        result: "REJECTED",
        correlationId,
        details: { code: err.code },
      }),
    );
  }

  private async guarded<T>(
    action: string,
    actor: Actor | null,
    stationId: string | null,
    correlationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DomainError)
        await this.auditRejected(action, actor, stationId, correlationId, e);
      throw e;
    }
  }

  /** Leitura direta do repositório (consultas e relatórios). */
  get reader(): PrintStoreTx {
    return this.deps.store.read();
  }

  /** Registra um evento de auditoria avulso (ex.: alteração de dados mestres). */
  async recordAudit(
    e: Omit<AuditEvent, "id" | "at" | "result"> & { result?: AuditEvent["result"] },
  ): Promise<void> {
    await this.deps.store.transaction((tx) => this.audit(tx, e));
  }

  // ---------- consultas ----------
  async getJobView(jobId: string): Promise<JobView> {
    const tx = this.deps.store.read();
    const job = await tx.getJob(jobId);
    if (!job) throw new DomainError("NOT_FOUND", "Pedido de impressão não encontrado.");
    const attempts = (await tx.listAttemptsByJob(jobId)).sort(byOrder);
    const labels = (await tx.listLabelsByJob(jobId)).sort(
      (a, b) => a.sequenceInJob - b.sequenceInJob,
    );
    return { job, status: deriveJobStatus(attempts), attempts, labels };
  }

  /** PRINT_JOB ativo da impressora (usado para recuperar a tela após recarregar, §6.2). */
  async getActiveJobForPrinter(printerId: string): Promise<JobView | undefined> {
    const tx = this.deps.store.read();
    return this.findActiveJob(tx, printerId);
  }

  private async findActiveJob(tx: PrintStoreTx, printerId: string): Promise<JobView | undefined> {
    const jobs = (await tx.listJobs())
      .filter((j) => j.printerId === printerId)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const job of jobs) {
      const attempts = (await tx.listAttemptsByJob(job.id)).sort(byOrder);
      const status = deriveJobStatus(attempts);
      if (isActiveStatus(status)) {
        const labels = await tx.listLabelsByJob(job.id);
        return { job, status, attempts, labels };
      }
    }
    return undefined;
  }

  async listAudit(): Promise<AuditEvent[]> {
    return this.deps.store.read().listAudit();
  }

  // ---------- criação ----------
  async createOriginal(input: CreateOriginalInput): Promise<{ view: JobView; replayed: boolean }> {
    return this.guarded(
      "PRINT_JOB_REJECTED",
      input.actor,
      input.stationId,
      input.correlationId,
      () =>
        this.deps.store.transaction(async (tx) => {
          const fingerprint = hashCanonical({
            kind: "ORIGINAL",
            partId: input.part.id,
            quantity: input.quantity,
            machineId: input.machine.id,
            stationId: input.stationId,
            printerId: input.printerId,
            operatorId: input.actor.id,
          });
          const replay = await this.checkIdempotency(tx, input.idempotencyKey, fingerprint);
          if (replay) return { view: await this.viewIn(tx, replay.id), replayed: true };

          if (!this.cfg.allowedQuantities.includes(input.quantity))
            throw new DomainError("INVALID_QUANTITY", "Quantidade inválida. Use 4, 8 ou 32.");
          if (!input.allowedMachineIds.includes(input.machine.id))
            throw new DomainError("MACHINE_NOT_ALLOWED", "Máquina não permitida para este posto.");
          await this.assertPrinterFree(tx, input.printerId);

          const now = this.now;
          const job: PrintJob = {
            id: this.deps.newId(),
            kind: "ORIGINAL",
            quantity: input.quantity,
            stationId: input.stationId,
            machineId: input.machine.id,
            printerId: input.printerId,
            operatorId: input.actor.id,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            correlationId: input.correlationId,
            createdAt: now,
          };
          await tx.insertJob(job);
          for (let i = 1; i <= input.quantity; i++) {
            const labelId = this.deps.newId();
            const snapshot: LabelSnapshot = {
              labelId,
              part: input.part,
              operator: { id: input.actor.id, displayName: input.actor.displayName },
              machine: input.machine,
              stationId: input.stationId,
              printerId: input.printerId,
              shift: input.shift,
              producedAtUtc: new Date(now).toISOString(),
              timezone: input.timezone,
              qrContent: provisionalQr({
                labelId,
                description: input.part.description,
                partNumber: input.part.partNumber,
                operator: input.actor.displayName,
                shift: input.shift.name,
                producedAtUtc: new Date(now).toISOString(),
              }),
              qrSchemaVersion: PROVISIONAL_QR_SCHEMA_VERSION,
              templateId: input.templateId,
              templateVersion: input.templateVersion,
            };
            const label: Label = {
              labelId,
              printJobId: job.id,
              sequenceInJob: i,
              snapshot,
              snapshotHash: hashCanonical(snapshot),
              payloadHash: payloadHashOf(snapshot),
            };
            await tx.insertLabel(label);
            await tx.insertAttempt(newAttempt(this.deps.newId(), job, label, 1, i, now));
            await this.audit(tx, {
              action: "LABEL_CREATED",
              actorId: input.actor.id,
              stationId: input.stationId,
              targetType: "LABEL",
              targetId: labelId,
              correlationId: input.correlationId,
            });
          }
          await this.audit(tx, {
            action: "PRINT_JOB_REQUESTED",
            actorId: input.actor.id,
            stationId: input.stationId,
            targetType: "PRINT_JOB",
            targetId: job.id,
            correlationId: input.correlationId,
            details: { kind: "ORIGINAL", quantity: input.quantity },
          });
          return { view: await this.viewIn(tx, job.id), replayed: false };
        }),
    );
  }

  /** RETRY: nova tentativa para etiquetas cuja última tentativa terminou em FAILED. Somente ADMIN. */
  createRetry(input: CreateFollowUpInput): Promise<{ view: JobView; replayed: boolean }> {
    return this.createFollowUp("RETRY", input);
  }

  /** REPRINT: nova tentativa para etiqueta já impressa. Exige motivo. */
  createReprint(input: CreateFollowUpInput): Promise<{ view: JobView; replayed: boolean }> {
    return this.createFollowUp("REPRINT", input);
  }

  private createFollowUp(
    kind: Exclude<JobKind, "ORIGINAL">,
    input: CreateFollowUpInput,
  ): Promise<{ view: JobView; replayed: boolean }> {
    const action = kind === "RETRY" ? "RETRY_REJECTED" : "REPRINT_REJECTED";
    return this.guarded(action, input.actor, input.stationId, input.correlationId, () =>
      this.deps.store.transaction(async (tx) => {
        if (kind === "RETRY" && input.actor.role !== "ADMIN")
          throw new DomainError(
            "FORBIDDEN",
            "Somente o administrador pode criar uma nova tentativa.",
          );
        if (kind === "REPRINT" && (!input.reason || input.reason.trim() === ""))
          throw new DomainError("REASON_REQUIRED", "Informe o motivo da reimpressão.");
        if (input.labelIds.length === 0)
          throw new DomainError("NOT_ELIGIBLE", "Nenhuma etiqueta selecionada.");

        const fingerprint = hashCanonical({
          kind,
          labelIds: [...input.labelIds].sort(),
          reason: input.reason ?? null,
          stationId: input.stationId,
          printerId: input.printerId,
        });
        const replay = await this.checkIdempotency(tx, input.idempotencyKey, fingerprint);
        if (replay) return { view: await this.viewIn(tx, replay.id), replayed: true };

        const targets: { label: Label; last: PrintAttempt }[] = [];
        for (const labelId of input.labelIds) {
          const label = await tx.getLabel(labelId);
          if (!label) throw new DomainError("NOT_FOUND", "Etiqueta não encontrada.");
          const attempts = (await tx.listAttemptsByLabel(labelId)).sort(
            (a, b) => a.attemptNo - b.attemptNo,
          );
          const last = attempts[attempts.length - 1];
          if (!last) throw new DomainError("NOT_FOUND", "Etiqueta sem tentativas.");
          if (last.state === "UNKNOWN_OUTCOME")
            throw new DomainError("UNKNOWN_OUTCOME_OPEN", MSG.UNKNOWN_BLOCK);
          if (kind === "RETRY" && last.state !== "FAILED")
            throw new DomainError(
              "NOT_ELIGIBLE",
              "Só é possível tentar de novo uma etiqueta que falhou.",
            );
          if (kind === "REPRINT" && last.state !== "PRINTED_CONFIRMED")
            throw new DomainError(
              "NOT_ELIGIBLE",
              "Só é possível reimprimir uma etiqueta já impressa.",
            );
          targets.push({ label, last });
        }
        await this.assertPrinterFree(tx, input.printerId);

        const now = this.now;
        const job: PrintJob = {
          id: this.deps.newId(),
          kind,
          quantity: targets.length,
          stationId: input.stationId,
          machineId: targets[0]!.label.snapshot.machine.id,
          printerId: input.printerId,
          operatorId: input.actor.id,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
          correlationId: input.correlationId,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          createdAt: now,
        };
        await tx.insertJob(job);
        let order = 1;
        for (const { label, last } of targets) {
          await tx.insertAttempt(
            newAttempt(this.deps.newId(), job, label, last.attemptNo + 1, order++, now),
          );
        }
        await this.audit(tx, {
          action: kind === "RETRY" ? "RETRY_REQUESTED" : "REPRINT_REQUESTED",
          actorId: input.actor.id,
          stationId: input.stationId,
          targetType: "PRINT_JOB",
          targetId: job.id,
          correlationId: input.correlationId,
          details: { labelIds: input.labelIds, reason: input.reason ?? null },
        });
        return { view: await this.viewIn(tx, job.id), replayed: false };
      }),
    );
  }

  private async checkIdempotency(
    tx: PrintStoreTx,
    key: string,
    fingerprint: string,
  ): Promise<PrintJob | undefined> {
    const existing = await tx.getJobByIdempotencyKey(key);
    if (!existing) return undefined;
    if (existing.requestFingerprint !== fingerprint)
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "Esta chave já foi usada em um pedido diferente.",
      );
    return existing;
  }

  /** E-005 / §6.4: um PRINT_JOB ativo por impressora; bloqueia antes de criar qualquer registro. */
  private async assertPrinterFree(tx: PrintStoreTx, printerId: string): Promise<void> {
    const active = await this.findActiveJob(tx, printerId);
    if (active)
      throw new DomainError("PRINTER_BUSY", MSG.PRINTER_BUSY, {
        activeJobId: active.job.id,
        activeStatus: active.status,
      });
  }

  private async viewIn(tx: PrintStoreTx, jobId: string): Promise<JobView> {
    const job = (await tx.getJob(jobId))!;
    const attempts = (await tx.listAttemptsByJob(jobId)).sort(byOrder);
    const labels = (await tx.listLabelsByJob(jobId)).sort(
      (a, b) => a.sequenceInJob - b.sequenceInJob,
    );
    return { job, status: deriveJobStatus(attempts), attempts, labels };
  }

  // ---------- agente ----------
  async heartbeat(info: AgentInfo): Promise<void> {
    await this.deps.store.transaction(async (tx) => {
      await tx.saveAgent({ ...info, lastHeartbeatAt: this.now });
    });
  }

  private assertAgentHealthy(
    agent: (AgentInfo & { lastHeartbeatAt: number }) | undefined,
    info: AgentInfo,
  ): void {
    if (info.protocolVersion < this.cfg.protocolMin || info.protocolVersion > this.cfg.protocolMax)
      throw new DomainError(
        "AGENT_INCOMPATIBLE",
        "Versão do agente incompatível. Atualização necessária.",
      );
    if (Math.abs(info.clockSkewMs) > this.cfg.clockSkewBlockMs)
      throw new DomainError("AGENT_NOT_HEALTHY", "Relógio da estação fora do limite permitido.");
    if (!agent || this.now - agent.lastHeartbeatAt > this.cfg.heartbeatMaxAgeMs)
      throw new DomainError("AGENT_NOT_HEALTHY", "Agente sem heartbeat recente.");
  }

  /** Reivindica a próxima tentativa elegível da estação/impressora do agente (lease). */
  async claimNext(info: AgentInfo): Promise<PrintAttempt | null> {
    const [a] = await this.claimBatch(info, 1);
    return a ?? null;
  }

  /**
   * Reivindica até `max` tentativas seguidas do mesmo PRINT_JOB para uma única linha de etiquetas (mídia com
   * várias colunas). INV-8 vale para a linha: nada novo é reivindicado enquanto houver tentativa em voo.
   */
  async claimBatch(info: AgentInfo, max: number): Promise<PrintAttempt[]> {
    const limit = Math.max(1, Math.min(8, Math.floor(max)));
    await this.reapExpired();
    return this.deps.store.transaction(async (tx) => {
      this.assertAgentHealthy(await tx.getAgent(info.stationId), info);
      if (info.printerStatus !== "READY") return [];
      const onPrinter = await tx.listAttemptsByPrinter(info.printerId);
      // INV-8: no máximo uma tentativa em voo por impressora.
      if (onPrinter.some((a) => a.state === "CLAIMED" || a.state === "SENDING")) return [];
      const jobs = new Map((await tx.listJobs()).map((j) => [j.id, j]));
      const candidates = onPrinter
        .filter(
          (a) => a.state === "QUEUED" && a.holdReason === null && a.stationId === info.stationId,
        )
        .sort(
          (a, b) =>
            jobs.get(a.printJobId)!.createdAt - jobs.get(b.printJobId)!.createdAt || byOrder(a, b),
        );
      const out: PrintAttempt[] = [];
      let jobId: string | undefined;
      for (const c of candidates) {
        if (out.length >= limit) break;
        if (jobId !== undefined && c.printJobId !== jobId) break;
        // INV-5: nunca iniciar tentativa para etiqueta cuja última tentativa está em UNKNOWN_OUTCOME.
        const prior = (await tx.listAttemptsByLabel(c.labelId)).filter(
          (a) => a.attemptNo < c.attemptNo,
        );
        if (prior.some((a) => a.state === "UNKNOWN_OUTCOME")) continue;
        const claimed = await this.move(tx, c, "CLAIMED", {
          lease: { agentId: info.agentId, expiresAt: this.now + this.cfg.leaseMs },
        });
        await this.audit(tx, {
          action: "ATTEMPT_CLAIMED",
          actorId: null,
          stationId: info.stationId,
          targetType: "PRINT_ATTEMPT",
          targetId: c.id,
          correlationId: c.correlationId,
          details: {
            agentId: info.agentId,
            agentVersion: info.agentVersion,
            clockSkewMs: info.clockSkewMs,
          },
        });
        jobId = c.printJobId;
        out.push(claimed);
      }
      return out;
    });
  }

  /** E-004: reconhecimento do servidor antes do primeiro byte (CLAIMED → SENDING). */
  async ackSending(attemptId: string, agentId: string): Promise<PrintAttempt> {
    return this.deps.store.transaction(async (tx) => {
      const a = await this.mustAttempt(tx, attemptId);
      if (a.state === "SENDING" && a.lease?.agentId === agentId) return a; // repetição idempotente
      if (a.state !== "CLAIMED")
        throw new DomainError("INVALID_TRANSITION", "A tentativa não está disponível para envio.");
      if (!a.lease || a.lease.agentId !== agentId || a.lease.expiresAt <= this.now)
        throw new DomainError("LEASE_INVALID", "Reserva da tentativa inválida ou expirada.");
      const sending = await this.move(tx, a, "SENDING", {
        lease: { agentId, expiresAt: this.now + this.cfg.leaseMs },
      });
      await this.audit(tx, {
        action: "ATTEMPT_SENDING_ACKED",
        actorId: null,
        stationId: a.stationId,
        targetType: "PRINT_ATTEMPT",
        targetId: a.id,
        correlationId: a.correlationId,
        details: { agentId },
      });
      return sending;
    });
  }

  /** Renova o lease durante o envio (heartbeat por tentativa). */
  async renewLease(attemptId: string, agentId: string): Promise<void> {
    await this.deps.store.transaction(async (tx) => {
      const a = await this.mustAttempt(tx, attemptId);
      if ((a.state !== "CLAIMED" && a.state !== "SENDING") || a.lease?.agentId !== agentId)
        throw new DomainError("LEASE_INVALID", "Reserva da tentativa inválida.");
      await tx.updateAttempt(
        {
          ...a,
          version: a.version + 1,
          lease: { agentId, expiresAt: this.now + this.cfg.leaseMs },
        },
        a.version,
      );
    });
  }

  /** O agente libera uma tentativa reivindicada antes de qualquer envio. */
  async releaseClaim(attemptId: string, agentId: string): Promise<void> {
    await this.deps.store.transaction(async (tx) => {
      const a = await this.mustAttempt(tx, attemptId);
      if (a.state !== "CLAIMED" || a.lease?.agentId !== agentId)
        throw new DomainError(
          "INVALID_TRANSITION",
          "Só é possível liberar uma tentativa reivindicada.",
        );
      await this.move(tx, a, "QUEUED", { lease: null });
    });
  }

  async reportResult(
    attemptId: string,
    agentId: string,
    result: AttemptResult,
  ): Promise<PrintAttempt> {
    return this.deps.store.transaction(async (tx) => {
      const a = await this.mustAttempt(tx, attemptId);
      if (a.lease && a.lease.agentId !== agentId)
        throw new DomainError("LEASE_INVALID", "Tentativa pertence a outro agente.");

      // Relatório repetido (idempotente): mesmo resultado já registrado.
      if (result.kind === "PRINTED" && a.state === "PRINTED_CONFIRMED") return a;
      if (result.kind === "UNKNOWN" && a.state === "UNKNOWN_OUTCOME") return a;
      if (result.kind === "FAILED" && a.state === "FAILED") return a;

      let target: AttemptState;
      let patch: Partial<PrintAttempt> = { lease: null };
      if (result.kind === "PRINTED") {
        if (a.state !== "SENDING")
          throw new DomainError(
            "INVALID_TRANSITION",
            "Só uma tentativa em envio pode ser confirmada.",
          );
        target = "PRINTED_CONFIRMED";
        patch = { ...patch, evidenceType: result.evidence };
      } else if (result.kind === "FAILED") {
        if (a.state === "CLAIMED") {
          if (!result.provenNoOutput)
            throw new DomainError(
              "INVALID_TRANSITION",
              "Falha antes do envio exige prova de que nada foi enviado.",
            );
          target = "FAILED";
        } else if (a.state === "SENDING") {
          // Sem prova de que nada saiu, a incerteza vence: UNKNOWN_OUTCOME (INV-5/6).
          target = result.provenNoOutput ? "FAILED" : "UNKNOWN_OUTCOME";
        } else
          throw new DomainError(
            "INVALID_TRANSITION",
            "Estado da tentativa não permite registrar falha.",
          );
        patch = { ...patch, failureClass: result.failureClass };
      } else {
        if (a.state !== "SENDING")
          throw new DomainError(
            "INVALID_TRANSITION",
            "Só uma tentativa em envio pode ficar com resultado desconhecido.",
          );
        target = "UNKNOWN_OUTCOME";
        patch = { ...patch, failureClass: result.reason };
      }
      const moved = await this.move(tx, a, target, patch);
      if (target === "FAILED" || target === "UNKNOWN_OUTCOME")
        await this.holdRemaining(tx, a.printJobId);
      await this.audit(tx, {
        action: `ATTEMPT_${target}`,
        actorId: null,
        stationId: a.stationId,
        targetType: "PRINT_ATTEMPT",
        targetId: a.id,
        correlationId: a.correlationId,
        details: { agentId, ...(result.kind === "PRINTED" ? { evidence: result.evidence } : {}) },
      });
      return moved;
    });
  }

  /** Reaper: CLAIMED expirado → QUEUED; SENDING expirado → UNKNOWN_OUTCOME. Nunca cria tentativa (INV-5). */
  async reapExpired(): Promise<{ requeued: number; unknown: number }> {
    return this.deps.store.transaction(async (tx) => {
      let requeued = 0;
      let unknown = 0;
      for (const a of await tx.listAttempts()) {
        if (!a.lease || a.lease.expiresAt > this.now) continue;
        if (a.state === "CLAIMED") {
          await this.move(tx, a, "QUEUED", { lease: null });
          requeued++;
          await this.audit(tx, {
            action: "LEASE_EXPIRED_REQUEUED",
            actorId: null,
            stationId: a.stationId,
            targetType: "PRINT_ATTEMPT",
            targetId: a.id,
            correlationId: a.correlationId,
          });
        } else if (a.state === "SENDING") {
          await this.move(tx, a, "UNKNOWN_OUTCOME", { lease: null, failureClass: "LEASE_EXPIRED" });
          await this.holdRemaining(tx, a.printJobId);
          unknown++;
          await this.audit(tx, {
            action: "LEASE_EXPIRED_UNKNOWN_OUTCOME",
            actorId: null,
            stationId: a.stationId,
            targetType: "PRINT_ATTEMPT",
            targetId: a.id,
            correlationId: a.correlationId,
          });
        }
      }
      return { requeued, unknown };
    });
  }

  /** Journal do agente ausente ou corrompido (§13): tentativas SENDING da estação viram UNKNOWN_OUTCOME. */
  async markSendingUnknownForStation(stationId: string, agentId: string): Promise<number> {
    return this.deps.store.transaction(async (tx) => {
      let n = 0;
      for (const a of await tx.listAttempts()) {
        if (a.stationId !== stationId || a.state !== "SENDING") continue;
        await this.move(tx, a, "UNKNOWN_OUTCOME", {
          lease: null,
          failureClass: "JOURNAL_UNAVAILABLE",
        });
        await this.holdRemaining(tx, a.printJobId);
        await this.audit(tx, {
          action: "JOURNAL_UNAVAILABLE_UNKNOWN_OUTCOME",
          actorId: null,
          stationId,
          targetType: "PRINT_ATTEMPT",
          targetId: a.id,
          correlationId: a.correlationId,
          details: { agentId },
        });
        n++;
      }
      return n;
    });
  }

  // ---------- ações humanas ----------
  /** Cancela as tentativas ainda não enviadas do PRINT_JOB (CREATED/QUEUED/CLAIMED). */
  async cancelJob(jobId: string, actor: Actor, correlationId: string): Promise<JobView> {
    return this.deps.store.transaction(async (tx) => {
      const job = await tx.getJob(jobId);
      if (!job) throw new DomainError("NOT_FOUND", "Pedido de impressão não encontrado.");
      for (const a of await tx.listAttemptsByJob(jobId)) {
        if (a.state === "CREATED" || a.state === "QUEUED" || a.state === "CLAIMED")
          await this.move(tx, a, "CANCELLED", { lease: null, holdReason: null });
      }
      await this.audit(tx, {
        action: "PRINT_JOB_CANCELLED",
        actorId: actor.id,
        stationId: job.stationId,
        targetType: "PRINT_JOB",
        targetId: jobId,
        correlationId,
      });
      return this.viewIn(tx, jobId);
    });
  }

  /** OPERATOR solicita ação do ADMIN; não resolve nada (D-031). */
  async requestResolution(attemptId: string, actor: Actor, correlationId: string): Promise<void> {
    await this.deps.store.transaction(async (tx) => {
      const a = await this.mustAttempt(tx, attemptId);
      if (a.state !== "UNKNOWN_OUTCOME")
        throw new DomainError("NOT_ELIGIBLE", "A tentativa não está com resultado desconhecido.");
      await this.audit(tx, {
        action: "RESOLUTION_REQUESTED",
        actorId: actor.id,
        stationId: a.stationId,
        targetType: "PRINT_ATTEMPT",
        targetId: a.id,
        correlationId,
      });
    });
  }

  /** Única saída de UNKNOWN_OUTCOME (INV-6). Somente ADMIN, aplicado no servidor. */
  async resolveUnknown(
    attemptId: string,
    actor: Actor,
    outcome: "PRINTED" | "NOT_PRINTED",
    note: string,
    correlationId: string,
  ): Promise<PrintAttempt> {
    return this.guarded("RESOLUTION_REJECTED", actor, null, correlationId, () =>
      this.deps.store.transaction(async (tx) => {
        if (actor.role !== "ADMIN")
          throw new DomainError(
            "FORBIDDEN",
            "Somente o administrador pode resolver esta ocorrência.",
          );
        if (note.trim() === "") throw new DomainError("REASON_REQUIRED", "Informe uma observação.");
        const a = await this.mustAttempt(tx, attemptId);
        if (a.state !== "UNKNOWN_OUTCOME")
          throw new DomainError(
            "INVALID_TRANSITION",
            "A tentativa não está com resultado desconhecido.",
          );
        const moved = await this.move(
          tx,
          a,
          outcome === "PRINTED" ? "PRINTED_CONFIRMED" : "FAILED",
          {
            evidenceType: outcome === "PRINTED" ? "OPERATOR_CONFIRMATION" : null,
            failureClass: outcome === "PRINTED" ? null : "ADMIN_CONFIRMED_NOT_PRINTED",
            resolvedBy: actor.id,
            resolvedAt: this.now,
          },
        );
        await this.audit(tx, {
          action: "UNKNOWN_OUTCOME_RESOLVED",
          actorId: actor.id,
          stationId: a.stationId,
          targetType: "PRINT_ATTEMPT",
          targetId: a.id,
          correlationId,
          details: { outcome, note },
        });
        return moved;
      }),
    );
  }

  /** ADMIN decide continuar ("release") ou cancelar o restante retido (§10.1). */
  async decideHeld(
    jobId: string,
    actor: Actor,
    decision: "CONTINUE" | "CANCEL",
    correlationId: string,
  ): Promise<JobView> {
    return this.guarded("HELD_DECISION_REJECTED", actor, null, correlationId, () =>
      this.deps.store.transaction(async (tx) => {
        if (actor.role !== "ADMIN")
          throw new DomainError("FORBIDDEN", "Somente o administrador pode decidir.");
        const attempts = await tx.listAttemptsByJob(jobId);
        if (attempts.some((a) => a.state === "UNKNOWN_OUTCOME"))
          throw new DomainError("UNKNOWN_OUTCOME_OPEN", MSG.UNKNOWN_BLOCK);
        const held = attempts.filter((a) => a.state === "QUEUED" && a.holdReason !== null);
        for (const a of held) {
          if (decision === "CONTINUE") await this.move(tx, a, "QUEUED", { holdReason: null });
          else await this.move(tx, a, "CANCELLED", { holdReason: null });
        }
        await this.audit(tx, {
          action: decision === "CONTINUE" ? "HELD_RELEASED" : "HELD_CANCELLED",
          actorId: actor.id,
          stationId: null,
          targetType: "PRINT_JOB",
          targetId: jobId,
          correlationId,
          details: { count: held.length },
        });
        return this.viewIn(tx, jobId);
      }),
    );
  }

  /**
   * Recomeço pelo operador (D-019/D-031 — divergência da recomendação ADMIN-only, a validar com a Doowon).
   * RESUME: continua de onde parou — as etiquetas que falharam e o restante retido voltam à fila com o
   * mesmo label_id (nova tentativa, attemptNo+1); as já confirmadas não são reimpressas.
   * ALL: reimprime o pedido inteiro (mesmos label_id), com motivo.
   * Se houver tentativa com resultado desconhecido, o operador informa o que viu na etiqueta (conferência
   * física); isso é auditado como confirmação do operador.
   */
  restartJob(input: RestartJobInput): Promise<{ view: JobView; replayed: boolean }> {
    const isAll = input.mode === "ALL";
    return this.guarded(
      "JOB_RESTART_REJECTED",
      input.actor,
      input.stationId,
      input.correlationId,
      () =>
        this.deps.store.transaction(async (tx) => {
          const job = await tx.getJob(input.jobId);
          if (!job) throw new DomainError("NOT_FOUND", "Pedido de impressão não encontrado.");
          if (input.actor.role === "OPERATOR" && job.stationId !== input.stationId)
            throw new DomainError("FORBIDDEN", "Este pedido pertence a outro posto.");
          if (isAll && (!input.reason || input.reason.trim() === ""))
            throw new DomainError("REASON_REQUIRED", "Informe o motivo da reimpressão.");

          const fingerprint = hashCanonical({
            op: "RESTART",
            mode: input.mode,
            jobId: input.jobId,
            reason: input.reason ?? null,
            unknown: input.unknownOutcome ?? null,
            unknowns: input.unknownOutcomes ?? null,
            stationId: input.stationId,
          });
          const replay = await this.checkIdempotency(tx, input.idempotencyKey, fingerprint);
          if (replay) return { view: await this.viewIn(tx, replay.id), replayed: true };

          const attempts = (await tx.listAttemptsByJob(input.jobId)).sort(byOrder);
          const status = deriveJobStatus(attempts);
          if (status === "IN_PROGRESS")
            throw new DomainError(
              "NOT_ELIGIBLE",
              "A impressão ainda está em andamento. Aguarde ou cancele o restante.",
            );

          const unknown = attempts.filter((a) => a.state === "UNKNOWN_OUTCOME");
          const outcomeOf = (id: string): "PRINTED" | "NOT_PRINTED" | undefined =>
            input.unknownOutcomes?.[id] ?? input.unknownOutcome;
          if (unknown.some((a) => !outcomeOf(a.id)))
            throw new DomainError("UNKNOWN_OUTCOME_OPEN", MSG.UNKNOWN_BLOCK);
          if (
            unknown.length > 0 &&
            input.actor.role === "OPERATOR" &&
            !this.cfg.operatorMayResolveUnknown
          )
            throw new DomainError(
              "FORBIDDEN",
              "Somente o administrador pode resolver esta ocorrência.",
            );

          // Estado final de cada etiqueta do pedido, depois da conferência informada.
          const fate = new Map<string, AttemptState>();
          for (const a of attempts) {
            let st: AttemptState = a.state;
            if (st === "UNKNOWN_OUTCOME")
              st = outcomeOf(a.id) === "PRINTED" ? "PRINTED_CONFIRMED" : "FAILED";
            if (st === "QUEUED")
              fate.set(a.labelId, "QUEUED"); // retida
            else fate.set(a.labelId, st);
          }
          const labelOrder: string[] = [];
          for (const a of attempts) if (!labelOrder.includes(a.labelId)) labelOrder.push(a.labelId);
          const targetIds = labelOrder.filter((id) => {
            const st = fate.get(id)!;
            return isAll ? true : st === "FAILED" || st === "QUEUED" || st === "CANCELLED";
          });
          if (targetIds.length === 0)
            throw new DomainError("NOT_ELIGIBLE", "Não há etiquetas pendentes para continuar.");

          // A única atividade permitida na impressora é a do próprio pedido, que será encerrada aqui.
          const active = await this.findActiveJob(tx, input.printerId);
          if (active && active.job.id !== input.jobId)
            throw new DomainError("PRINTER_BUSY", MSG.PRINTER_BUSY, {
              activeJobId: active.job.id,
              activeStatus: active.status,
            });

          const now = this.now;
          for (const a of attempts) {
            if (a.state === "UNKNOWN_OUTCOME") {
              const printed = outcomeOf(a.id) === "PRINTED";
              await this.move(tx, a, printed ? "PRINTED_CONFIRMED" : "FAILED", {
                evidenceType: printed ? "OPERATOR_CONFIRMATION" : null,
                failureClass: printed ? null : "OPERATOR_CONFIRMED_NOT_PRINTED",
                resolvedBy: input.actor.id,
                resolvedAt: now,
              });
              await this.audit(tx, {
                action: "UNKNOWN_OUTCOME_RESOLVED",
                actorId: input.actor.id,
                stationId: input.stationId,
                targetType: "PRINT_ATTEMPT",
                targetId: a.id,
                correlationId: input.correlationId,
                details: {
                  outcome: printed ? "PRINTED" : "NOT_PRINTED",
                  note: "Conferência física informada pelo operador ao recomeçar a impressão.",
                  byRole: input.actor.role,
                },
              });
            } else if (a.state === "QUEUED" || a.state === "CREATED" || a.state === "CLAIMED") {
              await this.move(tx, a, "CANCELLED", { lease: null, holdReason: null });
            }
          }

          const reason = isAll ? input.reason!.trim() : input.reason?.trim();
          const next: PrintJob = {
            id: this.deps.newId(),
            kind: isAll ? "REPRINT" : "RETRY",
            quantity: targetIds.length,
            stationId: input.stationId,
            machineId: job.machineId,
            printerId: input.printerId,
            operatorId: input.actor.id,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            correlationId: input.correlationId,
            ...(reason ? { reason } : {}),
            createdAt: now,
          };
          await tx.insertJob(next);
          let order = 1;
          for (const labelId of targetIds) {
            const label = await tx.getLabel(labelId);
            if (!label) throw new DomainError("NOT_FOUND", "Etiqueta não encontrada.");
            const prior = await tx.listAttemptsByLabel(labelId);
            const lastNo = prior.reduce((m, x) => Math.max(m, x.attemptNo), 0);
            await tx.insertAttempt(
              newAttempt(this.deps.newId(), next, label, lastNo + 1, order++, now),
            );
          }
          await this.audit(tx, {
            action: isAll ? "JOB_REPRINTED_ALL" : "JOB_RESUMED",
            actorId: input.actor.id,
            stationId: input.stationId,
            targetType: "PRINT_JOB",
            targetId: next.id,
            correlationId: input.correlationId,
            details: {
              fromJobId: input.jobId,
              labelIds: targetIds,
              reason: reason ?? null,
              byRole: input.actor.role,
            },
          });
          return { view: await this.viewIn(tx, next.id), replayed: false };
        }),
    );
  }

  // ---------- internos ----------
  private async mustAttempt(tx: PrintStoreTx, id: string): Promise<PrintAttempt> {
    const a = await tx.getAttempt(id);
    if (!a) throw new DomainError("NOT_FOUND", "Tentativa não encontrada.");
    return a;
  }

  private async holdRemaining(tx: PrintStoreTx, jobId: string): Promise<void> {
    for (const a of await tx.listAttemptsByJob(jobId)) {
      if (a.state === "QUEUED" && a.holdReason === null)
        await tx.updateAttempt({ ...a, version: a.version + 1, holdReason: "JOB_HELD" }, a.version);
    }
  }

  private async move(
    tx: PrintStoreTx,
    a: PrintAttempt,
    to: AttemptState,
    patch: Partial<PrintAttempt> = {},
  ): Promise<PrintAttempt> {
    if (a.state !== to && !canTransition(a.state, to))
      throw new DomainError("INVALID_TRANSITION", `Transição inválida: ${a.state} → ${to}.`);
    const next: PrintAttempt = { ...a, ...patch, state: to, version: a.version + 1 };
    await tx.updateAttempt(next, a.version);
    return next;
  }
}

function byOrder(a: PrintAttempt, b: PrintAttempt): number {
  return a.order - b.order;
}

function payloadHashOf(s: LabelSnapshot): string {
  return hashCanonical({
    labelId: s.labelId,
    part: s.part,
    operator: s.operator,
    machine: s.machine,
    shift: s.shift,
    producedAtUtc: s.producedAtUtc,
    qrContent: s.qrContent,
    qrSchemaVersion: s.qrSchemaVersion,
    templateVersion: s.templateVersion,
  });
}

function newAttempt(
  id: string,
  job: PrintJob,
  label: Label,
  attemptNo: number,
  order: number,
  now: number,
): PrintAttempt {
  return {
    id,
    printJobId: job.id,
    labelId: label.labelId,
    printerId: job.printerId,
    stationId: job.stationId,
    attemptNo,
    order,
    state: "QUEUED",
    version: 1,
    holdReason: null,
    evidenceType: null,
    failureClass: null,
    lease: null,
    resolvedBy: null,
    resolvedAt: null,
    correlationId: job.correlationId,
    payloadHash: label.payloadHash,
    templateVersion: label.snapshot.templateVersion,
    qrSchemaVersion: label.snapshot.qrSchemaVersion,
    renderSnapshot: structuredClone(label.snapshot),
    createdAt: now,
  };
}
