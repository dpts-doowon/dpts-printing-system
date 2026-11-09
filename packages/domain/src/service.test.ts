import { describe, expect, it } from "vitest";
import { DomainError } from "./errors.js";
import { checkHkmcQr, localDateTime } from "./hkmc-qr.js";
import { ALLOWED_QUANTITIES } from "./types.js";
import { admin, agentInfo, counts, operator, originalInput, printOne, setup } from "./testkit.js";

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "NO_ERROR";
  } catch (e) {
    return e instanceof DomainError ? e.code : `OTHER:${String(e)}`;
  }
};

describe("criação do PRINT_JOB ORIGINAL (INV-1..4)", () => {
  it.each([4, 8, 32])("quantidade %i cria 1 PRINT_JOB, N LABELs e N tentativas", async (q) => {
    const { svc, store } = setup({ allowedQuantities: ALLOWED_QUANTITIES });
    const { view } = await svc.createOriginal(originalInput({ quantity: q }));
    expect(view.job.kind).toBe("ORIGINAL");
    expect(view.labels).toHaveLength(q);
    expect(view.attempts).toHaveLength(q);
    expect(new Set(view.labels.map((l) => l.labelId)).size).toBe(q); // INV-2
    expect(view.labels.every((l) => l.printJobId === view.job.id)).toBe(true); // INV-3
    expect(view.attempts.every((a) => a.attemptNo === 1 && a.state === "QUEUED")).toBe(true);
    const total = Object.values(counts(view)).reduce((x, y) => x + y, 0);
    expect(total).toBe(q); // INV-4
    expect((await store.read().listJobs()).length).toBe(1);
  });

  it.each([0, 1, 2, 5, 10, 30, 31, 33, -1])("rejeita quantidade %i sem criar nada", async (q) => {
    const { svc, store } = setup({ allowedQuantities: ALLOWED_QUANTITIES });
    expect(await code(svc.createOriginal(originalInput({ quantity: q })))).toBe("INVALID_QUANTITY");
    expect((await store.read().listJobs()).length).toBe(0);
    expect((await store.read().listAttempts()).length).toBe(0);
  });

  it("congela o snapshot por valor, com hashes e versões", async () => {
    const { svc } = setup();
    const { view } = await svc.createOriginal(originalInput());
    const l = view.labels[0]!;
    expect(l.snapshot.part.partNumber).toBe("29135-BP000");
    expect(l.snapshot.operator.displayName).toBe("Operador Um");
    expect(l.snapshot.templateVersion).toBe(1);
    expect(l.snapshot.qrSchemaVersion).toBe("3-hkmc");
    expect(checkHkmcQr(l.snapshot.qrContent)).toEqual([]);
    expect(l.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(l.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    const att = view.attempts[0]!;
    expect(att.renderSnapshot).toEqual(l.snapshot);
    expect(att.payloadHash).toBe(l.payloadHash);
    expect(att.correlationId).toBe(view.job.correlationId);
  });

  it("rejeita máquina fora das permitidas do posto", async () => {
    const { svc } = setup();
    expect(
      await code(svc.createOriginal(originalInput({ machine: { id: "m-9", code: "M09" } }))),
    ).toBe("MACHINE_NOT_ALLOWED");
  });
});

describe("idempotência e bloqueio 'Impressora em uso'", () => {
  it("mesma chave e mesmo pedido devolve o mesmo PRINT_JOB sem criar nada", async () => {
    const { svc, store } = setup();
    const input = originalInput({ quantity: 10 });
    const first = await svc.createOriginal(input);
    const again = await svc.createOriginal(input);
    expect(again.replayed).toBe(true);
    expect(again.view.job.id).toBe(first.view.job.id);
    expect((await store.read().listJobs()).length).toBe(1);
    expect((await store.read().listAttempts()).length).toBe(10);
  });

  it("mesma chave com pedido diferente é conflito", async () => {
    const { svc } = setup();
    const input = originalInput({ quantity: 10 });
    await svc.createOriginal(input);
    expect(await code(svc.createOriginal({ ...input, quantity: 30 }))).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("outra chave com PRINT_JOB ativo na mesma impressora é bloqueada antes de criar registros", async () => {
    const { svc, store } = setup();
    await svc.createOriginal(originalInput({ quantity: 10 }));
    const before = {
      jobs: (await store.read().listJobs()).length,
      attempts: (await store.read().listAttempts()).length,
    };
    let err: DomainError | undefined;
    try {
      await svc.createOriginal(originalInput({ quantity: 1 }));
    } catch (e) {
      err = e as DomainError;
    }
    expect(err?.code).toBe("PRINTER_BUSY");
    expect(err?.message).toBe("Impressora em uso");
    expect((await store.read().listJobs()).length).toBe(before.jobs);
    expect((await store.read().listAttempts()).length).toBe(before.attempts);
    const audit = await svc.listAudit();
    expect(audit.some((e) => e.action === "PRINT_JOB_REJECTED" && e.result === "REJECTED")).toBe(
      true,
    );
  });

  it("o bloqueio é por posto: o outro posto continua livre", async () => {
    const { svc } = setup();
    await svc.createOriginal(originalInput({ quantity: 10 }));
    const other = await svc.createOriginal(
      originalInput({
        stationId: "st-2",
        printerId: "pr-2",
        machine: { id: "m-2", code: "M02" },
        allowedMachineIds: ["m-2"],
      }),
    );
    expect(other.view.job.printerId).toBe("pr-2");
  });

  it("dois pedidos simultâneos com chaves diferentes: exatamente um é aceito", async () => {
    const { svc, store } = setup();
    const results = await Promise.allSettled([
      svc.createOriginal(originalInput({ quantity: 10 })),
      svc.createOriginal(originalInput({ quantity: 10 })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.read().listJobs()).length).toBe(1);
  });

  it("libera a impressora quando o PRINT_JOB termina", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    await svc.createOriginal(originalInput({ quantity: 1 }));
    await printOne(svc, info);
    const next = await svc.createOriginal(originalInput({ quantity: 1 }));
    expect(next.replayed).toBe(false);
  });
});

describe("agente: claim, ack e resultado", () => {
  it("fluxo completo de 3 etiquetas em ordem e job COMPLETED", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    const { view } = await svc.createOriginal(originalInput({ quantity: 10 }));
    const order: string[] = [];
    for (let i = 0; i < 10; i++) {
      const att = await printOne(svc, info);
      order.push(att.labelId);
    }
    expect(order).toEqual(view.labels.map((l) => l.labelId));
    expect((await svc.getJobView(view.job.id)).status).toBe("COMPLETED");
  });

  it("INV-8: com uma tentativa em voo, não há segunda reivindicação", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    await svc.createOriginal(originalInput({ quantity: 10 }));
    const first = await svc.claimNext(info);
    expect(first).not.toBeNull();
    expect(await svc.claimNext(info)).toBeNull();
  });

  it("INV-7: não é possível confirmar sem o ack de SENDING", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    await svc.createOriginal(originalInput());
    const att = (await svc.claimNext(info))!;
    expect(
      await code(
        svc.reportResult(att.id, info.agentId, { kind: "PRINTED", evidence: "PRINTER_ACK" }),
      ),
    ).toBe("INVALID_TRANSITION");
  });

  it("ack com agente errado ou lease expirado é recusado", async () => {
    const { svc, clock } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    await svc.createOriginal(originalInput());
    const att = (await svc.claimNext(info))!;
    expect(await code(svc.ackSending(att.id, "outro-agente"))).toBe("LEASE_INVALID");
    clock.advance(31_000);
    expect(await code(svc.ackSending(att.id, info.agentId))).toBe("LEASE_INVALID");
  });

  it("ack repetido pelo mesmo agente é idempotente", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    await svc.createOriginal(originalInput());
    const att = (await svc.claimNext(info))!;
    const a1 = await svc.ackSending(att.id, info.agentId);
    const a2 = await svc.ackSending(att.id, info.agentId);
    expect(a2.state).toBe("SENDING");
    expect(a2.version).toBe(a1.version);
  });

  it("relatório de resultado repetido é idempotente", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    await svc.createOriginal(originalInput());
    const done = await printOne(svc, info);
    const again = await svc.reportResult(done.id, info.agentId, {
      kind: "PRINTED",
      evidence: "PRINTER_ACK",
    });
    expect(again.version).toBe(done.version);
  });

  it("agente incompatível, sem heartbeat ou com relógio fora do limite não reivindica", async () => {
    const { svc, clock } = setup();
    await svc.createOriginal(originalInput());
    expect(await code(svc.claimNext(agentInfo()))).toBe("AGENT_NOT_HEALTHY"); // sem heartbeat
    await svc.heartbeat(agentInfo());
    expect(await code(svc.claimNext(agentInfo("st-1", "pr-1", { protocolVersion: 5 })))).toBe(
      "AGENT_INCOMPATIBLE",
    );
    expect(await code(svc.claimNext(agentInfo("st-1", "pr-1", { clockSkewMs: 20_000 })))).toBe(
      "AGENT_NOT_HEALTHY",
    );
    clock.advance(40_000);
    expect(await code(svc.claimNext(agentInfo()))).toBe("AGENT_NOT_HEALTHY"); // heartbeat velho
  });

  it("impressora indisponível: nada é reivindicado e a fila aguarda", async () => {
    const { svc } = setup();
    await svc.heartbeat(agentInfo());
    await svc.createOriginal(originalInput());
    expect(
      await svc.claimNext(agentInfo("st-1", "pr-1", { printerStatus: "UNAVAILABLE" })),
    ).toBeNull();
    expect(await svc.claimNext(agentInfo())).not.toBeNull();
  });

  it("o agente só enxerga tentativas da própria estação/impressora", async () => {
    const { svc } = setup();
    const a2 = agentInfo("st-2", "pr-2");
    await svc.heartbeat(a2);
    await svc.createOriginal(originalInput());
    expect(await svc.claimNext(a2)).toBeNull();
  });

  it("lease expirado em CLAIMED volta a QUEUED; nada é criado", async () => {
    const { svc, store, clock } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    await svc.createOriginal(originalInput());
    const att = (await svc.claimNext(info))!;
    const before = (await store.read().listAttempts()).length;
    clock.advance(31_000);
    const r = await svc.reapExpired();
    expect(r).toEqual({ requeued: 1, unknown: 0 });
    expect((await store.read().getAttempt(att.id))!.state).toBe("QUEUED");
    expect((await store.read().listAttempts()).length).toBe(before);
  });

  it("falha antes do envio (CLAIMED) com prova vira FAILED e retém o restante", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    const { view } = await svc.createOriginal(originalInput({ quantity: 10 }));
    const att = (await svc.claimNext(info))!;
    await svc.reportResult(att.id, info.agentId, {
      kind: "FAILED",
      failureClass: "RENDER_ERROR",
      provenNoOutput: true,
    });
    const v = await svc.getJobView(view.job.id);
    expect(v.status).toBe("AWAITING_DECISION");
    expect(v.attempts.filter((a) => a.holdReason === "JOB_HELD")).toHaveLength(9);
  });

  it("falha em SENDING sem prova de que nada saiu vira UNKNOWN_OUTCOME", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    const { view } = await svc.createOriginal(originalInput());
    const att = (await svc.claimNext(info))!;
    await svc.ackSending(att.id, info.agentId);
    const r = await svc.reportResult(att.id, info.agentId, {
      kind: "FAILED",
      failureClass: "TIMEOUT",
      provenNoOutput: false,
    });
    expect(r.state).toBe("UNKNOWN_OUTCOME");
    expect((await svc.getJobView(view.job.id)).status).toBe("REQUIRES_REVIEW");
  });

  it("falha em SENDING com prova vira FAILED", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    await svc.createOriginal(originalInput());
    const att = (await svc.claimNext(info))!;
    await svc.ackSending(att.id, info.agentId);
    const r = await svc.reportResult(att.id, info.agentId, {
      kind: "FAILED",
      failureClass: "REJECTED",
      provenNoOutput: true,
    });
    expect(r.state).toBe("FAILED");
  });
});

