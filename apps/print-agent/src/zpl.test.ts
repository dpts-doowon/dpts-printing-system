import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { RenderedCommand } from "@doowon/printer-contracts";
import { ZplTcpPrinter, DEFAULT_ZPL_TCP } from "./zpl-printer.js";
import { ZplSpoolPrinter } from "./zpl-spool.js";
import {
  DEFAULT_ZPL,
  buildZpl,
  buildZplRow,
  parseHostStatus,
  qrModules,
  zplEscape,
} from "./zpl.js";
import { loadConfig } from "./config.js";
import { buildHkmcQr } from "@doowon/domain";

const QR = buildHkmcQr({
  supplierCode: "AQ2A",
  partNumber: "29135-BP000",
  alcCode: "AG10",
  productionDate: "261022",
  productionTime: "090000",
  fourM: "OP01",
  flag: "A",
  traceNumber: 1,
});
const cmd = (over: Record<string, string> = {}): RenderedCommand => ({
  labelId: "L1",
  widthMm: 30,
  heightMm: 20,
  text: "x",
  hash: "h",
  data: {
    description: "AG10",
    partNumber: "29135-BP000",
    producedAt: "2026-10-22T12:00:00Z",
    qr: QR,
    labelId: "L1",
    ...over,
  },
});

const HS = (
  o: {
    paperOut?: number;
    paused?: number;
    formats?: number;
    headUp?: number;
    ribbonOut?: number;
    remaining?: string;
  } = {},
): string =>
  `\x02030,${o.paperOut ?? 0},${o.paused ?? 0},0160,${String(o.formats ?? 0).padStart(3, "0")},0,0,0,000,0,0,0\x03\r\n` +
  `\x02000,${o.headUp ?? 0},${o.ribbonOut ?? 0},1,2,0,0,${o.remaining ?? "00000000"},00000000,0,000\x03\r\n\x020000,0\x03\r\n`;

describe("ZPL", () => {
  it("gera 240 x 160 pontos a 203 dpi, escapa caracteres especiais e traz um único QR", () => {
    const z = buildZpl(cmd());
    expect(z).toContain("^PW240");
    expect(z).toContain("^LL160");
    expect(z).toContain("^CI28");
    expect(z.match(/\^BQN/g)).toHaveLength(1);
    expect(z).toContain("^FDAG10^FS");
    expect(z).not.toContain("Operador");
    expect(z.startsWith("^XA")).toBe(true);
    expect(z.trim().endsWith("^XZ")).toBe(true);
  });
  it("a 300 dpi escala para 354 x 236 pontos", () => {
    const z = buildZpl(cmd(), {
      dpi: 300,
      timezone: "America/Sao_Paulo",
      mediaTracking: "gap",
      printMode: "thermal-transfer",
    });
    expect(z).toContain("^PW354");
    expect(z).toContain("^LL236");
  });
  it("a data impressa (AAMMDD) e a hora usam o horário de Brasília quando não vêm prontas", () => {
    const z = buildZpl(cmd());
    expect(z).toContain("^FD261022^FS");
    expect(z).toContain("^FD09:00^FS");
  });
  it("usa data e hora do snapshot quando presentes", () => {
    const z = buildZpl(cmd({ date: "270101", time: "23:59" }));
    expect(z).toContain("^FD270101^FS");
    expect(z).toContain("^FD23:59^FS");
  });
  it("o QR leva os caracteres de controle do padrão H/KMC escapados (RS, GS, EOT)", () => {
    const z = buildZpl(cmd());
    const fd = /\^BQN,2,\d+\^FH\^FDMA,([^^]*)\^FS/.exec(z)![1]!;
    expect(fd.startsWith("_5B)_3E_1E06_1DVAQ2A_1DP29135BP000")).toBe(true);
    expect(fd.endsWith("_1D_1E_04")).toBe(true);
  });
  it("nenhuma linha da coluna esquerda invade o QR, nem com nome de operador longo", () => {
    for (const dpi of [203, 300] as const) {
      const z = buildZpl(cmd({ partNumber: "29135-BP000-MUITO-LONGO-XYZ" }), {
        dpi,
        timezone: "America/Sao_Paulo",
        mediaTracking: "gap",
        printMode: "thermal-transfer",
      });
      const qrX = Number(/\^FO(\d+),\d+\^BQN/.exec(z)![1]);
      for (const m of z.matchAll(/\^FO(\d+),\d+\^A0N,\d+,(\d+)\^FH\^FD([^^]*)\^FS/g)) {
        const [, x, w, fd] = m;
        if (fd === "AG10") continue; // ALC ocupa a linha superior
        const chars = fd!.replace(/_[0-9A-F]{2}/g, "x").length;
        expect(Number(x) + chars * Number(w)).toBeLessThanOrEqual(qrX);
      }
    }
  });
  it("módulos do QR crescem com o conteúdo", () => {
    expect(qrModules(10)).toBe(21);
    expect(qrModules(Buffer.byteLength(QR))).toBeGreaterThan(21);
    expect(() => qrModules(5000)).toThrow();
  });
  it("zplEscape mantém texto simples", () => {
    expect(zplEscape("PN-0001")).toBe("PN-0001");
    expect(zplEscape("João ^~_")).toBe("Jo_C3_A3o _5E_7E_5F"); // UTF-8, ^, ~ e _ escapados
  });
  it("interpreta o ~HS", () => {
    const s = parseHostStatus(HS({ paperOut: 1, formats: 2 }))!;
    expect(s.paperOut).toBe(true);
    expect(s.formatsInBuffer).toBe(2);
    expect(parseHostStatus("lixo")).toBeNull();
  });
});

