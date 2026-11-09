/**
 * Configuração do ambiente de HOMOLOGAÇÃO. Nenhum valor que dependa de decisão da Doowon tem padrão:
 * conta e região (D-002/D-003), exposição e faixas de rede permitidas (D-004), domínio e certificado.
 * Os demais valores são PROVISÓRIOS e podem ser alterados sem mudar o código.
 */
export interface InfraConfig {
  account: string;
  region: string;
  /** "internal": ALB interno (acesso por VPN/rede corporativa). "internet": ALB público. */
  exposure: "internal" | "internet";
  /** Faixas de origem autorizadas a acessar o ALB (obrigatório; sem padrão). */
  allowedCidrs: string[];
  certificateArn: string;
  apiHost: string;
  webHost: string;
  imageTag: string;
  natGateways: number;
  dbInstanceClass: string;
  dbMultiAz: boolean;
  dbBackupDays: number;
  dbAllocatedStorageGb: number;
  logRetentionDays: number;
  apiDesiredCount: number;
  webDesiredCount: number;
  alarmEmail?: string;
}

export class InfraConfigError extends Error {}

type Raw = Record<string, unknown>;

const RETENTION = [
  1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288,
  3653,
];

/** Lê o contexto do CDK (`-c chave=valor`) e valida. Todos os erros são devolvidos juntos. */
export function parseConfig(ctx: Raw): InfraConfig {
  const errors: string[] = [];
  const str = (k: string): string | undefined => {
    const v = ctx[k];
    return v === undefined || v === null || v === "" ? undefined : String(v);
  };
  const need = (k: string, why: string): string => {
    const v = str(k);
    if (v === undefined) errors.push(`Informe "${k}" (${why}).`);
    return v ?? "";
  };
  const int = (k: string, def: number, min: number, max: number): number => {
    const v = str(k);
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`"${k}" deve ser um inteiro entre ${min} e ${max}.`);
      return def;
    }
    return n;
  };
  const bool = (k: string, def: boolean): boolean => {
    const v = str(k);
    if (v === undefined) return def;
    if (v !== "true" && v !== "false") errors.push(`"${k}" deve ser true ou false.`);
    return v === "true";
  };

  const account = need("account", "conta AWS, D-002");
  if (account && !/^\d{12}$/.test(account)) errors.push('"account" deve ter 12 dígitos.');
  const region = need("region", "região AWS, D-003");
  if (region && !/^[a-z]{2}-[a-z]+-\d$/.test(region))
    errors.push('"region" inválida (ex.: sa-east-1).');

  const exposure = str("exposure") ?? "internal";
  if (exposure !== "internal" && exposure !== "internet")
    errors.push('"exposure" deve ser "internal" ou "internet" (D-004).');

  const cidrsRaw = need("allowedCidrs", "faixas de rede autorizadas, separadas por vírgula, D-004");
  const allowedCidrs = cidrsRaw ? cidrsRaw.split(",").map((c) => c.trim()) : [];
  for (const c of allowedCidrs) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(c);
    const ok = m && m.slice(1, 5).every((o) => Number(o) <= 255) && Number(m[5]) <= 32;
    if (!ok) errors.push(`CIDR inválido: "${c}".`);
    else if (c === "0.0.0.0/0" && exposure === "internal")
      errors.push('"0.0.0.0/0" não é permitido com exposure "internal".');
  }

  const certificateArn = need("certificateArn", "certificado ACM do domínio");
  if (certificateArn && !/^arn:aws:acm:[a-z0-9-]+:\d{12}:certificate\/.+$/.test(certificateArn))
    errors.push('"certificateArn" não parece um ARN de certificado ACM.');
  const host = (k: string): string => {
    const v = need(k, "nome DNS, D-003/D-004");
    if (v && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(v))
      errors.push(`"${k}" não é um nome DNS válido.`);
    return v;
  };
  const apiHost = host("apiHost");
  const webHost = host("webHost");
  if (apiHost && apiHost === webHost) errors.push('"apiHost" e "webHost" devem ser diferentes.');

  const imageTag = str("imageTag") ?? "homolog";
  if (imageTag === "latest") errors.push('Use uma tag de imagem fixa; "latest" não é permitido.');

  const logRetentionDays = int("logRetentionDays", 30, 1, 3653); // PROVISÓRIO (D-014)
  if (!RETENTION.includes(logRetentionDays))
    errors.push(
      `"logRetentionDays" deve ser um dos valores aceitos pelo CloudWatch: ${RETENTION.join(", ")}.`,
    );

  const alarmEmail = str("alarmEmail");
  if (alarmEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alarmEmail))
    errors.push('"alarmEmail" inválido.');

  const cfg: InfraConfig = {
    account,
    region,
    exposure: exposure as InfraConfig["exposure"],
    allowedCidrs,
    certificateArn,
    apiHost,
    webHost,
    imageTag,
    natGateways: int("natGateways", 1, 1, 2),
    dbInstanceClass: str("dbInstanceClass") ?? "t4g.small", // PROVISÓRIO: dimensionar após conhecer o volume (pergunta 15 da pré-leitura)
    dbMultiAz: bool("dbMultiAz", false),
    dbBackupDays: int("dbBackupDays", 7, 1, 35), // PROVISÓRIO (D-014/D-015: RPO/RTO e retenção)
    dbAllocatedStorageGb: int("dbAllocatedStorageGb", 20, 20, 65536),
    logRetentionDays,
    apiDesiredCount: int("apiDesiredCount", 1, 1, 10),
    webDesiredCount: int("webDesiredCount", 1, 1, 10),
    ...(alarmEmail ? { alarmEmail } : {}),
  };
  if (errors.length > 0)
    throw new InfraConfigError(`Configuração inválida:\n- ${errors.join("\n- ")}`);
  return cfg;
}
