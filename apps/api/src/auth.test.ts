import { describe, expect, it } from "vitest";
import { lastOccurrence } from "./auth.js";

const TZ = "America/Sao_Paulo"; // UTC-3, sem horário de verão atualmente

describe("lastOccurrence (logout forçado)", () => {
  it("devolve o horário de hoje quando já passou", () => {
    const now = Date.parse("2026-10-21T19:00:00Z"); // 16:00 local
    expect(lastOccurrence(now, "15:30", TZ)).toBe(Date.parse("2026-10-21T18:30:00Z"));
  });
  it("devolve o de ontem quando ainda não chegou hoje", () => {
    const now = Date.parse("2026-10-21T17:00:00Z"); // 14:00 local
    expect(lastOccurrence(now, "15:30", TZ)).toBe(Date.parse("2026-10-20T18:30:00Z"));
  });
  it("trata a meia-noite (00:30)", () => {
    const now = Date.parse("2026-10-22T03:40:00Z"); // 00:40 local
    expect(lastOccurrence(now, "00:30", TZ)).toBe(Date.parse("2026-10-22T03:30:00Z"));
  });
  it("rejeita horário inválido", () => {
    expect(() => lastOccurrence(0, "25h", TZ)).toThrow();
  });
});
