import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { DomainError, type DomainErrorCode } from "@doowon/domain";
import type { Request, Response } from "express";
import type { Runtime } from "./runtime.js";
import type { Session } from "./auth.js";

const STATUS: Record<DomainErrorCode, number> = {
  PRINTER_BUSY: 409,
  INVALID_QUANTITY: 400,
  IDEMPOTENCY_CONFLICT: 409,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  MACHINE_NOT_ALLOWED: 400,
  AGENT_INCOMPATIBLE: 409,
  AGENT_NOT_HEALTHY: 503,
  LEASE_INVALID: 409,
  UNKNOWN_OUTCOME_OPEN: 409,
  NOT_ELIGIBLE: 400,
  REASON_REQUIRED: 400,
  QR_DATA_INVALID: 422,
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? "";
    if (exception instanceof DomainError) {
      res.status(STATUS[exception.code]).json({
        code: exception.code,
        message: exception.message,
        correlationId,
        ...(exception.details ? { details: exception.details } : {}),
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === "string"
          ? body
          : ((body as { message?: string }).message ?? "Requisição inválida.");
      res
        .status(status)
        .json({ code: status === 401 ? "UNAUTHENTICATED" : "HTTP_ERROR", message, correlationId });
      return;
    }
    // Sem pilha de erro ao cliente; o identificador de correlação fica no registro.
    console.error(
      "erro inesperado",
      correlationId,
      exception instanceof Error ? exception.message : exception,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: "INTERNAL",
      message: "Ocorreu um erro. Informe o código ao administrador.",
      correlationId,
    });
  }
}

export function correlationOf(req: Request): string {
  const h = req.headers["x-correlation-id"];
  const id = Array.isArray(h) ? h[0] : h;
  const value = id && /^[\w-]{1,64}$/.test(id) ? id : crypto.randomUUID();
  req.headers["x-correlation-id"] = value;
  return value;
}

export function bearer(req: Request): string | undefined {
  const h = req.headers["authorization"];
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : undefined;
}

export function requireSession(rt: Runtime, req: Request, role?: "OPERATOR" | "ADMIN"): Session {
  const s = rt.auth.resolve(bearer(req));
  if (!s) throw new HttpException("Sua sessão expirou. Entre novamente para continuar.", 401);
  if (role && s.role !== role) throw new HttpException("Acesso não permitido.", 403);
  return s;
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
