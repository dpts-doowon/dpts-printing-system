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
  const data: Record<string, string> = {
    description: s.part.description,
    partNumber: s.part.partNumber,
    operator: s.operator.displayName,
    shift: s.shift.name,
    producedAt: s.producedAtUtc,
    qr: s.qrContent,
    labelId: s.labelId,
  };
  const text = [
    `DESC: ${data.description}`,
    `PN: ${data.partNumber}`,
    `OP: ${data.operator}`,
    `TURNO: ${data.shift}`,
    `DATA: ${data.producedAt}`,
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