describe("caso de referência: 17 confirmadas, 1 desconhecida, 12 não enviadas (§10.1)", () => {
  async function scenario() {
    const ctx = setup();
    const { svc, clock } = ctx;
    const info = agentInfo();
    await svc.heartbeat(info);
    const { view } = await svc.createOriginal(originalInput({ quantity: 30 }));
    for (let i = 0; i < 17; i++) {
      await printOne(svc, info);
      await svc.heartbeat(info);
    }
    const att18 = (await svc.claimNext(info))!;
    await svc.ackSending(att18.id, info.agentId);
    clock.advance(31_000); // agente some durante o envio
    await svc.reapExpired();
    await svc.heartbeat(info);
    return { ...ctx, info, view, att18 };
  }

  it("estado: 1 PRINT_JOB, 30 LABELs, 17 + 1 + 12 = 30 (INV-4)", async () => {
    const { svc, view } = await scenario();
    const v = await svc.getJobView(view.job.id);
    expect(v.status).toBe("REQUIRES_REVIEW");
    expect(v.labels).toHaveLength(30);
    expect(counts(v)).toEqual({ PRINTED_CONFIRMED: 17, UNKNOWN_OUTCOME: 1, QUEUED: 12 });
    expect(
      v.attempts.filter((a) => a.state === "QUEUED").every((a) => a.holdReason === "JOB_HELD"),
    ).toBe(true);
  });

  it("INV-5: nada é reenviado nem liberado automaticamente; impressora bloqueada", async () => {
    const { svc, info, store } = await scenario();
    const attemptsBefore = (await store.read().listAttempts()).length;
    expect(await svc.claimNext(info)).toBeNull();
    await svc.reapExpired();
    expect((await store.read().listAttempts()).length).toBe(attemptsBefore);
    expect(await code(svc.createOriginal(originalInput()))).toBe("PRINTER_BUSY");
  });

  it("OPERATOR não resolve; só solicita ação (autorização no servidor)", async () => {
    const { svc, att18 } = await scenario();
    expect(await code(svc.resolveUnknown(att18.id, operator, "PRINTED", "ok", "c1"))).toBe(
      "FORBIDDEN",
    );
    await svc.requestResolution(att18.id, operator, "c2");
    const audit = await svc.listAudit();
    expect(audit.some((e) => e.action === "RESOLUTION_REQUESTED")).toBe(true);
    expect(audit.some((e) => e.action === "RESOLUTION_REJECTED" && e.result === "REJECTED")).toBe(
      true,
    );
  });

  it("não é possível liberar o restante nem reimprimir enquanto o desconhecido estiver aberto", async () => {
    const { svc, view, att18 } = await scenario();
    expect(await code(svc.decideHeld(view.job.id, admin, "CONTINUE", "c"))).toBe(
      "UNKNOWN_OUTCOME_OPEN",
    );
    expect(
      await code(
        svc.createReprint({
          idempotencyKey: "rp-1",
          labelIds: [att18.labelId],
          actor: operator,
          stationId: "st-1",
          printerId: "pr-1",
          correlationId: "c",
          reason: "teste",
        }),
      ),
    ).toBe("UNKNOWN_OUTCOME_OPEN");
  });

  it("'Saiu' + Continuar → COMPLETED (30 confirmadas)", async () => {
    const { svc, view, att18, info } = await scenario();
    await svc.resolveUnknown(att18.id, admin, "PRINTED", "conferido", "c");
    await svc.decideHeld(view.job.id, admin, "CONTINUE", "c");
    for (let i = 0; i < 12; i++) {
      await printOne(svc, info);
      await svc.heartbeat(info);
    }
    const v = await svc.getJobView(view.job.id);
    expect(v.status).toBe("COMPLETED");
    expect(counts(v)).toEqual({ PRINTED_CONFIRMED: 30 });
    expect(v.attempts.find((a) => a.id === att18.id)!.evidenceType).toBe("OPERATOR_CONFIRMATION");
  });

  it("'Saiu' + Cancelar → PARTIALLY_COMPLETED (18 confirmadas, 12 canceladas)", async () => {
    const { svc, view, att18 } = await scenario();
    await svc.resolveUnknown(att18.id, admin, "PRINTED", "conferido", "c");
    await svc.decideHeld(view.job.id, admin, "CANCEL", "c");
    const v = await svc.getJobView(view.job.id);
    expect(v.status).toBe("PARTIALLY_COMPLETED");
    expect(counts(v)).toEqual({ PRINTED_CONFIRMED: 18, CANCELLED: 12 });
  });

  it("'Não saiu' + Continuar → PARTIALLY_COMPLETED e RETRY cria attempt_no 2 no mesmo label_id", async () => {
    const { svc, view, att18, info, store } = await scenario();
    await svc.resolveUnknown(att18.id, admin, "NOT_PRINTED", "não saiu", "c");
    await svc.decideHeld(view.job.id, admin, "CONTINUE", "c");
    for (let i = 0; i < 12; i++) {
      await printOne(svc, info);
      await svc.heartbeat(info);
    }
    const v = await svc.getJobView(view.job.id);
    expect(v.status).toBe("PARTIALLY_COMPLETED");
    expect(counts(v)).toEqual({ PRINTED_CONFIRMED: 29, FAILED: 1 });
    const labelsBefore = (await store.read().listJobs()).length;
    expect(
      await code(
        svc.createRetry({
          idempotencyKey: "rt-op",
          labelIds: [att18.labelId],
          actor: operator,
          stationId: "st-1",
          printerId: "pr-1",
          correlationId: "c",
        }),
      ),
    ).toBe("FORBIDDEN");
    const { view: rv } = await svc.createRetry({
      idempotencyKey: "rt-1",
      labelIds: [att18.labelId],
      actor: admin,
      stationId: "st-1",
      printerId: "pr-1",
      correlationId: "c",
    });
    expect(rv.job.kind).toBe("RETRY");
    expect(rv.attempts[0]!.attemptNo).toBe(2);
    expect(rv.attempts[0]!.labelId).toBe(att18.labelId);
    expect(rv.labels).toHaveLength(0); // RETRY não cria LABELs
    expect((await store.read().listJobs()).length).toBe(labelsBefore + 1);
    await svc.heartbeat(info);
    const done = await printOne(svc, info);
    expect(done.labelId).toBe(att18.labelId);
  });

  it("'Não saiu' + Cancelar → PARTIALLY_COMPLETED (17 confirmadas, 1 falha, 12 canceladas)", async () => {
    const { svc, view, att18 } = await scenario();
    await svc.resolveUnknown(att18.id, admin, "NOT_PRINTED", "não saiu", "c");
    await svc.decideHeld(view.job.id, admin, "CANCEL", "c");
    const v = await svc.getJobView(view.job.id);
    expect(v.status).toBe("PARTIALLY_COMPLETED");
    expect(counts(v)).toEqual({ PRINTED_CONFIRMED: 17, FAILED: 1, CANCELLED: 12 });
  });

  it("relato tardio do agente não tira a tentativa de UNKNOWN_OUTCOME (INV-6)", async () => {
    const { svc, info, att18 } = await scenario();
    expect(
      await code(
        svc.reportResult(att18.id, info.agentId, { kind: "PRINTED", evidence: "PRINTER_ACK" }),
      ),
    ).toBe("INVALID_TRANSITION");
  });

  it("resolução exige observação", async () => {
    const { svc, att18 } = await scenario();
    expect(await code(svc.resolveUnknown(att18.id, admin, "PRINTED", "  ", "c"))).toBe(
      "REASON_REQUIRED",
    );
  });
});

