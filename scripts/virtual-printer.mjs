// Impressora virtual ZPL (para testes sem a impressora física).
//   node scripts/virtual-printer.mjs [--port 9100] [--http 9101] [--mode ok|paper|ribbon|head|pause|mute|drop|slow]
// Escuta ZPL por TCP como uma impressora na porta 9100, responde ao comando de status (~HS), simula o tempo de
// impressão e mostra as etiquetas em http://localhost:9101 (pré-visualização APROXIMADA: as fontes reais da
// impressora diferem). Só para desenvolvimento; não substitui o teste com a Elgin L42 Pro Full.
import net from "node:net";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const TCP_PORT = Number(opt("port", "9100"));
const HTTP_PORT = Number(opt("http", "9101"));
const DPI = Number(opt("dpi", "203"));
let mode = opt("mode", "ok");
const MODES = ["ok", "paper", "ribbon", "head", "pause", "mute", "drop", "slow"];
const outDir = opt("out", join(process.cwd(), ".local", "virtual-printer"));
mkdirSync(outDir, { recursive: true });

const labels = []; // mais recente primeiro
let inBuffer = 0;
let counter = 0;

const log = (m) => console.log(`\x1b[35m[impressora virtual]\x1b[0m ${m}`);

/** Decodifica ^FH (_XX em UTF-8). */
function unescapeFh(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "_" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...Buffer.from(s[i], "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Interpreta o subconjunto de ZPL que o Print Agent gera e devolve a descrição da etiqueta. */
function parseZpl(zpl) {
  const info = { pw: 240, ll: 160, fields: [], qrs: [], cells: [], warnings: [] };
  for (const raw of zpl.split("^FS")) {
    const cmds = raw.split("^").filter(Boolean);
    let fo = null,
      font = null,
      bq = null,
      rot = "N",
      fd = null;
    for (const c of cmds) {
      if (c.startsWith("PW")) info.pw = Number(c.slice(2));
      else if (c.startsWith("LL")) info.ll = Number(c.slice(2));
      else if (c.startsWith("FO")) fo = c.slice(2).split(",").map(Number);
      else if (c.startsWith("A0N") || c.startsWith("A0R")) {
        font = c.slice(3).replace(/^,/, "").split(",").map(Number);
        rot = c[2];
      } else if (c.startsWith("BQN")) bq = c.slice(3).replace(/^,/, "").split(",").map(Number);
      else if (c.startsWith("FD")) fd = c.slice(2);
      else if (c.startsWith("FXCELL,")) {
        const [x, y, w, h] = c.slice(7).split(",").map(Number);
        info.cells.push({ x, y, w, h });
      }
    }
    if (fd === null || fo === null) continue;
    const text = unescapeFh(fd.replace(/^\n+|\n+$/g, ""));
    if (bq) info.qrs.push({ x: fo[0], y: fo[1], mag: bq[1] ?? 2, data: text.replace(/^MA,/, "") });
    else if (font) info.fields.push({ x: fo[0], y: fo[1], h: font[0], w: font[1], text, rot });
  }
  return info;
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toSvg(info) {
  const S = 4; // escala de exibição
  let body = "";
  const box = (f) =>
    f.rot === "R"
      ? { x: f.x, y: f.y, w: f.h, h: f.text.length * f.w }
      : { x: f.x, y: f.y, w: f.text.length * f.w, h: f.h };
  for (const f of info.fields)
    if (f.rot === "R")
      body += `<text transform="translate(${f.x * S},${f.y * S}) rotate(90)" x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${f.h * S * 0.95}" textLength="${f.text.length * f.w * S * 0.95}" lengthAdjust="spacingAndGlyphs">${esc(f.text)}</text>`;
    else
      body += `<text x="${f.x * S}" y="${(f.y + f.h * 0.82) * S}" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${f.h * S * 0.95}" textLength="${Math.min(f.text.length * f.w * S * 0.95, (info.pw - f.x) * S)}" lengthAdjust="spacingAndGlyphs">${esc(f.text)}</text>`;
  for (const f of info.fields) {
    const b = box(f);
    if (b.x + b.w > info.pw) info.warnings.push(`O texto "${f.text}" sai da etiqueta.`);
    if (b.y + b.h > info.ll) info.warnings.push(`O texto "${f.text}" passa da altura da etiqueta.`);
  }
  let qrInfo = "";
  for (const c of info.cells)
    body += `<rect x="${c.x * S}" y="${c.y * S}" width="${c.w * S}" height="${c.h * S}" fill="none" stroke="#c33" stroke-dasharray="6 4" stroke-width="1.5"/>`;
  for (const qr of info.qrs) {
    const q = QRCode.create(qr.data, { errorCorrectionLevel: "M" });
    const n = q.modules.size;
    const m = qr.mag;
    const px = n * m;
    qrInfo = `QR: ${n}x${n} módulos, ${m} ponto(s) por módulo = ${px} pontos (${((px / DPI) * 25.4).toFixed(1)} mm); módulo = ${((m / DPI) * 25.4).toFixed(2)} mm`;
    for (const f of info.fields) {
      const b = box(f);
      const overlapX = b.x < qr.x + px && b.x + b.w > qr.x;
      const overlapY = b.y < qr.y + px && b.y + b.h > qr.y;
      if (overlapX && overlapY) info.warnings.push(`O texto "${f.text}" invade o QR.`);
    }
    if (qr.x + px > info.pw || qr.y + px > info.ll)
      info.warnings.push("O QR ultrapassa a área da etiqueta.");
    for (const c of info.cells)
      if (qr.x >= c.x && qr.x < c.x + c.w && (qr.x + px > c.x + c.w || qr.y + px > c.y + c.h))
        info.warnings.push("O QR sai da célula da etiqueta.");
    if (m < 2) info.warnings.push("Módulo do QR com 1 ponto: dificilmente legível.");
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (q.modules.get(r, c))
          body += `<rect x="${(qr.x + c * m) * S}" y="${(qr.y + r * m) * S}" width="${m * S}" height="${m * S}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.pw * S}" height="${info.ll * S}" viewBox="0 0 ${info.pw * S} ${info.ll * S}"><rect width="100%" height="100%" fill="#fff" stroke="#999"/><g fill="#000">${body}</g></svg>`;
  return { svg, qrInfo };
}

function hs() {
  const paper = mode === "paper" ? 1 : 0;
  const pause = mode === "pause" ? 1 : 0;
  const head = mode === "head" ? 1 : 0;
  const ribbon = mode === "ribbon" ? 1 : 0;
  const f = String(inBuffer).padStart(3, "0");
  return `\x02030,${paper},${pause},${String(info0.ll).padStart(4, "0")},${f},0,0,0,000,0,0,0\x03\r\n\x02000,${head},${ribbon},1,2,0,0,${inBuffer ? "00000001" : "00000000"},${inBuffer ? "00000001" : "00000000"},0,000\x03\r\n\x020000,0\x03\r\n`;
}
const info0 = { ll: 160 };

const server = net.createServer((sock) => {
  let buf = "";
  sock.on("error", () => undefined);
  sock.on("data", (d) => {
    if (mode === "mute") return;
    buf += d.toString("utf8");
    for (;;) {
      const hsAt = buf.indexOf("~HS");
      const xa = buf.indexOf("^XA");
      const xz = buf.indexOf("^XZ");
      if (hsAt >= 0 && (xa < 0 || hsAt < xa)) {
        sock.write(hs(), "latin1");
        buf = buf.slice(0, hsAt) + buf.slice(hsAt + 3);
        continue;
      }
      if (xa >= 0 && xz > xa) {
        const zpl = buf.slice(xa, xz + 3);
        buf = buf.slice(xz + 3);
        if (mode === "drop") {
          log("modo drop: derrubando a conexão com a etiqueta recebida (resultado incerto)");
          sock.destroy();
          return;
        }
        if (mode !== "ok" && mode !== "slow") {
          log(`modo ${mode}: etiqueta recebida, mas não impressa`);
          inBuffer = 1;
          continue;
        }
        const info = parseZpl(zpl);
        info0.ll = info.ll;
        inBuffer = 1;
        const t = mode === "slow" ? 6000 : 700;
        setTimeout(() => {
          inBuffer = 0;
          const n = ++counter;
          const { svg, qrInfo } = toSvg(info);
          writeFileSync(join(outDir, `etiqueta-${String(n).padStart(4, "0")}.svg`), svg);
          writeFileSync(join(outDir, `etiqueta-${String(n).padStart(4, "0")}.zpl`), zpl);
          labels.unshift({ n, at: new Date(), svg, zpl, qrInfo, warnings: info.warnings });
          log(
            `etiqueta #${n} impressa. ${qrInfo}${info.warnings.length ? " AVISO: " + info.warnings.join(" ") : ""}`,
          );
        }, t);
        continue;
      }
      break;
    }
    if (buf.length > 100_000) buf = "";
  });
});
server.listen(TCP_PORT, () =>
  log(`ZPL na porta ${TCP_PORT} (modo ${mode}); etiquetas em http://localhost:${HTTP_PORT}`),
);

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/mode") {
      const m = u.searchParams.get("m");
      if (MODES.includes(m)) {
        mode = m;
        if (m === "ok") inBuffer = 0;
        log(`modo alterado para ${mode}`);
      }
      res.writeHead(302, { location: "/" }).end();
      return;
    }
    const cards = labels
      .slice(0, 30)
      .map(
        (l) =>
          `<div class="c"><b>Etiqueta #${l.n}</b> <small>${l.at.toLocaleTimeString("pt-BR")}</small><div class="s">${l.svg}</div><small>${esc(l.qrInfo)}</small>${l.warnings.map((w) => `<div class="w">${esc(w)}</div>`).join("")}<details><summary>ZPL</summary><pre>${esc(l.zpl)}</pre></details></div>`,
      )
      .join("");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Impressora virtual</title>
<style>body{font-family:system-ui,sans-serif;margin:20px;background:#f4f5f7}.c{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin:10px 0;display:inline-block;margin-right:12px;vertical-align:top}.s svg{width:480px;height:auto;border:1px solid #ccc;margin:6px 0}.w{color:#b00;font-size:13px}pre{font-size:11px;max-width:480px;white-space:pre-wrap}a{margin-right:8px}.m{margin:8px 0}</style>
<h2>Impressora virtual (ZPL) — modo: ${mode}</h2>
<div class="m">Simular: ${MODES.map((m) => `<a href="/mode?m=${m}">${m === mode ? "<b>" + m + "</b>" : m}</a>`).join("")}</div>
<small>ok = imprime · paper/ribbon/head/pause = erro da impressora · mute = não responde ao status · drop = derruba a conexão depois de receber · slow = demora 6 s. Pré-visualização aproximada.</small><br>
${cards || "<p>Nenhuma etiqueta ainda.</p>"}`);
  })
  .listen(HTTP_PORT);
