// Verificação rápida do ambiente local (com `pnpm dev` em execução): login, impressão de 1 etiqueta e histórico.
const API = process.env.API_URL ?? "http://localhost:3001";
const call = async (method, path, token, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data?.message ?? ""}`);
  return data;
};
const ok = (m) => console.log(`\x1b[32m✔\x1b[0m ${m}`);
try {
  await call("GET", "/health");
  ok("API no ar");
  const op = (
    await call("POST", "/auth/login", null, {
      username: "operador1",
      password: "operator-pass-123",
      stationId: "st-1",
    })
  ).token;
  ok("login do operador");
  const ctx = await call("GET", "/operator/context", op);
  if (ctx.printer.status !== "READY")
    throw new Error(
      `impressora não está pronta (${ctx.printer.status}); o Print Agent está em execução?`,
    );
  ok("Print Agent conectado, impressora pronta");
  const job = await call("POST", "/operator/print-jobs", op, {
    partId: ctx.parts[0].id,
    machineId: ctx.machines[0].id,
    quantity: 1,
    idempotencyKey: crypto.randomUUID(),
  });
  for (let i = 0; i < 40; i++) {
    const j = await call("GET", `/operator/print-jobs/${job.printJobId}`, op);
    if (j.status === "COMPLETED") {
      ok("etiqueta impressa e confirmada (impressora simulada)");
      const adm = (
        await call("POST", "/auth/login", null, {
          username: "admin",
          password: "admin-pass-123",
          stationId: "st-1",
        })
      ).token;
      const h = await call("GET", "/admin/history?limit=1", adm);
      ok(`histórico consultado (${h.total} etiqueta(s) no total)`);
      console.log("\nTudo certo.");
      process.exit(0);
    }
    if (j.status !== "IN_PROGRESS") throw new Error(`situação inesperada: ${j.status}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("a impressão não terminou a tempo");
} catch (e) {
  console.error(`\x1b[31m✘\x1b[0m ${e.message}`);
  process.exit(1);
}
