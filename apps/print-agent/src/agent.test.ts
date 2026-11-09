import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  InMemoryPrintStore,
  PrintService,
  type Actor,
  type CreateOriginalInput,
} from "@doowon/domain";
import { PrintAgent } from "./agent.js";
import { InProcessTransport } from "./in-process-transport.js";
import { FileJournal, MemoryJournal } from "./journal.js";
import { SimulatedPrinter } from "./simulator.js";

const operator: Actor = { id: "op-1", role: "OPERATOR", displayName: "Operador Um" };
let k = 0;

function world() {
  let t = 1_000_000;
  let n = 0;
  const svc = new PrintService({
    store: new InMemoryPrintStore(),
    clock: () => t,
    newId: () => `id-${++n}`,
    // Testes de mecanismo usam quantidades variadas; a regra de produção (4, 8 e 32) é testada no domínio e na API.
    config: { allowedQuantities: [1, 3, 4, 8, 10, 30, 32] },
  });
  const printer = new SimulatedPrinter();
  const journal = new MemoryJournal();
  const transport = new InProcessTransport(svc, "agent-1", "st-1");
  const mkAgent = (over: Partial<ConstructorParameters<typeof PrintAgent>[0]> = {}) =>
    new PrintAgent({
      agentId: "agent-1",
      stationId: "st-1",
      printerId: "pr-1",
      agentVersion: "0.1.0",
      transport,
      printer,
      journal,
      clock: () => t,
      ...over,
    });
  const input = (over: Partial<CreateOriginalInput> = {}): CreateOriginalInput => ({
    idempotencyKey: `k-${++k}`,
    quantity: 1,
    actor: operator,
    stationId: "st-1",
    printerId: "pr-1",
    machine: { id: "m-1", code: "M01" },
    allowedMachineIds: ["m-1"],
    part: { id: "p-1", description: "AB123", partNumber: "29135-BP000" },
    shift: { id: "s-1", name: "Turno 1" },
    qr: { supplierCode: "AQ2A", alcCode: "AG10", operatorCode: "OP01", shiftCode: "A" },
    templateId: "tpl",
    templateVersion: 1,
    timezone: "America/Sao_Paulo",
    correlationId: `c-${k}`,
    ...over,
  });
  return { svc, printer, journal, transport, mkAgent, input, advance: (ms: number) => (t += ms) };
}

