import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  DomainError,
  type AgentInfo,
  type AttemptResult,
  type JobView,
  type PrintAttempt,
} from "@doowon/domain";
import { ATTEMPT_STATE_PT, auditPt } from "@doowon/shared";
import ExcelJS from "exceljs";
import type { Request, Response } from "express";
import { bearer, correlationOf, requireSession, str } from "./http.js";
import { RUNTIME, type Runtime } from "./runtime.js";

type Json = Record<string, unknown>;

@Controller()
export class SessionController {
  constructor(@Inject(RUNTIME) private rt: Runtime) {}

  @Get("health")
  health(): { status: "ok" } {
    return { status: "ok" };
  }

  @Post("auth/login")
  async login(@Body() b: Json, @Req() req: Request) {
    const corr = correlationOf(req);
    const s = await this.rt.auth.login(
      str(b["username"]),
      str(b["password"]),
      str(b["stationId"]) || null,
      corr,
    );
    return { token: s.token, role: s.role, displayName: s.displayName, stationId: s.stationId };
  }

  @Post("auth/logout")
  async logout(@Req() req: Request) {
    const t = bearer(req);
    if (t) await this.rt.auth.logout(t, correlationOf(req));
    return { ok: true };
  }

  @Get("me")
  me(@Req() req: Request) {
    const s = requireSession(this.rt, req);
    return { userId: s.userId, role: s.role, displayName: s.displayName, stationId: s.stationId };
  }
}

/** Estado da impressora para exibição: heartbeat recente + status informado pelo agente. */
function printerStatus(rt: Runtime, stationId: string) {
  return rt.svc.reader.getAgent(stationId).then((a) => {
    if (!a || rt.clock() - a.lastHeartbeatAt > rt.heartbeatMaxAgeMs)
      return { status: "OFFLINE" as const };
    return { status: a.printerStatus };
  });
}

@Controller("operator")
export class OperatorController {
  constructor(@Inject(RUNTIME) private rt: Runtime) {}

  private ctx(req: Request) {
    const s = requireSession(this.rt, req, "OPERATOR");
    const station = this.rt.md.stations.get(s.stationId ?? "");
    if (!station) throw new DomainError("NOT_ELIGIBLE", "Posto não configurado neste computador.");
    return { s, station, actor: this.rt.auth.actorOf(s), corr: correlationOf(req) };
  }

  /** Tudo o que a tela do operador precisa; a impressora é derivada do posto (E-006, E-023). */
  @Get("context")
  async context(@Req() req: Request) {
    const { station } = this.ctx(req);
    const allowed = (this.rt.md.stationMachines.get(station.id) ?? [])
      .map((id) => this.rt.md.machines.get(id))
      .filter((m) => m?.active);
    const shift = this.rt.md.currentShift(this.rt.clock(), this.rt.timezone);
    const active = await this.rt.svc.getActiveJobForPrinter(station.printerId);
    return {
      station: { id: station.id, name: station.name },
      machines: allowed.map((m) => ({ id: m!.id, code: m!.code, name: m!.name })),
      fixedMachine: allowed.length === 1,
      printer: {
        name: this.rt.md.printers.get(station.printerId)?.name,
        ...(await printerStatus(this.rt, station.id)),
      },
      shift: shift ? { id: shift.id, name: shift.name } : null,
      parts: [...this.rt.md.parts.values()]
        .filter((p) => p.active)
        .map((p) => ({ id: p.id, description: p.description, partNumber: p.partNumber })),
      quantities: [1, 10, 30],
      activeJob: active ? summarize(active) : null,
    };
  }