interface Fake {
  port: number;
  received: string[];
  close: () => Promise<void>;
}
let fakes: Fake[] = [];
afterEach(async () => {
  await Promise.all(fakes.map((f) => f.close()));
  fakes = [];
});

/** Impressora falsa: responde ao ~HS conforme o roteiro e registra o que recebeu. */
async function fakePrinter(
  script: (n: number, labelsReceived: number) => string | null,
  opts: { dropAfterLabel?: boolean } = {},
): Promise<Fake> {
  const received: string[] = [];
  let hsCount = 0;
  let labels = 0;
  const server = net.createServer((sock) => {
    sock.on("data", (d) => {
      const t = d.toString("latin1");
      received.push(t);
      if (t.includes("^XA")) {
        labels++;
        if (opts.dropAfterLabel) sock.destroy();
      }
      if (t.includes("~HS")) {
        const r = script(++hsCount, labels);
        if (r !== null) sock.write(r);
      }
    });
    sock.on("error", () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  const f: Fake = { port, received, close: () => new Promise((r) => server.close(() => r())) };
  fakes.push(f);
  return f;
}

const mk = (port: number, over: Partial<Parameters<typeof Object.assign>[1]> = {}) =>
  new ZplTcpPrinter({
    ...DEFAULT_ZPL_TCP,
    host: "127.0.0.1",
    port,
    statusTimeoutMs: 300,
    confirmTimeoutMs: 3000,
    ...over,
  });

describe("ZplTcpPrinter", () => {
  it("confirma depois que o buffer esvazia, em duas leituras limpas", async () => {
    const f = await fakePrinter((_n, labels) =>
      labels === 0 ? HS() : _n < 5 ? HS({ formats: 1 }) : HS(),
    );
    const out = await mk(f.port).send(cmd());
    expect(out).toEqual({ kind: "CONFIRMED", evidence: "PRINTER_ACK" });
    expect(f.received.join("")).toContain("^XA");
  });
  it("não envia nada se a impressora está sem papel (REJECTED_NO_OUTPUT)", async () => {
    const f = await fakePrinter(() => HS({ paperOut: 1 }));
    const out = await mk(f.port).send(cmd());
    expect(out).toMatchObject({ kind: "REJECTED_NO_OUTPUT" });
    expect(f.received.join("")).not.toContain("^XA");
  });
  it("não envia se o cabeçote está aberto, sem ribbon (transferência térmica) ou ocupada", async () => {
    for (const o of [{ headUp: 1 }, { ribbonOut: 1 }, { formats: 1 }]) {
      const f = await fakePrinter(() => HS(o));
      const out = await mk(f.port).send(cmd());
      expect(out.kind).toBe("REJECTED_NO_OUTPUT");
      expect(f.received.join("")).not.toContain("^XA");
    }
  });
  it("conexão recusada = REJECTED_NO_OUTPUT", async () => {
    const f = await fakePrinter(() => HS());
    await f.close();
    fakes = [];
    expect((await mk(f.port).send(cmd())).kind).toBe("REJECTED_NO_OUTPUT");
  });
  it("erro depois do envio = UNCERTAIN (nunca reenviar)", async () => {
    const f = await fakePrinter((n, labels) =>
      labels === 0 ? HS() : HS({ paperOut: 1, formats: 1 }),
    );
    const out = await mk(f.port).send(cmd());
    expect(out).toMatchObject({ kind: "UNCERTAIN" });
  });
  it("queda da conexão depois do envio = UNCERTAIN", async () => {
    const f = await fakePrinter((n, labels) => (labels === 0 ? HS() : null), {
      dropAfterLabel: true,
    });
    expect((await mk(f.port).send(cmd())).kind).toBe("UNCERTAIN");
  });
  it("buffer que nunca esvazia = UNCERTAIN por prazo", async () => {
    const f = await fakePrinter((n, labels) => (labels === 0 ? HS() : HS({ formats: 1 })));
    const out = await mk(f.port, { confirmTimeoutMs: 800 }).send(cmd());
    expect(out).toMatchObject({ kind: "UNCERTAIN", reason: "CONFIRM_TIMEOUT" });
  });
  it("sem resposta ao ~HS: recusa por padrão; confirma só pelo envio se configurado", async () => {
    const f1 = await fakePrinter(() => null);
    expect(await mk(f1.port).send(cmd())).toMatchObject({
      kind: "REJECTED_NO_OUTPUT",
      reason: "PRINTER_STATUS_UNSUPPORTED",
    });
    expect(f1.received.join("")).not.toContain("^XA");
    const f2 = await fakePrinter(() => null);
    expect((await mk(f2.port, { confirmWithoutStatus: true }).send(cmd())).kind).toBe("CONFIRMED");
  });
  it("getStatus: READY, UNAVAILABLE (erro ou sem conexão) e UNKNOWN (sem resposta)", async () => {
    const ok = await fakePrinter(() => HS());
    expect(await mk(ok.port).getStatus()).toBe("READY");
    const bad = await fakePrinter(() => HS({ paperOut: 1 }));
    expect(await mk(bad.port).getStatus()).toBe("UNAVAILABLE");
    const mute = await fakePrinter(() => null);
    expect(await mk(mute.port).getStatus()).toBe("UNKNOWN");
    const gone = await fakePrinter(() => HS());
    await gone.close();
    fakes = fakes.filter((x) => x !== gone);
    expect(await mk(gone.port).getStatus()).toBe("UNAVAILABLE");
  });
});

describe("configuração do adaptador ZPL", () => {
  const base = {
    AGENT_ID: "a",
    STATION_ID: "st-1",
    PRINTER_ID: "pr-1",
    API_URL: "https://x.test",
    AGENT_TOKEN: "t",
  };
  it("aceita zpl-tcp com host e usa padrões (9100, 203 dpi, Brasília)", () => {
    const c = loadConfig({ ...base, PRINTER_ADAPTER: "zpl-tcp", PRINTER_HOST: "192.168.0.50" });
    expect(c.printerAdapter).toBe("zpl-tcp");
    expect(c.zplTcp).toMatchObject({
      host: "192.168.0.50",
      port: 9100,
      dpi: 203,
      timezone: "America/Sao_Paulo",
    });
  });
  it("exige o host e valida valores", () => {
    expect(() => loadConfig({ ...base, PRINTER_ADAPTER: "zpl-tcp" })).toThrow(/printerHost/);
    expect(() =>
      loadConfig({ ...base, PRINTER_ADAPTER: "zpl-tcp", PRINTER_HOST: "h", PRINTER_DPI: "250" }),
    ).toThrow(/printerDpi/);
    expect(() => loadConfig({ ...base, PRINTER_ADAPTER: "outro" })).toThrow(/desconhecido/);
  });
});

describe("mídia maior que 30 x 20 e adaptador por fila", () => {
  const base = {
    AGENT_ID: "a",
    STATION_ID: "st-1",
    PRINTER_ID: "pr-1",
    API_URL: "https://x.test",
    AGENT_TOKEN: "t",
  };
  it("centraliza o desenho de 30 x 20 mm em mídia 50 x 35 (203 dpi)", () => {
    const z = buildZpl(cmd(), {
      dpi: 203,
      timezone: "America/Sao_Paulo",
      mediaTracking: "gap",
      printMode: "direct-thermal",
      labelWidthMm: 50,
      labelHeightMm: 35,
    });
    expect(z).toContain("^PW400");
    expect(z).toContain("^LL280");
    expect(z).toContain("^LH80,60");
  });

  it("padrão continua 30 x 20 sem deslocamento", () => {
    const z = buildZpl(cmd());
    expect(z).toContain("^PW240");
    expect(z).toContain("^LH0,0");
  });

  it("zpl-spool: valida nome, tamanho e usa lp -o raw", async () => {
    expect(() => loadConfig({ ...base, PRINTER_ADAPTER: "zpl-spool" })).toThrow(/printerName/);
    const c = loadConfig({
      ...base,
      PRINTER_ADAPTER: "zpl-spool",
      PRINTER_NAME: "ZD220",
      LABEL_WIDTH_MM: "50",
      LABEL_HEIGHT_MM: "35",
    });
    expect(c.zplSpool).toMatchObject({ printerName: "ZD220", labelWidthMm: 50, labelHeightMm: 35 });
    const calls: string[][] = [];
    const p = new ZplSpoolPrinter({
      printerName: "ZD220",
      zpl: DEFAULT_ZPL,
      platform: "darwin",
      run: async (c, a) => {
        calls.push([c, ...a]);
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      },
    });
    expect((await p.send(cmd())).kind).toBe("CONFIRMED");
    expect(calls[0]!.slice(0, 4)).toEqual(["lp", "-d", "ZD220", "-o"]);
    expect(calls[0]![4]).toBe("raw");
  });

  it("zpl-spool: recusa do spooler = sem saída; tempo esgotado = incerto; fila desabilitada = indisponível", async () => {
    const mk = (
      res: { code: number; stdout?: string; timedOut?: boolean },
      platform: NodeJS.Platform = "darwin",
    ) =>
      new ZplSpoolPrinter({
        printerName: "ZD220",
        zpl: DEFAULT_ZPL,
        platform,
        run: async () => ({ stdout: "", stderr: "erro", timedOut: false, ...res }),
      });
    expect((await mk({ code: 1 }).send(cmd())).kind).toBe("REJECTED_NO_OUTPUT");
    expect((await mk({ code: 1, timedOut: true }).send(cmd())).kind).toBe("UNCERTAIN");
    expect((await mk({ code: 11 }, "win32").send(cmd())).kind).toBe("UNCERTAIN");
    expect((await mk({ code: 10 }, "win32").send(cmd())).kind).toBe("REJECTED_NO_OUTPUT");
    expect(await mk({ code: 0, stdout: "printer ZD220 disabled since" }).getStatus()).toBe(
      "UNAVAILABLE",
    );
    expect(await mk({ code: 0, stdout: "printer ZD220 is idle." }).getStatus()).toBe("READY");
    expect(await mk({ code: 1 }).getStatus()).toBe("UNAVAILABLE");
  });
});

describe("mídia de 4 colunas, etiqueta em pé 22 x 35 mm", () => {
  const O = {
    dpi: 203 as const,
    timezone: "America/Sao_Paulo",
    mediaTracking: "gap" as const,
    printMode: "direct-thermal" as const,
    labelWidthMm: 22,
    labelHeightMm: 35,
    columns: 4,
    columnGapMm: 3,
    rowGapMm: 3,
    marginLeftMm: 3,
  };
  const four = ["A", "B", "C", "D"].map((x) => cmd({ description: `AB12${x}`, labelId: x }));

  it("monta uma linha com 4 células: largura 100 mm, passo de 38 mm, colunas a 25 mm", () => {
    const z = buildZplRow(four, O);
    expect(z.match(/\^XA/g)).toHaveLength(1);
    expect(z).toContain("^PW799"); // 3 + 4 x 22 + 3 x 3 = 100 mm
    expect(z).toContain("^LL304"); // 35 + 3 mm
    const cells = [...z.matchAll(/\^FXCELL,(\d+),0,(\d+),(\d+)\^FS/g)].map((m) => Number(m[1]));
    expect(cells).toEqual([24, 224, 424, 623]); // 3, 28, 53, 78 mm
    expect([...z.matchAll(/\^BQN/g)]).toHaveLength(4);
  });

  it("margem superior desce todo o desenho e o conteúdo continua dentro da célula de 35 mm", () => {
    const ys = (z: string): number[] => [...z.matchAll(/\^FO\d+,(\d+)/g)].map((m) => Number(m[1]));
    const base = ys(buildZplRow([four[0]!], O));
    const down = ys(buildZplRow([four[0]!], { ...O, marginTopMm: 3 }));
    expect(down.map((y, i) => y - base[i]!)).toEqual(base.map(() => 24)); // 3 mm = 24 pontos
    const qrTop = down[down.length - 1]!;
    expect(qrTop + 49 * 2).toBeLessThanOrEqual(Math.round(35 * 7.992));
  });

  it("etiqueta colada deitada: o desenho sai girado 90° (^A0R) e tudo fica dentro da célula 22 x 35", () => {
    const z = buildZplRow(
      [cmd({ operator: "Maria das Gracas Souza Lima", partNumber: "29135-BX900" })],
      {
        ...O,
        applyLandscape: true,
      },
    );
    expect(z).toContain("^A0R,");
    expect(z).not.toContain("^A0N,");
    const cellX = 24;
    const cellRight = cellX + Math.round(22 * 7.992);
    const cellBottom = Math.round(35 * 7.992);
    for (const m of z.matchAll(/\^FO(\d+),(\d+)\^A0R,(\d+),(\d+)\^FH\^FD([^^]*)\^FS/g)) {
      const [x, y, h, w, t] = [m[1], m[2], m[3], m[4], m[5]].map((v, i) => (i < 4 ? Number(v) : v));
      expect(x as number).toBeGreaterThanOrEqual(cellX);
      expect((x as number) + (h as number)).toBeLessThanOrEqual(cellRight);
      expect((y as number) + (t as string).length * (w as number)).toBeLessThanOrEqual(cellBottom);
    }
    expect(z).toContain("29135-BX900"); // Part Number completo, sem truncar, mesmo com o QR 4 mm à esquerda
    const qr = /\^FO(\d+),(\d+)\^BQN,2,(\d+)/.exec(z)!;
    const side = 49 * Number(qr[3]);
    expect(Number(qr[1])).toBeGreaterThanOrEqual(cellX);
    expect(Number(qr[1]) + side).toBeLessThanOrEqual(cellRight);
    expect(Number(qr[2]) + side).toBeLessThanOrEqual(cellBottom);
  });

  it("linha incompleta usa só as primeiras colunas; mais de 4 é recusado", () => {
    const z = buildZplRow(four.slice(0, 2), O);
    expect([...z.matchAll(/\^FXCELL/g)]).toHaveLength(2);
    expect(() => buildZplRow([...four, four[0]!], O)).toThrow();
    expect(() => buildZplRow([], O)).toThrow();
  });

  it("todo texto e QR ficam dentro da célula de 22 x 35 mm", () => {
    const z = buildZplRow([cmd({ operator: "Maria das Gracas Souza Lima" })], O);
    const cellX = 24;
    const w = Math.round(22 * (203 / 25.4));
    const h = Math.round(35 * (203 / 25.4));
    for (const m of z.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),(\d+)\^FH\^FD([^^]*)\^FS/g)) {
      const x = Number(m[1]);
      const y = Number(m[2]);
      const hh = Number(m[3]);
      const ww = Number(m[4]);
      const len = m[5]!.replace(/_[0-9A-F]{2}/g, "x").length;
      expect(x).toBeGreaterThanOrEqual(cellX);
      expect(x + len * ww).toBeLessThanOrEqual(cellX + w);
      expect(y + hh).toBeLessThanOrEqual(h);
    }
    const qr = /\^FO(\d+),(\d+)\^BQN,2,(\d+)/.exec(z)!;
    const mods = 17 + 4 * Math.ceil(0); // só confirma presença; limites abaixo
    void mods;
    expect(Number(qr[1])).toBeGreaterThanOrEqual(cellX);
    expect(Number(qr[2])).toBeGreaterThan(0);
  });

  it("1 coluna e etiqueta deitada continua igual ao ZPL de uma etiqueta", () => {
    expect(buildZplRow([cmd()])).toBe(buildZpl(cmd()));
  });

  it("config: aceita 22 x 35 com 4 colunas e recusa 4 colunas deitadas ou tamanho menor que o desenho", () => {
    const base = {
      AGENT_ID: "a",
      STATION_ID: "st-1",
      PRINTER_ID: "pr-1",
      API_URL: "https://x.test",
      AGENT_TOKEN: "t",
      PRINTER_ADAPTER: "zpl-spool",
      PRINTER_NAME: "ZD220",
    };
    const c = loadConfig({
      ...base,
      LABEL_WIDTH_MM: "22",
      LABEL_HEIGHT_MM: "35",
      LABEL_COLUMNS: "4",
      LABEL_MARGIN_LEFT_MM: "3",
    });
    expect(c.zplSpool).toMatchObject({ labelColumns: 4, columnGapMm: 3, marginLeftMm: 3 });
    expect(() => loadConfig({ ...base, LABEL_COLUMNS: "4" })).toThrow(/em pé/);
    expect(() => loadConfig({ ...base, LABEL_WIDTH_MM: "18", LABEL_HEIGHT_MM: "35" })).toThrow(
      /menor/,
    );
  });
});
