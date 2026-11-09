import {
  InMemoryPrintStore,
  type PrintStore,
  PrintService,
  type Actor,
  type AgentInfo,
  type CreateOriginalInput,
  type JobView,
  type PrintServiceConfig,
} from "./index.js";

export const operator: Actor = { id: "op-1", role: "OPERATOR", displayName: "Operador Um" };
export const admin: Actor = { id: "adm-1", role: "ADMIN", displayName: "Admin" };

/** Permite rodar a mesma suíte contra outra implementação de PrintStore (ex.: PostgreSQL). */
let storeFactory: () => PrintStore = () => new InMemoryPrintStore();
export const useStoreFactory = (f: () => PrintStore): void => {
  storeFactory = f;
};

export function setup(config?: Partial<PrintServiceConfig>) {
  let t = 1_000_000;
  let n = 0;
  const store = storeFactory();
  const svc = new PrintService({
    store,
    clock: () => t,
    newId: () => `id-${++n}`,
    // Os testes de mecanismo usam quantidades variadas; a regra de produção (4, 8 e 32) tem testes próprios.
    config: { allowedQuantities: [1, 3, 4, 8, 10, 30, 32], ...config },
  });
  const clock = {
    advance: (ms: number) => {
      t += ms;
    },
  };
  return { store, svc, clock };
}

export const agentInfo = (
  stationId = "st-1",
  printerId = "pr-1",
  over: Partial<AgentInfo> = {},
): AgentInfo => ({
  agentId: `agent-${stationId}`,
  stationId,
  printerId,
  agentVersion: "0.1.0",
  protocolVersion: 0,
  clockSkewMs: 0,
  printerStatus: "READY",
  ...over,
});

let k = 0;
export function originalInput(over: Partial<CreateOriginalInput> = {}): CreateOriginalInput {
  return {
    idempotencyKey: `key-${++k}`,
    quantity: 1,
    actor: operator,
    stationId: "st-1",
    printerId: "pr-1",
    machine: { id: "m-1", code: "M01" },
    allowedMachineIds: ["m-1"],
    part: { id: "p-1", description: "AB123", partNumber: "29135-BP000" },
    shift: { id: "s-1", name: "Turno 1" },
    qr: { supplierCode: "AQ2A", alcCode: "AG10", operatorCode: "OP01", shiftCode: "A" },
    templateId: "tpl-1",
    templateVersion: 1,
    timezone: "America/Sao_Paulo",
    correlationId: `corr-${k}`,
    ...over,
  };
}

/** Executa uma tentativa até PRINTED_CONFIRMED (fluxo feliz do agente). */
export async function printOne(svc: PrintService, info: AgentInfo) {
  const att = await svc.claimNext(info);
  if (!att) throw new Error("nada para reivindicar");
  await svc.ackSending(att.id, info.agentId);
  return svc.reportResult(att.id, info.agentId, { kind: "PRINTED", evidence: "PRINTER_ACK" });
}

export const counts = (v: JobView) => {
  const c: Record<string, number> = {};
  for (const a of v.attempts) c[a.state] = (c[a.state] ?? 0) + 1;
  return c;
};