  @Post("print-jobs")
  async create(@Body() b: Json, @Req() req: Request) {
    const { station, actor, corr } = this.ctx(req);
    const part = this.rt.md.parts.get(str(b["partId"]));
    if (!part || !part.active) throw new DomainError("NOT_FOUND", "Peça não encontrada.");
    const machineId =
      str(b["machineId"]) || (this.rt.md.stationMachines.get(station.id) ?? [])[0] || "";
    const machine = this.rt.md.machines.get(machineId);
    if (!machine || !machine.active)
      throw new DomainError("MACHINE_NOT_ALLOWED", "Máquina não permitida para este posto.");
    const shift = this.rt.md.currentShift(this.rt.clock(), this.rt.timezone);
    if (!shift)
      throw new DomainError("NOT_ELIGIBLE", "Não há turno vigente. Chame o administrador.");
    const key = str(b["idempotencyKey"]);
    if (key.length < 8) throw new DomainError("NOT_ELIGIBLE", "Chave de idempotência ausente.");
    const { view, replayed } = await this.rt.svc.createOriginal({
      idempotencyKey: key,
      quantity: Number(b["quantity"]),
      actor,
      stationId: station.id,
      printerId: station.printerId,
      machine: { id: machine.id, code: machine.code },
      allowedMachineIds: this.rt.md.stationMachines.get(station.id) ?? [],
      part: { id: part.id, description: part.description, partNumber: part.partNumber },
      shift: { id: shift.id, name: shift.name },
      templateId: "tpl-default",
      templateVersion: 1,
      timezone: this.rt.timezone,
      correlationId: corr,
    });
    return { replayed, ...summarize(view) };
  }

  @Get("print-jobs/:id")
  async get(@Param("id") id: string, @Req() req: Request) {
    const { station } = this.ctx(req);
    const view = await this.rt.svc.getJobView(id);
    if (view.job.stationId !== station.id)
      throw new DomainError("NOT_FOUND", "Pedido de impressão não encontrado.");
    return summarize(view);
  }

  @Post("print-jobs/:id/cancel")
  async cancel(@Param("id") id: string, @Req() req: Request) {
    const { station, actor, corr } = this.ctx(req);
    const cur = await this.rt.svc.getJobView(id);
    if (cur.job.stationId !== station.id)
      throw new DomainError("NOT_FOUND", "Pedido de impressão não encontrado.");
    return summarize(await this.rt.svc.cancelJob(id, actor, corr));
  }

  /**
   * Recomeço pelo operador: "Continuar de onde parou" (mode RESUME) ou "Reimprimir tudo" (mode ALL).
   * Usa a impressora do posto da sessão; o pedido precisa ser deste posto.
   */
  @Post("print-jobs/:id/restart")
  async restart(@Param("id") id: string, @Body() b: Json, @Req() req: Request) {
    const { station, actor, corr } = this.ctx(req);
    const mode = b["mode"] === "ALL" ? "ALL" : b["mode"] === "RESUME" ? "RESUME" : null;
    if (!mode) throw new DomainError("NOT_ELIGIBLE", "Escolha continuar ou reimprimir tudo.");
    const unknown =
      b["unknownOutcome"] === "PRINTED"
        ? "PRINTED"
        : b["unknownOutcome"] === "NOT_PRINTED"
          ? "NOT_PRINTED"
          : undefined;
    const reason = str(b["reason"]);
    const rawMap = b["unknownOutcomes"];
    const unknownOutcomes: Record<string, "PRINTED" | "NOT_PRINTED"> = {};
    if (rawMap && typeof rawMap === "object")
      for (const [k, v] of Object.entries(rawMap as Record<string, unknown>))
        if (v === "PRINTED" || v === "NOT_PRINTED") unknownOutcomes[k] = v;
    const { view, replayed } = await this.rt.svc.restartJob({
      idempotencyKey: str(b["idempotencyKey"]),
      jobId: id,
      mode,
      actor,
      stationId: station.id,
      printerId: station.printerId,
      correlationId: corr,
      ...(reason ? { reason } : {}),
      ...(unknown ? { unknownOutcome: unknown } : {}),
      ...(Object.keys(unknownOutcomes).length > 0 ? { unknownOutcomes } : {}),
    });
    return { replayed, ...summarize(view) };
  }

