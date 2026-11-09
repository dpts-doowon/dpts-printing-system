export const PROJECT_NAME = "doowon-traceability";

/** Nomes técnicos de auditoria normalizados -> texto amigável em português (a interface nunca mostra o código). */
export const AUDIT_PT: Record<string, string> = {
  LABEL_CREATED: "Etiqueta criada",
  PRINT_JOB_REQUESTED: "Impressão solicitada",
  PRINT_JOB_REJECTED: "Impressão recusada",
  PRINT_JOB_CANCELLED: "Impressão cancelada",
  RETRY_REQUESTED: "Nova tentativa solicitada",
  RETRY_REJECTED: "Nova tentativa recusada",
  REPRINT_REQUESTED: "Reimpressão solicitada",
  REPRINT_REJECTED: "Reimpressão recusada",
  ATTEMPT_CLAIMED: "Tentativa reservada pela estação",
  ATTEMPT_SENDING_ACKED: "Envio à impressora autorizado",
  ATTEMPT_PRINTED_CONFIRMED: "Impressão confirmada",
  ATTEMPT_FAILED: "Impressão falhou",
  ATTEMPT_UNKNOWN_OUTCOME: "Resultado da impressão desconhecido",
  LEASE_EXPIRED_REQUEUED: "Reserva expirada; tentativa devolvida à fila",
  LEASE_EXPIRED_UNKNOWN_OUTCOME: "Estação sem resposta durante o envio; resultado desconhecido",
  JOURNAL_UNAVAILABLE_UNKNOWN_OUTCOME:
    "Registro local da estação indisponível; resultado desconhecido",
  RESOLUTION_REQUESTED: "Conferência solicitada ao administrador",
  RESOLUTION_REJECTED: "Conferência recusada",
  UNKNOWN_OUTCOME_RESOLVED: "Resultado desconhecido resolvido pelo administrador",
  HELD_RELEASED: "Etiquetas retidas liberadas",
  HELD_CANCELLED: "Etiquetas retidas canceladas",
  JOB_RESUMED: "Impressão retomada de onde parou",
  JOB_REPRINTED_ALL: "Pedido reimpresso por completo",
  JOB_RESTART_REJECTED: "Recomeço de impressão rejeitado",
  HELD_DECISION_REJECTED: "Decisão sobre etiquetas retidas recusada",
  LOGIN_OK: "Login realizado",
  HISTORY_EXPORTED: "Relatório do histórico exportado",
  LOGIN_FAILED: "Falha de login",
  LOGOUT: "Logout",
  ADJUSTMENT_REQUESTED: "Ajuste de dados solicitado pelo operador",
  LABELS_CONFIRMED_BY_OPERATOR: "Operador conferiu as etiquetas",
  MASTER_DATA_CREATED: "Cadastro criado",
  MASTER_DATA_UPDATED: "Cadastro alterado",
  MASTER_DATA_INACTIVATED: "Cadastro inativado",
  MASTER_DATA_REACTIVATED: "Cadastro reativado",
  MASTER_DATA_DELETED: "Cadastro excluído",
};

export const auditPt = (action: string): string => AUDIT_PT[action] ?? "Evento do sistema";

export const JOB_STATUS_PT: Record<string, string> = {
  IN_PROGRESS: "Imprimindo",
  AWAITING_DECISION: "Aguardando decisão do administrador",
  REQUIRES_REVIEW: "Requer conferência do administrador",
  COMPLETED: "Concluída",
  PARTIALLY_COMPLETED: "Concluída parcialmente",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

export const ATTEMPT_STATE_PT: Record<string, string> = {
  CREATED: "Criada",
  QUEUED: "Na fila",
  CLAIMED: "Reservada",
  SENDING: "Enviando",
  PRINTED_CONFIRMED: "Impressa",
  FAILED: "Falhou",
  UNKNOWN_OUTCOME: "Resultado desconhecido",
  CANCELLED: "Cancelada",
};