describe("Print Agent + simulador", () => {
  it("imprime um pedido de 10 em ordem e o PRINT_JOB termina COMPLETED", async () => {
    const w = world();
    const { view } = await w.svc.createOriginal(w.input({ quantity: 10 }));
    const agent = w.mkAgent();
    for (let i = 0; i < 10; i++) expect((await agent.tick()).kind).toBe("PRINTED");
    expect((await agent.tick()).kind).toBe("IDLE");
    expect(w.printer.printed.map((c) => c.labelId)).toEqual(view.labels.map((l) => l.labelId));
    expect((await w.svc.getJobView(view.job.id)).status).toBe("COMPLETED");
    expect(w.journal.entries.at(-1)?.type).toBe("REPORTED");
  });

  it("a etiqueta renderizada contém só campos do REQ-011 (sem 'lote') e 30 x 20 mm", async () => {
    const w = world();
    await w.svc.createOriginal(w.input());
    await w.mkAgent().tick();
    const c = w.printer.printed[0]!;
    expect([c.widthMm, c.heightMm]).toEqual([30, 20]);
    expect(Object.keys(c.data).sort()).toEqual(
      ["date", "description", "labelId", "partNumber", "producedAt", "qr", "time"].sort(),
    );
    // Só o que a Doowon pediu na etiqueta: ALC, Part Number, data e hora (sem operador e turno).
    expect(c.data["description"]).toBe("AG10");
    expect(c.data["partNumber"]).toBe("29135-BP000");
    expect(c.data["date"]).toMatch(/^\d{6}$/);
    expect(c.data["time"]).toMatch(/^\d{2}:\d{2}$/);
    expect(c.text).not.toContain("OP:");
    expect(c.text).not.toContain("TURNO");
    expect(c.text.toLowerCase()).not.toContain("lote");
  });

  it("sem ack do servidor, nenhum byte é enviado e a tentativa volta à fila", async () => {
    const w = world();
    const { view } = await w.svc.createOriginal(w.input());
    w.transport.failAck = true;
    const r = await w.mkAgent().tick();
    expect(r).toEqual({ kind: "SKIPPED", reason: "NO_ACK" });
    expect(w.printer.received).toHaveLength(0);
    // nada se perdeu: o agente tenta de novo quando a rede volta
    w.transport.failAck = false;
    expect((await w.mkAgent().tick()).kind).toBe("PRINTED");
    expect((await w.svc.getJobView(view.job.id)).status).toBe("COMPLETED");
  });

  it("incerteza no envio vira UNKNOWN_OUTCOME e nunca é reenviada", async () => {
    const w = world();
    const { view } = await w.svc.createOriginal(w.input({ quantity: 10 }));
    w.printer.script = ["OK", "OK", "UNCERTAIN"];
    const agent = w.mkAgent();
    expect((await agent.tick()).kind).toBe("PRINTED");
    expect((await agent.tick()).kind).toBe("PRINTED");
    expect((await agent.tick()).kind).toBe("UNKNOWN");
    const sent = w.printer.received.length;
    for (let i = 0; i < 5; i++) expect((await agent.tick()).kind).toBe("IDLE");
    expect(w.printer.received.length).toBe(sent); // nada foi reenviado
    expect((await w.svc.getJobView(view.job.id)).status).toBe("REQUIRES_REVIEW");
  });

  it("exceção durante o envio também vira UNKNOWN_OUTCOME", async () => {
    const w = world();
    await w.svc.createOriginal(w.input());
    w.printer.script = ["THROW"];
    expect((await w.mkAgent().tick()).kind).toBe("UNKNOWN");
  });

  it("rejeição certificada sem saída vira FAILED e retém o restante", async () => {
    const w = world();
    const { view } = await w.svc.createOriginal(w.input({ quantity: 10 }));
    w.printer.script = ["REJECT"];
    expect((await w.mkAgent().tick()).kind).toBe("FAILED");
    const v = await w.svc.getJobView(view.job.id);
    expect(v.status).toBe("AWAITING_DECISION");
    expect(v.attempts.filter((a) => a.holdReason === "JOB_HELD")).toHaveLength(9);
  });

  it("erro de renderização termina em FAILED sem enviar nada", async () => {
    const w = world();
    await w.svc.createOriginal(
      w.input({
        part: { id: "p", description: "", partNumber: "29135-BP000" },
        qr: { supplierCode: "AQ2A", operatorCode: "OP01", shiftCode: "A" },
      }),
    );
    const r = await w.mkAgent().tick();
    expect(r).toMatchObject({ kind: "FAILED", failureClass: "RENDER_ERROR" });
    expect(w.printer.received).toHaveLength(0);
  });

  it("impressora indisponível: não reivindica nada", async () => {
    const w = world();
    const { view } = await w.svc.createOriginal(w.input());
    w.printer.status = "UNAVAILABLE";
    expect(await w.mkAgent().tick()).toEqual({ kind: "SKIPPED", reason: "PRINTER_NOT_READY" });
    expect((await w.svc.getJobView(view.job.id)).attempts[0]!.state).toBe("QUEUED");
  });

  it("relato de resultado com falha de rede é repetido sem reimprimir", async () => {
    const w = world();
    await w.svc.createOriginal(w.input());
    w.transport.failReportTimes = 2;
    expect((await w.mkAgent().tick()).kind).toBe("PRINTED");
    expect(w.printer.received).toHaveLength(1);
  });

  it("se o relato falha em todas as tentativas, o resultado fica pendente no journal e é relatado na recuperação", async () => {
    const w = world();
    const { view } = await w.svc.createOriginal(w.input());
    w.transport.failReportTimes = 99;
    await expect(w.mkAgent().tick()).rejects.toThrow();
    expect((await w.svc.getJobView(view.job.id)).attempts[0]!.state).toBe("SENDING");
    w.transport.failReportTimes = 0;
    await w.mkAgent().recover(); // "reinício"
    expect((await w.svc.getJobView(view.job.id)).attempts[0]!.state).toBe("PRINTED_CONFIRMED");
    expect(w.printer.received).toHaveLength(1);
  });
});

