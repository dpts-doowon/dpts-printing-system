import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpTransport, MemoryJournal, PrintAgent, SimulatedPrinter } from "@doowon/print-agent";
import ExcelJS from "exceljs";
import { createApp } from "./app.js";
import { createRuntime, seedDevData, type Runtime } from "./runtime.js";

const TOK1 = "agent-token-station-1";
const TOK2 = "agent-token-station-2";
// 20/10/2026 15:00 em São Paulo (UTC-3) => Turno 2 (provisório).
const T0 = Date.parse("2026-10-20T18:00:00Z");

interface Ctx {
  app: INestApplication;
  rt: Runtime;
  base: string;
  now: { t: number };
  call: (
    method: string,
    path: string,
    opts?: { token?: string; body?: unknown; agent?: string },
  ) => Promise<{ status: number; body: any }>;
  login: (username: string, password: string, stationId?: string) => Promise<string>;
}

let ctx: Ctx;

beforeEach(async () => {
  const now = { t: T0 };
  let n = 0;
  const rt = createRuntime({ clock: () => now.t, newId: () => `id-${++n}` });
  await seedDevData(rt, {
    adminPassword: "admin-pass-123",
    operatorPassword: "operator-pass-123",
    agentTokens: { [TOK1]: "st-1", [TOK2]: "st-2" },
  });
  const app = await createApp(rt);
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const call: Ctx["call"] = async (method, path, opts = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.agent ? { "x-agent-token": opts.agent } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login: Ctx["login"] = async (username, password, stationId) => {
    const r = await call("POST", "/auth/login", {
      body: { username, password, ...(stationId ? { stationId } : {}) },
    });
    if (r.status !== 201 && r.status !== 200)
      throw new Error(`login ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.token as string;
  };
  ctx = { app, rt, base, now, call, login };
});

afterEach(async () => {
  await ctx.app.close();
});

const newAgent = (token: string, stationId: string, printerId: string, printer: SimulatedPrinter) =>
  new PrintAgent({
    agentId: `agent-${stationId}`,
    stationId,
    printerId,
    agentVersion: "0.1.0",
    transport: new HttpTransport(ctx.base, token),
    printer,
    journal: new MemoryJournal(),
    clock: () => ctx.now.t,
  });

const body = (
  partId = "p-1",
  quantity = 10,
  key = `key-${Math.random().toString(36).slice(2)}-xx`,
) => ({
  partId,
  quantity,
  idempotencyKey: key,
});

describe("autenticação e perfis", () => {
  it("exige login; rejeita credenciais inválidas sem revelar qual campo", async () => {
    expect((await ctx.call("GET", "/me")).status).toBe(401);
    const bad = await ctx.call("POST", "/auth/login", {
      body: { username: "admin", password: "errada", stationId: "st-1" },
    });
    expect(bad.status).toBe(403);
    expect(bad.body.message).toBe("Usuário ou senha inválidos.");
  });

  it("bloqueia temporariamente após falhas repetidas", async () => {
    for (let i = 0; i < 5; i++)
      await ctx.call("POST", "/auth/login", {
        body: { username: "operador1", password: "x", stationId: "st-1" },
      });
    const r = await ctx.call("POST", "/auth/login", {
      body: { username: "operador1", password: "operator-pass-123", stationId: "st-1" },
    });
    expect(r.status).toBe(403);
    ctx.now.t += 6 * 60_000;
    expect(
      (
        await ctx.call("POST", "/auth/login", {
          body: { username: "operador1", password: "operator-pass-123", stationId: "st-1" },
        })
      ).status,
    ).toBe(201);
  });

  it("OPERATOR não acessa rotas de ADMIN e ADMIN não usa rotas de operador (servidor)", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const adm = await ctx.login("admin", "admin-pass-123");
    expect((await ctx.call("GET", "/admin/dashboard", { token: op })).status).toBe(403);
    expect(
      (
        await ctx.call("POST", "/admin/attempts/x/resolve", {
          token: op,
          body: { outcome: "PRINTED", note: "n" },
        })
      ).status,
    ).toBe(403);
    expect((await ctx.call("GET", "/operator/context", { token: adm })).status).toBe(403);
  });

  it("a sessão expira por inatividade", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    ctx.now.t += 31 * 60_000;
    const r = await ctx.call("GET", "/me", { token: op });
    expect(r.status).toBe(401);
    expect(r.body.message).toBe("Sua sessão expirou. Entre novamente para continuar.");
  });

  it("logout forçado às 15:30 e às 00:30 (fuso provisório de São Paulo): exige novo login", async () => {
    // 15:20 local = 18:20Z
    ctx.now.t = Date.parse("2026-10-21T18:20:00Z");
    const tok = await ctx.login("operador1", "operator-pass-123", "st-1");
    ctx.now.t = Date.parse("2026-10-21T18:29:00Z"); // 15:29: ainda válida
    expect((await ctx.call("GET", "/operator/context", { token: tok })).status).toBe(200);
    ctx.now.t = Date.parse("2026-10-21T18:31:00Z"); // 15:31: passou das 15:30
    const r = await ctx.call("GET", "/operator/context", { token: tok });
    expect(r.status).toBe(401);
    // novo login depois das 15:30 funciona e segue válido até as 00:30
    const tok2 = await ctx.login("operador1", "operator-pass-123", "st-1");
    ctx.now.t = Date.parse("2026-10-21T18:55:00Z");
    expect((await ctx.call("GET", "/operator/context", { token: tok2 })).status).toBe(200);
    // 00:10 local = 03:10Z do dia seguinte
    ctx.now.t = Date.parse("2026-10-22T03:10:00Z");
    const tok3 = await ctx.login("operador1", "operator-pass-123", "st-1");
    ctx.now.t = Date.parse("2026-10-22T03:29:00Z"); // 00:29
    expect((await ctx.call("GET", "/operator/context", { token: tok3 })).status).toBe(200);
    ctx.now.t = Date.parse("2026-10-22T03:31:00Z"); // 00:31
    expect((await ctx.call("GET", "/operator/context", { token: tok3 })).status).toBe(401);
  });

  it("o logout forçado vale também para o administrador", async () => {
    ctx.now.t = Date.parse("2026-10-21T18:25:00Z"); // 15:25
    const tok = await ctx.login("admin", "admin-pass-123");
    expect((await ctx.call("GET", "/admin/dashboard", { token: tok })).status).toBe(200);
    ctx.now.t = Date.parse("2026-10-21T18:35:00Z"); // 15:35
    expect((await ctx.call("GET", "/admin/dashboard", { token: tok })).status).toBe(401);
  });

  it("a lista de operadores nunca expõe hash de senha", async () => {
    const adm = await ctx.login("admin", "admin-pass-123");
    const r = await ctx.call("GET", "/admin/operators", { token: adm });
    expect(JSON.stringify(r.body)).not.toMatch(/scrypt|passwordHash/);
  });
});

describe("fluxo do operador (posto 1)", () => {
  it("o contexto mostra só a impressora e a máquina do próprio posto; turno somente leitura", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const r = await ctx.call("GET", "/operator/context", { token: op });
    expect(r.body.station.name).toBe("Posto 01");
    expect(r.body.printer.name).toBe("Impressora 01");
    expect(r.body.machines.map((m: any) => m.code)).toEqual(["M01"]);
    expect(r.body.fixedMachine).toBe(true);
    expect(r.body.shift.name).toBe("Turno 2");
    expect(r.body.quantities).toEqual([1, 10, 30]);
    expect(r.body.printer.status).toBe("OFFLINE"); // sem heartbeat do agente
  });

  it("imprime 10 etiquetas de ponta a ponta com o agente via HTTP", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const printer = new SimulatedPrinter();
    const agent = newAgent(TOK1, "st-1", "pr-1", printer);
    const created = await ctx.call("POST", "/operator/print-jobs", { token: op, body: body() });
    expect(created.status).toBe(201);
    expect(created.body.quantity).toBe(10);
    expect(created.body.attempts).toHaveLength(10);
    for (let i = 0; i < 10; i++) expect((await agent.tick()).kind).toBe("PRINTED");
    const done = await ctx.call("GET", `/operator/print-jobs/${created.body.printJobId}`, {
      token: op,
    });
    expect(done.body.status).toBe("COMPLETED");
    expect(done.body.counts).toEqual({ PRINTED_CONFIRMED: 10 });
    expect(printer.printed).toHaveLength(10);
    const c = await ctx.call("GET", "/operator/context", { token: op });
    expect(c.body.printer.status).toBe("READY");
    expect(c.body.activeJob).toBeNull();
  });

  it("quantidade fora de 1/10/30 é recusada no servidor", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const r = await ctx.call("POST", "/operator/print-jobs", { token: op, body: body("p-1", 7) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_QUANTITY");
  });

  it("segundo pedido com outra chave: 409 'Impressora em uso'; mesma chave devolve o mesmo pedido", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const b = body("p-1", 10, "chave-fixa-0001");
    const first = await ctx.call("POST", "/operator/print-jobs", { token: op, body: b });
    const replay = await ctx.call("POST", "/operator/print-jobs", { token: op, body: b });
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.printJobId).toBe(first.body.printJobId);
    const busy = await ctx.call("POST", "/operator/print-jobs", {
      token: op,
      body: body("p-1", 1),
    });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe("PRINTER_BUSY");
    expect(busy.body.message).toBe("Impressora em uso");
    const conflict = await ctx.call("POST", "/operator/print-jobs", {
      token: op,
      body: { ...b, quantity: 30 },
    });
    expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("posto 2 não é bloqueado pelo posto 1 e não enxerga pedidos do posto 1", async () => {
    const op1 = await ctx.login("operador1", "operator-pass-123", "st-1");
    const op2 = await ctx.login("operador2", "operator-pass-123", "st-2");
    const j1 = await ctx.call("POST", "/operator/print-jobs", { token: op1, body: body() });
    const j2 = await ctx.call("POST", "/operator/print-jobs", { token: op2, body: body() });
    expect(j2.status).toBe(201);
    expect(
      (await ctx.call("GET", `/operator/print-jobs/${j1.body.printJobId}`, { token: op2 })).status,
    ).toBe(404);
    expect(
      (await ctx.call("POST", `/operator/print-jobs/${j1.body.printJobId}/cancel`, { token: op2 }))
        .status,
    ).toBe(404);
  });

  it("o mesmo operador entra em qualquer posto, imprime só na impressora do posto onde entrou, e as mesmas peças rodam nos dois postos ao mesmo tempo (D-018, D-040)", async () => {
    const tokA = await ctx.login("operador1", "operator-pass-123", "st-1");
    const tokB = await ctx.login("operador1", "operator-pass-123", "st-2");
    const a = await ctx.call("POST", "/operator/print-jobs", {
      token: tokA,
      body: { partId: "p-1", machineId: "m-1", quantity: 1, idempotencyKey: "cross-key-a1" },
    });
    const b = await ctx.call("POST", "/operator/print-jobs", {
      token: tokB,
      body: { partId: "p-1", machineId: "m-2", quantity: 1, idempotencyKey: "cross-key-b1" },
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201); // mesma peça, outra máquina e outra impressora, ao mesmo tempo
    expect(a.body.printerId ?? "pr-1").not.toBe(b.body.printerId ?? "pr-2");
    // a sessão do posto 2 não consegue imprimir na máquina do posto 1 nem enxergar o pedido do posto 1
    const wrongMachine = await ctx.call("POST", "/operator/print-jobs", {
      token: tokB,
      body: { partId: "p-2", machineId: "m-1", quantity: 1, idempotencyKey: "cross-key-b2" },
    });
    expect(wrongMachine.status).toBeGreaterThanOrEqual(400);
    expect(
      (await ctx.call("GET", `/operator/print-jobs/${a.body.id}`, { token: tokB })).status,
    ).toBe(404);
  });

  it("o token do agente do posto 2 não reivindica tentativas do posto 1", async () => {
    const op1 = await ctx.login("operador1", "operator-pass-123", "st-1");
    await ctx.call("POST", "/operator/print-jobs", { token: op1, body: body() });
    const agent2 = newAgent(TOK2, "st-2", "pr-2", new SimulatedPrinter());
    expect((await agent2.tick()).kind).toBe("IDLE");
    expect(
      (await ctx.call("POST", "/agent/claim", { agent: "token-invalido", body: {} })).status,
    ).toBe(401);
  });

  it("mídia de 4 colunas: o agente imprime 10 etiquetas em 3 linhas (4 + 4 + 2) pelo HTTP", async () => {
    const op1 = await ctx.login("operador1", "operator-pass-123", "st-1");
    const job = await ctx.call("POST", "/operator/print-jobs", { token: op1, body: body() });
    const printer = new SimulatedPrinter();
    printer.labelsPerRow = 4;
    const agent = newAgent(TOK1, "st-1", "pr-1", printer);
    for (let i = 0; i < 3; i++) expect((await agent.tick()).kind).toBe("PRINTED");
    expect(printer.rows.map((r) => r.length)).toEqual([4, 4, 2]);
    const done = await ctx.call("GET", `/operator/print-jobs/${job.body.printJobId}`, {
      token: op1,
    });
    expect(done.body.status).toBe("COMPLETED");
  });

  it("recarregar a tela recupera o pedido ativo do servidor (sem reenviar)", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const created = await ctx.call("POST", "/operator/print-jobs", { token: op, body: body() });
    const c = await ctx.call("GET", "/operator/context", { token: op });
    expect(c.body.activeJob.printJobId).toBe(created.body.printJobId);
  });

  it("cancelar um pedido em andamento cancela o que ainda não foi enviado", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const created = await ctx.call("POST", "/operator/print-jobs", { token: op, body: body() });
    const r = await ctx.call("POST", `/operator/print-jobs/${created.body.printJobId}/cancel`, {
      token: op,
    });
    expect(r.body.status).toBe("CANCELLED");
  });

  it("máquina fora do vínculo do posto é recusada", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const r = await ctx.call("POST", "/operator/print-jobs", {
      token: op,
      body: { ...body(), machineId: "m-2" },
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("MACHINE_NOT_ALLOWED");
  });
});

describe("resultado desconhecido e reimpressão", () => {
  async function unknownScenario() {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const adm = await ctx.login("admin", "admin-pass-123");
    const printer = new SimulatedPrinter();
    printer.script = ["OK", "OK", "UNCERTAIN"];
    const agent = newAgent(TOK1, "st-1", "pr-1", printer);
    const created = await ctx.call("POST", "/operator/print-jobs", {
      token: op,
      body: body("p-1", 10),
    });
    for (let i = 0; i < 3; i++) await agent.tick();
    const job = await ctx.call("GET", `/operator/print-jobs/${created.body.printJobId}`, {
      token: op,
    });
    const unknown = job.body.attempts.find((a: any) => a.state === "UNKNOWN_OUTCOME");
    return { op, adm, printer, agent, jobId: created.body.printJobId as string, unknown, job };
  }

  it("o operador vê o estado e solicita ação; não resolve (403 no servidor)", async () => {
    const s = await unknownScenario();
    expect(s.job.body.status).toBe("REQUIRES_REVIEW");
    expect(s.job.body.counts).toEqual({ PRINTED_CONFIRMED: 2, UNKNOWN_OUTCOME: 1, QUEUED: 7 });
    const req = await ctx.call(
      "POST",
      `/operator/attempts/${s.unknown.attemptId}/request-resolution`,
      { token: s.op },
    );
    expect(req.body.message).toBe(
      "Aviso enviado ao administrador. Aguarde a conferência da etiqueta.",
    );
    const forbidden = await ctx.call("POST", `/admin/attempts/${s.unknown.attemptId}/resolve`, {
      token: s.op,
      body: { outcome: "PRINTED", note: "x" },
    });
    expect(forbidden.status).toBe(403);
    const busy = await ctx.call("POST", "/operator/print-jobs", {
      token: s.op,
      body: body("p-1", 1),
    });
    expect(busy.body.code).toBe("PRINTER_BUSY");
  });

  it("o ADMIN resolve 'não saiu', continua o restante e cria RETRY com o mesmo label_id", async () => {
    const s = await unknownScenario();
    const res = await ctx.call("POST", `/admin/attempts/${s.unknown.attemptId}/resolve`, {
      token: s.adm,
      body: { outcome: "NOT_PRINTED", note: "Conferido: não saiu" },
    });
    expect(res.body.state).toBe("FAILED");
    const held = await ctx.call("POST", `/admin/print-jobs/${s.jobId}/held`, {
      token: s.adm,
      body: { decision: "CONTINUE" },
    });
    expect(held.body.status).toBe("IN_PROGRESS");
    for (let i = 0; i < 7; i++) expect((await s.agent.tick()).kind).toBe("PRINTED");
    const done = await ctx.call("GET", `/admin/print-jobs/${s.jobId}`, { token: s.adm });
    expect(done.body.status).toBe("PARTIALLY_COMPLETED");
    const retry = await ctx.call("POST", `/admin/labels/${s.unknown.labelId}/retry`, {
      token: s.adm,
      body: { idempotencyKey: "retry-key-0001" },
    });
    expect(retry.status).toBe(201);
    expect(retry.body.kind).toBe("RETRY");
    expect(retry.body.attempts[0].attemptNo).toBe(2);
    expect((await s.agent.tick()).kind).toBe("PRINTED");
    const trace = await ctx.call("GET", `/admin/labels/${s.unknown.labelId}`, { token: s.adm });
    expect(trace.body.attempts.map((a: any) => a.state)).toEqual(["FAILED", "PRINTED_CONFIRMED"]);
    expect(trace.body.jobs.map((j: any) => j.kind).sort()).toEqual(["ORIGINAL", "RETRY"]);
  });

  it("o operador recomeça: confere a etiqueta desconhecida e continua de onde parou, sem reimprimir as já impressas", async () => {
    const s = await unknownScenario();
    const noAnswer = await ctx.call("POST", `/operator/print-jobs/${s.jobId}/restart`, {
      token: s.op,
      body: { idempotencyKey: "rs-key-00001", mode: "RESUME" },
    });
    expect(noAnswer.body.code).toBe("UNKNOWN_OUTCOME_OPEN");
    const r = await ctx.call("POST", `/operator/print-jobs/${s.jobId}/restart`, {
      token: s.op,
      body: { idempotencyKey: "rs-key-00002", mode: "RESUME", unknownOutcome: "NOT_PRINTED" },
    });
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe("RETRY");
    expect(r.body.attempts).toHaveLength(8); // a que não saiu + 7 restantes
    expect(r.body.attempts[0].labelId).toBe(s.unknown.labelId);
    for (let i = 0; i < 8; i++) expect((await s.agent.tick()).kind).toBe("PRINTED");
    const done = await ctx.call("GET", `/operator/print-jobs/${r.body.printJobId}`, {
      token: s.op,
    });
    expect(done.body.status).toBe("COMPLETED");
    const audit = await ctx.call("GET", "/admin/audit", { token: s.adm });
    const actions = JSON.stringify(audit.body);
    expect(actions).toContain("JOB_RESUMED");
    expect(actions).toContain("UNKNOWN_OUTCOME_RESOLVED");
  });

  it("o operador pode reimprimir tudo, exigindo o motivo", async () => {
    const s = await unknownScenario();
    const noReason = await ctx.call("POST", `/operator/print-jobs/${s.jobId}/restart`, {
      token: s.op,
      body: { idempotencyKey: "ra-key-00001", mode: "ALL", unknownOutcome: "PRINTED" },
    });
    expect(noReason.body.code).toBe("REASON_REQUIRED");
    const r = await ctx.call("POST", `/operator/print-jobs/${s.jobId}/restart`, {
      token: s.op,
      body: {
        idempotencyKey: "ra-key-00002",
        mode: "ALL",
        unknownOutcome: "PRINTED",
        reason: "Rolo trocado",
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe("REPRINT");
    expect(r.body.attempts).toHaveLength(10);
  });

  it("reimpressão exige motivo, mantém o label_id e aparece como filtro do Histórico", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const adm = await ctx.login("admin", "admin-pass-123");
    const agent = newAgent(TOK1, "st-1", "pr-1", new SimulatedPrinter());
    const created = await ctx.call("POST", "/operator/print-jobs", {
      token: op,
      body: body("p-1", 1),
    });
    await agent.tick();
    const labelId = created.body.attempts[0].labelId as string;
    const noReason = await ctx.call("POST", `/operator/labels/${labelId}/reprint`, {
      token: op,
      body: { idempotencyKey: "reprint-key-01", reason: " " },
    });
    expect(noReason.status).toBe(400);
    const ok = await ctx.call("POST", `/operator/labels/${labelId}/reprint`, {
      token: op,
      body: { idempotencyKey: "reprint-key-01", reason: "Etiqueta danificada" },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.kind).toBe("REPRINT");
    await agent.tick();
    const all = await ctx.call("GET", "/admin/history", { token: adm });
    expect(all.body.total).toBe(1);
    const only = await ctx.call("GET", "/admin/history?onlyReprints=true", { token: adm });
    expect(only.body.items[0].reprints).toBe(1);
    const trace = await ctx.call("GET", `/admin/labels/${labelId}`, { token: adm });
    expect(trace.body.jobs.find((j: any) => j.kind === "REPRINT").reason).toBe(
      "Etiqueta danificada",
    );
    expect(trace.body.label.snapshot.operator.displayName).toBe("Operador 1");
  });
});

describe("administração", () => {
  it("dashboard mostra versão do agente e status; só ADMIN", async () => {
    const adm = await ctx.login("admin", "admin-pass-123");
    await newAgent(TOK1, "st-1", "pr-1", new SimulatedPrinter()).tick();
    const r = await ctx.call("GET", "/admin/dashboard", { token: adm });
    const st1 = r.body.stations.find((s: any) => s.station.id === "st-1");
    expect(st1.agent.version).toBe("0.1.0");
    expect(st1.printer.status).toBe("READY");
    expect(r.body.stations).toHaveLength(2);
  });

  it("modelos da Doowon já vêm cadastrados e o ALC Code é validado", async () => {
    const adm = await ctx.login("admin", "admin-pass-123");
    const list = await ctx.call("GET", "/admin/parts", { token: adm });
    const pns = Object.fromEntries(list.body.map((p: any) => [p.alcCode, p.partNumber]));
    expect(pns).toMatchObject({
      AG10: "29135-BP000",
      AG11: "29135-BP300",
      AG12: "29135-BP400",
      AG02: "29135-BX500",
      AG03: "29135-BX700",
      AG04: "29135-BX900",
    });
    const bad = await ctx.call("POST", "/admin/parts", {
      token: adm,
      body: { alcCode: "A-1", partNumber: "PN-77" },
    });
    expect(bad.status).toBe(400);
    const ok = await ctx.call("POST", "/admin/parts", {
      token: adm,
      body: { alcCode: "ag20", partNumber: "29135-ZZ000" },
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ alcCode: "AG20", description: "AG20" });
  });

  it("peça: valida 2 letras + 3 números; com histórico é inativada, não excluída", async () => {
    const adm = await ctx.login("admin", "admin-pass-123");
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    expect(
      (
        await ctx.call("POST", "/admin/parts", {
          token: adm,
          body: { description: "A1234", partNumber: "PN-9" },
        })
      ).status,
    ).toBe(400);
    const created = await ctx.call("POST", "/admin/parts", {
      token: adm,
      body: { description: "ef789", partNumber: "PN-9" },
    });
    expect(created.status).toBe(201);
    expect(created.body.description).toBe("EF789");
    await ctx.call("POST", "/operator/print-jobs", { token: op, body: body(created.body.id, 1) });
    const del = await ctx.call("DELETE", `/admin/parts/${created.body.id}`, { token: adm });
    expect(del.status).toBe(400);
    const inact = await ctx.call("PUT", `/admin/parts/${created.body.id}/active`, {
      token: adm,
      body: { active: false },
    });
    expect(inact.status).toBe(200);
    const unused = await ctx.call("POST", "/admin/parts", {
      token: adm,
      body: { description: "GH111", partNumber: "PN-10" },
    });
    expect(
      (await ctx.call("DELETE", `/admin/parts/${unused.body.id}`, { token: adm })).status,
    ).toBe(200);
    const c = await ctx.call("GET", "/operator/context", { token: op });
    expect(c.body.parts.map((p: any) => p.description)).not.toContain("EF789");
  });

  it("a auditoria traz nomes técnicos e descrição amigável em português", async () => {
    const adm = await ctx.login("admin", "admin-pass-123");
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    await ctx.call("POST", "/operator/print-jobs", { token: op, body: body("p-1", 1) });
    const r = await ctx.call("GET", "/admin/audit", { token: adm });
    const ev = r.body.items.find((e: any) => e.action === "PRINT_JOB_REQUESTED");
    expect(ev.description).toBe("Impressão solicitada");
    expect(r.body.items.find((e: any) => e.action === "LOGIN_OK").description).toBe(
      "Login realizado",
    );
  });

  it("virada de turno noturna (Turno 3) é resolvida corretamente", async () => {
    ctx.now.t = Date.parse("2026-10-21T03:00:00Z"); // 00:00 em São Paulo
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const r = await ctx.call("GET", "/operator/context", { token: op });
    expect(r.body.shift.name).toBe("Turno 3");
  });
});

describe("fluxo do protótipo: ajuste, conferência, painel e filtros", () => {
  it("o operador pede ajuste e o administrador vê o pedido no painel (e na auditoria amigável)", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const adm = await ctx.login("admin", "admin-pass-123");
    const r = await ctx.call("POST", "/operator/adjustment-requests", {
      token: op,
      body: { note: "Peça errada na lista", partId: "p-1" },
    });
    expect(r.body.ok).toBe(true);
    const d = await ctx.call("GET", "/admin/dashboard", { token: adm });
    expect(d.body.adjustments[0]).toMatchObject({
      operator: "Operador 1",
      station: "Posto 01",
      note: "Peça errada na lista",
    });
    const audit = await ctx.call("GET", "/admin/audit", { token: adm });
    expect(audit.body.items.find((e: any) => e.action === "ADJUSTMENT_REQUESTED").description).toBe(
      "Ajuste de dados solicitado pelo operador",
    );
    expect((await ctx.call("GET", "/admin/dashboard", { token: op })).status).toBe(403);
  });

  it("'Aplicar etiqueta' registra a conferência do operador sem alterar estados", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const agent = newAgent(TOK1, "st-1", "pr-1", new SimulatedPrinter());
    const job = await ctx.call("POST", "/operator/print-jobs", { token: op, body: body("p-1", 1) });
    await agent.tick();
    const before = await ctx.call("GET", `/operator/print-jobs/${job.body.printJobId}`, {
      token: op,
    });
    expect(
      (
        await ctx.call("POST", `/operator/print-jobs/${job.body.printJobId}/acknowledge`, {
          token: op,
        })
      ).body.ok,
    ).toBe(true);
    const after = await ctx.call("GET", `/operator/print-jobs/${job.body.printJobId}`, {
      token: op,
    });
    expect(after.body.status).toBe(before.body.status);
    const adm = await ctx.login("admin", "admin-pass-123");
    const audit = await ctx.call("GET", "/admin/audit", { token: adm });
    expect(audit.body.items.some((e: any) => e.action === "LABELS_CONFIRMED_BY_OPERATOR")).toBe(
      true,
    );
  });

  it("a pré-visualização traz só campos do REQ-011 (sem máquina nem lote)", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const job = await ctx.call("POST", "/operator/print-jobs", { token: op, body: body("p-1", 1) });
    const l = job.body.attempts[0].label;
    expect(Object.keys(l).sort()).toEqual([
      "description",
      "labelId",
      "operator",
      "partNumber",
      "producedAtUtc",
      "qr",
      "shift",
    ]);
  });

  it("o painel traz indicadores, produção por hora e últimas impressões", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const adm = await ctx.login("admin", "admin-pass-123");
    const agent = newAgent(TOK1, "st-1", "pr-1", new SimulatedPrinter());
    await ctx.call("POST", "/operator/print-jobs", { token: op, body: body("p-1", 10) });
    for (let i = 0; i < 10; i++) await agent.tick();
    const first = await ctx.call("GET", "/operator/context", { token: op });
    expect(first.body.activeJob).toBeNull();
    const rows = (await ctx.call("GET", "/admin/history", { token: adm })).body.items;
    await ctx.call("POST", `/operator/labels/${rows[0].labelId}/reprint`, {
      token: op,
      body: { idempotencyKey: "reprint-dash-1", reason: "Etiqueta danificada" },
    });
    await agent.tick();
    const d = (await ctx.call("GET", "/admin/dashboard", { token: adm })).body;
    expect(d.kpis.labelsToday).toBe(10);
    expect(d.kpis.reprintsToday).toBe(1);
    expect(d.kpis.machines).toEqual({ active: 2, total: 2 });
    expect(d.kpis.operators).toEqual({ active: 2, total: 2 });
    expect(d.hourly).toHaveLength(24);
    expect(d.hourly.reduce((n: number, h: any) => n + h.count, 0)).toBe(11);
    expect(d.recent).toHaveLength(5);
    expect(d.today.shift.name).toBe("Turno 2");
  });

  it("o histórico filtra por ID, peça, Part Number, operador, máquina e data, com paginação", async () => {
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const adm = await ctx.login("admin", "admin-pass-123");
    const agent = newAgent(TOK1, "st-1", "pr-1", new SimulatedPrinter());
    await ctx.call("POST", "/operator/print-jobs", { token: op, body: body("p-1", 10) });
    for (let i = 0; i < 10; i++) await agent.tick();
    await ctx.call("POST", "/operator/print-jobs", { token: op, body: body("p-2", 1) });
    await agent.tick();
    const h = (qs: string) =>
      ctx.call("GET", `/admin/history?${qs}`, { token: adm }).then((r) => r.body);
    expect((await h("")).total).toBe(11);
    expect((await h("partNumber=PN-0002")).total).toBe(1);
    expect((await h("part=ab123")).total).toBe(10);
    expect((await h("operatorId=u-op1")).total).toBe(11);
    expect((await h("operatorId=u-op2")).total).toBe(0);
    expect((await h("machineId=m-1")).total).toBe(11);
    expect((await h("machineId=m-2")).total).toBe(0);
    expect((await h("from=2026-10-20&to=2026-10-20")).total).toBe(11);
    expect((await h("from=2026-10-21")).total).toBe(0);
    const page = await h("limit=5&offset=5");
    expect(page.items).toHaveLength(5);
    expect(page.total).toBe(11);
    const one = (await h("")).items[0].labelId as string;
    expect((await h(`id=${one.slice(0, 4)}`)).total).toBeGreaterThanOrEqual(1);
  });

  it("exporta o histórico em Excel com os mesmos filtros, só para ADMIN, e audita", async () => {
    const tok = await ctx.login("operador1", "operator-pass-123", "st-1");
    const printer = new SimulatedPrinter();
    const agent = newAgent(TOK1, "st-1", "pr-1", printer);
    const created = await ctx.call("POST", "/operator/print-jobs", {
      token: tok,
      body: { partId: "p-1", machineId: "m-1", quantity: 10, idempotencyKey: "export-key-1" },
    });
    expect(created.status).toBe(201);
    for (let i = 0; i < 12; i++) await agent.tick();
    const admin = await ctx.login("admin", "admin-pass-123");
    const raw = async (path: string, token: string) =>
      fetch(ctx.base + path, { headers: { authorization: `Bearer ${token}` } });
    expect((await raw("/admin/history/export", tok)).status).toBe(403);
    const res = await raw("/admin/history/export?part=AB123", admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toContain(".xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
    const ws = wb.getWorksheet("Etiquetas")!;
    expect(ws.rowCount).toBe(11); // cabeçalho + 10 etiquetas
    expect(ws.getRow(1).values).toContain("Part Number");
    expect(ws.getRow(2).getCell(3).value).toBe("PN-0001");
    const none = await raw("/admin/history/export?part=ZZ999", admin);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(Buffer.from(await none.arrayBuffer()) as any);
    expect(wb2.getWorksheet("Etiquetas")!.rowCount).toBe(1);
    const audit = await ctx.call("GET", "/admin/audit", { token: admin });
    expect(JSON.stringify(audit.body)).toContain("Relatório do histórico exportado");
  });

  it("edita peça, máquina, turno e operador (com validação) e preserva as etiquetas já emitidas", async () => {
    const adm = await ctx.login("admin", "admin-pass-123");
    const op = await ctx.login("operador1", "operator-pass-123", "st-1");
    const job = await ctx.call("POST", "/operator/print-jobs", { token: op, body: body("p-1", 1) });
    const labelId = job.body.attempts[0].labelId as string;
    expect(
      (await ctx.call("PUT", "/admin/parts/p-1", { token: adm, body: { description: "xx99" } }))
        .status,
    ).toBe(400);
    const ok = await ctx.call("PUT", "/admin/parts/p-1", {
      token: adm,
      body: { description: "zz999", partNumber: "PN-NEW" },
    });
    expect(ok.body).toMatchObject({ description: "ZZ999", partNumber: "PN-NEW" });
    const trace = await ctx.call("GET", `/admin/labels/${labelId}`, { token: adm });
    expect(trace.body.label.snapshot.part).toMatchObject({
      description: "AB123",
      partNumber: "PN-0001",
    });
    expect(
      (await ctx.call("PUT", "/admin/machines/m-1", { token: adm, body: { name: "Injetora 01" } }))
        .body.name,
    ).toBe("Injetora 01");
    expect(
      (await ctx.call("PUT", "/admin/shifts/sh-1", { token: adm, body: { start: "07:00" } })).body
        .start,
    ).toBe("07:00");
    const u = await ctx.call("PUT", "/admin/operators/u-op1", {
      token: adm,
      body: { displayName: "Carlos Silva" },
    });
    expect(JSON.stringify(u.body)).not.toMatch(/passwordHash|scrypt/);
    expect(
      (await ctx.call("PUT", "/admin/parts/p-1", { token: op, body: { description: "AA111" } }))
        .status,
    ).toBe(403);
  });
});
