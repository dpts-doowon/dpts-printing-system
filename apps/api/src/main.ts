import { randomBytes } from "node:crypto";
import { createApp } from "./app.js";
import {
  PostgresMasterDataRepo,
  PostgresPrintStore,
  createPool,
  migrate,
} from "@doowon/store-postgres";
import { createRuntime, seedDevData } from "./runtime.js";

/**
 * Servidor de desenvolvimento local com dados de partida provisórios. Sem DATABASE_URL, os dados ficam
 * em memória; com DATABASE_URL (ou PGHOST), o PostgreSQL guarda impressões, auditoria e cadastros.
 * A implantação AWS depende de decisões da Doowon (D-002 a D-004).
 */
async function main(): Promise<void> {
  // DATABASE_URL ou as variáveis PG* (usadas na nuvem, onde o segredo do banco é injetado por campo).
  const url = process.env["DATABASE_URL"];
  const pool = url || process.env["PGHOST"] ? createPool(url) : undefined;
  if (pool) {
    const applied = await migrate(pool);
    if (applied.length > 0) console.log("[db] migrações aplicadas:", applied.join(", "));
  }
  // FORCED_LOGOUT_TIMES="15:30,00:30" (padrão); vazio desativa. Horários informados pela Doowon.
  const forced = process.env["FORCED_LOGOUT_TIMES"];
  const auth = forced !== undefined ? { forcedLogoutTimes: forced.split(",").filter(Boolean) } : {};
  const rt = createRuntime({
    ...(pool
      ? { store: new PostgresPrintStore(pool), masterDataRepo: new PostgresMasterDataRepo(pool) }
      : {}),
    auth,
  });
  await rt.md.load();
  if (process.env["NODE_ENV"] === "production")
    throw new Error("Esta composição é apenas para desenvolvimento local.");
  const pw = (k: string): string => process.env[k] ?? randomBytes(9).toString("base64url");
  const adminPassword = pw("SEED_ADMIN_PASSWORD");
  const operatorPassword = pw("SEED_OPERATOR_PASSWORD");
  const agentTokens: Record<string, string> = {
    [process.env["AGENT_TOKEN_ST1"] ?? randomBytes(16).toString("hex")]: "st-1",
    [process.env["AGENT_TOKEN_ST2"] ?? randomBytes(16).toString("hex")]: "st-2",
  };
  await seedDevData(rt, { adminPassword, operatorPassword, agentTokens });
  if (!process.env["SEED_ADMIN_PASSWORD"]) {
    console.log("[dev] usuário admin / senha gerada:", adminPassword);
    console.log("[dev] usuários operador1, operador2 / senha gerada:", operatorPassword);
    for (const [t, s] of Object.entries(agentTokens)) console.log(`[dev] token do agente ${s}:`, t);
  }
  const app = await createApp(rt);
  // Reaper (intervalo PROPOSED: 15 s).
  setInterval(
    () => void rt.svc.reapExpired().catch((e) => console.error("reaper", e)),
    15_000,
  ).unref();
  await app.listen(Number(process.env["API_PORT"] ?? 3001));
}
void main();