describe("recuperação após reinício (§13)", () => {
  async function claimAndAck(w: ReturnType<typeof world>, ack: boolean) {
    const { view } = await w.svc.createOriginal(w.input());
    const info = {
      agentId: "agent-1",
      stationId: "st-1",
      printerId: "pr-1",
      agentVersion: "0.1.0",
      protocolVersion: 0,
      clockSkewMs: 0,
      printerStatus: "READY" as const,
    };
    await w.svc.heartbeat(info);
    const att = (await w.svc.claimNext(info))!;
    if (ack) await w.svc.ackSending(att.id, "agent-1");
    return { view, att };
  }

  it("CLAIMED sem ack: libera a tentativa", async () => {
    const w = world();
    const { view, att } = await claimAndAck(w, false);
    w.journal.append({ type: "CLAIMED", attemptId: att.id, at: 1 });
    await w.mkAgent().recover();
    expect((await w.svc.getJobView(view.job.id)).attempts[0]!.state).toBe("QUEUED");
  });

  it("ack sem 'prestes a enviar': prova que nada saiu → FAILED (retry só por ação humana)", async () => {
    const w = world();
    const { view, att } = await claimAndAck(w, true);
    for (const type of ["CLAIMED", "INTENT_SEND", "ACKED"] as const)
      w.journal.append({ type, attemptId: att.id, at: 1 });
    await w.mkAgent().recover();
    const a = (await w.svc.getJobView(view.job.id)).attempts[0]!;
    expect(a.state).toBe("FAILED");
    expect(a.failureClass).toBe("NO_BYTES_SENT");
    expect(w.printer.received).toHaveLength(0);
  });

  it("'prestes a enviar' sem resultado: UNKNOWN_OUTCOME e nada é reenviado", async () => {
    const w = world();
    const { view, att } = await claimAndAck(w, true);
    for (const type of ["CLAIMED", "INTENT_SEND", "ACKED", "ABOUT_TO_SEND"] as const)
      w.journal.append({ type, attemptId: att.id, at: 1 });
    await w.mkAgent().recover();
    expect((await w.svc.getJobView(view.job.id)).attempts[0]!.state).toBe("UNKNOWN_OUTCOME");
    expect(w.printer.received).toHaveLength(0);
  });

  it("journal corrompido: o servidor marca as tentativas SENDING da estação como UNKNOWN_OUTCOME", async () => {
    const w = world();
    const { view } = await claimAndAck(w, true);
    w.journal.corrupted = true;
    await w.mkAgent().recover();
    expect((await w.svc.getJobView(view.job.id)).attempts[0]!.state).toBe("UNKNOWN_OUTCOME");
  });

  it("recuperação ocorre uma vez e é idempotente em um segundo reinício", async () => {
    const w = world();
    const { att } = await claimAndAck(w, true);
    for (const type of ["CLAIMED", "INTENT_SEND", "ACKED", "ABOUT_TO_SEND"] as const)
      w.journal.append({ type, attemptId: att.id, at: 1 });
    await w.mkAgent().recover();
    await w.mkAgent().recover();
    expect(w.printer.received).toHaveLength(0);
  });
});

