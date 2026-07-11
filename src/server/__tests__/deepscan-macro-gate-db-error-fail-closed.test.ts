/**
 * deep-scan services CRITICAL regression (2026-07-06):
 * C11 macro gate — the ISM/RRP check must fail CLOSED on a DB error.
 *
 * The original bug: checkIsmRrpGate() swallowed its own DB read error and returned
 * "no gate" (fail-OPEN) with a silent logger.warn — so a crisis-window ES/NQ long was
 * allowed through the exact gate meant to catch it, and the paper-signal fail-closed
 * WRAPPER was structurally unreachable (the function never let the exception escape).
 *
 * This test exercises the REAL internal-swallow path (not the wrapper): it mocks the DB
 * so the ISM/RRP query throws, with a valid NON-crisis regime state, and asserts that an
 * index-future long is BLOCKED (blockNewLongs=true) rather than allowed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// db.select() throws → checkIsmRrpGate's query fails → must fail CLOSED.
// insert()/other calls are no-op chains so the audit write at the end never crashes the test.
vi.mock("../db/index.js", () => {
  const noopChain: Record<string, unknown> = {};
  for (const m of ["values", "set", "where", "from", "returning", "onConflictDoNothing", "limit"]) {
    noopChain[m] = () => noopChain;
  }
  (noopChain as { then: unknown }).then = (resolve: (v: unknown[]) => unknown) => resolve([]);
  return {
    db: {
      select: () => {
        throw new Error("simulated DB failure (ISM/RRP read)");
      },
      insert: () => noopChain,
      update: () => noopChain,
    },
  };
});

// Valid, NON-crisis regime so the crisis gate does NOT independently block — this isolates
// the ISM/RRP fail-closed path as the ONLY thing that can block the long.
vi.mock("../services/macro-regime-service.js", () => ({
  getLatestMacroRegimeState: async () => ({
    probCrisis: 0,
    crisisGateTriggered: false,
    fomcDayProximity: null,
    macroReleaseDay: false,
    dominantState: "normal",
  }),
}));

describe("C11 macro gate — ISM/RRP DB error fails CLOSED (deep-scan CRITICAL regression)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("index-future long is BLOCKED when the ISM/RRP DB read throws (not allowed through)", async () => {
    const { evaluateMacroGates } = await import("../services/macro-gate-service.js");
    const result = await evaluateMacroGates("MES", "long");
    // Fail-CLOSED: a DB error on a HARD safety gate must block, not allow.
    expect(result.blockNewLongs).toBe(true);
    expect(result.allowed).toBe(false);
  });

  it("MCL long (not an index future) is NOT blocked by the ISM/RRP gate — scope is index-only", async () => {
    const { evaluateMacroGates } = await import("../services/macro-gate-service.js");
    const result = await evaluateMacroGates("MCL", "long");
    // The ISM/RRP gate only applies to index-future longs; MCL must not be caught by it.
    expect(result.blockNewLongs).toBe(false);
  });
});
