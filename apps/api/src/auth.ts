import { randomBytes } from "node:crypto";
import { DomainError, type Actor, type PrintService, type Role } from "@doowon/domain";
import { verifyPassword, type MasterData } from "./master-data.js";

export interface Session {
  token: string;
  userId: string;
  role: Role;
  displayName: string;
  /** Posto da sessão (somente OPERATOR). Provisório: D-021/D-038 em aberto. */
  stationId: string | null;
  lastSeen: number;
  /** Instante do login (para o logout forçado em horários fixos). */
  createdAt: number;
}

/** Parâmetros PROPOSED — PENDING DOOWON VALIDATION (política de sessão: D-038/D-005). */
export interface AuthConfig {
  idleTimeoutMs: number;
  maxFailures: number;
  lockMs: number;
  /**
   * Horários (HH:MM, no fuso do sistema) em que todas as sessões são encerradas e o login é exigido de novo.
   * Resposta da Doowon: 15:30 e 00:30. Fuso: D-013 em aberto (valor provisório).
   */
  forcedLogoutTimes: string[];
  timezone: string;
}
export const DEFAULT_AUTH: AuthConfig = {
  idleTimeoutMs: 30 * 60_000,
  maxFailures: 5,
  lockMs: 5 * 60_000,
  forcedLogoutTimes: ["15:30", "00:30"],
  timezone: "America/Sao_Paulo",
};

/** Instante (epoch ms) do horário HH:MM mais recente que já passou, no fuso informado. */
export function lastOccurrence(now: number, hhmm: string, timezone: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Horário inválido: ${hhmm}`);
  const target = Number(m[1]) * 3600 + Number(m[2]) * 60;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Alguns ambientes devolvem "24" para a meia-noite.
  const nowSec = (get("hour") % 24) * 3600 + get("minute") * 60 + get("second");
  const delta = (nowSec - target + 86_400) % 86_400;
  return now - (delta * 1000 + (now % 1000));
}

export class AuthService {
  private sessions = new Map<string, Session>();
  private failures = new Map<string, { n: number; lockedUntil: number }>();
  private cfg: AuthConfig;

  constructor(
    private md: MasterData,
    private svc: PrintService,
    private clock: () => number,
    cfg: Partial<AuthConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_AUTH, ...cfg };
  }

  async login(
    username: string,
    password: string,
    stationId: string | null,
    correlationId: string,
  ): Promise<Session> {
    const key = username.trim().toLowerCase();
    const f = this.failures.get(key);
    if (f && f.lockedUntil > this.clock())
      throw new DomainError(
        "FORBIDDEN",
        "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      );
    const user = [...this.md.users.values()].find((u) => u.username === key);
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok || !user.active) {
      const n = (f?.n ?? 0) + 1;
      this.failures.set(key, {
        n,
        lockedUntil: n >= this.cfg.maxFailures ? this.clock() + this.cfg.lockMs : 0,
      });
      await this.svc.recordAudit({
        action: "LOGIN_FAILED",
        actorId: user?.id ?? null,
        stationId,
        targetType: "SYSTEM",
        targetId: null,
        result: "REJECTED",
        correlationId,
      });
      throw new DomainError("FORBIDDEN", "Usuário ou senha inválidos.");
    }
    this.failures.delete(key);
    if (user.role === "OPERATOR") {
      if (!stationId || !this.md.stations.has(stationId))
        throw new DomainError("NOT_ELIGIBLE", "Posto não configurado neste computador.");
    }
    const session: Session = {
      token: randomBytes(32).toString("hex"),
      userId: user.id,
      role: user.role,
      displayName: user.displayName,
      stationId: user.role === "OPERATOR" ? stationId : null,
      lastSeen: this.clock(),
      createdAt: this.clock(),
    };
    this.sessions.set(session.token, session);
    await this.svc.recordAudit({
      action: "LOGIN_OK",
      actorId: user.id,
      stationId: session.stationId,
      targetType: "SYSTEM",
      targetId: null,
      correlationId,
    });
    return session;
  }

  async logout(token: string, correlationId: string): Promise<void> {
    const s = this.sessions.get(token);
    if (!s) return;
    this.sessions.delete(token);
    await this.svc.recordAudit({
      action: "LOGOUT",
      actorId: s.userId,
      stationId: s.stationId,
      targetType: "SYSTEM",
      targetId: null,
      correlationId,
    });
  }

  /** Valida o token e renova a inatividade. Retorna undefined se inválido ou expirado. */
  resolve(token: string | undefined): Session | undefined {
    if (!token) return undefined;
    const s = this.sessions.get(token);
    if (!s) return undefined;
    if (this.clock() - s.lastSeen > this.cfg.idleTimeoutMs) {
      this.sessions.delete(token);
      return undefined;
    }
    if (this.forcedLogoutPassed(s.createdAt)) {
      this.sessions.delete(token);
      return undefined;
    }
    const user = this.md.users.get(s.userId);
    if (!user || !user.active) {
      this.sessions.delete(token);
      return undefined;
    }
    s.lastSeen = this.clock();
    return s;
  }

  /** Verdadeiro se algum horário de logout forçado ocorreu depois do login da sessão. */
  private forcedLogoutPassed(createdAt: number): boolean {
    const now = this.clock();
    return this.cfg.forcedLogoutTimes.some(
      (t) => lastOccurrence(now, t, this.cfg.timezone) > createdAt,
    );
  }

  actorOf(s: Session): Actor {
    return { id: s.userId, role: s.role, displayName: s.displayName };
  }
}