describe("FileJournal", () => {
  it("grava e relê as entradas na ordem", () => {
    const dir = mkdtempSync(join(tmpdir(), "journal-"));
    const j = new FileJournal(join(dir, "agent.journal"));
    j.append({ type: "CLAIMED", attemptId: "a1", at: 1 });
    j.append({ type: "ACKED", attemptId: "a1", at: 2 });
    expect(j.readAll().map((e) => e.type)).toEqual(["CLAIMED", "ACKED"]);
  });
  it("detecta corrupção", () => {
    const dir = mkdtempSync(join(tmpdir(), "journal-"));
    const p = join(dir, "agent.journal");
    writeFileSync(p, '{"type":"CLAIMED"\nnot-json\n');
    expect(() => new FileJournal(p).readAll()).toThrow();
  });
});

describe("linhas de etiquetas (mídia de 4 colunas)", () => {
  it("imprime 10 etiquetas em 3 envios: 4 + 4 + 2", async () => {
    const w = world();
    w.printer.labelsPerRow = 4;
    const agent = w.mkAgent();
    const { view } = await w.svc.createOriginal(w.input({ quantity: 10 }));
    for (let i = 0; i < 3; i++) expect((await agent.tick()).kind).toBe("PRINTED");
    expect((await agent.tick()).kind).toBe("IDLE");
    expect(w.printer.rows.map((r) => r.length)).toEqual([4, 4, 2]);
    expect((await w.svc.getJobView(view.job.id)).status).toBe("COMPLETED");
  });

  it("queda no envio da linha: todas as etiquetas da linha ficam desconhecidas e o restante é retido", async () => {
    const w = world();
    w.printer.labelsPerRow = 4;
    w.printer.defaultMode = "UNCERTAIN";
    const agent = w.mkAgent();
    const { view } = await w.svc.createOriginal(w.input({ quantity: 10 }));
    expect((await agent.tick()).kind).toBe("UNKNOWN");
    const v = await w.svc.getJobView(view.job.id);
    expect(v.status).toBe("REQUIRES_REVIEW");
    expect(v.attempts.filter((a) => a.state === "UNKNOWN_OUTCOME")).toHaveLength(4);
    expect(v.attempts.filter((a) => a.state === "QUEUED" && a.holdReason !== null)).toHaveLength(6);
    // nada é reenviado sozinho
    w.printer.defaultMode = "OK";
    expect((await agent.tick()).kind).toBe("IDLE");
    expect(w.printer.rows).toHaveLength(1);
  });

  it("recusa provada da linha: todas FAILED e nada saiu", async () => {
    const w = world();
    w.printer.labelsPerRow = 4;
    w.printer.defaultMode = "REJECT";
    const agent = w.mkAgent();
    const { view } = await w.svc.createOriginal(w.input({ quantity: 10 }));
    expect((await agent.tick()).kind).toBe("FAILED");
    const v = await w.svc.getJobView(view.job.id);
    expect(v.attempts.filter((a) => a.state === "FAILED")).toHaveLength(4);
    expect(v.attempts.filter((a) => a.state === "QUEUED" && a.holdReason !== null)).toHaveLength(6);
    expect(w.printer.printed).toHaveLength(0);
  });

  it("sem o ack de uma etiqueta da linha, nada é enviado", async () => {
    const w = world();
    w.printer.labelsPerRow = 4;
    w.transport.failAck = true;
    const agent = w.mkAgent();
    const { view } = await w.svc.createOriginal(w.input({ quantity: 10 }));
    expect((await agent.tick()).kind).toBe("SKIPPED");
    expect(w.printer.rows).toHaveLength(0);
    w.transport.failAck = false;
    // as quatro voltaram à fila e a linha é reimpressa normalmente
    expect((await w.svc.getJobView(view.job.id)).attempts.every((a) => a.state === "QUEUED")).toBe(
      true,
    );
    expect((await agent.tick()).kind).toBe("PRINTED");
    expect(w.printer.rows.map((r) => r.length)).toEqual([4]);
  });
});
