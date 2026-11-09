import { readFileSync } from "node:fs";
import { PrintAgent } from "./agent.js";
import { ConfigError, loadConfig } from "./config.js";
import { HttpTransport } from "./http-transport.js";
import { FileJournal } from "./journal.js";
import { AlreadyRunningError, acquireLock } from "./lock.js";
import { createLogger } from "./logger.js";
import { Runner } from "./runner.js";
import { SimulatedPrinter } from "./simulator.js";
import { DEFAULT_ZPL_TCP, ZplTcpPrinter } from "./zpl-printer.js";
import { ZplSpoolPrinter } from "./zpl-spool.js";
import { buildZplRow, type ZplOptions } from "./zpl.js";
import type { PrinterAdapter, RenderedCommand } from "@doowon/printer-contracts";

/**
 * Entrada do Print Agent. Adaptadores: simulador (padrão) e ZPL por Ethernet (Elgin L42 Pro Full, a validar
 * fisicamente). Uso: node doowon-print-agent.mjs [--config caminho.json] [--check] [--printer-test]
 */
function main(): void {
  const args = process.argv.slice(2);
  const ci = args.indexOf("--config");
  const configPath = ci >= 0 ? args[ci + 1] : undefined;
  const checkOnly = args.includes("--check");
  const printerTest = args.includes("--printer-test");

  let cfg;
  try {
    const file = configPath
      ? (JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>)
      : {};
    cfg = loadConfig(process.env, file, (p) => readFileSync(p, "utf8"));
  } catch (e) {
    console.error(
      e instanceof ConfigError ? e.message : `Não foi possível ler a configuração: ${String(e)}`,
    );
    process.exit(2);
  }

  if (checkOnly) {
    console.log(`Configuração válida (posto ${cfg.stationId}, servidor ${cfg.apiUrl}).`);
    return;
  }

  const log0 = createLogger(cfg.logPath);
  const makePrinter = (): PrinterAdapter => {
    if (cfg.printerAdapter === "zpl-tcp" && cfg.zplTcp) {
      const z = cfg.zplTcp;
      return new ZplTcpPrinter({
        ...DEFAULT_ZPL_TCP,
        host: z.host,
        port: z.port,
        zpl: zplOf(z),
        confirmTimeoutMs: z.confirmTimeoutMs,
        confirmWithoutStatus: z.confirmWithoutStatus,
        log: (level, msg, extra) => log0.log(level, msg, extra),
      });
    }
    if (cfg.printerAdapter === "zpl-spool" && cfg.zplSpool) {
      return new ZplSpoolPrinter({
        printerName: cfg.zplSpool.printerName,
        zpl: zplOf(cfg.zplSpool),
        log: (level, msg, extra) => log0.log(level, msg, extra),
      });
    }
    return new SimulatedPrinter();
  };

  if (printerTest) {
    void runPrinterTest(cfg, makePrinter()).then((code) => process.exit(code));
    return;
  }

  let release: () => void;
  try {
    release = acquireLock(cfg.lockPath);
  } catch (e) {
    console.error(e instanceof AlreadyRunningError ? e.message : String(e));
    process.exit(3);
  }

  const log = createLogger(cfg.logPath);
  const agent = new PrintAgent({
    agentId: cfg.agentId,
    stationId: cfg.stationId,
    printerId: cfg.printerId,
    agentVersion:
      cfg.agentVersion !== "0.0.0"
        ? cfg.agentVersion
        : (process.env.AGENT_BUNDLED_VERSION ?? "0.0.0"),
    transport: new HttpTransport(cfg.apiUrl, cfg.agentToken, fetch, cfg.requestTimeoutMs),
    printer: makePrinter(),
    journal: new FileJournal(cfg.journalPath),
  });
  const runner = new Runner(agent, log, { pollMs: cfg.pollMs });
  const shutdown = (): void => {
    log.log("info", "encerrando após o ciclo em curso");
    runner.stop();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  void runner.run().finally(() => {
    release();
    process.exit(0);
  });
}

function zplOf(z: {
  dpi: 203 | 300;
  timezone: string;
  mediaTracking: ZplOptions["mediaTracking"];
  printMode: ZplOptions["printMode"];
  darkness?: number;
  labelWidthMm: number;
  labelHeightMm: number;
  labelColumns: number;
  columnGapMm: number;
  rowGapMm: number;
  marginLeftMm: number;
  marginTopMm: number;
  applyLandscape: boolean;
  qrUpMm: number;
  qrLeftMm: number;
}): ZplOptions {
  return {
    dpi: z.dpi,
    timezone: z.timezone,
    mediaTracking: z.mediaTracking,
    printMode: z.printMode,
    ...(z.darkness !== undefined ? { darkness: z.darkness } : {}),
    labelWidthMm: z.labelWidthMm,
    labelHeightMm: z.labelHeightMm,
    columns: z.labelColumns,
    columnGapMm: z.columnGapMm,
    rowGapMm: z.rowGapMm,
    marginLeftMm: z.marginLeftMm,
    marginTopMm: z.marginTopMm,
    applyLandscape: z.applyLandscape,
    qrUpMm: z.qrUpMm,
    qrLeftMm: z.qrLeftMm,
  };
}

/** Teste de bancada: mostra a resposta bruta do ~HS, o ZPL gerado e imprime uma etiqueta de exemplo. */
async function runPrinterTest(
  cfg: ReturnType<typeof loadConfig>,
  printer: PrinterAdapter,
): Promise<number> {
  const qr = JSON.stringify({
    v: 2,
    id: "00000000-0000-4000-8000-000000000000",
    d: "AB123",
    pn: "PN-0001",
    op: "Operador 1",
    t: "Turno 1",
    ts: Date.now(),
  });
  const cmd: RenderedCommand = {
    labelId: "TESTE",
    widthMm: 30,
    heightMm: 20,
    text: "TESTE",
    hash: "teste",
    data: {
      description: "AB123",
      partNumber: "PN-0001",
      operator: "Operador 1",
      shift: "Turno 1",
      producedAt: new Date().toISOString(),
      qr,
      labelId: "TESTE",
    },
  };
  const columns = cfg.zplTcp?.labelColumns ?? cfg.zplSpool?.labelColumns ?? 1;
  const testRow = (n: number): RenderedCommand[] =>
    Array.from({ length: n }, (_, i) => ({
      ...cmd,
      labelId: `TESTE-${i + 1}`,
      data: { ...cmd.data, labelId: `TESTE-${i + 1}`, description: `AB12${i + 1}` },
    }));
  const row = testRow(columns);
  console.log(
    `Adaptador: ${cfg.printerAdapter}${cfg.zplTcp ? ` (${cfg.zplTcp.host}:${cfg.zplTcp.port}, ${cfg.zplTcp.dpi} dpi)` : ""}${cfg.zplSpool ? ` (fila "${cfg.zplSpool.printerName}", ${cfg.zplSpool.dpi} dpi, mídia ${cfg.zplSpool.labelWidthMm}x${cfg.zplSpool.labelHeightMm} mm)` : ""}`,
  );
  if (cfg.zplSpool) {
    console.log(
      "ZPL que será enviado:\n" +
        buildZplRow(testRow(cfg.zplSpool.labelColumns), zplOf(cfg.zplSpool)),
    );
  }
  if (printer instanceof ZplTcpPrinter) {
    try {
      const r = await printer.queryStatus();
      console.log("Resposta bruta do ~HS:", JSON.stringify(r.raw));
      console.log("Status interpretado:", r.parsed ?? "não reconhecido");
    } catch (e) {
      console.error("Não foi possível falar com a impressora:", e instanceof Error ? e.message : e);
      return 1;
    }
    console.log(
      "ZPL que será enviado:\n" +
        buildZplRow(testRow(cfg.zplTcp!.labelColumns), zplOf(cfg.zplTcp!)),
    );
  }
  console.log("Status:", await printer.getStatus());
  const out =
    row.length > 1 && printer.sendRow ? await printer.sendRow(row) : await printer.send(cmd);
  console.log("Resultado do envio:", out);
  if (printer instanceof ZplTcpPrinter)
    console.log("Última resposta bruta do ~HS:", JSON.stringify(printer.lastRawStatus));
  return out.kind === "CONFIRMED" ? 0 : 1;
}

main();
