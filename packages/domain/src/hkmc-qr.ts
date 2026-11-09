/**
 * QR no padrão "H/KMC Part 2D Barcode Standard" (regras conferidas no leitor HMBarcodeChecker 1.0.0).
 *
 * Quadro: `[)>` RS `06` GS ...segmentos separados por GS... GS RS EOT
 * Segmentos: V fornecedor(4) · P part number(10-15, sem hífen) · S sequence code(<=8, opcional)
 *            · E EO(vazio ou 8-9) · T data(AAMMDD)+4M(4)+flag(@|A)+trace · C área do fornecedor(<=50, opcional)
 *
 * PROPOSED — PENDING DOOWON VALIDATION: posição da hora, escopo/formato do Trace Number.
 */
export const HKMC_QR_SCHEMA_VERSION = "3-hkmc";

export const RS = "\u001e";
export const GS = "\u001d";
export const EOT = "\u0004";

export interface HkmcQrFields {
  supplierCode: string;
  /** Com ou sem hífen; no QR o hífen é removido. */
  partNumber: string;
  alcCode?: string;
  eoNumber?: string;
  /** AAMMDD */
  productionDate: string;
  /** HHMMSS (hora local da planta) */
  productionTime: string;
  /** Exatamente 4 caracteres. */
  fourM: string;
  /** "@" ou "A" no leitor da Hyundai. */
  flag: string;
  traceNumber: number;
  supplierArea?: string;
}

export class HkmcQrError extends Error {}

const stripHyphen = (s: string): string => s.replace(/-/g, "");
const printable = (s: string): boolean =>
  /^[\x20-\x7e]*$/.test(s) && !s.includes(String.fromCharCode(0x1d));

export function validateHkmcFields(f: HkmcQrFields): string[] {
  const e: string[] = [];
  if (f.supplierCode.length !== 4 || !printable(f.supplierCode))
    e.push("Supplier Code deve ter exatamente 4 caracteres.");
  const pn = stripHyphen(f.partNumber);
  if (pn.length < 10 || pn.length > 15 || !printable(pn))
    e.push("Part Number (sem hífen) deve ter de 10 a 15 caracteres.");
  if ((f.alcCode ?? "").length > 8 || !printable(f.alcCode ?? ""))
    e.push("ALC Code (Sequence Code) deve ter até 8 caracteres.");
  const eo = f.eoNumber ?? "";
  if (eo !== "" && (eo.length < 8 || eo.length > 9 || !printable(eo)))
    e.push("EO Number deve ficar vazio ou ter 8 a 9 caracteres.");
  if (!/^\d{6}$/.test(f.productionDate) || !validYymmdd(f.productionDate))
    e.push("Data de produção inválida (AAMMDD).");
  if (!/^\d{6}$/.test(f.productionTime)) e.push("Hora de produção inválida (HHMMSS).");
  if (f.fourM.length !== 4 || !printable(f.fourM) || f.fourM.includes(" "))
    e.push("Código 4M (operador) deve ter exatamente 4 caracteres.");
  if (f.flag !== "@" && f.flag !== "A")
    e.push("Flag do Trace deve ser '@' ou 'A' (único aceito pelo leitor da Hyundai).");
  if (!Number.isInteger(f.traceNumber) || f.traceNumber < 1) e.push("Trace Number inválido.");
  if ((f.supplierArea ?? "").length > 50 || !printable(f.supplierArea ?? ""))
    e.push("Área do Fornecedor deve ter até 50 caracteres.");
  return e;
}

function validYymmdd(s: string): boolean {
  const y = 2000 + Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  const d = Number(s.slice(4, 6));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const traceString = (n: number): string => String(n).padStart(7, "0");

export function buildHkmcQr(f: HkmcQrFields): string {
  const errors = validateHkmcFields(f);
  if (errors.length > 0) throw new HkmcQrError(errors.join(" "));
  const seg = [
    `V${f.supplierCode}`,
    `P${stripHyphen(f.partNumber)}`,
    ...(f.alcCode ? [`S${f.alcCode}`] : []),
    `E${f.eoNumber ?? ""}`,
    `T${f.productionDate}${f.fourM}${f.flag}${traceString(f.traceNumber)}${f.productionTime}`,
    ...(f.supplierArea ? [`C${f.supplierArea}`] : []),
  ];
  return `[)>${RS}06${GS}${seg.join(GS)}${GS}${RS}${EOT}`;
}

/** Espelha as regras do leitor; devolve a lista de erros (vazia = OK). */
export function checkHkmcQr(qr: string): string[] {
  const e: string[] = [];
  const head = `[)>${RS}06${GS}`;
  const tail = `${GS}${RS}${EOT}`;
  if (!qr.startsWith(head)) return ["Cabeçalho inválido."];
  if (!qr.endsWith(tail)) return ["Final inválido."];
  const body = qr.slice(head.length, qr.length - tail.length);
  const segs = body.split(GS);
  const get = (id: string): string | undefined => segs.find((s) => s[0] === id)?.slice(1);
  const v = get("V");
  if (v === undefined || v.length !== 4) e.push("V: 4 caracteres.");
  const p = get("P");
  if (p === undefined || p.length < 10 || p.length > 15 || p.includes("-"))
    e.push("P: 10-15 sem hífen.");
  const s = get("S");
  if (s !== undefined && s.length > 8) e.push("S: até 8.");
  const eo = get("E");
  if (eo !== undefined && eo !== "" && (eo.length < 8 || eo.length > 9)) e.push("E: vazio ou 8-9.");
  const t = get("T");
  if (t === undefined || !/^\d{6}.{4}[@A]/.test(t) || !validYymmdd(t.slice(0, 6)))
    e.push("T inválido.");
  const c = get("C");
  if (c !== undefined && c.length > 50) e.push("C: até 50.");
  return e;
}

/** Datas locais da planta (AAMMDD / HHMMSS) a partir de um instante e um fuso IANA. */
export function localDateTime(ms: number, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const g = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${g("year")}${g("month")}${g("day")}`,
    time: `${g("hour")}${g("minute")}${g("second")}`,
  };
}
