// Sintetiza o template SEM credenciais AWS (para validação local e CI): informa as zonas de disponibilidade
// como contexto, no lugar da consulta que o CDK faria à conta. Nada é criado na AWS.
// Uso: node scripts/synth-offline.mjs -c account=... -c region=... (mesmos -c do `cdk synth`)
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ctx = {};
for (let i = 0; i < args.length; i += 2)
  if (args[i] === "-c") {
    const [k, ...v] = args[i + 1].split("=");
    ctx[k] = v.join("=");
  }
const { account, region } = ctx;
if (!account || !region) {
  console.error("Informe -c account=... e -c region=...");
  process.exit(2);
}
const context = {
  ...ctx,
  [`availability-zones:account=${account}:region=${region}`]: [`${region}a`, `${region}b`],
};
const r = spawnSync("node", ["dist/bin/app.js"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CDK_CONTEXT_JSON: JSON.stringify(context), CDK_OUTDIR: "cdk.out" },
});
process.exit(r.status ?? 1);
