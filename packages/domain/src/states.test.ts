import { describe, expect, it } from "vitest";
import { canTransition, deriveJobStatus } from "./states.js";
import type { AttemptState } from "./types.js";
import { canonicalJson, hashCanonical } from "./hash.js";

const a = (state: AttemptState, held = false) => ({
  state,
  holdReason: held ? ("JOB_HELD" as const) : null,
});

describe("transições", () => {
  it("permite o fluxo normal e proíbe saltos", () => {
    expect(canTransition("QUEUED", "CLAIMED")).toBe(true);
    expect(canTransition("CLAIMED", "SENDING")).toBe(true);
    expect(canTransition("SENDING", "PRINTED_CONFIRMED")).toBe(true);
    expect(canTransition("QUEUED", "SENDING")).toBe(false);
    expect(canTransition("QUEUED", "PRINTED_CONFIRMED")).toBe(false);
  });
  it("UNKNOWN_OUTCOME só sai para estados finais (resolução humana)", () => {
    expect(canTransition("UNKNOWN_OUTCOME", "QUEUED")).toBe(false);
    expect(canTransition("UNKNOWN_OUTCOME", "CLAIMED")).toBe(false);
    expect(canTransition("UNKNOWN_OUTCOME", "SENDING")).toBe(false);
    expect(canTransition("UNKNOWN_OUTCOME", "PRINTED_CONFIRMED")).toBe(true);
    expect(canTransition("UNKNOWN_OUTCOME", "FAILED")).toBe(true);
  });
  it("estados terminais não saem", () => {
    for (const t of ["PRINTED_CONFIRMED", "FAILED", "CANCELLED"] as const)
      expect(canTransition(t, "QUEUED")).toBe(false);
  });
  it("SENDING não volta a QUEUED nem a CLAIMED (nunca reenvia sozinho)", () => {
    expect(canTransition("SENDING", "QUEUED")).toBe(false);
    expect(canTransition("SENDING", "CLAIMED")).toBe(false);
  });
});

describe("estado derivado do PRINT_JOB (§3.1)", () => {
  it("REQUIRES_REVIEW com alguma UNKNOWN_OUTCOME", () => {
    expect(deriveJobStatus([a("PRINTED_CONFIRMED"), a("UNKNOWN_OUTCOME"), a("QUEUED", true)])).toBe(
      "REQUIRES_REVIEW",
    );
  });
  it("AWAITING_DECISION com falha e restante retido", () => {
    expect(deriveJobStatus([a("FAILED"), a("QUEUED", true)])).toBe("AWAITING_DECISION");
  });
  it("IN_PROGRESS com tentativa não terminal e não retida", () => {
    expect(deriveJobStatus([a("PRINTED_CONFIRMED"), a("SENDING"), a("QUEUED")])).toBe(
      "IN_PROGRESS",
    );
  });
  it("COMPLETED, PARTIALLY_COMPLETED, FAILED e CANCELLED", () => {
    expect(deriveJobStatus([a("PRINTED_CONFIRMED"), a("PRINTED_CONFIRMED")])).toBe("COMPLETED");
    expect(deriveJobStatus([a("PRINTED_CONFIRMED"), a("FAILED")])).toBe("PARTIALLY_COMPLETED");
    expect(deriveJobStatus([a("PRINTED_CONFIRMED"), a("CANCELLED")])).toBe("PARTIALLY_COMPLETED");
    expect(deriveJobStatus([a("FAILED"), a("CANCELLED")])).toBe("FAILED");
    expect(deriveJobStatus([a("CANCELLED"), a("CANCELLED")])).toBe("CANCELLED");
  });
});

describe("hash canônico", () => {
  it("independe da ordem das chaves", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(hashCanonical({ x: 1, y: 2 })).toBe(hashCanonical({ y: 2, x: 1 }));
  });
  it("muda quando o conteúdo muda", () => {
    expect(hashCanonical({ x: 1 })).not.toBe(hashCanonical({ x: 2 }));
  });
});
