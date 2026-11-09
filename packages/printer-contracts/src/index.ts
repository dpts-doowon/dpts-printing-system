import type { AgentInfo, AttemptResult, EvidenceType, LabelSnapshot } from "@doowon/domain";

/** Versão do protocolo Print Agent <-> servidor (E-012). Deve estar na faixa publicada pelo backend. */
export const PROTOCOL_VERSION = 0;

export interface ClaimedAttemptDto {
  attemptId: string;
  printJobId: string;
  labelId: string;
  attemptNo: number;
  correlationId: string;
  payloadHash: string;
  templateVersion: number;
  qrSchemaVersion: string;
  renderSnapshot: LabelSnapshot;
}

/** Transporte do agente (HTTP em produção; em processo nos testes). O agente nunca escolhe impressora. */
export interface AgentTransport {
  heartbeat(info: AgentInfo): Promise<void>;
  claim(info: AgentInfo): Promise<ClaimedAttemptDto | null>;
  /** Reivindica até `max` etiquetas seguidas do mesmo pedido, para uma linha de mídia com várias colunas. */
  claimBatch?(info: AgentInfo, max: number): Promise<ClaimedAttemptDto[]>;
  ack(attemptId: string): Promise<void>;
  report(attemptId: string, result: AttemptResult): Promise<void>;
  release(attemptId: string): Promise<void>;
  renew(attemptId: string): Promise<void>;
  journalUnavailable(): Promise<void>;
}

export type PrinterStatus = "READY" | "UNAVAILABLE" | "UNKNOWN";

/** Comando renderizado de forma neutra; o adaptador real traduz para a linguagem da impressora (D-007). */
export interface RenderedCommand {
  labelId: string;
  widthMm: number;
  heightMm: number;
  text: string;
  hash: string;
  data: Record<string, string>;
}

export type SendOutcome =
  | { kind: "CONFIRMED"; evidence: EvidenceType }
  /** A impressora recusou e o adaptador certifica que nada saiu. */
  | { kind: "REJECTED_NO_OUTPUT"; reason: string }
  /** Qualquer incerteza: queda, timeout, resposta parcial. */
  | { kind: "UNCERTAIN"; reason: string };

export interface PrinterAdapter {
  getStatus(): Promise<PrinterStatus>;
  send(command: RenderedCommand): Promise<SendOutcome>;
  /** Quantas etiquetas cabem numa linha da mídia (padrão 1). */
  labelsPerRow?: number;
  /** Envia uma linha de 1 a `labelsPerRow` etiquetas em um único comando; o resultado vale para todas. */
  sendRow?(commands: RenderedCommand[]): Promise<SendOutcome>;
}

export type JournalEntryType =
  "CLAIMED" | "INTENT_SEND" | "ACKED" | "ABOUT_TO_SEND" | "SENT" | "RESULT_PENDING" | "REPORTED";

export interface JournalEntry {
  type: JournalEntryType;
  attemptId: string;
  at: number;
  result?: AttemptResult;
}

/** Journal local durável (E-004, §5.2 e §13). */
export interface Journal {
  append(entry: JournalEntry): void;
  /** Lança se o journal estiver corrompido. */
  readAll(): JournalEntry[];
}
