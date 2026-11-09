import type { AttemptState, JobStatus, PrintAttempt } from "./types.js";

/** Tabela de transições permitidas (printing-state-machine.md §3 e §5.1). */
const TRANSITIONS: Record<AttemptState, readonly AttemptState[]> = {
  CREATED: ["QUEUED", "CANCELLED"],
  QUEUED: ["CLAIMED", "CANCELLED"],
  CLAIMED: ["QUEUED", "CANCELLED", "FAILED", "SENDING"],
  SENDING: ["PRINTED_CONFIRMED", "FAILED", "UNKNOWN_OUTCOME"],
  UNKNOWN_OUTCOME: ["PRINTED_CONFIRMED", "FAILED"],
  PRINTED_CONFIRMED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: AttemptState, to: AttemptState): boolean {
  return TRANSITIONS[from].includes(to);
}

export const TERMINAL_STATES: readonly AttemptState[] = [
  "PRINTED_CONFIRMED",
  "FAILED",
  "CANCELLED",
];
export const IN_FLIGHT_STATES: readonly AttemptState[] = ["CLAIMED", "SENDING"];

export function isTerminal(state: AttemptState): boolean {
  return TERMINAL_STATES.includes(state);
}

type AttemptView = Pick<PrintAttempt, "state" | "holdReason">;

/** INV-10: o estado do PRINT_JOB é sempre calculado (printing-state-machine.md §3.1). */
export function deriveJobStatus(attempts: readonly AttemptView[]): JobStatus {
  const has = (s: AttemptState): boolean => attempts.some((a) => a.state === s);
  if (has("UNKNOWN_OUTCOME")) return "REQUIRES_REVIEW";
  const nonTerminal = attempts.filter((a) => !isTerminal(a.state));
  const heldNonTerminal = nonTerminal.filter((a) => a.holdReason !== null);
  if (has("FAILED") && heldNonTerminal.length > 0) return "AWAITING_DECISION";
  if (nonTerminal.some((a) => a.holdReason === null)) return "IN_PROGRESS";
  if (heldNonTerminal.length > 0) return "AWAITING_DECISION";
  if (attempts.length > 0 && attempts.every((a) => a.state === "PRINTED_CONFIRMED"))
    return "COMPLETED";
  if (attempts.every((a) => a.state === "CANCELLED")) return "CANCELLED";
  if (has("PRINTED_CONFIRMED")) return "PARTIALLY_COMPLETED";
  return "FAILED";
}

/** PRINT_JOB "ativo" para o bloqueio "Impressora em uso" (E-005, §6.4). */
export function isActiveStatus(status: JobStatus): boolean {
  return status === "IN_PROGRESS" || status === "AWAITING_DECISION" || status === "REQUIRES_REVIEW";
}
