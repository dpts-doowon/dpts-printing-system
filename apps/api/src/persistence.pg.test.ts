import { describe, expect, it } from "vitest";
import {
  PostgresMasterDataRepo,
  PostgresPrintStore,
  createPool,
  migrate,
} from "@doowon/store-postgres";
import { createRuntime, seedDevData } from "./runtime.js";

const url = process.env["TEST_DATABASE_URL_API"];
const d = url ? describe : describe.skip;

d("persistência PostgreSQL da API (reinício do processo)", () => {
  const boot = async () => {
    const pool = createPool(url!);
    const rt = createRuntime({
      store: new PostgresPrintStore(pool),
      masterDataRepo: new PostgresMasterDataRepo(pool),
    });
    await rt.md.load();
    await seedDevData(rt, {
      adminPassword: "admin-pass-123",
      operatorPassword: "operator-pass-123",
      agentTokens: { tok1: "st-1" },
    });
    return { rt, pool };
  };

  it("cadastros, impressões e auditoria sobrevivem ao reinício, sem duplicar os dados de partida", async () => {
    const setup = createPool(url!);
    await setup.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(setup);
    await setup.end();

    const a = await boot();
    const part = await a.rt.md.create("parts", "u-admin", {
      description: "ZZ999",
      partNumber: "PN-9999",
    });
    await a.rt.md.setActive("parts", "u-admin", "p-2", false);
    await a.rt.md.update("machines", "u-admin", "m-1", { name: "Prensa 1" });
    await a.pool.end();

    const b = await boot();
    expect(b.rt.md.parts.get(part.id)?.partNumber).toBe("PN-9999");
    expect(b.rt.md.parts.get("p-2")?.active).toBe(false);
    expect(b.rt.md.machines.get("m-1")?.name).toBe("Prensa 1");
    expect(b.rt.md.users.size).toBe(3);
    expect(b.rt.md.parts.size).toBe(9);
    expect((await b.rt.svc.listAudit()).some((e) => e.action === "MASTER_DATA_UPDATED")).toBe(true);

    await b.rt.md.remove("parts", "u-admin", part.id);
    await b.pool.end();
    const c = await boot();
    expect(c.rt.md.parts.has(part.id)).toBe(false);
    await c.pool.end();
  });
});