  @Post("labels/:labelId/reprint")
  async reprint(@Param("labelId") labelId: string, @Body() b: Json, @Req() req: Request) {
    const { station, actor, corr } = this.ctx(req);
    const { view, replayed } = await this.rt.svc.createReprint({
      idempotencyKey: str(b["idempotencyKey"]),
      labelIds: [labelId],
      actor,
      stationId: station.id,
      printerId: station.printerId,
      correlationId: corr,
      reason: str(b["reason"]),
    });
    return { replayed, ...summarize(view) };
  }

  /** "Dados incorretos?": o operador pede ajuste ao administrador (fluxo do protótipo). */
  @Post("adjustment-requests")
  async adjustment(@Body() b: Json, @Req() req: Request) {
    const { station, actor, corr } = this.ctx(req);
    const note = str(b["note"]).trim().slice(0, 200);
    await this.rt.svc.recordAudit({
      action: "ADJUSTMENT_REQUESTED",
      actorId: actor.id,
      stationId: station.id,
      targetType: "SYSTEM",
      targetId: null,
      correlationId: corr,
      details: { note, partId: str(b["partId"]), machineId: str(b["machineId"]) },
    });
    return { ok: true, message: "Aviso enviado ao administrador." };
  }

  /** "Etiqueta OK? → Aplicar etiqueta": registra a conferência do operador (não altera estados). */
  @Post("print-jobs/:id/acknowledge")
  async acknowledge(@Param("id") id: string, @Req() req: Request) {
    const { station, actor, corr } = this.ctx(req);
    const v = await this.rt.svc.getJobView(id);
    if (v.job.stationId !== station.id)
      throw new DomainError("NOT_FOUND", "Pedido de impressão não encontrado.");
    await this.rt.svc.recordAudit({
      action: "LABELS_CONFIRMED_BY_OPERATOR",
      actorId: actor.id,
      stationId: station.id,
      targetType: "PRINT_JOB",
      targetId: id,
      correlationId: corr,
    });
    return { ok: true };
  }

  /** OPERATOR só solicita a ação do ADMIN; não resolve (D-031). */
  @Post("attempts/:id/request-resolution")
  async requestResolution(@Param("id") id: string, @Req() req: Request) {
    const { actor, corr } = this.ctx(req);
    await this.rt.svc.requestResolution(id, actor, corr);
    return {
      ok: true,
      message: "Aviso enviado ao administrador. Aguarde a conferência da etiqueta.",
    };
  }
}

/** Resumo para a interface: estados por etiqueta, sem termos técnicos além do necessário. */
function summarize(v: JobView) {
  const labels = v.labels.length ? v.labels : []; // RETRY/REPRINT não criam etiquetas; o resumo usa as tentativas
  const bySeq = new Map(labels.map((l) => [l.labelId, l.sequenceInJob]));
  return {
    printJobId: v.job.id,
    kind: v.job.kind,
    status: v.status,
    quantity: v.job.quantity,
    correlationId: v.job.correlationId,
    attempts: v.attempts.map((a) => ({
      attemptId: a.id,
      labelId: a.labelId,
      sequence: bySeq.get(a.labelId) ?? a.order,
      attemptNo: a.attemptNo,
      state: a.state,
      held: a.holdReason !== null,
      // Somente campos do REQ-011 (sem "lote", sem máquina), para a pré-visualização da etiqueta.
      label: {
        description: a.renderSnapshot.part.description,
        partNumber: a.renderSnapshot.part.partNumber,
        operator: a.renderSnapshot.operator.displayName,
        shift: a.renderSnapshot.shift.name,
        producedAtUtc: a.renderSnapshot.producedAtUtc,
        qr: a.renderSnapshot.qrContent,
        labelId: a.renderSnapshot.labelId,
      },
    })),
    counts: countStates(v),
  };
}

function countStates(v: JobView): Record<string, number> {
  const c: Record<string, number> = {};
  for (const a of v.attempts) c[a.state] = (c[a.state] ?? 0) + 1;
  return c;
}

@Controller("admin")
export class AdminController {
  constructor(@Inject(RUNTIME) private rt: Runtime) {}

  private ctx(req: Request) {
    const s = requireSession(this.rt, req, "ADMIN");
    return { s, actor: this.rt.auth.actorOf(s), corr: correlationOf(req) };
  }

