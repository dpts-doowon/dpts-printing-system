import type { RenderedCommand } from "@doowon/printer-contracts";

/**
 * Geração de ZPL II para a etiqueta de 30 x 20 mm e leitura do status do host (~HS).
 * O modelo de impressora previsto é a Elgin L42 Pro Full (aceita ZPL, EPL, PPLA e PPLB), ainda a validar
 * fisicamente. Layout PROVISÓRIO (D-009/D-010/D-036), em milímetros para valer em 203 e 300 dpi.
 */
export interface ZplOptions {
  dpi: 203 | 300;
  /** Fuso para a data e hora impressas (D-013: horário de Brasília). */
  timezone: string;
  /** Sensor de mídia: com intervalo (gap), com marca preta ou contínua. */
  mediaTracking: "gap" | "mark" | "continuous";
  /** Térmica direta ou transferência térmica (com ribbon). */
  printMode: "thermal-transfer" | "direct-thermal";
  /** Escuridão 0..30; ausente = usa a configuração atual da impressora. */
  darkness?: number;
  /** Tamanho físico da mídia em mm (padrão 30 x 20). O desenho de 30 x 20 mm é centralizado em mídias maiores. */
  labelWidthMm?: number;
  labelHeightMm?: number;
  /** Mídia com várias colunas: etiquetas por linha (padrão 1). Com altura > largura, usa o desenho em pé. */
  columns?: number;
  /** Distância entre colunas, entre linhas e da borda esquerda do papel à primeira etiqueta (mm). */
  columnGapMm?: number;
  rowGapMm?: number;
  marginLeftMm?: number;
  /** Desce todo o desenho de cada etiqueta (mm), para compensar o desalinhamento vertical da mídia. */
  marginTopMm?: number;
  /**
   * A etiqueta é impressa em pé (22 x 35 mm), mas colada deitada (35 x 22 mm). O desenho deitado de 30 x 20 mm
   * é girado 90° na mídia: o topo da etiqueta colada fica do lado esquerdo do papel impresso, ou seja, o
   * operador gira a etiqueta 90° para a esquerda (anti-horário) para lê-la. O QR não gira (é lido em qualquer ângulo).
   */
  applyLandscape?: boolean;
  /** Com applyLandscape: sobe o QR (mm, no sentido de leitura da etiqueta colada). Padrão 0. */
  qrUpMm?: number;
  /** Com applyLandscape: leva o QR para a esquerda (mm, no sentido de leitura da etiqueta colada). Padrão 4. */
  qrLeftMm?: number;
}

/** Desenho em pé (22 x 35 mm) quando a altura da etiqueta é maior que a largura. */
export const isPortrait = (o: ZplOptions): boolean =>
  (o.labelHeightMm ?? 20) > (o.labelWidthMm ?? 30);

export const DEFAULT_ZPL: ZplOptions = {
  dpi: 203,
  timezone: "America/Sao_Paulo",
  mediaTracking: "gap",
  printMode: "thermal-transfer",
};

/** Área do desenho (etiqueta da Doowon). Em mídia maior, o desenho fica centralizado (^LH). */
const LABEL_W_MM = 30;
const LABEL_H_MM = 20;

/** Capacidade em bytes do QR (modo byte, correção M) para as versões 1 a 14. */
const QR_CAPACITY_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362];

/** Versão mínima do QR e número de módulos para o conteúdo informado. */
export function qrModules(byteLength: number): number {
  const i = QR_CAPACITY_M.findIndex((c) => byteLength <= c);
  if (i < 0) throw new Error("Conteúdo do QR grande demais para a etiqueta.");
  return 17 + 4 * (i + 1);
}

