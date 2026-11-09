import type { Logger } from "./logger.js";
import type { TickResult } from "./agent.js";

export interface Tickable {
  tick(): Promise<TickResult>;
}

export interface RunnerOptions {
  pollMs: number;
  maxBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Laço de execução do agente. Registra apenas mudanças de situação (não cada ciclo ocioso), aplica
 * espera crescente quando o servidor está inacessível e encerra de forma ordenada: o ciclo em curso
 * termina antes de sair, de modo que o journal nunca fica no meio de um envio por causa do desligamento.
 */
export class Runner {
  private stopping = false;
  private lastKey = "";
  private failures = 0;
  private wake: (() => void) | null = null;

  constructor(
    private agent: Tickable,
    private log: Logger,
    private o: RunnerOptions,
  ) {}

  stop(): void {
    this.stopping = true;
    this.wake?.();
  }

  private sleep(ms: number): Promise<void> {
    if (this.o.sleep) return this.o.sleep(ms);
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }

  private note(r: TickResult): void {
    const key = r.kind === "SKIPPED" ? `SKIPPED:${r.reason}` : r.kind === "IDLE" ? "IDLE" : "";
    if (key !== "") {
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.log.log(
        r.kind === "SKIPPED" ? "warn" : "info",
        r.kind === "IDLE" ? "ocioso" : "ciclo ignorado",
        {
          ...(r.kind === "SKIPPED" ? { reason: r.reason } : {}),
        },
      );
      return;
    }
    this.lastKey = "";
    this.log.log(r.kind === "PRINTED" ? "info" : "error", `etiqueta: ${r.kind}`, { ...r });
  }

  async run(): Promise<void> {
    this.log.log("info", "agente iniciado", { pollMs: this.o.pollMs });
    while (!this.stopping) {
      let delay = this.o.pollMs;
      try {
        const r = await this.agent.tick();
        this.note(r);
        const unreachable = r.kind === "SKIPPED" && r.reason === "HEARTBEAT_FAILED";
        this.failures = unreachable ? this.failures + 1 : 0;
      } catch (e) {
        this.failures++;
        this.log.log("error", "ciclo falhou", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      if (this.failures > 0)
        delay = Math.min(
          this.o.pollMs * 2 ** Math.min(this.failures, 6),
          this.o.maxBackoffMs ?? 30_000,
        );
      if (!this.stopping) await this.sleep(delay);
    }
    this.log.log("info", "agente encerrado");
  }
}
