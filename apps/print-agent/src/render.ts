import { hashCanonical } from "@doowon/domain";
import type { ClaimedAttemptDto, RenderedCommand } from "@doowon/printer-contracts";

/**
 * Renderização provisória em modelo neutro (30 x 20 mm). O layout final depende de D-009/D-010
 * e a linguagem da impressora de D-007. Somente campos do REQ-011; "Lote de produção" está excluído (D-039).
 */
export function renderLabel(a: ClaimedAttemptDto): RenderedCommand {
  const s = a.renderSnapshot;
  if (!s.part.description || !s.part.partNumber || !s.qrContent)
    throw new Error("snapshot incompleto para renderização");
  // Etiqueta (Doowon, 2026-11-06): ALC em destaque, Part Number, data (AAMMDD) e hora. Operador e turno
  // seguem no QR (4M e flag), mas não são impressos.
  const hhmmss = s.productionTime ?? "";
  const data: Record<string, string> = {
    description: s.alcCode || s.part.description,
    partNumber: s.part.partNumber,
    ...(s.productionDate ? { date: s.productionDate } : {}),
    ...(hhmmss.length === 6 ? { time: `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}` } : {}),
    producedAt: s.producedAtUtc,
    qr: s.qrContent,
    labelId: s.labelId,
  };
  const text = [
    `ALC: ${data.description}`,
    `PN: ${data.partNumber}`,
    `DATA: ${data.date ?? data.producedAt}`,
    `HORA: ${data.time ?? ""}`,
    `QR: ${data.qr}`,
    `ID: ${data.labelId}`,
  ].join("\n");
  return {
    labelId: s.labelId,
    widthMm: 30,
    heightMm: 20,
    text,
    data,
    hash: hashCanonical({ text, templateVersion: a.templateVersion }),
  };
}
