import type { Pool } from "pg";

export type MasterKind = "machines" | "parts" | "shifts" | "users";

/** Persistência dos cadastros: um documento JSON por registro. */
export class PostgresMasterDataRepo {
  constructor(private pool: Pool) {}

  async loadAll(): Promise<Record<MasterKind, { id: string }[]>> {
    const out: Record<MasterKind, { id: string }[]> = {
      machines: [],
      parts: [],
      shifts: [],
      users: [],
    };
    const res = await this.pool.query("SELECT kind, data FROM master_data ORDER BY updated_at, id");
    for (const r of res.rows as { kind: MasterKind; data: { id: string } }[])
      out[r.kind].push(r.data);
    return out;
  }

  async save(kind: MasterKind, id: string, data: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO master_data (kind, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [kind, id, data],
    );
  }

  async delete(kind: MasterKind, id: string): Promise<void> {
    await this.pool.query("DELETE FROM master_data WHERE kind = $1 AND id = $2", [kind, id]);
  }
}
