import type {
  PrinterAdapter,
  PrinterStatus,
  RenderedCommand,
  SendOutcome,
} from "@doowon/printer-contracts";

export type SimMode = "OK" | "REJECT" | "UNCERTAIN" | "THROW";

/** Simulador de impressora: sucesso, falha, timeout/incerteza e erro; não consome etiquetas. */
export class SimulatedPrinter implements PrinterAdapter {
  status: PrinterStatus = "READY";
  /** Modo por chamada; quando acaba a lista, usa `defaultMode`. */
  script: SimMode[] = [];
  defaultMode: SimMode = "OK";
  readonly printed: RenderedCommand[] = [];
  readonly received: RenderedCommand[] = [];
  /** Etiquetas por linha (mídia de várias colunas); 1 = comportamento original. */
  labelsPerRow = 1;
  readonly rows: RenderedCommand[][] = [];

  async getStatus(): Promise<PrinterStatus> {
    return this.status;
  }

  send(command: RenderedCommand): Promise<SendOutcome> {
    return this.sendRow([command]);
  }

  async sendRow(commands: RenderedCommand[]): Promise<SendOutcome> {
    this.rows.push(commands);
    this.received.push(...commands);
    const mode = this.script.shift() ?? this.defaultMode;
    switch (mode) {
      case "OK":
        this.printed.push(...commands);
        return { kind: "CONFIRMED", evidence: "PRINTER_ACK" };
      case "REJECT":
        return { kind: "REJECTED_NO_OUTPUT", reason: "SIM_REJECTED" };
      case "UNCERTAIN":
        return { kind: "UNCERTAIN", reason: "SIM_TIMEOUT" };
      case "THROW":
        throw new Error("simulated connection drop");
    }
  }
}
