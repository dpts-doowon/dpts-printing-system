import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PrinterAdapter,
  PrinterStatus,
  RenderedCommand,
  SendOutcome,
} from "@doowon/printer-contracts";
import { DEFAULT_ZPL, buildZplRow, type ZplOptions } from "./zpl.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
export type RunCommand = (cmd: string, args: string[], timeoutMs: number) => Promise<RunResult>;

export interface ZplSpoolConfig {
  /** Nome da impressora instalada no sistema (fila de impressão), ex.: "ZDesigner ZD220-203dpi ZPL". */
  printerName: string;
  zpl: ZplOptions;
  platform?: NodeJS.Platform;
  run?: RunCommand;
  timeoutMs?: number;
  log?: (level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) => void;
}

export const DEFAULT_SPOOL = { zpl: DEFAULT_ZPL };

export const defaultRun: RunCommand = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      resolve({
        code: e ? (typeof e.code === "number" ? e.code : 1) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? e?.message ?? ""),
        timedOut: !!e?.killed,
      });
    });
  });

/** Códigos de saída do script do Windows. 10 = não abriu a impressora (nada foi enviado). */
const PS_NOT_OPENED = 10;

const PS_SCRIPT = `param([string]$Printer, [string]$File)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class RawPrn {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true)] public static extern bool StartDocPrinter(IntPtr h, int l, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true)] public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
}
"@
$bytes = [System.IO.File]::ReadAllBytes($File)
$h = [IntPtr]::Zero
if (-not [RawPrn]::OpenPrinter($Printer, [ref]$h, [IntPtr]::Zero)) { Write-Error "Nao foi possivel abrir a impressora."; exit ${PS_NOT_OPENED} }
$di = New-Object RawPrn+DOCINFOA
$di.pDocName = 'Doowon etiqueta'; $di.pDataType = 'RAW'
if (-not [RawPrn]::StartDocPrinter($h, 1, $di)) { [RawPrn]::ClosePrinter($h) | Out-Null; Write-Error "StartDoc falhou."; exit ${PS_NOT_OPENED} }
[RawPrn]::StartPagePrinter($h) | Out-Null
$p = [System.Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $p, $bytes.Length)
$w = 0
$ok = [RawPrn]::WritePrinter($h, $p, $bytes.Length, [ref]$w)
[System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($p)
[RawPrn]::EndPagePrinter($h) | Out-Null; [RawPrn]::EndDocPrinter($h) | Out-Null; [RawPrn]::ClosePrinter($h) | Out-Null
if (-not $ok -or $w -ne $bytes.Length) { exit 11 }
exit 0
`;

/**
 * Adaptador ZPL por fila de impressão do sistema (USB): macOS/Linux usa \`lp -o raw\`; Windows usa a API RAW do
 * spooler via PowerShell. NÃO lê o status da impressora e portanto só sabe que o spooler aceitou o trabalho:
 * é evidência fraca, adequada a teste de bancada e não à produção (a Elgin L42 Pro Full segue por rede, zpl-tcp).
 *  - falha ao entregar ao spooler (impressora inexistente, fila recusou) = REJECTED_NO_OUTPUT;
 *  - tempo esgotado ou erro depois de iniciar a escrita = UNCERTAIN (nunca reenvia).
 */
export class ZplSpoolPrinter implements PrinterAdapter {
  private warned = false;
  private run: RunCommand;
  private platform: NodeJS.Platform;
  private timeoutMs: number;
  constructor(private cfg: ZplSpoolConfig) {
    this.run = cfg.run ?? defaultRun;
    this.platform = cfg.platform ?? process.platform;
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
  }

  async getStatus(): Promise<PrinterStatus> {
    try {
      if (this.platform === "win32") {
        const r = await this.run(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `(Get-Printer -Name '${this.cfg.printerName.replaceAll("'", "''")}').PrinterStatus`,
          ],
          this.timeoutMs,
        );
        if (r.code !== 0) return "UNAVAILABLE";
        return /offline|error|paper|door|notavailable/i.test(r.stdout) ? "UNAVAILABLE" : "READY";
      }
      const r = await this.run("lpstat", ["-p", this.cfg.printerName], this.timeoutMs);
      if (r.code !== 0) return "UNAVAILABLE";
      return /disabled|not accepting/i.test(r.stdout) ? "UNAVAILABLE" : "READY";
    } catch {
      return "UNAVAILABLE";
    }
  }

  get labelsPerRow(): number {
    return Math.max(1, this.cfg.zpl.columns ?? 1);
  }

  send(command: RenderedCommand): Promise<SendOutcome> {
    return this.sendRow([command]);
  }

  async sendRow(commands: RenderedCommand[]): Promise<SendOutcome> {
    let zpl: string;
    try {
      zpl = buildZplRow(commands, this.cfg.zpl);
    } catch (e) {
      return { kind: "REJECTED_NO_OUTPUT", reason: `ZPL_BUILD_FAILED: ${String(e)}` };
    }
    if (!this.warned) {
      this.warned = true;
      this.cfg.log?.(
        "warn",
        "zpl-spool: sem leitura de status; a confirmação é só a entrega ao spooler (uso de teste)",
      );
    }
    const dir = mkdtempSync(join(tmpdir(), "doowon-zpl-"));
    try {
      const file = join(dir, "etiqueta.zpl");
      writeFileSync(file, zpl, "utf8");
      let r: RunResult;
      if (this.platform === "win32") {
        const script = join(dir, "raw.ps1");
        writeFileSync(script, "﻿" + PS_SCRIPT, "utf8");
        r = await this.run(
          "powershell",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
            "-Printer",
            this.cfg.printerName,
            "-File",
            file,
          ],
          this.timeoutMs,
        );
      } else {
        r = await this.run("lp", ["-d", this.cfg.printerName, "-o", "raw", file], this.timeoutMs);
      }
      if (r.timedOut) return { kind: "UNCERTAIN", reason: "SPOOL_TIMEOUT" };
      if (r.code === 0) return { kind: "CONFIRMED", evidence: "PRINTER_ACK" };
      const detail = (r.stderr || r.stdout).trim().slice(0, 200);
      // No Windows, só o código 10 garante que nada foi escrito; os demais podem ter enviado parte.
      if (this.platform === "win32" && r.code !== PS_NOT_OPENED)
        return { kind: "UNCERTAIN", reason: `SPOOL_WRITE_FAILED: ${detail}` };
      return { kind: "REJECTED_NO_OUTPUT", reason: `SPOOL_REJECTED: ${detail}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