  /** Painel: indicadores, produção, últimas impressões, estações (versão do agente só para ADMIN) e pedidos de ajuste. */
  @Get("dashboard")
  async dashboard(@Req() req: Request) {
    this.ctx(req);
    const rt = this.rt;
    const read = rt.svc.reader;
    const now = rt.clock();
    const day = (ts: number): string =>
      new Intl.DateTimeFormat("en-CA", { timeZone: rt.timezone }).format(new Date(ts));
    const hour = (ts: number): number =>
      Number(
        new Intl.DateTimeFormat("en-GB", { timeZone: rt.timezone, hour: "2-digit", hour12: false })
          .format(new Date(ts))
          .replace("24", "0"),
      );
    const today = day(now);
    const yesterday = day(now - 24 * 3_600_000);
    const jobs = new Map((await read.listJobs()).map((j) => [j.id, j]));
    const confirmed = (await read.listAttempts()).filter((a) => a.state === "PRINTED_CONFIRMED");
    const isReprint = (a: (typeof confirmed)[number]): boolean =>
      jobs.get(a.printJobId)?.kind === "REPRINT";
    const originals = confirmed.filter((a) => !isReprint(a));
    const reprints = confirmed.filter(isReprint);
    const countDay = (list: typeof confirmed, d: string): number =>
      list.filter((a) => day(a.createdAt) === d).length;
    const hourly = Array.from({ length: 24 }, (_, i) => {
      const start = now - (23 - i) * 3_600_000;
      const count = confirmed.filter(
        (a) => a.createdAt > start - 3_600_000 && a.createdAt <= start,
      ).length;
      return { hour: hour(start), count };
    });
    const recent = [...confirmed]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5)
      .map((a) => ({
        labelId: a.labelId,
        part: a.renderSnapshot.part.description,
        operator: a.renderSnapshot.operator.displayName,
        at: a.createdAt,
        machine: a.renderSnapshot.machine.code,
      }));
    const adjustments = (await rt.svc.listAudit())
      .filter((e) => e.action === "ADJUSTMENT_REQUESTED")
      .sort((a, b) => b.at - a.at)
      .slice(0, 5)
      .map((e) => ({
        at: e.at,
        operator: rt.md.users.get(e.actorId ?? "")?.displayName ?? "",
        station: rt.md.stations.get(e.stationId ?? "")?.name ?? "",
        note: String((e.details as { note?: string } | undefined)?.note ?? ""),
      }));
    const stations = [];
    for (const st of rt.md.stations.values()) {
      const agent = await read.getAgent(st.id);
      const active = await rt.svc.getActiveJobForPrinter(st.printerId);
      stations.push({
        station: { id: st.id, name: st.name },
        printer: {
          name: rt.md.printers.get(st.printerId)?.name,
          ...(await printerStatus(rt, st.id)),
        },
        agent: agent
          ? {
              version: agent.agentVersion,
              protocolVersion: agent.protocolVersion,
              lastHeartbeatAt: agent.lastHeartbeatAt,
              clockSkewMs: agent.clockSkewMs,
            }
          : null,
        activeJob: active ? summarize(active) : null,
      });
    }
    const operators = [...rt.md.users.values()].filter((u) => u.role === "OPERATOR");
    const shift = rt.md.currentShift(now, rt.timezone);
    return {
      today: {
        date: today,
        shift: shift ? { name: shift.name, start: shift.start, end: shift.end } : null,
      },
      kpis: {
        labelsToday: countDay(originals, today),
        labelsYesterday: countDay(originals, yesterday),
        reprintsToday: countDay(reprints, today),
        reprintsYesterday: countDay(reprints, yesterday),
        machines: {
          active: [...rt.md.machines.values()].filter((m) => m.active).length,
          total: rt.md.machines.size,
        },
        operators: { active: operators.filter((u) => u.active).length, total: operators.length },
      },
      hourly,
      recent,
      adjustments,
      stations,
    };
  }

  // ----- dados mestres -----
  @Get("machines")
  machines(@Req() req: Request) {
    this.ctx(req);
    return [...this.rt.md.machines.values()];
  }
  @Post("machines")
  async createMachine(@Body() b: Json, @Req() req: Request) {
    const { s } = this.ctx(req);
    return this.rt.md.create("machines", s.userId, { code: str(b["code"]), name: str(b["name"]) });
  }
  @Get("parts")
  parts(@Req() req: Request) {
    this.ctx(req);
    return [...this.rt.md.parts.values()];
  }
  @Post("parts")
  async createPart(@Body() b: Json, @Req() req: Request) {
    const { s } = this.ctx(req);
    return this.rt.md.create("parts", s.userId, {
      description: str(b["description"]),
      partNumber: str(b["partNumber"]),
      alcCode: str(b["alcCode"]),
    });
  }
  @Get("shifts")
  shifts(@Req() req: Request) {
    this.ctx(req);
    return [...this.rt.md.shifts.values()];
  }
  @Post("shifts")
  async createShift(@Body() b: Json, @Req() req: Request) {
    const { s } = this.ctx(req);
    return this.rt.md.create("shifts", s.userId, {
      name: str(b["name"]),
      start: str(b["start"]),
      end: str(b["end"]),
    });
  }
  @Get("operators")
  operators(@Req() req: Request) {
    this.ctx(req);
    return [...this.rt.md.users.values()].map(({ passwordHash: _p, ...u }) => u);
  }
  @Post("operators")
  async createOperator(@Body() b: Json, @Req() req: Request) {
    const { s } = this.ctx(req);
    const { passwordHash: _p, ...u } = await this.rt.md.create("users", s.userId, {
      username: str(b["username"]),
      displayName: str(b["displayName"]),
      role: b["role"] === "ADMIN" ? "ADMIN" : "OPERATOR",
      password: str(b["password"]),
    });
    return u;
  }
  @Put(":kind/:id")
  async update(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @Body() b: Json,
    @Req() req: Request,
  ) {
    const { s } = this.ctx(req);
    const r = (await this.rt.md.update(kindOf(kind), s.userId, id, b)) as Record<string, unknown>;
    const { passwordHash: _p, ...rest } = r;
    return rest;
  }
  @Put(":kind/:id/active")
  async setActive(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @Body() b: Json,
    @Req() req: Request,
  ) {
    const { s } = this.ctx(req);
    const k = kindOf(kind);
    await this.rt.md.setActive(k, s.userId, id, b["active"] === true);
    return { ok: true };
  }
  @Delete(":kind/:id")
  async remove(@Param("kind") kind: string, @Param("id") id: string, @Req() req: Request) {
    const { s } = this.ctx(req);
    await this.rt.md.remove(kindOf(kind), s.userId, id);
    return { ok: true };
  }

  // ----- histórico e rastreabilidade -----
  /** Histórico paginado; a aba "Reimpressões" é um filtro (`onlyReprints=true`), não um módulo (DIV-08). */
  @Get("history")
  async history(@Query() q: Record<string, string>, @Req() req: Request) {
    this.ctx(req);
    const limit = Math.min(Math.max(Number(q["limit"] ?? 50), 1), 200);
    const offset = Math.max(Number(q["offset"] ?? 0), 0);
    const rows = await this.historyRows(q);
    return { total: rows.length, items: rows.slice(offset, offset + limit) };
  }

  /**
   * Relatório básico do histórico em Excel (.xlsx), com os mesmos filtros da tela (D-017: resposta da Doowon).
   * Colunas e formato são PROVISÓRIOS até a Doowon validar o relatório.
   */
  @Get("history/export")
  async exportHistory(
    @Query() q: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { actor, corr } = this.ctx(req);
    const rows = await this.historyRows(q);
    const fmt = new Intl.DateTimeFormat("pt-BR", {
      timeZone: this.rt.timezone,
      dateStyle: "short",
      timeStyle: "medium",
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Etiquetas");
    ws.columns = [
      { header: "ID da etiqueta", key: "labelId", width: 40 },
      { header: "Peça", key: "partDescription", width: 12 },
      { header: "Part Number", key: "partNumber", width: 18 },
      { header: "Operador", key: "operator", width: 24 },
      { header: "Máquina", key: "machine", width: 12 },
      { header: "Turno", key: "shift", width: 12 },
      { header: "Data e hora da produção", key: "producedAt", width: 24 },
      { header: "Situação", key: "state", width: 22 },
      { header: "Tentativas", key: "attempts", width: 12 },
      { header: "Reimpressões", key: "reprints", width: 14 },
      { header: "Pedido de impressão", key: "printJobId", width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of rows)
      ws.addRow({
        ...r,
        producedAt: fmt.format(new Date(r.producedAtUtc)),
        state: ATTEMPT_STATE_PT[r.lastState] ?? r.lastState,
      });
    ws.autoFilter = { from: "A1", to: "K1" };
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await this.rt.svc.recordAudit({
      action: "HISTORY_EXPORTED",
      actorId: actor.id,
      stationId: null,
      targetType: "SYSTEM",
      targetId: null,
      correlationId: corr,
      details: { rows: rows.length, filters: q },
    });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: this.rt.timezone }).format(
      new Date(this.rt.clock()),
    );
    res.setHeader(
      "content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("access-control-expose-headers", "content-disposition");
    res.setHeader("content-disposition", `attachment; filename="historico-etiquetas-${day}.xlsx"`);
    res.end(buf);
  }

  private async historyRows(q: Record<string, string>) {
    const read = this.rt.svc.reader;
    const text = (q["q"] ?? "").trim().toLowerCase();
    const rows = [];
    for (const job of await read.listJobs()) {
      if (job.kind !== "ORIGINAL") continue;
      for (const l of await read.listLabelsByJob(job.id)) {
        const attempts = (await read.listAttemptsByLabel(l.labelId)).sort(
          (a, b) => a.attemptNo - b.attemptNo,
        );
        const last = attempts[attempts.length - 1]!;
        const reprints = attempts.filter((a) => a.attemptNo > 1).length;
        const s = l.snapshot;
        if (q["onlyReprints"] === "true" && reprints === 0) continue;
        if (q["state"] && last.state !== q["state"]) continue;
        const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: this.rt.timezone }).format(
          new Date(s.producedAtUtc),
        );
        if (q["from"] && localDay < q["from"]) continue;
        if (q["to"] && localDay > q["to"]) continue;
        if (q["id"] && !l.labelId.toLowerCase().includes(q["id"].toLowerCase())) continue;
        if (q["part"] && !s.part.description.toLowerCase().includes(q["part"].toLowerCase()))
          continue;
        if (
          q["partNumber"] &&
          !s.part.partNumber.toLowerCase().includes(q["partNumber"].toLowerCase())
        )
          continue;
        if (q["operatorId"] && s.operator.id !== q["operatorId"]) continue;
        if (q["machineId"] && s.machine.id !== q["machineId"]) continue;
        const hay = [
          l.labelId,
          s.part.partNumber,
          s.part.description,
          s.operator.displayName,
          s.machine.code,
        ]
          .join(" ")
          .toLowerCase();
        if (text && !hay.includes(text)) continue;
        rows.push({
          labelId: l.labelId,
          partDescription: s.part.description,
          partNumber: s.part.partNumber,
          operator: s.operator.displayName,
          machine: s.machine.code,
          shift: s.shift.name,
          producedAtUtc: s.producedAtUtc,
          printJobId: job.id,
          lastState: last.state,
          attempts: attempts.length,
          reprints,
        });
      }
    }
    rows.sort((a, b) => (a.producedAtUtc < b.producedAtUtc ? 1 : -1));
    return rows;
  }

  /** REQ-015: rastreabilidade de uma etiqueta (dados, tentativas e reimpressões com motivo). */
  @Get("labels/:labelId")
  async label(@Param("labelId") labelId: string, @Req() req: Request) {
    this.ctx(req);
    const read = this.rt.svc.reader;
    const label = await read.getLabel(labelId);
    if (!label) throw new DomainError("NOT_FOUND", "Etiqueta não encontrada.");
    const attempts = (await read.listAttemptsByLabel(labelId)).sort(
      (a, b) => a.attemptNo - b.attemptNo,
    );
    const jobs = new Map<string, unknown>();
    for (const a of attempts) {
      const j = await read.getJob(a.printJobId);
      if (j)
        jobs.set(j.id, {
          id: j.id,
          kind: j.kind,
          reason: j.reason ?? null,
          createdAt: j.createdAt,
          stationId: j.stationId,
        });
    }
    return {
      label: {
        labelId,
        sequenceInJob: label.sequenceInJob,
        originPrintJobId: label.printJobId,
        snapshot: label.snapshot,
        snapshotHash: label.snapshotHash,
        payloadHash: label.payloadHash,
      },
      attempts: attempts.map((a) => ({
        id: a.id,
        printJobId: a.printJobId,
        attemptNo: a.attemptNo,
        state: a.state,
        evidenceType: a.evidenceType,
        failureClass: a.failureClass,
        resolvedBy: a.resolvedBy,
        resolvedAt: a.resolvedAt,
        createdAt: a.createdAt,
      })),
      jobs: [...jobs.values()],
    };
  }

  @Get("print-jobs/:id")
  async job(@Param("id") id: string, @Req() req: Request) {
    this.ctx(req);
    return summarize(await this.rt.svc.getJobView(id));
  }

  @Get("audit")
  async audit(@Query() q: Record<string, string>, @Req() req: Request) {
    this.ctx(req);
    const limit = Math.min(Math.max(Number(q["limit"] ?? 100), 1), 500);
    const all = (await this.rt.svc.listAudit()).sort((a, b) => b.at - a.at);
    return {
      total: all.length,
      items: all.slice(0, limit).map((e) => ({ ...e, description: auditPt(e.action) })),
    };
  }

  // ----- decisões do ADMIN sobre ocorrências -----
  @Post("attempts/:id/resolve")
  async resolve(@Param("id") id: string, @Body() b: Json, @Req() req: Request) {
    const { actor, corr } = this.ctx(req);
    const outcome =
      b["outcome"] === "PRINTED"
        ? "PRINTED"
        : b["outcome"] === "NOT_PRINTED"
          ? "NOT_PRINTED"
          : null;
    if (!outcome) throw new DomainError("NOT_ELIGIBLE", "Informe se a etiqueta saiu ou não saiu.");
    const a = await this.rt.svc.resolveUnknown(id, actor, outcome, str(b["note"]), corr);
    return { attemptId: a.id, state: a.state };
  }

  @Post("print-jobs/:id/held")
  async held(@Param("id") id: string, @Body() b: Json, @Req() req: Request) {
    const { actor, corr } = this.ctx(req);
    const decision =
      b["decision"] === "CONTINUE" ? "CONTINUE" : b["decision"] === "CANCEL" ? "CANCEL" : null;
    if (!decision)
      throw new DomainError("NOT_ELIGIBLE", "Informe continuar ou cancelar o restante.");
    return summarize(await this.rt.svc.decideHeld(id, actor, decision, corr));
  }

  /** Nova tentativa (RETRY) para etiqueta cuja última tentativa foi FAILED; usa a impressora do posto de origem. */
  @Post("labels/:labelId/retry")
  async retry(@Param("labelId") labelId: string, @Body() b: Json, @Req() req: Request) {
    const { actor, corr } = this.ctx(req);
    const label = await this.rt.svc.reader.getLabel(labelId);
    if (!label) throw new DomainError("NOT_FOUND", "Etiqueta não encontrada.");
    const station = this.rt.md.stations.get(label.snapshot.stationId);
    if (!station) throw new DomainError("NOT_FOUND", "Posto da etiqueta não encontrado.");
    const { view, replayed } = await this.rt.svc.createRetry({
      idempotencyKey: str(b["idempotencyKey"]),
      labelIds: [labelId],
      actor,
      stationId: station.id,
      printerId: station.printerId,
      correlationId: corr,
    });
    return { replayed, ...summarize(view) };
  }
}

