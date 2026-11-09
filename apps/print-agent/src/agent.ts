import type { AgentInfo, AttemptResult } from "@doowon/domain";
import {
  PROTOCOL_VERSION,
  type AgentTransport,
  type ClaimedAttemptDto,
  type Journal,
  type JournalEntry,
  type PrinterAdapter,
  type RenderedCommand,
} from "@doowon/printer-contracts";
import { renderLabel } from "./render.js";

export interface AgentOptions {
  agentId: string;
  stationId: string;
  printerId: string;
  agentVersion: string;
  transport: AgentTransport;
  printer: PrinterAdapter;
  journal: Journal;
  clock?: () => number;
  /** Desvio de relógio medido contra o servidor (ms). */
  clockSkewMs?: () => number;
  reportRetries?: number;
}

export type TickResult =
  | { kind: "IDLE" }
  | { kind: "PRINTED"; attemptId: string }
  | { kind: "FAILED"; attemptId: string; failureClass: string }
  | { kind: "UNKNOWN"; attemptId: string }
  | { kind: "SKIPPED"; reason: string };

/**
 * Print Agent (um por posto). Regras de segurança (printing-state-machine.md §5.2, §9 e §13):
 * - nenhum byte é enviado sem o `ack` do servidor para SENDING;
 * - qualquer incerteza após o `ack` vira UNKNOWN_OUTCOME e nunca é reenviada;
 * - o journal registra a ordem dos passos para provar, após falha, se algum byte pode ter saído.
 */
export class PrintAgent {
  private recovered = false;
  private now: () => number;

  constructor(private o: AgentOptions) {
    this.now = o.clock ?? Date.now;
  }

  private info(printerStatus: AgentInfo["printerStatus"]): AgentInfo {
    return {
      agentId: this.o.agentId,
      stationId: this.o.stationId,
      printerId: this.o.printerId,
      agentVersion: this.o.agentVersion,
      protocolVersion: PROTOCOL_VERSION,
      clockSkewMs: this.o.clockSkewMs?.() ?? 0,
      printerStatus,
    };
  }

  private log(type: JournalEntry["type"], attemptId: string, result?: AttemptResult): void {
    this.o.journal.append({ type, attemptId, at: this.now(), ...(result ? { result } : {}) });
  }

  /** Recuperação no início (§13): aplica a última entrada do journal de cada tentativa. */
  async recover(): Promise<void> {
    let entries: JournalEntry[];
    try {
      entries = this.o.journal.readAll();
    } catch {
      await this.o.transport.journalUnavailable();
      this.recovered = true;
      return;
    }
    const last = new Map<string, JournalEntry>();
    for (const e of entries) last.set(e.attemptId, e);
    for (const [attemptId, e] of last) {
      switch (e.type) {
        case "REPORTED":
          break;
        case "CLAIMED":
        case "INTENT_SEND":
          // Sem ack: nada foi enviado. Libera (seguro).
          await this.safe(() => this.o.transport.release(attemptId));
          this.log("REPORTED", attemptId);
          break;
        case "ACKED":
          // ack recebido sem "prestes a enviar": prova de que nenhum byte saiu.
          await this.report(attemptId, {
            kind: "FAILED",
            failureClass: "NO_BYTES_SENT",
            provenNoOutput: true,
          });
          break;
        case "ABOUT_TO_SEND":
        case "SENT":
          // Pode ter havido envio: nunca reenvia.
          await this.report(attemptId, { kind: "UNKNOWN", reason: "AGENT_RESTART_AFTER_SEND" });
          break;
        case "RESULT_PENDING":
          if (e.result) await this.report(attemptId, e.result);
          break;
      }
    }
    this.recovered = true;
  }

