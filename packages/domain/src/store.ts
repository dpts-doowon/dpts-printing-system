import type { AgentInfo, AuditEvent, Label, PrintAttempt, PrintJob } from "./types.js";

/**
 * Porta de persistência. A implementação em memória serve ao desenvolvimento local e aos testes;
 * a implementação PostgreSQL deve respeitar o mesmo contrato (transação única, unicidade da chave
 * de idempotência, atualização condicional por `version`, tabelas append-only para auditoria).
 */
export interface PrintStore {
  /** Executa `fn` de forma atômica e serializada. */
  transaction<T>(fn: (tx: PrintStoreTx) => Promise<T>): Promise<T>;
  /** Leituras fora de transação. */
  read(): PrintStoreTx;
}

export interface PrintStoreTx {
  getJob(id: string): Promise<PrintJob | undefined>;
  getJobByIdempotencyKey(key: string): Promise<PrintJob | undefined>;
  listJobs(): Promise<PrintJob[]>;
  getLabel(labelId: string): Promise<Label | undefined>;
  listLabelsByJob(jobId: string): Promise<Label[]>;
  getAttempt(id: string): Promise<PrintAttempt | undefined>;
  listAttemptsByJob(jobId: string): Promise<PrintAttempt[]>;
  listAttemptsByLabel(labelId: string): Promise<PrintAttempt[]>;
  listAttemptsByPrinter(printerId: string): Promise<PrintAttempt[]>;
  listAttempts(): Promise<PrintAttempt[]>;
  insertJob(job: PrintJob): Promise<void>;
  insertLabel(label: Label): Promise<void>;
  insertAttempt(attempt: PrintAttempt): Promise<void>;
  /** Atualização condicional: falha se `expectedVersion` não for a versão atual. */
  updateAttempt(attempt: PrintAttempt, expectedVersion: number): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
  listAudit(): Promise<AuditEvent[]>;
  getAgent(stationId: string): Promise<(AgentInfo & { lastHeartbeatAt: number }) | undefined>;
  saveAgent(agent: AgentInfo & { lastHeartbeatAt: number }): Promise<void>;
  /** Reserva `count` números de Trace sequenciais (1, 2, 3, ...) e devolve o primeiro. Atômico. */
  reserveTraceNumbers(count: number): Promise<number>;
}

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryPrintStore implements PrintStore {
  private jobs = new Map<string, PrintJob>();
  private labels = new Map<string, Label>();
  private attempts = new Map<string, PrintAttempt>();
  private audit: AuditEvent[] = [];
  private agents = new Map<string, AgentInfo & { lastHeartbeatAt: number }>();
  private traceCounter = 0;
  private chain: Promise<unknown> = Promise.resolve();

  private tx: PrintStoreTx = {
    getJob: async (id) => clone(this.jobs.get(id)),
    getJobByIdempotencyKey: async (key) =>
      clone([...this.jobs.values()].find((j) => j.idempotencyKey === key)),
    listJobs: async () => clone([...this.jobs.values()]),
    getLabel: async (id) => clone(this.labels.get(id)),
    listLabelsByJob: async (jobId) =>
      clone([...this.labels.values()].filter((l) => l.printJobId === jobId)),
    getAttempt: async (id) => clone(this.attempts.get(id)),
    listAttemptsByJob: async (jobId) =>
      clone([...this.attempts.values()].filter((a) => a.printJobId === jobId)),
    listAttemptsByLabel: async (labelId) =>
      clone([...this.attempts.values()].filter((a) => a.labelId === labelId)),
    listAttemptsByPrinter: async (printerId) =>
      clone([...this.attempts.values()].filter((a) => a.printerId === printerId)),
    listAttempts: async () => clone([...this.attempts.values()]),
    insertJob: async (job) => {
      if ([...this.jobs.values()].some((j) => j.idempotencyKey === job.idempotencyKey))
        throw new Error("unique violation: idempotency_key");
      this.jobs.set(job.id, clone(job));
    },
    insertLabel: async (label) => {
      if (this.labels.has(label.labelId)) throw new Error("unique violation: label_id");
      this.labels.set(label.labelId, clone(label));
    },
    insertAttempt: async (attempt) => {
      this.attempts.set(attempt.id, clone(attempt));
    },
    updateAttempt: async (attempt, expectedVersion) => {
      const cur = this.attempts.get(attempt.id);
      if (!cur || cur.version !== expectedVersion) throw new Error("version conflict");
      this.attempts.set(attempt.id, clone(attempt));
    },
    appendAudit: async (event) => {
      this.audit.push(clone(event));
    },
    listAudit: async () => clone(this.audit),
    getAgent: async (stationId) => clone(this.agents.get(stationId)),
    saveAgent: async (agent) => {
      this.agents.set(agent.stationId, clone(agent));
    },
    reserveTraceNumbers: async (count) => {
      const first = this.traceCounter + 1;
      this.traceCounter += count;
      return first;
    },
  };

  read(): PrintStoreTx {
    return this.tx;
  }

  transaction<T>(fn: (tx: PrintStoreTx) => Promise<T>): Promise<T> {
    // Serializa as transações; em caso de erro, desfaz as mudanças (snapshot de estado).
    const run = async (): Promise<T> => {
      const backup = {
        jobs: clone(this.jobs),
        labels: clone(this.labels),
        attempts: clone(this.attempts),
        audit: clone(this.audit),
        agents: clone(this.agents),
        traceCounter: this.traceCounter,
      };
      try {
        return await fn(this.tx);
      } catch (e) {
        this.jobs = backup.jobs;
        this.labels = backup.labels;
        this.attempts = backup.attempts;
        this.audit = backup.audit;
        this.agents = backup.agents;
        this.traceCounter = backup.traceCounter;
        throw e;
      }
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }
}
