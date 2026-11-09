import { afterAll, beforeEach } from "vitest";
import { useStoreFactory } from "../../domain/src/testkit.js";
import { PostgresPrintStore, createPool, migrate } from "../src/index.js";

const url = process.env["TEST_DATABASE_URL"];
export const pool = url ? createPool(url) : undefined;

if (pool) {
  useStoreFactory(() => new PostgresPrintStore(pool));
  beforeEach(async () => {
    // Esquema limpo a cada teste (a tabela de auditoria é append-only e não aceita TRUNCATE).
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
}
