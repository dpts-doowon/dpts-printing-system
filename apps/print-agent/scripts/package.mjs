// Gera release/doowon-print-agent-<versão>.zip: bundle único (sem node_modules), configuração de exemplo,
// scripts de instalação, README e SHA256SUMS. Uso: pnpm -F @doowon/print-agent package
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = process.env.AGENT_RELEASE_VERSION ?? pkg.version;
const name = `doowon-print-agent-${version}`;
const out = join(root, "release", name);
rmSync(join(root, "release"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "src/main.ts")],
  outfile: join(out, "doowon-print-agent.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: false,
  banner: { js: `// Doowon Print Agent ${version}` },
  define: { "process.env.AGENT_BUNDLED_VERSION": JSON.stringify(version) },
});

cpSync(join(root, "packaging/agent.config.example.json"), join(out, "agent.config.example.json"));
cpSync(
  join(root, "packaging/agent.config.zpl.example.json"),
  join(out, "agent.config.zpl.example.json"),
);
cpSync(join(root, "packaging/windows"), join(out, "windows"), { recursive: true });
cpSync(join(root, "packaging/linux"), join(out, "linux"), { recursive: true });
cpSync(join(root, "packaging/README.md"), join(out, "README.md"));

const sums = [];
const walk = (dir, rel = "") => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "SHA256SUMS") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
    else
      sums.push(`${createHash("sha256").update(readFileSync(p)).digest("hex")}  ${rel}${e.name}`);
  }
};
walk(out);
writeFileSync(join(out, "SHA256SUMS"), sums.sort().join("\n") + "\n");

const zip = join(root, "release", `${name}.zip`);
execFileSync("zip", ["-qr", zip, name], { cwd: join(root, "release") });
console.log(`Gerado: ${zip}`);
