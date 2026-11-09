import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { DomainError, type PrintService, type Role } from "@doowon/domain";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltHex, keyHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export interface Station {
  id: string;
  name: string;
  printerId: string;
}
export interface Printer {
  id: string;
  name: string;
}
export interface Machine {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
export interface Part {
  id: string;
  description: string;
  partNumber: string;
  /** ALC Code (D-042): cadastrado pelo admin; quando a descrição não é informada, o texto grande da etiqueta usa o ALC. */
  alcCode?: string;
  active: boolean;
}
export interface Shift {
  id: string;
  name: string;
  start: string;
  end: string;
  active: boolean;
}
export interface UserRec {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  active: boolean;
}

/** REQ-011: descrição da peça = 2 letras + 3 números. Regra de validação formal: D-024 (OPEN). */
export const PART_DESCRIPTION_PATTERN = /^[A-Z]{2}\d{3}$/;
export const ALC_CODE_PATTERN = /^[A-Z0-9]{2,10}$/;

type Kind = "machines" | "parts" | "shifts" | "users";
const KINDS: Kind[] = ["machines", "parts", "shifts", "users"];

/** Persistência opcional dos cadastros (PostgreSQL). Sem ela, os dados ficam só em memória. */
export interface MasterDataRepo {
  loadAll(): Promise<Record<Kind, { id: string }[]>>;
  save(kind: Kind, id: string, data: unknown): Promise<void>;
  delete(kind: Kind, id: string): Promise<void>;
}

/**
 * Dados mestres em memória (desenvolvimento local). A persistência PostgreSQL implementará o mesmo contrato.
 * Registros com histórico são inativados, nunca excluídos (E-014).
 */
export class MasterData {
  stations = new Map<string, Station>();
  printers = new Map<string, Printer>();
  /** Máquinas permitidas por posto (D-040: premissa de vínculo fixo 1:1). */
  stationMachines = new Map<string, string[]>();
  machines = new Map<string, Machine>();
  parts = new Map<string, Part>();
  shifts = new Map<string, Shift>();
  users = new Map<string, UserRec>();
  /** Token do agente -> posto (credencial por estação; inscrição em duas etapas é uma fatia futura, D-027). */
  agentTokens = new Map<string, string>();

  constructor(
    private svc: PrintService,
    private newId: () => string,
    private repo?: MasterDataRepo,
  ) {}

  /** Carrega os cadastros persistidos (no início do processo). */
  async load(): Promise<void> {
    if (!this.repo) return;
    const all = await this.repo.loadAll();
    for (const kind of KINDS)
      for (const rec of all[kind])
        this.store(kind).set(rec.id, rec as { id: string; active: boolean });
  }

  /** Grava todos os cadastros atuais (usado após a carga inicial de partida). */
  async persistAll(): Promise<void> {
    if (!this.repo) return;
    for (const kind of KINDS)
      for (const [id, rec] of this.store(kind)) await this.repo.save(kind, id, rec);
  }

  /** Espelha no banco o estado atual do registro (gravado) ou a sua ausência (excluído). */
  private async sync(kind: Kind, id: string): Promise<void> {
    if (!this.repo) return;
    const rec = this.store(kind).get(id);
    if (rec) await this.repo.save(kind, id, rec);
    else await this.repo.delete(kind, id);
  }

  private async audit(action: string, actorId: string, kind: Kind, id: string): Promise<void> {
    await this.sync(kind, id);
    await this.svc.recordAudit({
      action,
      actorId,
      stationId: null,
      targetType: "SYSTEM",
      targetId: `${kind}:${id}`,
      correlationId: `md-${id}`,
    });
  }

  private store(kind: Kind): Map<string, { id: string; active: boolean }> {
    return this[kind] as unknown as Map<string, { id: string; active: boolean }>;
  }