function kindOf(kind: string): "machines" | "parts" | "shifts" | "users" {
  const map: Record<string, "machines" | "parts" | "shifts" | "users"> = {
    machines: "machines",
    parts: "parts",
    shifts: "shifts",
    operators: "users",
  };
  const k = map[kind];
  if (!k) throw new HttpException("Recurso não encontrado.", 404);
  return k;
}

@Controller("agent")
export class AgentController {
  constructor(@Inject(RUNTIME) private rt: Runtime) {}

  /** A estação vem do token; o agente nunca informa nem escolhe a impressora (E-006, E-021). */
  private station(req: Request) {
    const token = req.headers["x-agent-token"];
    const stationId = typeof token === "string" ? this.rt.md.agentTokens.get(token) : undefined;
    if (!stationId) throw new HttpException("Agente não autorizado.", 401);
    const st = this.rt.md.stations.get(stationId)!;
    correlationOf(req);
    return st;
  }

  private bind(info: AgentInfo, req: Request): AgentInfo {
    const st = this.station(req);
    return { ...info, stationId: st.id, printerId: st.printerId, agentId: `agent-${st.id}` };
  }

  @Post("heartbeat")
  async heartbeat(@Body() b: AgentInfo, @Req() req: Request) {
    await this.rt.svc.heartbeat(this.bind(b, req));
    return {};
  }

