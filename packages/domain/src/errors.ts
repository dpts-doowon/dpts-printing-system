export type DomainErrorCode =
  | "PRINTER_BUSY"
  | "INVALID_QUANTITY"
  | "IDEMPOTENCY_CONFLICT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "MACHINE_NOT_ALLOWED"
  | "AGENT_INCOMPATIBLE"
  | "AGENT_NOT_HEALTHY"
  | "LEASE_INVALID"
  | "UNKNOWN_OUTCOME_OPEN"
  | "NOT_ELIGIBLE"
  | "REASON_REQUIRED";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    /** Mensagem em português simples, exibível ao operador. */
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const MSG = {
  PRINTER_BUSY: "Impressora em uso",
  UNKNOWN_BLOCK:
    "Não foi possível confirmar a impressão. Não imprima novamente até verificar a etiqueta.",
} as const;