  async create(
    kind: "machines",
    actor: string,
    v: Omit<Machine, "id" | "active">,
  ): Promise<Machine>;
  async create(kind: "parts", actor: string, v: Omit<Part, "id" | "active">): Promise<Part>;
  async create(kind: "shifts", actor: string, v: Omit<Shift, "id" | "active">): Promise<Shift>;
  async create(
    kind: "users",
    actor: string,
    v: Omit<UserRec, "id" | "active" | "passwordHash"> & { password: string },
  ): Promise<UserRec>;
  async create(kind: Kind, actor: string, v: Record<string, unknown>): Promise<unknown> {
    const id = this.newId();
    let rec: { id: string; active: boolean };
    if (kind === "parts") {
      const alcCode = String(v["alcCode"] ?? "")
        .trim()
        .toUpperCase();
      if (alcCode !== "" && !ALC_CODE_PATTERN.test(alcCode))
        throw new DomainError(
          "NOT_ELIGIBLE",
          "O ALC Code deve ter de 2 a 10 letras ou números (ex.: AG10).",
        );
      // Sem descrição, o texto grande da etiqueta é o ALC.
      const description =
        String(v["description"] ?? "")
          .trim()
          .toUpperCase() || alcCode;
      const partNumber = String(v["partNumber"] ?? "").trim();
      if (alcCode === "" || String(v["description"] ?? "").trim() !== "")
        if (!PART_DESCRIPTION_PATTERN.test(description))
          throw new DomainError(
            "NOT_ELIGIBLE",
            "A descrição da peça deve ter 2 letras e 3 números (ex.: AB123).",
          );
      if (partNumber === "") throw new DomainError("NOT_ELIGIBLE", "Informe o Part Number.");
      if ([...this.parts.values()].some((p) => p.partNumber === partNumber))
        throw new DomainError("NOT_ELIGIBLE", "Já existe uma peça com este Part Number.");
      rec = {
        id,
        description,
        partNumber,
        ...(alcCode !== "" ? { alcCode } : {}),
        active: true,
      } as Part;
    } else if (kind === "machines") {
      const code = String(v["code"] ?? "").trim();
      if (code === "") throw new DomainError("NOT_ELIGIBLE", "Informe o código da máquina.");
      if ([...this.machines.values()].some((m) => m.code === code))
        throw new DomainError("NOT_ELIGIBLE", "Já existe uma máquina com este código.");
      rec = { id, code, name: String(v["name"] ?? code), active: true } as Machine;
    } else if (kind === "shifts") {
      const re = /^([01]\d|2[0-3]):[0-5]\d$/;
      const start = String(v["start"] ?? "");
      const end = String(v["end"] ?? "");
      if (!re.test(start) || !re.test(end))
        throw new DomainError("NOT_ELIGIBLE", "Horários devem estar no formato HH:MM.");
      rec = { id, name: String(v["name"] ?? "").trim(), start, end, active: true } as Shift;
      if ((rec as Shift).name === "")
        throw new DomainError("NOT_ELIGIBLE", "Informe o nome do turno.");
    } else {
      const username = String(v["username"] ?? "")
        .trim()
        .toLowerCase();
      const password = String(v["password"] ?? "");
      if (username === "" || password.length < 8)
        throw new DomainError(
          "NOT_ELIGIBLE",
          "Informe o usuário e uma senha com pelo menos 8 caracteres.",
        );
      if ([...this.users.values()].some((u) => u.username === username))
        throw new DomainError("NOT_ELIGIBLE", "Já existe um usuário com este nome.");
      rec = {
        id,
        username,
        displayName: String(v["displayName"] ?? username),
        role: v["role"] === "ADMIN" ? "ADMIN" : "OPERATOR",
        passwordHash: await hashPassword(password),
        active: true,
      } as UserRec;
    }
    this.store(kind).set(id, rec);
    await this.audit("MASTER_DATA_CREATED", actor, kind, id);
    return rec;
  }