  private async safe(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      /* o reaper do servidor cobre este caso */
    }
  }

  /** Relata o resultado com repetição (o relato é idempotente; repetir não reimprime). */
  private async report(attemptId: string, result: AttemptResult): Promise<void> {
    this.log("RESULT_PENDING", attemptId, result);
    const tries = this.o.reportRetries ?? 3;
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        await this.o.transport.report(attemptId, result);
        this.log("REPORTED", attemptId);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    // Permanece RESULT_PENDING no journal; será reenviado na próxima recuperação/tick.
    throw lastErr;
  }

  /** Um ciclo: heartbeat, recuperação (uma vez), reivindicação e execução de no máximo uma etiqueta. */
  async tick(): Promise<TickResult> {
    const status = await this.o.printer.getStatus().catch(() => "UNKNOWN" as const);
    const info = this.info(status);
    try {
      await this.o.transport.heartbeat(info);
    } catch {
      return { kind: "SKIPPED", reason: "HEARTBEAT_FAILED" };
    }
    if (!this.recovered) {
      try {
        await this.recover();
      } catch {
        return { kind: "SKIPPED", reason: "RECOVERY_FAILED" };
      }
    }
    if (status !== "READY") return { kind: "SKIPPED", reason: "PRINTER_NOT_READY" };

    const perRow = this.o.printer.labelsPerRow ?? 1;
    if (perRow > 1 && this.o.printer.sendRow && this.o.transport.claimBatch) {
      let rows: ClaimedAttemptDto[];
      try {
        rows = await this.o.transport.claimBatch(info, perRow);
      } catch {
        return { kind: "SKIPPED", reason: "CLAIM_REFUSED" };
      }
      if (rows.length === 0) return { kind: "IDLE" };
      return this.executeRow(rows);
    }

    let claimed: ClaimedAttemptDto | null;
    try {
      claimed = await this.o.transport.claim(info);
    } catch {
      return { kind: "SKIPPED", reason: "CLAIM_REFUSED" };
    }
    if (!claimed) return { kind: "IDLE" };
    return this.execute(claimed);
  }

  private async execute(c: ClaimedAttemptDto): Promise<TickResult> {
    const id = c.attemptId;
    this.log("CLAIMED", id);

    // 1) Renderiza localmente; erro aqui termina em FAILED sem enviar nada.
    let command;
    try {
      command = renderLabel(c);
    } catch (e) {
      const failureClass = "RENDER_ERROR";
      await this.report(id, { kind: "FAILED", failureClass, provenNoOutput: true }).catch(
        () => undefined,
      );
      void e;
      return { kind: "FAILED", attemptId: id, failureClass };
    }

    // 2) Intenção no journal e pedido de SENDING ao servidor. Sem ack, nada é enviado.
    this.log("INTENT_SEND", id);
    try {
      await this.o.transport.ack(id);
    } catch {
      await this.safe(() => this.o.transport.release(id));
      this.log("REPORTED", id);
      return { kind: "SKIPPED", reason: "NO_ACK" };
    }
    this.log("ACKED", id);

    // 3) Prestes a enviar -> envio -> resultado.
    this.log("ABOUT_TO_SEND", id);
    let result: AttemptResult;
    try {
      const outcome = await this.o.printer.send(command);
      this.log("SENT", id);
      if (outcome.kind === "CONFIRMED") result = { kind: "PRINTED", evidence: outcome.evidence };
      else if (outcome.kind === "REJECTED_NO_OUTPUT")
        result = { kind: "FAILED", failureClass: outcome.reason, provenNoOutput: true };
      else result = { kind: "UNKNOWN", reason: outcome.reason };
    } catch {
      this.log("SENT", id);
      result = { kind: "UNKNOWN", reason: "SEND_EXCEPTION" };
    }
    await this.report(id, result);
    if (result.kind === "PRINTED") return { kind: "PRINTED", attemptId: id };
    if (result.kind === "FAILED")
      return { kind: "FAILED", attemptId: id, failureClass: result.failureClass };
    return { kind: "UNKNOWN", attemptId: id };
  }
  /**
   * Linha de etiquetas (mídia de várias colunas): as etiquetas são reivindicadas e reconhecidas uma a uma, mas
   * saem em um único envio. O resultado do envio vale para todas; depois do `ack`, qualquer incerteza deixa
   * todas em UNKNOWN_OUTCOME e o operador confere cada uma (nunca reenvia sozinho).
   */
  private async executeRow(rows: ClaimedAttemptDto[]): Promise<TickResult> {
    const items: { id: string; command: RenderedCommand }[] = [];
    let firstFailure: TickResult | null = null;
    for (const c of rows) {
      this.log("CLAIMED", c.attemptId);
      try {
        items.push({ id: c.attemptId, command: renderLabel(c) });
      } catch {
        const failureClass = "RENDER_ERROR";
        await this.report(c.attemptId, {
          kind: "FAILED",
          failureClass,
          provenNoOutput: true,
        }).catch(() => undefined);
        firstFailure ??= { kind: "FAILED", attemptId: c.attemptId, failureClass };
      }
    }
    if (items.length === 0) return firstFailure ?? { kind: "IDLE" };

    // Sem o ack de todas, nada é enviado.
    const acked: string[] = [];
    for (const it of items) {
      this.log("INTENT_SEND", it.id);
      try {
        await this.o.transport.ack(it.id);
      } catch {
        for (const id of acked)
          await this.report(id, {
            kind: "FAILED",
            failureClass: "NO_BYTES_SENT",
            provenNoOutput: true,
          }).catch(() => undefined);
        for (const rest of items.slice(acked.length)) {
          await this.safe(() => this.o.transport.release(rest.id));
          this.log("REPORTED", rest.id);
        }
        return { kind: "SKIPPED", reason: "NO_ACK" };
      }
      this.log("ACKED", it.id);
      acked.push(it.id);
    }

    for (const it of items) this.log("ABOUT_TO_SEND", it.id);
    let result: AttemptResult;
    try {
      const outcome = await this.o.printer.sendRow!(items.map((i) => i.command));
      for (const it of items) this.log("SENT", it.id);
      if (outcome.kind === "CONFIRMED") result = { kind: "PRINTED", evidence: outcome.evidence };
      else if (outcome.kind === "REJECTED_NO_OUTPUT")
        result = { kind: "FAILED", failureClass: outcome.reason, provenNoOutput: true };
      else result = { kind: "UNKNOWN", reason: outcome.reason };
    } catch {
      for (const it of items) this.log("SENT", it.id);
      result = { kind: "UNKNOWN", reason: "SEND_EXCEPTION" };
    }
    let reportErr: unknown;
    for (const it of items) {
      try {
        await this.report(it.id, result);
      } catch (e) {
        reportErr ??= e;
      }
    }
    if (reportErr) throw reportErr;
    const id = items[0]!.id;
    if (result.kind === "PRINTED") return { kind: "PRINTED", attemptId: id };
    if (result.kind === "FAILED")
      return { kind: "FAILED", attemptId: id, failureClass: result.failureClass };
    return { kind: "UNKNOWN", attemptId: id };
  }
}
