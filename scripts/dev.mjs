// Sobe o ambiente local completo: API, Print Agent (impressora simulada) e interface web.
//   pnpm dev                       dados em memória (somem ao parar)
//   pnpm dev --docker-db           PostgreSQL via Docker Compose (dados persistem)
//   DATABASE_URL=postgres://... pnpm dev   usa um PostgreSQL já existente
//   pnpm dev --virtual-printer     o agente imprime em ZPL numa impressora virtual (http://localhost:9101)
//   pnpm dev --virtual-printer --label 22x35 --columns 4   mídia de 4 colunas, etiqueta em pé (margem 3 mm, espaços de 3 mm)
//   pnpm dev --printer-queue "NOME" [--label 50x35]   imprime numa impressora USB instalada no sistema (teste de bancada)
// Ctrl+C encerra tudo. Somente para desenvolvimento local; as credenciais abaixo NÃO são de produção.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const line = (m) => console.log(`\x1b[36m[dev]\x1b[0m ${m}`);
const fail = (m) => {
  console.error(`\x1b[31m[dev]\x1b[0m ${m}`);
  process.exit(1);
};

if (Number(process.versions.node.split(".")[0]) < 22)
  fail(`Node.js 22 ou superior é necessário (versão atual: ${process.versions.node}).`);

const need = ["apps/api/dist/main.js", "apps/print-agent/dist/main.js", "apps/web/.next/BUILD_ID"];
if (need.some((f) => !existsSync(join(root, f))))
  fail("Faltam artefatos de build. Execute primeiro: pnpm install && pnpm build");

const PW = { admin: "admin-pass-123", operador: "operator-pass-123" };
const ports = { api: 3001, web: 3000 };
const dataDir = join(root, ".local");
mkdirSync(dataDir, { recursive: true });

let databaseUrl = process.env.DATABASE_URL;
if (args.includes("--docker-db")) {
  line("Subindo o PostgreSQL (docker compose up -d db)...");
  const up = spawnSync("docker", ["compose", "up", "-d", "db"], { cwd: root, stdio: "inherit" });
  if (up.status !== 0)
    fail(
      "Não foi possível subir o banco com o Docker. Verifique se o Docker está instalado e em execução.",
    );
  for (let i = 0; ; i++) {
    const r = spawnSync("docker", ["compose", "exec", "-T", "db", "pg_isready", "-U", "app"], {
      cwd: root,
    });
    if (r.status === 0) break;
    if (i > 30) fail("O PostgreSQL não ficou pronto a tempo.");
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},1000)"]);
  }
  databaseUrl = "postgres://app:app@localhost:5432/traceability";
}

const kids = [];
const run = (name, file, env, cwd = root) => {
  const p = spawn(process.execPath, file, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tag = `\x1b[90m${name.padEnd(5)}\x1b[0m`;
  for (const s of [p.stdout, p.stderr])
    s.on("data", (d) =>
      String(d)
        .split("\n")
        .filter(Boolean)
        .forEach((l) => console.log(`${tag} ${l}`)),
    );
  p.on("exit", (code) => {
    if (!stopping) {
      line(`${name} encerrou inesperadamente (código ${code}). Encerrando o ambiente.`);
      stop(1);
    }
  });
  kids.push(p);
  return p;
};

let stopping = false;
const stop = (code = 0) => {
  stopping = true;
  for (const k of kids) k.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

run("api", ["apps/api/dist/main.js"], {
  API_PORT: String(ports.api),
  SEED_ADMIN_PASSWORD: PW.admin,
  SEED_OPERATOR_PASSWORD: PW.operador,
  AGENT_TOKEN_ST1: "local-token-st1",
  AGENT_TOKEN_ST2: "local-token-st2",
  ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
});
const virtual = args.includes("--virtual-printer");
const argAfter = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const queue = argAfter("--printer-queue");
const label = (argAfter("--label") ?? "30x20").split("x");
const dpiArg = argAfter("--dpi") ?? "203";
const columnsArg = argAfter("--columns");
const labelEnv = {
  ...(argAfter("--label")
    ? { LABEL_WIDTH_MM: label[0] ?? "30", LABEL_HEIGHT_MM: label[1] ?? "20" }
    : {}),
  ...(columnsArg
    ? {
        LABEL_COLUMNS: columnsArg,
        LABEL_COLUMN_GAP_MM: argAfter("--column-gap") ?? "3",
        LABEL_ROW_GAP_MM: argAfter("--row-gap") ?? "3",
        LABEL_MARGIN_LEFT_MM: argAfter("--margin-left") ?? "3",
        LABEL_MARGIN_TOP_MM: argAfter("--margin-top") ?? "0",
        LABEL_QR_UP_MM: argAfter("--qr-up") ?? "0",
        LABEL_QR_LEFT_MM: argAfter("--qr-left") ?? "4",
        ...(args.includes("--apply-landscape") ? { LABEL_APPLY_LANDSCAPE: "1" } : {}),
      }
    : {}),
  ...(args.includes("--direct-thermal") ? { PRINTER_MODE: "direct-thermal" } : {}),
};
if (virtual)
  run("vprn", ["scripts/virtual-printer.mjs", "--out", join(dataDir, "virtual-printer")], {});
// O agente reconecta sozinho enquanto a API ainda está subindo.
run("agent", ["apps/print-agent/dist/main.js"], {
  ...(virtual
    ? { PRINTER_ADAPTER: "zpl-tcp", PRINTER_HOST: "127.0.0.1", PRINTER_PORT: "9100", ...labelEnv }
    : {}),
  ...(queue
    ? {
        PRINTER_ADAPTER: "zpl-spool",
        PRINTER_NAME: queue,
        PRINTER_DPI: dpiArg,
        ...labelEnv,
      }
    : {}),
  AGENT_ID: "agent-st-1",
  STATION_ID: "st-1",
  PRINTER_ID: "pr-1",
  API_URL: `http://localhost:${ports.api}`,
  AGENT_TOKEN: "local-token-st1",
  JOURNAL_PATH: join(dataDir, "agent-st-1.journal"),
  POLL_MS: "500",
});
run(
  "web",
  ["node_modules/next/dist/bin/next", "start", "-p", String(ports.web)],
  {},
  join(root, "apps/web"),
);

setTimeout(() => {
  console.log(`
\x1b[32m================ Ambiente local pronto ================\x1b[0m
  Interface:  http://localhost:${ports.web}
  API:        http://localhost:${ports.api}/health
  Dados:      ${databaseUrl ? "PostgreSQL (persistem)" : "em memória (somem ao parar)"}

  Operador (Posto 01):  operador1 / ${PW.operador}
  Administrador:        admin / ${PW.admin}
  (credenciais apenas para desenvolvimento local)

  ${virtual ? "Impressora virtual (ZPL): http://localhost:9101\n\n  " : ""}Ctrl+C para encerrar.
\x1b[32m=======================================================\x1b[0m`);
}, 4000);
