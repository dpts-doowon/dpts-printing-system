import net from "node:net";
import type {
  PrinterAdapter,
  PrinterStatus,
  RenderedCommand,
  SendOutcome,
} from "@doowon/printer-contracts";
import {
  DEFAULT_ZPL,
  buildZplRow,
  parseHostStatus,
  statusProblem,
  type HostStatus,
  type ZplOptions,
} from "./zpl.js";

export interface ZplTcpConfig {
  host: string;
  port: number;
  zpl: ZplOptions;
  connectTimeoutMs: number;
  statusTimeoutMs: number;
  /** Prazo para a impressora esvaziar o buffer depois do envio. */
  confirmTimeoutMs: number;
  /** Se a impressora não responder ao ~HS, confirmar só pelo envio (evidência mais fraca). Padrão: não. */
  confirmWithoutStatus: boolean;
  log?: (level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) => void;
}

export const DEFAULT_ZPL_TCP: Omit<ZplTcpConfig, "host"> = {
  port: 9100,
  zpl: DEFAULT_ZPL,
  connectTimeoutMs: 3000,
  statusTimeoutMs: 2000,
  confirmTimeoutMs: 10_000,
  confirmWithoutStatus: false,
};

type Conn = net.Socket;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Adaptador ZPL por TCP (porta 9100, Ethernet). ZPL não devolve confirmação de impressão física: a
 * evidência é o buffer da impressora ter sido consumido, sem erro, em duas leituras seguidas de ~HS.
 * Regras de segurança:
 *  - falha antes de qualquer byte (conexão recusada, impressora com erro) = REJECTED_NO_OUTPUT;
 *  - depois do primeiro byte, qualquer incerteza (queda, prazo, erro no meio) = UNCERTAIN (nunca reenvia).
 */
export class ZplTcpPrinter implements PrinterAdapter {
  private cached: { at: number; status: PrinterStatus } | null = null;
  /** Última resposta bruta do ~HS (para diagnóstico). */
  lastRawStatus = "";

  constructor(private cfg: ZplTcpConfig) {}

  private log(
    level: "info" | "warn" | "error",
    msg: string,
    extra?: Record<string, unknown>,
  ): void {
    this.cfg.log?.(level, msg, extra);
  }

