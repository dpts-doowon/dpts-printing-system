export interface AgentConfig {
  agentId: string;
  stationId: string;
  printerId: string;
  apiUrl: string;
  agentToken: string;
  journalPath: string;
  lockPath: string;
  logPath: string | null;
  pollMs: number;
  requestTimeoutMs: number;
  printerAdapter: "simulator" | "zpl-tcp" | "zpl-spool";
  /** Somente com printerAdapter = "zpl-tcp" (Elgin L42 Pro Full por Ethernet, a validar fisicamente). */
  zplTcp?: {
    host: string;
    port: number;
    dpi: 203 | 300;
    timezone: string;
    mediaTracking: "gap" | "mark" | "continuous";
    printMode: "thermal-transfer" | "direct-thermal";
    darkness?: number;
    confirmTimeoutMs: number;
    confirmWithoutStatus: boolean;
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
  };
  /**
   * Somente com printerAdapter = "zpl-spool": impressora instalada no sistema (USB), ex.: Zebra ZD220.
   * Sem leitura de status: serve para bancada/teste, não para produção.
   */
  zplSpool?: {
    printerName: string;
    dpi: 203 | 300;
    timezone: string;
    mediaTracking: "gap" | "mark" | "continuous";
    printMode: "thermal-transfer" | "direct-thermal";
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
  };
  agentVersion: string;
}

export class ConfigError extends Error {}

type Raw = Record<string, unknown>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Monta e valida a configuração a partir de um arquivo JSON (opcional) e de variáveis de ambiente
 * (as variáveis vencem o arquivo). Todos os erros são acumulados e devolvidos de uma vez, em português.
 * O token do agente deve vir de AGENT_TOKEN ou de `agentTokenFile`, nunca do arquivo principal em claro
 * quando houver como evitar (por isso não é exibido em nenhum log).
 */
