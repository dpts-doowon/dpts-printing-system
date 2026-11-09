import { describe, expect, it } from "vitest";
import { DomainError } from "./errors.js";
import { counts } from "./testkit.js";
import { agentInfo, operator, originalInput, printOne, setup } from "./testkit.js";

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "NO_ERROR";
  } catch (e) {
    return e instanceof DomainError ? e.code : `OTHER:${String(e)}`;
  }
};

const base = (jobId: string, key: string) => ({
  idempotencyKey: key,
  jobId,
  actor: operator,
  stationId: "st-1",
  printerId: "pr-1",
  correlationId: "c",
});

/** 10 etiquetas: 4 confirmadas, a 5ª termina como `last`, 5 retidas. */
async function stopped(last: "FAILED" | "UNKNOWN") {
  const ctx = setup();
  const { svc, clock } = ctx;
  const info = agentInfo();
  await svc.heartbeat(info);
  const { view } = await svc.createOriginal(originalInput({ quantity: 10 }));
  for (let i = 0; i < 4; i++) {
    await printOne(svc, info);
    await svc.heartbeat(info);
  }
  const att = (await svc.claimNext(info))!;
  await svc.ackSending(att.id, info.agentId);
  if (last === "FAILED") {
    await svc.reportResult(att.id, info.agentId, {
      kind: "FAILED",
      failureClass: "NO_MEDIA",
      provenNoOutput: true,
    });
  } else {
    clock.advance(31_000);
    await svc.reapExpired();
    await svc.heartbeat(info);
  }
  return { ...ctx, info, view };
}

