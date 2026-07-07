/**
 * deep-scan services/governor CRITICAL regression (2026-07-06):
 * C11 macro gate — a NULL regime state (fresh deploy before the classifier cron ran, or a cold DB error) must
 * NOT silently allow an index-future long through the crisis gate.
 *
 * The prior fail-closed fix only covered checkIsmRrpGate()'s DB error; the earlier-returning null-regime-state
 * branch in evaluateMacroGates() still returned allowed=true with zero observability. This test exercises that
 * exact path: getLatestMacroRegimeState resolves to null → an index-future long must be BLOCKED (fail closed),
 * while MCL and shorts proceed (the crisis gate does not apply to them).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../db/index.js", () => {
  const noopChain: Record<string, unknown> = {};
  for (const m of ["values", "set", "where", "from", "returning", "onConflictDoNothing", "limit"]) {
    noopChain[m] = () => noopChain;
  }
  (noopChain as { then: unknown }).then = (resolve: (v: unknown[]) => unknown) => resolve([]);
  return { db: { select: () => noopChain, insert: () => noopChain, update: () => noopChain } };
});

// The crux: regime state is NULL (no rows yet / cold cache).
vi.mock("../services/macro-regime-service.js", () => ({
  getLatestMacroRegimeState: async () => null,
}));

describe("C11 macro gate — null regime state fails CLOSED for index longs (deep-scan CRITICAL regression)", () => {
  it("index-future long (MES) is BLOCKED when regime state is null (not silently allowed)", async () => {
    const { evaluateMacroGates } = await import("../services/macro-gate-service.js");
    const result = await evaluateMacroGates("MES", "long");
    expect(result.blockNewLongs).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.severity).toBe("critical");
  });

  it("MCL long (non-index) is allowed when regime state is null — crisis gate does not apply", async () => {
    const { evaluateMacroGates } = await import("../services/macro-gate-service.js");
    const result = await evaluateMacroGates("MCL", "long");
    expect(result.blockNewLongs).toBe(false);
    expect(result.allowed).toBe(true);
  });

  it("index-future SHORT is allowed when regime state is null — crisis gate targets longs", async () => {
    const { evaluateMacroGates } = await import("../services/macro-gate-service.js");
    const result = await evaluateMacroGates("MES", "short");
    expect(result.blockNewLongs).toBe(false);
    expect(result.allowed).toBe(true);
  });
});
