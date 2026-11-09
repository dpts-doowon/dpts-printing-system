import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TickResult } from "./agent.js";
import { ConfigError, loadConfig } from "./config.js";
import { AlreadyRunningError, acquireLock } from "./lock.js";
import { Runner } from "./runner.js";
import { HttpTransport } from "./http-transport.js";

const base = {
  AGENT_ID: "agent-st-1",
  STATION_ID: "st-1",
  PRINTER_ID: "pr-1",
  API_URL: "https://api.exemplo.local",
  AGENT_TOKEN: "segredo",
};

describe("configuração", () => {
  it("aceita o mínimo e aplica padrões", () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      pollMs: 1000,
      requestTimeoutMs: 10_000,
      printerAdapter: "simulator",
    });
    expect(c.lockPath).toBe("./agent.journal.lock");
  });
  it("variáveis de ambiente vencem o arquivo", () => {
    const c = loadConfig({ ...base, POLL_MS: "500" }, { pollMs: 3000, stationId: "outro" });
    expect(c.pollMs).toBe(500);
    expect(c.stationId).toBe("st-1");
  });
  it("lê o token de arquivo e remove a barra final da URL", () => {
    const { AGENT_TOKEN: _t, ...rest } = base;
    const c = loadConfig(
      { ...rest, API_URL: "https://api.exemplo.local///" },
      { agentTokenFile: "/t" },
      () => " abc \n",
    );
    expect(c.agentToken).toBe("abc");
    expect(c.apiUrl).toBe("https://api.exemplo.local");
  });
  it("acumula todos os erros em português", () => {
    try {
      loadConfig({ API_URL: "http://servidor.fabrica", POLL_MS: "10", PRINTER_ADAPTER: "zebra" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const m = (e as Error).message;
      for (const parte of [
        "agentId",
        "stationId",
        "printerId",
        "HTTPS",
        "pollMs",
        "token",
        "desconhecido",
      ])
        expect(m).toContain(parte);
    }
  });
  it("aceita HTTP apenas para localhost", () => {
    expect(() => loadConfig({ ...base, API_URL: "http://localhost:3001" })).not.toThrow();
    expect(() => loadConfig({ ...base, API_URL: "http://10.0.0.5:3001" })).toThrow(/HTTPS/);
  });
  it("não vaza o token na mensagem de erro", () => {
    try {
      loadConfig({ ...base, API_URL: "ftp://x" });
    } catch (e) {
      expect((e as Error).message).not.toContain("segredo");
    }
  });
});

describe("trava de instância única", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-lock-"));
  it("impede o segundo agente e libera ao sair", () => {
    const p = join(dir, "a.lock");
    const release = acquireLock(p);
    expect(() => acquireLock(p)).toThrow(AlreadyRunningError);
    release();
    expect(existsSync(p)).toBe(false);
    acquireLock(p)();
  });
  it("reaproveita trava de processo que não existe mais", () => {
    const p = join(dir, "b.lock");
    writeFileSync(p, "999999999");
    const release = acquireLock(p);
    expect(existsSync(p)).toBe(true);
    release();
  });
});

describe("laço de execução", () => {
  const mkLog = () => {
    const lines: { level: string; msg: string; reason?: string }[] = [];
    return {
      lines,
      log: {
        log: (level: string, msg: string, extra?: object) =>
          void lines.push({ level, msg, ...extra }),
      } as never,
    };
  };
  const script = (results: (TickResult | Error)[], runner: () => Runner) => {
    let i = 0;
    return {
      tick: async (): Promise<TickResult> => {
        const r = results[i++];
        if (i >= results.length) runner().stop();
        if (r instanceof Error) throw r;
        return r ?? { kind: "IDLE" };
      },
    };
  };

  it("registra só mudanças de situação e aplica espera crescente se o servidor cai", async () => {
    const { lines, log } = mkLog();
    const sleeps: number[] = [];
    const agent = script(
      [
        { kind: "IDLE" },
        { kind: "IDLE" },
        { kind: "SKIPPED", reason: "HEARTBEAT_FAILED" },
        { kind: "SKIPPED", reason: "HEARTBEAT_FAILED" },
        { kind: "PRINTED", attemptId: "a1" },
      ],
      () => runner,
    );
    const runner: Runner = new Runner(agent, log, {
      pollMs: 1000,
      sleep: async (ms) => void sleeps.push(ms),
    });
    await runner.run();
    expect(sleeps).toEqual([1000, 1000, 2000, 4000]); // o último ciclo já encerrou
    expect(lines.filter((l) => l.msg === "ocioso")).toHaveLength(1);
    expect(lines.filter((l) => l.msg === "ciclo ignorado")).toHaveLength(1);
    expect(lines.some((l) => l.msg === "etiqueta: PRINTED")).toBe(true);
    expect(lines.at(-1)?.msg).toBe("agente encerrado");
  });

  it("um erro inesperado não derruba o laço", async () => {
    const { lines, log } = mkLog();
    const agent = script([new Error("boom"), { kind: "IDLE" }], () => runner);
    const runner: Runner = new Runner(agent, log, { pollMs: 1000, sleep: async () => undefined });
    await runner.run();
    expect(lines.some((l) => l.level === "error" && l.msg === "ciclo falhou")).toBe(true);
  });

  it("stop() acorda a espera e encerra sem novo ciclo", async () => {
    const { log } = mkLog();
    let ticks = 0;
    const runner = new Runner({ tick: async () => (ticks++, { kind: "IDLE" as const }) }, log, {
      pollMs: 60_000,
    });
    const done = runner.run();
    await new Promise((r) => setTimeout(r, 30));
    runner.stop();
    await done;
    expect(ticks).toBe(1);
  });
});

describe("transporte HTTP", () => {
  it("aborta a requisição que excede o prazo", async () => {
    const hang: typeof fetch = (_u, init) =>
      new Promise((_res, rej) =>
        init?.signal?.addEventListener("abort", () => rej(new Error("abortado"))),
      );
    const t = new HttpTransport("http://localhost:1/", "tok", hang, 50);
    await expect(t.ack("a1")).rejects.toThrow();
  });
});