describe("recomeço pelo operador", () => {
  it("continuar de onde parou: reimprime só a que falhou e as retidas, com o mesmo label_id", async () => {
    const { svc, info, view } = await stopped("FAILED");
    expect((await svc.getJobView(view.job.id)).status).toBe("AWAITING_DECISION");
    const { view: rv } = await svc.restartJob({ ...base(view.job.id, "r1"), mode: "RESUME" });
    expect(rv.job.kind).toBe("RETRY");
    expect(rv.attempts).toHaveLength(6); // 5ª (falhou) + 5 retidas
    expect(rv.attempts.map((a) => a.labelId)).toEqual(view.labels.slice(4).map((l) => l.labelId));
    expect(rv.attempts.every((a) => a.attemptNo === 2 && a.holdReason === null)).toBe(true);
    // o pedido original deixa de ocupar a impressora
    const orig = await svc.getJobView(view.job.id);
    expect(orig.status).toBe("PARTIALLY_COMPLETED");
    expect(counts(orig)).toEqual({ PRINTED_CONFIRMED: 4, FAILED: 1, CANCELLED: 5 });
    // o agente imprime as 6 em ordem
    for (let i = 0; i < 6; i++) {
      await printOne(svc, info);
      await svc.heartbeat(info);
    }
    expect((await svc.getJobView(rv.job.id)).status).toBe("COMPLETED");
  });

  it("é idempotente e audita JOB_RESUMED", async () => {
    const { svc, view } = await stopped("FAILED");
    const a = await svc.restartJob({ ...base(view.job.id, "r1"), mode: "RESUME" });
    const b = await svc.restartJob({ ...base(view.job.id, "r1"), mode: "RESUME" });
    expect(b.replayed).toBe(true);
    expect(b.view.job.id).toBe(a.view.job.id);
    expect((await svc.listAudit()).some((e) => e.action === "JOB_RESUMED")).toBe(true);
  });

  it("reimprimir tudo: exige motivo e cria tentativa nova para todas as etiquetas", async () => {
    const { svc, view } = await stopped("FAILED");
    expect(await code(svc.restartJob({ ...base(view.job.id, "a1"), mode: "ALL" }))).toBe(
      "REASON_REQUIRED",
    );
    const { view: rv } = await svc.restartJob({
      ...base(view.job.id, "a2"),
      mode: "ALL",
      reason: "Rolo trocado",
    });
    expect(rv.job.kind).toBe("REPRINT");
    expect(rv.attempts).toHaveLength(10);
    expect(rv.attempts.map((a) => a.labelId)).toEqual(view.labels.map((l) => l.labelId));
    expect(rv.attempts.map((a) => a.attemptNo)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect((await svc.listAudit()).some((e) => e.action === "JOB_REPRINTED_ALL")).toBe(true);
  });

  it("resultado desconhecido: exige a conferência do operador e a audita", async () => {
    const { svc, view } = await stopped("UNKNOWN");
    expect(await code(svc.restartJob({ ...base(view.job.id, "u1"), mode: "RESUME" }))).toBe(
      "UNKNOWN_OUTCOME_OPEN",
    );
    // saiu impressa: a 5ª fica confirmada e só as 5 retidas recomeçam
    const { view: rv } = await svc.restartJob({
      ...base(view.job.id, "u2"),
      mode: "RESUME",
      unknownOutcome: "PRINTED",
    });
    expect(rv.attempts).toHaveLength(5);
    const orig = await svc.getJobView(view.job.id);
    expect(counts(orig)).toEqual({ PRINTED_CONFIRMED: 5, CANCELLED: 5 });
    const ev = (await svc.listAudit()).find((e) => e.action === "UNKNOWN_OUTCOME_RESOLVED")!;
    expect(ev.details).toMatchObject({ outcome: "PRINTED", byRole: "OPERATOR" });
  });

  it("resultado desconhecido que não saiu: a etiqueta entra de novo", async () => {
    const { svc, view } = await stopped("UNKNOWN");
    const { view: rv } = await svc.restartJob({
      ...base(view.job.id, "u3"),
      mode: "RESUME",
      unknownOutcome: "NOT_PRINTED",
    });
    expect(rv.attempts).toHaveLength(6);
  });

  it("pode ser desligado: com a regra desativada o operador não resolve desconhecidas", async () => {
    const ctx = setup({ operatorMayResolveUnknown: false });
    const { svc, clock } = ctx;
    const info = agentInfo();
    await svc.heartbeat(info);
    const { view } = await svc.createOriginal(originalInput({ quantity: 10 }));
    const att = (await svc.claimNext(info))!;
    await svc.ackSending(att.id, info.agentId);
    clock.advance(31_000);
    await svc.reapExpired();
    await svc.heartbeat(info);
    expect(
      await code(
        svc.restartJob({ ...base(view.job.id, "z"), mode: "RESUME", unknownOutcome: "PRINTED" }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("recusa pedido em andamento e pedido de outro posto", async () => {
    const { svc } = setup();
    const { view } = await svc.createOriginal(originalInput({ quantity: 10 }));
    expect(await code(svc.restartJob({ ...base(view.job.id, "p"), mode: "RESUME" }))).toBe(
      "NOT_ELIGIBLE",
    );
    expect(
      await code(svc.restartJob({ ...base(view.job.id, "q"), stationId: "st-2", mode: "RESUME" })),
    ).toBe("FORBIDDEN");
  });
});

describe("linhas de várias etiquetas (mídia de 4 colunas)", () => {
  it("reivindica até 4 etiquetas seguidas do mesmo pedido; 10 etiquetas = 4 + 4 + 2", async () => {
    const { svc } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    const { view } = await svc.createOriginal(originalInput({ quantity: 10 }));
    const sizes: number[] = [];
    for (;;) {
      const row = await svc.claimBatch(info, 4);
      if (row.length === 0) break;
      sizes.push(row.length);
      // INV-8: enquanto a linha está em voo, nada novo é reivindicado.
      expect(await svc.claimBatch(info, 4)).toEqual([]);
      for (const a of row) {
        await svc.ackSending(a.id, info.agentId);
        await svc.reportResult(a.id, info.agentId, { kind: "PRINTED", evidence: "PRINTER_ACK" });
      }
      await svc.heartbeat(info);
    }
    expect(sizes).toEqual([4, 4, 2]);
    expect((await svc.getJobView(view.job.id)).status).toBe("COMPLETED");
  });

  it("falha da linha retém o restante; o operador confere cada etiqueta incerta e continua", async () => {
    const { svc, clock } = setup();
    const info = agentInfo();
    await svc.heartbeat(info);
    const { view } = await svc.createOriginal(originalInput({ quantity: 10 }));
    const row = await svc.claimBatch(info, 4);
    for (const a of row) await svc.ackSending(a.id, info.agentId);
    clock.advance(31_000); // o agente some durante o envio da linha
    await svc.reapExpired();
    await svc.heartbeat(info);
    const v = await svc.getJobView(view.job.id);
    expect(v.status).toBe("REQUIRES_REVIEW");
    expect(counts(v)).toEqual({ UNKNOWN_OUTCOME: 4, QUEUED: 6 });
    const unk = v.attempts.filter((a) => a.state === "UNKNOWN_OUTCOME");
    // falta a resposta de uma etiqueta: recusa
    expect(
      await code(
        svc.restartJob({
          ...base(view.job.id, "k1"),
          mode: "RESUME",
          unknownOutcomes: { [unk[0]!.id]: "PRINTED", [unk[1]!.id]: "PRINTED" },
        }),
      ),
    ).toBe("UNKNOWN_OUTCOME_OPEN");
    const { view: rv } = await svc.restartJob({
      ...base(view.job.id, "k2"),
      mode: "RESUME",
      unknownOutcomes: {
        [unk[0]!.id]: "PRINTED",
        [unk[1]!.id]: "PRINTED",
        [unk[2]!.id]: "NOT_PRINTED",
        [unk[3]!.id]: "NOT_PRINTED",
      },
    });
    // 2 não saíram + 6 restantes
    expect(rv.attempts).toHaveLength(8);
    expect(rv.attempts.slice(0, 2).map((a) => a.labelId)).toEqual([
      unk[2]!.labelId,
      unk[3]!.labelId,
    ]);
  });
});