/** Escapa um texto para ^FH (caracteres especiais e UTF-8 viram _XX). */
export function zplEscape(text: string): string {
  let out = "";
  for (const b of Buffer.from(text, "utf8")) {
    const ch = String.fromCharCode(b);
    out += /[A-Za-z0-9 .,:/+=@#()-]/.test(ch)
      ? ch
      : `_${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function formatLocal(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const hour = g("hour") === "24" ? "00" : g("hour");
  return `${g("day")}/${g("month")}/${g("year")} ${hour}:${g("minute")}`;
}

/**
 * Ajusta um texto à largura disponível: reduz a largura do caractere (e a altura, para manter a proporção) e,
 * se ainda não couber com o mínimo legível, corta o texto. Evita que a linha invada o QR ou saia da etiqueta.
 */
export function fitText(
  text: string,
  h: number,
  w: number,
  avail: number,
  minW: number,
): { text: string; h: number; w: number } {
  const chars = Math.max(1, Math.floor(avail / minW));
  const t = text.length > chars ? text.slice(0, chars) : text;
  const fw = Math.max(minW, Math.min(w, Math.floor(avail / Math.max(1, t.length))));
  const fh = Math.min(h, Math.round(fw * 1.75));
  return { text: t, h: fh, w: fw };
}

export function buildZpl(cmd: RenderedCommand, o: ZplOptions = DEFAULT_ZPL): string {
  const dpm = o.dpi / 25.4; // pontos por mm
  const dots = (mm: number): number => Math.round(mm * dpm);
  const mediaW = Math.max(LABEL_W_MM, o.labelWidthMm ?? LABEL_W_MM);
  const mediaH = Math.max(LABEL_H_MM, o.labelHeightMm ?? LABEL_H_MM);
  const d = cmd.data;
  const qr = d["qr"] ?? "";
  const qrBytes = Buffer.byteLength(qr, "utf8");
  const modules = qrModules(qrBytes);
  // Caixa do QR: 13 mm; magnificação inteira que cabe nela (1..10).
  const mag = Math.max(1, Math.min(10, Math.floor(dots(13) / modules)));
  const qrDots = modules * mag;
  const qrX = dots(LABEL_W_MM - 1) - qrDots;
  const qrY = dots(LABEL_H_MM - 1) - qrDots;

  const field = (x: number, y: number, h: number, w: number, text: string): string =>
    `^FO${x},${y}^A0N,${h},${w}^FH^FD${zplEscape(text)}^FS`;
  // Coluna esquerda: da margem até 1 mm antes do QR.
  const leftX = dots(1);
  const leftAvail = qrX - dots(1) - leftX;
  const minW = Math.round(dots(1.1));
  const left = (y: number, h: number, w: number, text: string): string => {
    const f = fitText(text, h, w, leftAvail, minW);
    return field(leftX, y, f.h, f.w, f.text);
  };

  const [wd = "", wt = ""] = formatLocal(d["producedAt"] ?? "", o.timezone).split(" ");
  const when = { date: wd, time: wt };
  const tracking = { gap: "^MNY", mark: "^MNM", continuous: "^MNN" }[o.mediaTracking];
  const mt = o.printMode === "thermal-transfer" ? "^MTT" : "^MTD";
  const lines = [
    "^XA",
    "^CI28", // UTF-8
    `^PW${dots(mediaW)}`,
    `^LL${dots(mediaH)}`,
    `^LH${dots((mediaW - LABEL_W_MM) / 2)},${dots((mediaH - LABEL_H_MM) / 2)}`,
    "^PR3", // velocidade moderada
    tracking,
    mt,
    ...(o.darkness !== undefined ? [`~SD${String(Math.round(o.darkness)).padStart(2, "0")}`] : []),
    // Descrição da peça: maior destaque, linha superior.
    field(dots(1), dots(0.8), dots(5.4), dots(4.4), d["description"] ?? ""),
    // Coluna esquerda, abaixo da descrição (5 linhas curtas; data e hora em linhas separadas para caberem).
    left(dots(7.2), dots(2.1), dots(1.7), d["partNumber"] ?? ""),
    left(dots(9.6), dots(2.0), dots(1.6), d["operator"] ?? ""),
    left(dots(12.0), dots(2.0), dots(1.6), d["shift"] ?? ""),
    left(dots(14.4), dots(2.0), dots(1.6), when.date),
    left(dots(16.8), dots(2.0), dots(1.6), when.time),
    // QR único (correção M, modelo 2).
    `^FO${qrX},${qrY}^BQN,2,${mag}^FH^FDMA,${zplEscape(qr)}^FS`,
    "^PQ1",
    "^XZ",
  ];
  return lines.join("\n") + "\n";
}

export interface HostStatus {
  paperOut: boolean;
  paused: boolean;
  headUp: boolean;
  ribbonOut: boolean;
  formatsInBuffer: number;
  labelsRemaining: number;
  printing: boolean;
}

/**
 * Interpreta a resposta do ~HS (três linhas entre STX e ETX). Devolve null se o formato não for reconhecido;
 * quem chama deve registrar a resposta bruta, pois o comportamento real da L42 Pro Full ainda é desconhecido.
 */
export function parseHostStatus(raw: string): HostStatus | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replaceAll("\x02", "").replaceAll("\x03", "").trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;
  const a = lines[0]!.split(",");
  const b = lines[1]!.split(",");
  if (a.length < 5 || b.length < 8) return null;
  const n = (s: string | undefined, radix = 10): number => {
    const v = parseInt((s ?? "").trim(), radix);
    return Number.isNaN(v) ? NaN : v;
  };
  const formats = n(a[4]);
  const remaining = n(b[7], 16);
  if (Number.isNaN(formats) || Number.isNaN(remaining)) return null;
  const flag = (s: string | undefined): boolean => (s ?? "0").trim() === "1";
  return {
    paperOut: flag(a[1]),
    paused: flag(a[2]),
    headUp: flag(b[1]),
    ribbonOut: flag(b[2]),
    formatsInBuffer: formats,
    labelsRemaining: remaining,
    printing: b[8] !== undefined && /[1-9]/.test(b[8]),
  };
}

/** Descrição do problema, ou null se a impressora está pronta. */
export function statusProblem(s: HostStatus, printMode: ZplOptions["printMode"]): string | null {
  if (s.paperOut) return "sem papel ou etiqueta";
  if (s.headUp) return "cabeçote aberto";
  if (s.ribbonOut && printMode === "thermal-transfer") return "sem ribbon";
  if (s.paused) return "impressora em pausa";
  return null;
}

/**
 * Uma célula (etiqueta) em pé, com origem (ox, oy) em pontos. Layout PROVISÓRIO para 22 x 35 mm, a ser
 * substituído pelo desenho da Doowon (D-010/D-042). Mesmos campos do REQ-011; o QR ainda é o provisório.
 */
function portraitCell(cmd: RenderedCommand, o: ZplOptions, ox: number, oy: number): string[] {
  if (o.applyLandscape) return landscapeOnPortraitCell(cmd, o, ox, oy);
  const dpm = o.dpi / 25.4;
  const dots = (mm: number): number => Math.round(mm * dpm);
  const w = o.labelWidthMm ?? 22;
  const d = cmd.data;
  const qr = d["qr"] ?? "";
  const modules = qrModules(Buffer.byteLength(qr, "utf8"));
  const mag = Math.max(1, Math.min(10, Math.floor(dots(Math.min(16, w - 3)) / modules)));
  const qrDots = modules * mag;
  const margin = dots(1);
  const avail = dots(w) - 2 * margin;
  const minW = Math.round(dots(1.1));
  const field = (yMm: number, hMm: number, wMm: number, text: string): string => {
    const f = fitText(text, dots(hMm), dots(wMm), avail, minW);
    return `^FO${ox + margin},${oy + dots(yMm)}^A0N,${f.h},${f.w}^FH^FD${zplEscape(f.text)}^FS`;
  };
  const when = formatLocal(d["producedAt"] ?? "", o.timezone);
  return [
    field(1.0, 5.4, 4.4, d["description"] ?? ""),
    field(7.2, 2.1, 1.7, d["partNumber"] ?? ""),
    field(9.7, 2.0, 1.6, d["operator"] ?? ""),
    field(12.1, 2.0, 1.6, d["shift"] ?? ""),
    field(14.5, 2.0, 1.6, when),
    `^FO${ox + Math.round((dots(w) - qrDots) / 2)},${oy + dots(17.2)}^BQN,2,${mag}^FH^FDMA,${zplEscape(qr)}^FS`,
  ];
}

/**
 * Mesma etiqueta deitada (35 x 22 mm, desenho de 30 x 20 mm centralizado) desenhada girada 90° dentro da célula
 * em pé: o ponto (vx, vy) da etiqueta deitada vai para (largura - vy, vx) na célula. Texto com ^A0R (lê de cima
 * para baixo); a origem de ^FO é o canto superior esquerdo da caixa do texto.
 */
function landscapeOnPortraitCell(
  cmd: RenderedCommand,
  o: ZplOptions,
  ox: number,
  oy: number,
): string[] {
  const dpm = o.dpi / 25.4;
  const dots = (mm: number): number => Math.round(mm * dpm);
  const cellW = dots(o.labelWidthMm ?? 22);
  const cellH = o.labelHeightMm ?? 35;
  // Desenho deitado centralizado na etiqueta deitada (cellH x labelWidth).
  const offX = (cellH - LABEL_W_MM) / 2;
  const offY = ((o.labelWidthMm ?? 22) - LABEL_H_MM) / 2;
  const d = cmd.data;
  const qr = d["qr"] ?? "";
  const modules = qrModules(Buffer.byteLength(qr, "utf8"));
  const mag = Math.max(1, Math.min(10, Math.floor(dots(13) / modules)));
  const qrDots = modules * mag;
  const qrVx = dots(offX + LABEL_W_MM) - qrDots - dots(o.qrLeftMm ?? 4);
  const qrVy = dots(offY + LABEL_H_MM - 1 - (o.qrUpMm ?? 0)) - qrDots;
  const leftVx = dots(offX + 1);
  const leftAvail = qrVx - dots(1) - leftVx;
  // Com o QR mais à esquerda a coluna de texto fica estreita: aceita letra um pouco mais fina (1,0 mm).
  const minW = Math.round(dots(1.0));
  const put = (vx: number, vy: number, f: { text: string; h: number; w: number }): string =>
    `^FO${ox + cellW - vy - f.h},${oy + vx}^A0R,${f.h},${f.w}^FH^FD${zplEscape(f.text)}^FS`;
  const left = (yMm: number, hMm: number, wMm: number, text: string): string =>
    put(leftVx, dots(offY + yMm), fitText(text, dots(hMm), dots(wMm), leftAvail, minW));
  const [wd = "", wt = ""] = formatLocal(d["producedAt"] ?? "", o.timezone).split(" ");
  return [
    put(dots(offX + 1), dots(offY + 0.8), {
      text: d["description"] ?? "",
      h: dots(5.4),
      w: dots(4.4),
    }),
    left(7.2, 2.1, 1.7, d["partNumber"] ?? ""),
    left(9.6, 2.0, 1.6, d["operator"] ?? ""),
    left(12.0, 2.0, 1.6, d["shift"] ?? ""),
    left(14.4, 2.0, 1.6, wd),
    left(16.8, 2.0, 1.6, wt),
    `^FO${ox + cellW - qrVy - qrDots},${oy + qrVx}^BQN,2,${mag}^FH^FDMA,${zplEscape(qr)}^FS`,
  ];
}

/**
 * Uma linha de etiquetas (1 a `columns`) em um único formato ZPL, para mídia de várias colunas. Os rótulos
 * ocupam as colunas da esquerda para a direita; colunas sem etiqueta ficam em branco. Com 1 coluna e desenho
 * deitado, devolve o mesmo ZPL de `buildZpl`.
 */
export function buildZplRow(cmds: RenderedCommand[], o: ZplOptions = DEFAULT_ZPL): string {
  const cols = Math.max(1, o.columns ?? 1);
  if (cmds.length < 1 || cmds.length > cols)
    throw new Error(`A linha comporta de 1 a ${cols} etiquetas.`);
  if (cols === 1 && !isPortrait(o)) return buildZpl(cmds[0]!, o);
  const dpm = o.dpi / 25.4;
  const dots = (mm: number): number => Math.round(mm * dpm);
  const w = o.labelWidthMm ?? 22;
  const h = o.labelHeightMm ?? 35;
  const gap = o.columnGapMm ?? 3;
  const rowGap = o.rowGapMm ?? 3;
  const left = o.marginLeftMm ?? 3;
  const top = dots(o.marginTopMm ?? 0);
  const tracking = { gap: "^MNY", mark: "^MNM", continuous: "^MNN" }[o.mediaTracking];
  const mt = o.printMode === "thermal-transfer" ? "^MTT" : "^MTD";
  const lines = [
    "^XA",
    "^CI28",
    `^PW${dots(left + cols * w + (cols - 1) * gap)}`,
    `^LL${dots(h + rowGap)}`,
    "^LH0,0",
    "^PR3",
    tracking,
    mt,
    ...(o.darkness !== undefined ? [`~SD${String(Math.round(o.darkness)).padStart(2, "0")}`] : []),
  ];
  cmds.forEach((cmd, i) => {
    const ox = dots(left + i * (w + gap));
    // Comentário ZPL (^FX): marca a célula para a impressora virtual; a impressora real o ignora.
    lines.push(`^FXCELL,${ox},0,${dots(w)},${dots(h)}^FS`);
    lines.push(...portraitCell(cmd, o, ox, top));
  });
  lines.push("^PQ1", "^XZ");
  return lines.join("\n") + "\n";
}