  private connect(): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.cfg.host, port: this.cfg.port });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error("tempo esgotado ao conectar na impressora"));
      }, this.cfg.connectTimeoutMs);
      s.once("connect", () => {
        clearTimeout(timer);
        s.setNoDelay(true);
        resolve(s);
      });
      s.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  /** Envia ~HS e lê a resposta até três linhas ou o prazo. */
  private async queryOn(conn: Conn): Promise<{ raw: string; parsed: HostStatus | null }> {
    if (conn.destroyed) throw new Error("conexão com a impressora encerrada");
    const raw = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const done = (): void => {
        clearTimeout(timer);
        conn.off("data", onData);
        conn.off("error", onErr);
        conn.off("close", onClose);
        resolve(buf);
      };
      const onData = (d: Buffer): void => {
        buf += d.toString("latin1");
        if (buf.split("\x03").length - 1 >= 3) done();
      };
      const onErr = (e: Error): void => {
        clearTimeout(timer);
        conn.off("data", onData);
        conn.off("close", onClose);
        reject(e);
      };
      const onClose = (): void => {
        clearTimeout(timer);
        conn.off("data", onData);
        conn.off("error", onErr);
        reject(new Error("conexão encerrada pela impressora"));
      };
      const timer = setTimeout(done, this.cfg.statusTimeoutMs);
      conn.on("data", onData);
      conn.once("error", onErr);
      conn.once("close", onClose);
      conn.write("~HS");
    });
    this.lastRawStatus = raw;
    return { raw, parsed: parseHostStatus(raw) };
  }

  /** Consulta pontual (abre e fecha a conexão). */
  async queryStatus(): Promise<{ raw: string; parsed: HostStatus | null }> {
    const conn = await this.connect();
    try {
      return await this.queryOn(conn);
    } finally {
      conn.destroy();
    }
  }

  async getStatus(): Promise<PrinterStatus> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < 2000) return this.cached.status;
    let status: PrinterStatus;
    try {
      const { parsed } = await this.queryStatus();
      status = !parsed
        ? "UNKNOWN"
        : statusProblem(parsed, this.cfg.zpl.printMode)
          ? "UNAVAILABLE"
          : "READY";
    } catch {
      status = "UNAVAILABLE";
    }
    this.cached = { at: now, status };
    return status;
  }

  get labelsPerRow(): number {
    return Math.max(1, this.cfg.zpl.columns ?? 1);
  }

  send(command: RenderedCommand): Promise<SendOutcome> {
    return this.sendRow([command]);
  }

  async sendRow(commands: RenderedCommand[]): Promise<SendOutcome> {
    this.cached = null;
    let zpl: string;
    try {
      zpl = buildZplRow(commands, this.cfg.zpl);
    } catch (e) {
      return { kind: "REJECTED_NO_OUTPUT", reason: `ZPL_BUILD_FAILED: ${String(e)}` };
    }

    // 1. Antes de enviar: conexão e estado. Nada foi enviado, então qualquer falha aqui é segura.
    let conn: Conn;
    try {
      conn = await this.connect();
    } catch (e) {
      return { kind: "REJECTED_NO_OUTPUT", reason: `PRINTER_UNREACHABLE: ${errText(e)}` };
    }
    let statusAvailable = true;
    try {
      let pre;
      try {
        pre = await this.queryOn(conn);
      } catch (e) {
        return { kind: "REJECTED_NO_OUTPUT", reason: `PRINTER_STATUS_FAILED: ${errText(e)}` };
      }
      if (pre.parsed) {
        const problem = statusProblem(pre.parsed, this.cfg.zpl.printMode);
        if (problem) return { kind: "REJECTED_NO_OUTPUT", reason: `PRINTER_NOT_READY: ${problem}` };
        if (pre.parsed.formatsInBuffer > 0 || pre.parsed.labelsRemaining > 0 || pre.parsed.printing)
          return { kind: "REJECTED_NO_OUTPUT", reason: "PRINTER_BUSY" };
      } else {
        statusAvailable = false;
        this.log("warn", "impressora não respondeu ao ~HS em formato reconhecido", {
          raw: JSON.stringify(pre.raw),
        });
        if (!this.cfg.confirmWithoutStatus)
          return { kind: "REJECTED_NO_OUTPUT", reason: "PRINTER_STATUS_UNSUPPORTED" };
      }

      // 2. A partir daqui, qualquer incerteza é UNCERTAIN.
      try {
        await new Promise<void>((resolve, reject) =>
          conn.write(zpl, "utf8", (err) => (err ? reject(err) : resolve())),
        );
      } catch (e) {
        return { kind: "UNCERTAIN", reason: `SEND_FAILED: ${errText(e)}` };
      }
      if (!statusAvailable) return { kind: "CONFIRMED", evidence: "PRINTER_ACK" };

      // 3. Confirmação: buffer consumido, sem erro, em duas leituras seguidas.
      const deadline = Date.now() + this.cfg.confirmTimeoutMs;
      let clean = 0;
      while (Date.now() < deadline) {
        await sleep(250);
        let r;
        try {
          r = await this.queryOn(conn);
        } catch (e) {
          return { kind: "UNCERTAIN", reason: `CONNECTION_LOST: ${errText(e)}` };
        }
        const st = r.parsed;
        if (!st) {
          clean = 0;
          continue;
        }
        const problem = statusProblem(st, this.cfg.zpl.printMode);
        if (problem) return { kind: "UNCERTAIN", reason: `PRINTER_ERROR_AFTER_SEND: ${problem}` };
        if (st.formatsInBuffer === 0 && st.labelsRemaining === 0 && !st.printing) {
          if (++clean >= 2) return { kind: "CONFIRMED", evidence: "PRINTER_ACK" };
        } else clean = 0;
      }
      return { kind: "UNCERTAIN", reason: "CONFIRM_TIMEOUT" };
    } finally {
      conn.destroy();
    }
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
