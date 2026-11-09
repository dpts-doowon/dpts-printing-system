"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export interface LabelData {
  /** ALC Code (Sequence Code), em destaque. */
  description: string;
  partNumber: string;
  /** AAMMDD */
  date: string;
  /** HH:MM */
  time: string;
  producedAtUtc: string;
  qr: string;
  labelId: string;
}

/** Etiqueta (Doowon, 2026-11-06): ALC em destaque, Part Number, data (AAMMDD), hora e QR no padrão H/KMC. Operador e turno não são impressos. */
export function LabelPreview({ label }: { label: LabelData }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    void QRCode.toString(label.qr, { type: "svg", margin: 0 }).then(setSvg);
  }, [label.qr]);
  return (
    <div className="label-preview" aria-label="Pré-visualização da etiqueta">
      <div className="left">
        <div className="d">{label.description}</div>
        <div className="m">
          {label.partNumber}
          <br />
          {label.date}
          <br />
          {label.time}
        </div>
      </div>
      <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
