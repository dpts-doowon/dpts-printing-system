import { randomUUID } from "node:crypto";
import {
  InMemoryPrintStore,
  PrintService,
  type PrintServiceConfig,
  type PrintStore,
} from "@doowon/domain";
import { AuthService, type AuthConfig } from "./auth.js";
import { MasterData, hashPassword, type MasterDataRepo } from "./master-data.js";

export const RUNTIME = Symbol("RUNTIME");

export interface Runtime {
  svc: PrintService;
  md: MasterData;
  auth: AuthService;
  clock: () => number;
  newId: () => string;
  timezone: string;
  heartbeatMaxAgeMs: number;
}

export interface RuntimeOptions {
  clock?: () => number;
  newId?: () => string;
  timezone?: string;
  service?: Partial<PrintServiceConfig>;
  /** Persistência (padrão: memória). */
  store?: PrintStore;
  masterDataRepo?: MasterDataRepo;
  auth?: Partial<AuthConfig>;
}

export function createRuntime(opts: RuntimeOptions = {}): Runtime {
  const clock = opts.clock ?? Date.now;
  const newId = opts.newId ?? randomUUID;
  const svc = new PrintService({
    store: opts.store ?? new InMemoryPrintStore(),
    clock,
    newId,
    ...(opts.service ? { config: opts.service } : {}),
  });
  const md = new MasterData(svc, newId, opts.masterDataRepo);
  // D-013 (fuso horário) em aberto: valor provisório, compartilhado com o logout forçado.
  const timezone = opts.timezone ?? "America/Sao_Paulo";
  const auth = new AuthService(md, svc, clock, { timezone, ...opts.auth });
  return {
    svc,
    md,
    auth,
    clock,
    newId,
    timezone,
    heartbeatMaxAgeMs: opts.service?.heartbeatMaxAgeMs ?? 30_000,
  };
}

export interface SeedOptions {
  adminPassword: string;
  operatorPassword: string;
  agentTokens?: Record<string, string>;
}

/**
 * Dados de partida para DESENVOLVIMENTO LOCAL (não são dados da Doowon).
 * Turnos, peças e vínculos são provisórios (D-013, D-024, D-025, D-040).
 */
export async function seedDevData(rt: Runtime, o: SeedOptions): Promise<void> {
  const { md } = rt;
  // Cadastros já existentes (carregados do banco) não são sobrescritos pelos dados de partida.
  const hasRecords = md.users.size > 0;
  md.printers.set("pr-1", { id: "pr-1", name: "Impressora 01" });
  md.printers.set("pr-2", { id: "pr-2", name: "Impressora 02" });
  md.stations.set("st-1", { id: "st-1", name: "Posto 01", printerId: "pr-1" });
  md.stations.set("st-2", { id: "st-2", name: "Posto 02", printerId: "pr-2" });
  md.stationMachines.set("st-1", ["m-1"]);
  md.stationMachines.set("st-2", ["m-2"]);
  if (!hasRecords) await seedRecords(md, o);
  for (const [token, stationId] of Object.entries(o.agentTokens ?? {}))
    md.agentTokens.set(token, stationId);
  if (!hasRecords) await md.persistAll();
}

async function seedRecords(md: MasterData, o: SeedOptions): Promise<void> {
  md.machines.set("m-1", { id: "m-1", code: "M01", name: "Máquina 01", active: true });
  md.machines.set("m-2", { id: "m-2", code: "M02", name: "Máquina 02", active: true });
  md.shifts.set("sh-1", {
    id: "sh-1",
    name: "Turno 1",
    start: "06:00",
    end: "14:00",
    active: true,
  });
  md.shifts.set("sh-2", {
    id: "sh-2",
    name: "Turno 2",
    start: "14:00",
    end: "22:00",
    active: true,
  });
  md.shifts.set("sh-3", {
    id: "sh-3",
    name: "Turno 3",
    start: "22:00",
    end: "06:00",
    active: true,
  });
  md.parts.set("p-1", { id: "p-1", description: "AB123", partNumber: "PN-0001", active: true });
  md.parts.set("p-2", { id: "p-2", description: "CD456", partNumber: "PN-0002", active: true });
  // Modelos informados pela Doowon (relato de 2026-11-02): ALC Code + Part Number. A descrição ainda não foi
  // informada; até lá o texto grande da etiqueta usa o ALC.
  for (const [alc, pn] of [
    ["AG10", "29135-BP000"],
    ["AG11", "29135-BP300"],
    ["AG12", "29135-BP400"],
    ["AG02", "29135-BX500"],
    ["AG03", "29135-BX700"],
    ["AG04", "29135-BX900"],
  ] as const)
    md.parts.set(`p-${alc}`, {
      id: `p-${alc}`,
      description: alc,
      alcCode: alc,
      partNumber: pn,
      active: true,
    });
  const mk = async (
    id: string,
    username: string,
    displayName: string,
    role: "ADMIN" | "OPERATOR",
    pw: string,
  ) =>
    md.users.set(id, {
      id,
      username,
      displayName,
      role,
      passwordHash: await hashPassword(pw),
      active: true,
    });
  await mk("u-admin", "admin", "Administrador", "ADMIN", o.adminPassword);
  await mk("u-op1", "operador1", "Operador 1", "OPERATOR", o.operatorPassword);
  await mk("u-op2", "operador2", "Operador 2", "OPERATOR", o.operatorPassword);
}