  private dto(a: PrintAttempt) {
    return {
      attemptId: a.id,
      printJobId: a.printJobId,
      labelId: a.labelId,
      attemptNo: a.attemptNo,
      correlationId: a.correlationId,
      payloadHash: a.payloadHash,
      templateVersion: a.templateVersion,
      qrSchemaVersion: a.qrSchemaVersion,
      renderSnapshot: a.renderSnapshot,
    };
  }

  @Post("claim")
  async claim(@Body() b: AgentInfo, @Req() req: Request) {
    const a = await this.rt.svc.claimNext(this.bind(b, req));
    return a ? this.dto(a) : null;
  }

  /** Linha de etiquetas (mídia de várias colunas): até `max` tentativas seguidas do mesmo pedido. */
  @Post("claim-batch")
  async claimBatch(@Body() b: AgentInfo & { max?: number }, @Req() req: Request) {
    const rows = await this.rt.svc.claimBatch(this.bind(b, req), Number(b.max) || 1);
    return rows.map((a) => this.dto(a));
  }

  private async own(id: string, req: Request) {
    const st = this.station(req);
    const a = await this.rt.svc.reader.getAttempt(id);
    if (!a || a.stationId !== st.id)
      throw new DomainError("NOT_FOUND", "Tentativa não encontrada.");
    return { st, agentId: `agent-${st.id}` };
  }

  @Post("attempts/:id/ack")
  async ack(@Param("id") id: string, @Req() req: Request) {
    const { agentId } = await this.own(id, req);
    await this.rt.svc.ackSending(id, agentId);
    return {};
  }

  @Post("attempts/:id/result")
  async result(@Param("id") id: string, @Body() b: AttemptResult, @Req() req: Request) {
    const { agentId } = await this.own(id, req);
    await this.rt.svc.reportResult(id, agentId, b);
    return {};
  }

  @Post("attempts/:id/release")
  async release(@Param("id") id: string, @Req() req: Request) {
    const { agentId } = await this.own(id, req);
    await this.rt.svc.releaseClaim(id, agentId);
    return {};
  }

  @Post("attempts/:id/renew")
  async renew(@Param("id") id: string, @Req() req: Request) {
    const { agentId } = await this.own(id, req);
    await this.rt.svc.renewLease(id, agentId);
    return {};
  }

  @Post("journal-unavailable")
  async journalUnavailable(@Req() req: Request) {
    const st = this.station(req);
    await this.rt.svc.markSendingUnknownForStation(st.id, `agent-${st.id}`);
    return {};
  }
}

export const CONTROLLERS = [
  SessionController,
  OperatorController,
  AdminController,
  AgentController,
];
