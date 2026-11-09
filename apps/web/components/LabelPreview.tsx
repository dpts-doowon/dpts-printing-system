"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export interface LabelData {
  description: string;
  partNumber: string;
  operator: string;
  shift: string;
  producedAtUtc: string;
  qr: string;
  labelId: string;
}

/** Layout provisório 30 x 20 mm: descrição em maior destaque, Part Number em fonte pequena, operador, turno, data e um único QR com a carga da peça e da produção. Layout final: D-009/D-010. */
export function LabelPreview({ label }: { label: LabelData }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    void QRCode.toString(label.qr, { type: "svg", margin: 0 }).then(setSvg);
  }, [label.qr]);
  const when = new Date(label.producedAtUtc).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  return (
    <div className="label-preview" aria-label="Pré-visualização da etiqueta">
      <div className="left">
        <div className="d">{label.description}</div>
        <div className="m">
          <b>OP:</b> {label.operator}
          <br />
          <b>Turno:</b> {label.shift}
          <br />
          <b>Data:</b> {when}
        </div>
        <div className="pn">PN {label.partNumber}</div>
      </div>
      <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