export function loadConfig(
  env: Record<string, string | undefined>,
  file: Raw = {},
  readTextFile: (path: string) => string = () => {
    throw new Error("leitura de arquivo indisponível");
  },
): AgentConfig {
  const errors: string[] = [];
  const pick = (envKey: string, fileKey: string): string | undefined => {
    const e = env[envKey];
    if (e !== undefined && e !== "") return e;
    const f = file[fileKey];
    return f === undefined || f === null || f === "" ? undefined : String(f);
  };
  const required = (envKey: string, fileKey: string): string => {
    const v = pick(envKey, fileKey);
    if (v === undefined) errors.push(`Informe ${fileKey} (ou a variável ${envKey}).`);
    return v ?? "";
  };
  const int = (envKey: string, fileKey: string, def: number, min: number, max: number): number => {
    const v = pick(envKey, fileKey);
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${fileKey} deve ser um número inteiro entre ${min} e ${max}.`);
      return def;
    }
    return n;
  };

  const mm = (envKey: string, fileKey: string, def: number, min: number, max: number): number => {
    const v = pick(envKey, fileKey);
    if (v === undefined) return def;
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n) || n < min || n > max) {
      errors.push(`${fileKey} deve ser um número (mm) entre ${min} e ${max}.`);
      return def;
    }
    return Math.round(n * 10) / 10;
  };

  const agentId = required("AGENT_ID", "agentId");
  const stationId = required("STATION_ID", "stationId");
  const printerId = required("PRINTER_ID", "printerId");

  let apiUrl = required("API_URL", "apiUrl");
  if (apiUrl) {
    try {
      const u = new URL(apiUrl);
      if (u.protocol !== "https:" && !(u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname)))
        errors.push(
          "apiUrl deve usar HTTPS (HTTP só é aceito para localhost, em desenvolvimento).",
        );
      apiUrl = apiUrl.replace(/\/+$/, "");
    } catch {
      errors.push("apiUrl não é uma URL válida.");
    }
  }

  let agentToken = pick("AGENT_TOKEN", "agentToken") ?? "";
  const tokenFile = pick("AGENT_TOKEN_FILE", "agentTokenFile");
  if (agentToken === "" && tokenFile) {
    try {
      agentToken = readTextFile(tokenFile).trim();
    } catch {
      errors.push(`Não foi possível ler o arquivo do token (${tokenFile}).`);
    }
  }
  if (agentToken === "" && !errors.some((e) => e.includes("token")))
    errors.push("Informe o token do agente (AGENT_TOKEN ou agentTokenFile).");

  const adapter = pick("PRINTER_ADAPTER", "printerAdapter") ?? "simulator";
  let zplTcp: AgentConfig["zplTcp"];
  let zplSpool: AgentConfig["zplSpool"];
  if (adapter === "zpl-tcp" || adapter === "zpl-spool") {
    const dpi = int("PRINTER_DPI", "printerDpi", 203, 203, 300);
    if (dpi !== 203 && dpi !== 300) errors.push("printerDpi deve ser 203 ou 300.");
    const tracking = pick("PRINTER_MEDIA", "printerMedia") ?? "gap";
    if (!["gap", "mark", "continuous"].includes(tracking))
      errors.push('printerMedia deve ser "gap", "mark" ou "continuous".');
    const mode = pick("PRINTER_MODE", "printerMode") ?? "thermal-transfer";
    if (!["thermal-transfer", "direct-thermal"].includes(mode))
      errors.push('printerMode deve ser "thermal-transfer" ou "direct-thermal".');
    const darkness = pick("PRINTER_DARKNESS", "printerDarkness");
    if (darkness !== undefined && !(Number(darkness) >= 0 && Number(darkness) <= 30))
      errors.push("printerDarkness deve estar entre 0 e 30.");
    const labelWidthMm = int("LABEL_WIDTH_MM", "labelWidthMm", 30, 15, 120);
    const labelHeightMm = int("LABEL_HEIGHT_MM", "labelHeightMm", 20, 15, 120);
    // Etiqueta deitada: o desenho de 30 x 20 mm precisa caber. Em pé (altura > largura): 20 x 30 mm.
    if (
      labelHeightMm > labelWidthMm
        ? labelWidthMm < 20 || labelHeightMm < 30
        : labelWidthMm < 30 || labelHeightMm < 20
    )
      errors.push(
        "O tamanho da etiqueta é menor que o desenho (deitada 30 x 20 mm; em pé 20 x 30 mm).",
      );
    const labelColumns = int("LABEL_COLUMNS", "labelColumns", 1, 1, 8);
    const columnGapMm = int("LABEL_COLUMN_GAP_MM", "columnGapMm", 3, 0, 20);
    const rowGapMm = int("LABEL_ROW_GAP_MM", "rowGapMm", 3, 0, 20);
    const marginLeftMm = mm("LABEL_MARGIN_LEFT_MM", "marginLeftMm", 0, 0, 30);
    const marginTopMm = mm("LABEL_MARGIN_TOP_MM", "marginTopMm", 0, 0, 10);
    const qrUpMm = mm("LABEL_QR_UP_MM", "qrUpMm", 0, 0, 8);
    const qrLeftMm = mm("LABEL_QR_LEFT_MM", "qrLeftMm", 4, 0, 8);
    const applyLandscape = ["1", "true"].includes(
      pick("LABEL_APPLY_LANDSCAPE", "applyLandscape") ?? "",
    );
    if (labelColumns > 1 && labelHeightMm <= labelWidthMm)
      errors.push("Mídia com várias colunas usa etiqueta em pé (altura maior que a largura).");
    const common = {
      dpi: (dpi === 300 ? 300 : 203) as 203 | 300,
      timezone: pick("TIMEZONE", "timezone") ?? "America/Sao_Paulo",
      mediaTracking: tracking as "gap" | "mark" | "continuous",
      printMode: mode as "thermal-transfer" | "direct-thermal",
      ...(darkness !== undefined ? { darkness: Number(darkness) } : {}),
      labelWidthMm,
      labelHeightMm,
      labelColumns,
      columnGapMm,
      rowGapMm,
      marginLeftMm,
      marginTopMm,
      applyLandscape,
      qrUpMm,
      qrLeftMm,
    };
    if (adapter === "zpl-tcp") {
      zplTcp = {
        host: required("PRINTER_HOST", "printerHost"),
        port: int("PRINTER_PORT", "printerPort", 9100, 1, 65535),
        ...common,
        confirmTimeoutMs: int(
          "PRINTER_CONFIRM_TIMEOUT_MS",
          "printerConfirmTimeoutMs",
          10_000,
          1000,
          60_000,
        ),
        confirmWithoutStatus:
          (pick("PRINTER_CONFIRM_WITHOUT_STATUS", "printerConfirmWithoutStatus") ?? "false") ===
          "true",
      };
    } else {
      zplSpool = { printerName: required("PRINTER_NAME", "printerName"), ...common };
    }
  } else if (adapter !== "simulator") {
    errors.push(
      `Adaptador de impressora "${adapter}" desconhecido. Use "simulator", "zpl-tcp" ou "zpl-spool".`,
    );
  }

  const journalPath = pick("JOURNAL_PATH", "journalPath") ?? "./agent.journal";
  const cfg: AgentConfig = {
    agentId,
    stationId,
    printerId,
    apiUrl,
    agentToken,
    journalPath,
    lockPath: pick("LOCK_PATH", "lockPath") ?? `${journalPath}.lock`,
    logPath: pick("LOG_PATH", "logPath") ?? null,
    pollMs: int("POLL_MS", "pollMs", 1000, 200, 60_000),
    requestTimeoutMs: int("REQUEST_TIMEOUT_MS", "requestTimeoutMs", 10_000, 1000, 120_000),
    printerAdapter: adapter === "zpl-tcp" || adapter === "zpl-spool" ? adapter : "simulator",
    ...(zplTcp ? { zplTcp } : {}),
    ...(zplSpool ? { zplSpool } : {}),
    agentVersion: pick("AGENT_VERSION", "agentVersion") ?? "0.0.0",
  };
  if (errors.length > 0) throw new ConfigError(`Configuração inválida:\n- ${errors.join("\n- ")}`);
  return cfg;
}