  /** Atualiza campos de um cadastro. Etiquetas já emitidas não mudam (snapshot por valor). */
  async update(
    kind: Kind,
    actor: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<unknown> {
    const rec = this.store(kind).get(id) as Record<string, unknown> | undefined;
    if (!rec) throw new DomainError("NOT_FOUND", "Cadastro não encontrado.");
    const next = { ...rec };
    if (kind === "parts") {
      if (patch["description"] !== undefined) {
        const d = String(patch["description"]).trim().toUpperCase();
        if (!PART_DESCRIPTION_PATTERN.test(d))
          throw new DomainError(
            "NOT_ELIGIBLE",
            "A descrição da peça deve ter 2 letras e 3 números (ex.: AB123).",
          );
        next["description"] = d;
      }
      if (patch["alcCode"] !== undefined) {
        const alc = String(patch["alcCode"]).trim().toUpperCase();
        if (alc !== "" && !ALC_CODE_PATTERN.test(alc))
          throw new DomainError(
            "NOT_ELIGIBLE",
            "O ALC Code deve ter de 2 a 10 letras ou números (ex.: AG10).",
          );
        if (alc !== "") next["alcCode"] = alc;
      }
      if (patch["partNumber"] !== undefined) {
        const pn = String(patch["partNumber"]).trim();
        if (pn === "") throw new DomainError("NOT_ELIGIBLE", "Informe o Part Number.");
        if ([...this.parts.values()].some((x) => x.id !== id && x.partNumber === pn))
          throw new DomainError("NOT_ELIGIBLE", "Já existe uma peça com este Part Number.");
        next["partNumber"] = pn;
      }
    } else if (kind === "machines") {
      if (patch["code"] !== undefined) {
        const code = String(patch["code"]).trim();
        if (code === "") throw new DomainError("NOT_ELIGIBLE", "Informe o código da máquina.");
        if ([...this.machines.values()].some((x) => x.id !== id && x.code === code))
          throw new DomainError("NOT_ELIGIBLE", "Já existe uma máquina com este código.");
        next["code"] = code;
      }
      if (patch["name"] !== undefined) next["name"] = String(patch["name"]);
    } else if (kind === "shifts") {
      const re = /^([01]\d|2[0-3]):[0-5]\d$/;
      for (const f of ["start", "end"] as const)
        if (patch[f] !== undefined) {
          if (!re.test(String(patch[f])))
            throw new DomainError("NOT_ELIGIBLE", "Horários devem estar no formato HH:MM.");
          next[f] = String(patch[f]);
        }
      if (patch["name"] !== undefined && String(patch["name"]).trim() !== "")
        next["name"] = String(patch["name"]).trim();
    } else {
      if (patch["displayName"] !== undefined && String(patch["displayName"]).trim() !== "")
        next["displayName"] = String(patch["displayName"]).trim();
      if (patch["password"] !== undefined && String(patch["password"]) !== "") {
        if (String(patch["password"]).length < 8)
          throw new DomainError("NOT_ELIGIBLE", "A senha deve ter pelo menos 8 caracteres.");
        next["passwordHash"] = await hashPassword(String(patch["password"]));
      }
    }
    this.store(kind).set(id, next as { id: string; active: boolean });
    await this.audit("MASTER_DATA_UPDATED", actor, kind, id);
    return next;
  }

  async setActive(kind: Kind, actor: string, id: string, active: boolean): Promise<void> {
    const rec = this.store(kind).get(id);
    if (!rec) throw new DomainError("NOT_FOUND", "Cadastro não encontrado.");
    rec.active = active;
    await this.audit(
      active ? "MASTER_DATA_REACTIVATED" : "MASTER_DATA_INACTIVATED",
      actor,
      kind,
      id,
    );
  }

  /** Exclusão física só para registros sem histórico (E-014); caso contrário, inativar. */
  async remove(kind: Kind, actor: string, id: string): Promise<void> {
    if (!this.store(kind).has(id)) throw new DomainError("NOT_FOUND", "Cadastro não encontrado.");
    if (await this.hasHistory(kind, id))
      throw new DomainError(
        "NOT_ELIGIBLE",
        "Este cadastro tem histórico e não pode ser excluído. Inative-o.",
      );
    this.store(kind).delete(id);
    await this.audit("MASTER_DATA_DELETED", actor, kind, id);
  }

  private async hasHistory(kind: Kind, id: string): Promise<boolean> {
    const read = this.svc.reader;
    for (const job of await read.listJobs()) {
      for (const l of await read.listLabelsByJob(job.id)) {
        const s = l.snapshot;
        if (kind === "parts" && s.part.id === id) return true;
        if (kind === "machines" && s.machine.id === id) return true;
        if (kind === "shifts" && s.shift.id === id) return true;
        if (kind === "users" && s.operator.id === id) return true;
      }
      if (kind === "users" && job.operatorId === id) return true;
    }
    return false;
  }

  /** Turno vigente no fuso informado, com virada noturna (D-025/D-013 em aberto: valores provisórios). */
  currentShift(now: number, timezone: string): Shift | undefined {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(now));
    const hhmm = parts.replace("24:", "00:");
    for (const s of this.shifts.values()) {
      if (!s.active) continue;
      const inRange =
        s.start <= s.end ? hhmm >= s.start && hhmm < s.end : hhmm >= s.start || hhmm < s.end;
      if (inRange) return s;
    }
    return undefined;
  }
}