describe("falha provada, cancelamento, retry e reimpressão", () => {
  it("falha provada na etiqueta 17: 1–16 confirmadas, 17 FAILED, 18–30 retidas, AWAITING_DECISION", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    const { view } = await svc.createOriginal(originalInput({ quantity: 30 }));
    for (let i = 0; i < 16; i++) {
      await printOne(svc, info);
      await svc.heartbeat(info);
    }
    const att = (await svc.claimNext(info))!;
    await svc.ackSending(att.id, info.agentId);
    await svc.reportResult(att.id, info.agentId, {
      kind: "FAILED",
      failureClass: "NO_MEDIA",
      provenNoOutput: true,
    });
    const v = await svc.getJobView(view.job.id);
    expect(v.status).toBe("AWAITING_DECISION");
    expect(counts(v)).toEqual({ PRINTED_CONFIRMED: 16, FAILED: 1, QUEUED: 13 });
  });

  it("cancelar durante o job cancela QUEUED/CLAIMED; o ack da reivindicada falha", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    const { view } = await svc.createOriginal(originalInput({ quantity: 10 }));
    const att = (await svc.claimNext(info))!;
    await svc.cancelJob(view.job.id, operator, "c");
    expect(await code(svc.ackSending(att.id, info.agentId))).toBe("INVALID_TRANSITION");
    expect((await svc.getJobView(view.job.id)).status).toBe("CANCELLED");
  });

  it("reimpressão exige motivo, mantém label_id e não cria LABEL nova", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    const { view } = await svc.createOriginal(originalInput());
    await printOne(svc, info);
    const base = {
      idempotencyKey: "rp-1",
      labelIds: [view.labels[0]!.labelId],
      actor: operator,
      stationId: "st-1",
      printerId: "pr-1",
      correlationId: "c",
    };
    expect(await code(svc.createReprint({ ...base, reason: "  " }))).toBe("REASON_REQUIRED");
    const { view: rv } = await svc.createReprint({ ...base, reason: "Etiqueta danificada" });
    expect(rv.job.kind).toBe("REPRINT");
    expect(rv.job.reason).toBe("Etiqueta danificada");
    expect(rv.labels).toHaveLength(0);
    expect(rv.attempts[0]!.attemptNo).toBe(2);
    expect(rv.attempts[0]!.renderSnapshot).toEqual(view.labels[0]!.snapshot); // snapshot original
  });

  it("reimpressão só de etiqueta impressa; retry só de etiqueta que falhou", async () => {
    const { svc } = setup();
    const { view } = await svc.createOriginal(originalInput());
    const base = {
      idempotencyKey: "x",
      labelIds: [view.labels[0]!.labelId],
      stationId: "st-1",
      printerId: "pr-1",
      correlationId: "c",
    };
    expect(await code(svc.createReprint({ ...base, actor: operator, reason: "r" }))).toBe(
      "NOT_ELIGIBLE",
    );
    expect(await code(svc.createRetry({ ...base, idempotencyKey: "y", actor: admin }))).toBe(
      "NOT_ELIGIBLE",
    );
  });

  it("a auditoria registra criação, claim, ack e resultado com correlation_id", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    const input = originalInput();
    await svc.createOriginal(input);
    await printOne(svc, info);
    const actions = (await svc.listAudit()).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "LABEL_CREATED",
        "PRINT_JOB_REQUESTED",
        "ATTEMPT_CLAIMED",
        "ATTEMPT_SENDING_ACKED",
        "ATTEMPT_PRINTED_CONFIRMED",
      ]),
    );
    expect(
      (await svc.listAudit()).find((e) => e.action === "PRINT_JOB_REQUESTED")!.correlationId,
    ).toBe(input.correlationId);
  });
});

