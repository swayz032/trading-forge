/**
 * Correlated Position Guard — Tier 5.3.1 (W5b)
 *
 * Tests for:
 *   1. MNQ + try MES → BLOCKED (correlation 0.95 > threshold 0.70)
 *   2. MNQ + try MCL → ALLOWED (correlation 0.18 < threshold 0.70)
 *   3. Sequential: close MNQ, then enter MES → ALLOWED (empty open positions)
 *   4. Empty open_positions → guard NEVER blocks (no false positive on first trade)
 *   5. Symmetry: MNQ→MES and MES→MNQ produce identical decisions
 *   6. Unknown pair → defaults to 0.0 (ALLOWED), warning log emitted
 *   7. pairKey() — canonical sorting is symmetric
 *   8. Same symbol as open position → not a correlation block
 *   9. Custom threshold via matrix override
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused"; });

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
// Prevent fs.readFileSync from hitting the real YAML during tests
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => { throw new Error("mocked fs"); }),
}));

import {
  checkCorrelatedPositionGuard,
  pairKey,
  KILL_REASON_CORRELATED_POSITION_OPEN,
  DEFAULT_CORRELATION_THRESHOLD,
  __resetCorrelationMatrixForTests,
} from "../services/correlated-position-guard.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STANDARD_MATRIX = {
  correlations: {
    MES_MNQ: 0.95,
    MES_MYM: 0.92,
    MNQ_MYM: 0.88,
    MNQ_M2K: 0.85,
    MES_M2K: 0.83,
    MCL_MGC: 0.45,
    MCL_MES: 0.22,
    MCL_MNQ: 0.18,
    MCL_M6E: 0.30,
    MGC_MES: 0.15,
    MGC_M6E: 0.35,
    M6E_MES: 0.12,
    M6E_MNQ: 0.10,
  },
  threshold: 0.70,
};

beforeEach(() => {
  __resetCorrelationMatrixForTests(STANDARD_MATRIX);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pairKey()", () => {
  it("is symmetric: pairKey(MNQ, MES) === pairKey(MES, MNQ)", () => {
    expect(pairKey("MNQ", "MES")).toBe(pairKey("MES", "MNQ"));
  });

  it("sorts lexicographically: result is MES_MNQ not MNQ_MES", () => {
    expect(pairKey("MNQ", "MES")).toBe("MES_MNQ");
    expect(pairKey("MES", "MNQ")).toBe("MES_MNQ");
  });

  it("is case-insensitive: pairKey(mnq, mes) === MES_MNQ", () => {
    expect(pairKey("mnq", "mes")).toBe("MES_MNQ");
  });
});

describe("checkCorrelatedPositionGuard — blocking cases", () => {
  it("BLOCKS entry MES when MNQ is open (correlation 0.95 > 0.70)", () => {
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ" }],
      STANDARD_MATRIX,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(KILL_REASON_CORRELATED_POSITION_OPEN);
    expect(result.blockingSymbol).toBe("MNQ");
    expect(result.blockingCorrelation).toBeCloseTo(0.95, 2);
    expect(result.threshold).toBe(0.70);
  });

  it("BLOCKS entry MNQ when MES is open (symmetry: same result as MES+MNQ)", () => {
    const result = checkCorrelatedPositionGuard(
      "MNQ",
      [{ symbol: "MES" }],
      STANDARD_MATRIX,
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingSymbol).toBe("MES");
    expect(result.blockingCorrelation).toBeCloseTo(0.95, 2);
  });

  it("BLOCKS entry MES when MYM is open (correlation 0.92 > 0.70)", () => {
    const result = checkCorrelatedPositionGuard("MES", [{ symbol: "MYM" }], STANDARD_MATRIX);
    expect(result.allowed).toBe(false);
    expect(result.blockingCorrelation).toBeCloseTo(0.92, 2);
  });

  it("BLOCKS first matching correlated position when multiple open", () => {
    // Both MNQ and MYM are correlated with MES — first match wins
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MCL" }, { symbol: "MNQ" }],
      STANDARD_MATRIX,
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingSymbol).toBe("MNQ"); // MCL is 0.22 (allowed), MNQ is 0.95 (blocked)
  });
});

describe("checkCorrelatedPositionGuard — allowed cases", () => {
  it("ALLOWS entry MES when MCL is open (correlation 0.22 < 0.70)", () => {
    const result = checkCorrelatedPositionGuard("MES", [{ symbol: "MCL" }], STANDARD_MATRIX);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.blockingSymbol).toBeNull();
  });

  it("ALLOWS entry MNQ when MCL is open (correlation 0.18 < 0.70)", () => {
    const result = checkCorrelatedPositionGuard("MNQ", [{ symbol: "MCL" }], STANDARD_MATRIX);
    expect(result.allowed).toBe(true);
  });

  it("ALLOWS any entry when open_positions is empty (first trade)", () => {
    const result = checkCorrelatedPositionGuard("MES", [], STANDARD_MATRIX);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("ALLOWS entry for same symbol as open position (not a correlation block)", () => {
    // Same-symbol concurrent positions are handled by a different guard
    const result = checkCorrelatedPositionGuard("MES", [{ symbol: "MES" }], STANDARD_MATRIX);
    expect(result.allowed).toBe(true);
  });

  it("ALLOWS when pair not in matrix (defaults to 0.0)", () => {
    const result = checkCorrelatedPositionGuard("FAKE1", [{ symbol: "FAKE2" }], STANDARD_MATRIX);
    expect(result.allowed).toBe(true);
  });
});

// deep-scan long-tail F-4 re-verify (2026-07-06): the Topstep multi-account exception (guard.ts:231) had
// ZERO test coverage — none of the pre-existing cases passed proposedFirmId/proposedUserId/proposedStrategyId,
// so a future refactor of sameUser/sameStrategy would silently regress. These 4 cases pin the exception's
// exact contract (matches the grader's tsx repro): allow ONLY same-firm(topstep) + same-operator + same-strategy.
describe("checkCorrelatedPositionGuard — F-4 Topstep multi-account exception", () => {
  it("ALLOWS a correlated Topstep entry when same operator runs the SAME strategy across own Topstep accounts", () => {
    // MES vs open MNQ (corr 0.95 > 0.70 → normally BLOCKED), but both Topstep, userId absent on both
    // (single-operator deployment), same strategyId → exception fires.
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ", firmId: "topstep", userId: null, strategyId: "strat-A" }],
      STANDARD_MATRIX,
      "topstep", // proposedFirmId
      null, // proposedUserId (single operator)
      "strat-A", // proposedStrategyId — matches the open position
    );
    expect(result.allowed).toBe(true);
    expect(result.blockingSymbol).toBeNull();
  });

  it("BLOCKS a correlated Topstep entry when the strategy DIFFERS (exception needs same strategy)", () => {
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ", firmId: "topstep", userId: null, strategyId: "strat-A" }],
      STANDARD_MATRIX,
      "topstep",
      null,
      "strat-B", // different strategy → no exception
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingSymbol).toBe("MNQ");
  });

  it("BLOCKS a cross-firm correlated entry (MFFU proposed vs open Topstep) even with same strategy", () => {
    // MFFU collaborative-trading ban always applies; the exception is Topstep-only on the PROPOSED side.
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ", firmId: "topstep", userId: null, strategyId: "strat-A" }],
      STANDARD_MATRIX,
      "mffu", // proposedFirmId — not Topstep
      null,
      "strat-A",
    );
    expect(result.allowed).toBe(false);
    expect(result.blockingSymbol).toBe("MNQ");
  });

  it("BLOCKS when proposedStrategyId is absent (sameStrategy requires a non-null match on both sides)", () => {
    const result = checkCorrelatedPositionGuard(
      "MES",
      [{ symbol: "MNQ", firmId: "topstep", userId: null, strategyId: "strat-A" }],
      STANDARD_MATRIX,
      "topstep",
      null,
      undefined, // no proposed strategy → cannot be "same strategy"
    );
    expect(result.allowed).toBe(false);
  });
});

describe("Sequential entry (close → re-enter)", () => {
  it("ALLOWS MES entry after MNQ is closed (empty open positions)", () => {
    // After closing MNQ, open_positions is empty → allowed
    const result = checkCorrelatedPositionGuard("MES", [], STANDARD_MATRIX);
    expect(result.allowed).toBe(true);
  });

  it("BLOCKS MES if MNQ is still open (not yet closed)", () => {
    const result = checkCorrelatedPositionGuard("MES", [{ symbol: "MNQ" }], STANDARD_MATRIX);
    expect(result.allowed).toBe(false);
  });
});

describe("Symmetry guarantee", () => {
  it("MNQ→MES and MES→MNQ produce identical allowed/blocked decisions", () => {
    const r1 = checkCorrelatedPositionGuard("MES", [{ symbol: "MNQ" }], STANDARD_MATRIX);
    const r2 = checkCorrelatedPositionGuard("MNQ", [{ symbol: "MES" }], STANDARD_MATRIX);
    expect(r1.allowed).toBe(r2.allowed);
    expect(r1.blockingCorrelation).toBeCloseTo(r2.blockingCorrelation!, 4);
    expect(r1.threshold).toBe(r2.threshold);
  });

  it("MCL→MNQ and MNQ→MCL are both allowed (0.18 < 0.70)", () => {
    const r1 = checkCorrelatedPositionGuard("MCL", [{ symbol: "MNQ" }], STANDARD_MATRIX);
    const r2 = checkCorrelatedPositionGuard("MNQ", [{ symbol: "MCL" }], STANDARD_MATRIX);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });
});

describe("Custom threshold", () => {
  it("blocks MCL+MGC when threshold is lowered to 0.40 (correlation 0.45 > 0.40)", () => {
    const strictMatrix = { ...STANDARD_MATRIX, threshold: 0.40 };
    const result = checkCorrelatedPositionGuard("MCL", [{ symbol: "MGC" }], strictMatrix);
    expect(result.allowed).toBe(false);
    expect(result.blockingCorrelation).toBeCloseTo(0.45, 2);
  });

  it("allows MCL+MGC at default threshold 0.70 (correlation 0.45 < 0.70)", () => {
    const result = checkCorrelatedPositionGuard("MCL", [{ symbol: "MGC" }], STANDARD_MATRIX);
    expect(result.allowed).toBe(true);
  });
});

describe("DEFAULT_CORRELATION_THRESHOLD", () => {
  it("is 0.70", () => {
    expect(DEFAULT_CORRELATION_THRESHOLD).toBe(0.70);
  });
});

describe("KILL_REASON_CORRELATED_POSITION_OPEN", () => {
  it("is the expected constant string", () => {
    expect(KILL_REASON_CORRELATED_POSITION_OPEN).toBe("correlated_position_open");
  });
});
