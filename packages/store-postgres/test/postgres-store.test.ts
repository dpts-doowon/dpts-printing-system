import { describe, expect, it } from "vitest";
import { PrintService } from "@doowon/domain";
import { admin, agentInfo, originalInput } from "../../domain/src/testkit.js";
import { PostgresPrintStore, migrate } from "../src/index.js";
import { pool } from "./setup.js";

const d = pool ? describe : describe.skip;

d("PostgresPrintStore (contrato específico do PostgreSQL)", () => {
  const mk = () => {
    let t = 1_000_000;
    let n = 0;
    const store = new PostgresPrintStore(pool!);
    const svc = new PrintService({ store, clock: () => t++, newId: () => `pg-${++n}` });
    return { store, svc };
  };

  it("a migração é idempotente", async () => {
    expect(await migrate(pool!)).toEqual([]);
  });

  it("os dados sobrevivem a um novo store sobre o mesmo banco (reinício)", async () => {
    const a = mk();
    await a.svc.heartbeat(agentInfo());
    const { view: created } = await a.svc.createOriginal(originalInput({ quantity: 10 }));
    const job = created.job;
    const b = new PrintService({
      store: new PostgresPrintStore(pool!),
      clock: () => 5_000_000,
      newId: () => "x",
    });
    const view = await b.getJobView(job.id);
    expect(view?.attempts).toHaveLength(10);
    expect((await b.reader.getAgent("st-1"))?.agentVersion).toBe("0.1.0");
  });

  it("recusa a mesma chave de idempotência em duas gravações e desfaz a transação", async () => {
    const { store } = mk();
    const job = {
      id: "j1",
      kind: "ORIGINAL" as const,
      quantity: 1,
      stationId: "s",
      machineId: "m",
      printerId: "p",
      operatorId: "o",
      idempotencyKey: "k",
      requestFingerprint: "f",
      correlationId: "c",
      createdAt: 1,
    };
    await store.transaction((tx) => tx.insertJob(job));
    await expect(
      store.transaction(async (tx) => {
        await tx.insertJob({ ...job, id: "j2", idempotencyKey: "k2" });
        await tx.insertJob({ ...job, id: "j3" }); // chave repetida
      }),
    ).rejects.toThrow();
    expect((await store.read().listJobs()).map((j) => j.id)).toEqual(["j1"]);
  });

  it("a auditoria é append-only (UPDATE, DELETE e TRUNCATE são bloqueados)", async () => {
    const { store } = mk();
    await store.transaction((tx) =>
      tx.appendAudit({
        id: "a1",
        at: 1,
        action: "X",
        actorId: null,
        stationId: null,
        targetType: "SYSTEM",
        targetId: null,
        result: "OK",
        correlationId: "c",
      }),
    );
    await expect(pool!.query("UPDATE audit_events SET action='Y'")).rejects.toThrow(/append-only/);
    await expect(pool!.query("DELETE FROM audit_events")).rejects.toThrow(/append-only/);
    await expect(pool!.query("TRUNCATE audit_events")).rejects.toThrow(/append-only/);
  });

  it("transações concorrentes são serializadas: só uma criação ativa por impressora", async () => {
    const { svc } = mk();
    await svc.heartbeat(agentInfo());
    const results = await Promise.allSettled([
      svc.createOriginal(originalInput({ quantity: 1 })),
      svc.createOriginal(originalInput({ quantity: 1 })),
      svc.createOriginal(originalInput({ quantity: 1 })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(admin.role).toBe("ADMIN");
  });
});