describe("quantidades de produção (E-016)", () => {
  it("o padrão do serviço aceita só 4, 8 e 32 (linhas completas de 4 etiquetas)", () => {
    expect([...ALLOWED_QUANTITIES]).toEqual([4, 8, 32]);
    expect(ALLOWED_QUANTITIES.every((q) => q % 4 === 0)).toBe(true);
  });
});

describe("QR no padrão H/KMC e Trace Number", () => {
  const RS = "\u001e";
  const GS = "\u001d";
  const EOT = "\u0004";

  it("monta o QR no quadro da Hyundai, sem hífen no Part Number", async () => {
    const { svc } = setup();
    const { view } = await svc.createOriginal(originalInput({ quantity: 3 }));
    const qr = view.labels[0]!.snapshot.qrContent;
    expect(qr.startsWith(`[)>${RS}06${GS}VAQ2A${GS}P29135BP000${GS}SAG10${GS}E${GS}T`)).toBe(true);
    expect(qr.endsWith(`${GS}${RS}${EOT}`)).toBe(true);
    expect(checkHkmcQr(qr)).toEqual([]);
    expect(view.labels[0]!.snapshot.qrSchemaVersion).toBe("3-hkmc");
  });

  it("Trace Number é sequencial e contínuo entre pedidos", async () => {
    const { svc } = setup();
    const a = await svc.createOriginal(originalInput({ quantity: 3 }));
    const b = await svc.createOriginal(originalInput({ quantity: 1, printerId: "pr-2" }));
    const traces = [...a.view.labels, ...b.view.labels].map((l) => l.snapshot.traceNumber);
    expect(traces).toEqual([1, 2, 3, 4]);
    expect(a.view.labels[0]!.snapshot.qrContent).toContain("A0000001");
  });

  it("pedido rejeitado não consome números de Trace", async () => {
    const { svc } = setup();
    await expect(
      svc.createOriginal(
        originalInput({ qr: { supplierCode: "AQ2A", operatorCode: "OP", shiftCode: "A" } }),
      ),
    ).rejects.toMatchObject({ code: "QR_DATA_INVALID" });
    const ok = await svc.createOriginal(originalInput());
    expect(ok.view.labels[0]!.snapshot.traceNumber).toBe(1);
  });

  it("recusa dados que o leitor da Hyundai reprovaria", async () => {
    const { svc } = setup();
    const bad = [
      { supplierCode: "AQ2", operatorCode: "OP01", shiftCode: "A" },
      { supplierCode: "AQ2A", operatorCode: "OP01", shiftCode: "B" },
      { supplierCode: "AQ2A", operatorCode: "OP01", shiftCode: "A", eoNumber: "123" },
    ];
    for (const qr of bad)
      expect(await code(svc.createOriginal(originalInput({ qr })))).toBe("QR_DATA_INVALID");
  });

  it("EO Number de 8 a 9 caracteres e Área do Fornecedor entram no QR", async () => {
    const { svc } = setup();
    const { view } = await svc.createOriginal(
      originalInput({
        qr: {
          supplierCode: "AQ2A",
          alcCode: "AG10",
          operatorCode: "OP01",
          shiftCode: "@",
          eoNumber: "EO1234567",
          supplierArea: "LINHA 3",
        },
      }),
    );
    const qr = view.labels[0]!.snapshot.qrContent;
    expect(qr).toContain(`${GS}EEO1234567${GS}`);
    expect(qr).toContain(`${GS}CLINHA 3${GS}`);
    expect(checkHkmcQr(qr)).toEqual([]);
  });

  it("data e hora do QR usam o fuso da planta (AAMMDD / HHMMSS)", () => {
    expect(localDateTime(Date.UTC(2026, 10, 6, 2, 5, 9), "America/Sao_Paulo")).toEqual({
      date: "261105",
      time: "230509",
    });
  });
});
