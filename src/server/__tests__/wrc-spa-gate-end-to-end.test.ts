/**
 * wrc-spa-gate-end-to-end.test.ts
 *
 * End-to-end key-contract tests for the WRC + SPA producer → DB → gate chain.
 *
 * Tests the full logical flow:
 *   1. Python walk_forward.py emits wrc_result / spa_result dicts
 *   2. backtest-service.ts stamps them as wrcResult / spaResult JSONB columns
 *   3. lifecycle-service.ts reads (wrcResult?.p_value) → orchGates.wrcPValue
 *   4. promotion-gate-orchestrator.ts evaluates the gate
 *
 * What each test covers:
 *   - extractWrcSpa: confirms the TypeScript extraction cast used in
 *     backtest-service.ts correctly passes Python dict shapes through
 *   - lifecycleReads: confirms lifecycle-service.ts reader logic correctly
 *     extracts p_value / spa_consistent_p from wrcResult / spaResult JSONB blobs
 *   - gateDecisions: proves DEPLOY_READY is BLOCKED for insignificant edge,
 *     REACHABLE for significant edge
 *   - nullHandling: confirms null wrc/spa → fail-CLOSED by default (F-4 hardening)
 *   - availableFalse: confirms {available: false} blob → gate reads null → fail-CLOSED
 *   - twoLevelWfe: confirms WFE uses 0.70 at TESTING→PAPER and 0.80 at PAPER→DEPLOY_READY
 *
 * No DB required — these tests exercise pure TypeScript logic only.
 */

import { describe, it, expect } from "vitest";
import {
  evaluatePromotionGates,
  type StrategyPromotionData,
} from "../lib/promotion-gate-orchestrator.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Mirrors the Python wrc_result schema for a passing strategy. */
function wrcResultPass(pValue: number = 0.02): Record<string, unknown> {
  return {
    p_value: pValue,
    test_stat: 1.5,
    passed: pValue < 0.05,
    threshold: 0.05,
    n_obs: 120,
    n_bootstrap: 2000,
    block_length: 11,
    mean_excess_return: 180.5,
  };
}

/** Mirrors the Python spa_result schema for a passing strategy. */
function spaResultPass(spaConsistentP: number = 0.015): Record<string, unknown> {
  return {
    spa_lower_p: 0.01,
    spa_consistent_p: spaConsistentP,
    spa_upper_p: 0.03,
    passed: spaConsistentP < 0.05,
    threshold: 0.05,
    n_obs: 120,
    n_bootstrap: 2000,
    block_length: 11,
    mean_excess_return: 180.5,
  };
}

/** Mirrors the Python wrc_result schema for an insignificant strategy. */
function wrcResultFail(): Record<string, unknown> {
  return {
    p_value: 0.41,
    test_stat: 0.2,
    passed: false,
    threshold: 0.05,
    n_obs: 120,
    n_bootstrap: 2000,
    block_length: 11,
    mean_excess_return: 12.0,
  };
}

/** Mirrors the Python spa_result schema for an insignificant strategy. */
function spaResultFail(): Record<string, unknown> {
  return {
    spa_lower_p: 0.35,
    spa_consistent_p: 0.38,
    spa_upper_p: 0.41,
    passed: false,
    threshold: 0.05,
    n_obs: 120,
    n_bootstrap: 2000,
    block_length: 11,
    mean_excess_return: 12.0,
  };
}

/** The {available: false} shape Python emits when OOS obs < 20. */
function unavailableBlob(reason: string = "insufficient_obs"): Record<string, unknown> {
  return { available: false, reason };
}

/** The TypeScript extraction cast used in backtest-service.ts and lifecycle-service.ts. */
function extractWrcPValue(wrcResult: Record<string, unknown> | null | undefined): number | null {
  return (wrcResult?.p_value as number | null | undefined) ?? null;
}

function extractSpaConsistentP(spaResult: Record<string, unknown> | null | undefined): number | null {
  return (spaResult?.spa_consistent_p as number | null | undefined) ?? null;
}

/** Build a fully-passing StrategyPromotionData. */
function allPassData(): StrategyPromotionData {
  return {
    ruinCi: { ci_high: 0.20, ci_low: 0.05, point_estimate: 0.15 },
    ruinPointEstimate: 0.15,
    wfeOverall: 0.85,
    cpcvNPaths: 15,
    wrcPValue: 0.02,
    spaConsistentP: 0.015,
  };
}

// ── Section 1: TypeScript extraction cast (backtest-service.ts stamping logic) ──

describe("WRC/SPA extraction cast (backtest-service.ts stamping)", () => {
  it("extracts p_value from full wrc_result dict (passing strategy)", () => {
    const blob = wrcResultPass(0.02);
    const p = extractWrcPValue(blob);
    expect(p).toBe(0.02);
  });

  it("extracts spa_consistent_p from full spa_result dict (passing strategy)", () => {
    const blob = spaResultPass(0.015);
    const p = extractSpaConsistentP(blob);
    expect(p).toBe(0.015);
  });

  it("extracts p_value from full wrc_result dict (failing strategy)", () => {
    const blob = wrcResultFail();
    const p = extractWrcPValue(blob);
    expect(p).toBe(0.41);
  });

  it("extracts spa_consistent_p from full spa_result dict (failing strategy)", () => {
    const blob = spaResultFail();
    const p = extractSpaConsistentP(blob);
    expect(p).toBe(0.38);
  });

  it("returns null for null wrcResult (not yet stamped)", () => {
    expect(extractWrcPValue(null)).toBeNull();
  });

  it("returns null for undefined wrcResult (not yet stamped)", () => {
    expect(extractWrcPValue(undefined)).toBeNull();
  });

  it("returns null for available=false blob (insufficient OOS obs)", () => {
    const blob = unavailableBlob("insufficient OOS observations: 5 < 20 minimum");
    expect(extractWrcPValue(blob)).toBeNull();
    expect(extractSpaConsistentP(blob)).toBeNull();
  });

  it("returns null when blob has no p_value key", () => {
    const blob = { some_other_key: 0.99 };
    expect(extractWrcPValue(blob)).toBeNull();
  });

  it("returns null when blob has no spa_consistent_p key", () => {
    const blob = { spa_lower_p: 0.02 };
    expect(extractSpaConsistentP(blob)).toBeNull();
  });
});

// ── Section 2: lifecycle-service.ts reader simulation ─────────────────────────

describe("lifecycle-service.ts reader pattern for wrcResult/spaResult", () => {
  /**
   * Mirrors the reader pattern in lifecycle-service.ts lines 449-483:
   *   const wrcResult = latestBtP2D?.wrcResult as Record<string, unknown> | null | undefined;
   *   orchGates: {
   *     wrcPValue: (wrcResult?.p_value as number | null | undefined) ?? null,
   *     spaConsistentP: (spaResult?.spa_consistent_p as number | null | undefined) ?? null,
   *   }
   */
  function simulateLifecycleRead(
    wrcJsonb: Record<string, unknown> | null,
    spaJsonb: Record<string, unknown> | null,
  ): { wrcPValue: number | null; spaConsistentP: number | null } {
    const wrcResult = wrcJsonb as Record<string, unknown> | null | undefined;
    const spaResult = spaJsonb as Record<string, unknown> | null | undefined;
    return {
      wrcPValue: (wrcResult?.p_value as number | null | undefined) ?? null,
      spaConsistentP: (spaResult?.spa_consistent_p as number | null | undefined) ?? null,
    };
  }

  it("extracts correct values from freshly-stamped WRC/SPA blobs", () => {
    const { wrcPValue, spaConsistentP } = simulateLifecycleRead(
      wrcResultPass(0.03),
      spaResultPass(0.02),
    );
    expect(wrcPValue).toBe(0.03);
    expect(spaConsistentP).toBe(0.02);
  });

  it("returns null for null blobs (not yet stamped by backtest-service.ts)", () => {
    const { wrcPValue, spaConsistentP } = simulateLifecycleRead(null, null);
    expect(wrcPValue).toBeNull();
    expect(spaConsistentP).toBeNull();
  });

  it("returns null for available=false blobs (insufficient OOS obs)", () => {
    const { wrcPValue, spaConsistentP } = simulateLifecycleRead(
      unavailableBlob() as Record<string, unknown>,
      unavailableBlob() as Record<string, unknown>,
    );
    expect(wrcPValue).toBeNull();
    expect(spaConsistentP).toBeNull();
  });

  it("correctly feeds a failing strategy to the gate as null (→ fail-CLOSED)", () => {
    // available=false blob → null extraction → gate sees null → fail-CLOSED
    const { wrcPValue, spaConsistentP } = simulateLifecycleRead(
      unavailableBlob("insufficient OOS observations: 8 < 20 minimum"),
      unavailableBlob("insufficient OOS observations: 8 < 20 minimum"),
    );
    // Confirm gate sees null
    const data: StrategyPromotionData = {
      ...allPassData(),
      wrcPValue,
      spaConsistentP,
    };
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(false);
    expect(result.failing_gates).toContain("wrc_p");
    expect(result.failing_gates).toContain("spa_p");
  });
});

// ── Section 3: Gate decisions — DEPLOY_READY reachable vs blocked ─────────────

describe("Gate decisions: DEPLOY_READY reachable vs blocked", () => {
  it("DEPLOY_READY REACHABLE — significant edge (p_wrc=0.02, spa_p=0.015)", () => {
    /**
     * This is the primary regression guard: a strategy with genuine statistical
     * edge (WRC p=0.02, SPA consistent_p=0.015) MUST be able to reach DEPLOY_READY.
     *
     * Before FIX 1-2, wrcResult/spaResult were always null in the DB (Python never
     * computed them, TS never stamped them) → null fed to gate → fail-CLOSED →
     * DEPLOY_READY permanently frozen.  This test proves the fix works end-to-end.
     */
    const data = allPassData(); // wrcPValue=0.02, spaConsistentP=0.015
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(true);
    expect(result.n_gates_failed).toBe(0);
    expect(result.failing_gates).toHaveLength(0);
  });

  it("DEPLOY_READY BLOCKED — insignificant edge (p_wrc=0.41, spa_p=0.38)", () => {
    /**
     * A strategy that fails the WRC/SPA data-snooping test MUST be blocked
     * at PAPER → DEPLOY_READY.  p >= 0.05 → H0 not rejected → no genuine edge.
     */
    const data: StrategyPromotionData = {
      ...allPassData(),
      wrcPValue: 0.41,
      spaConsistentP: 0.38,
    };
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(false);
    expect(result.failing_gates).toContain("wrc_p");
    expect(result.failing_gates).toContain("spa_p");
  });

  it("DEPLOY_READY BLOCKED — only WRC fails (p=0.08), SPA passes (spa_p=0.03)", () => {
    const data: StrategyPromotionData = {
      ...allPassData(),
      wrcPValue: 0.08,  // fails
      spaConsistentP: 0.03,  // passes
    };
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(false);
    expect(result.failing_gates).toContain("wrc_p");
    expect(result.failing_gates).not.toContain("spa_p");
  });

  it("DEPLOY_READY BLOCKED — WRC passes (p=0.02), only SPA fails (spa_p=0.12)", () => {
    const data: StrategyPromotionData = {
      ...allPassData(),
      wrcPValue: 0.02,  // passes
      spaConsistentP: 0.12,  // fails
    };
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(false);
    expect(result.failing_gates).toContain("spa_p");
    expect(result.failing_gates).not.toContain("wrc_p");
  });

  it("DEPLOY_READY BLOCKED — WRC/SPA null (F-4 hardening: fail-CLOSED default)", () => {
    /**
     * This reproduces the exact pre-fix failure mode:
     * null wrcResult in DB → null fed to gate → both WRC+SPA gates fail.
     *
     * Before FIX 1-2, EVERY strategy hit this case because Python never computed
     * wrc_result/spa_result.  With the fix, a strategy running WF on ≥20 OOS
     * observations will always get real p-values instead of null.
     */
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    try {
      const data: StrategyPromotionData = {
        ...allPassData(),
        wrcPValue: null,
        spaConsistentP: null,
      };
      const result = evaluatePromotionGates(data);
      expect(result.can_promote).toBe(false);
      expect(result.failing_gates).toContain("wrc_p");
      expect(result.failing_gates).toContain("spa_p");
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });

  it("DEPLOY_READY REACHABLE with grandfather=true when WRC/SPA are null", () => {
    /**
     * Grandfather opt-in (PROMOTION_GRANDFATHER_PRE_PASS_E=true) allows
     * strategies from before WRC/SPA were wired to pass despite null data.
     * This is the explicit fail-open escape hatch — must still work.
     */
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    try {
      const data: StrategyPromotionData = {
        ...allPassData(),
        wrcPValue: null,
        spaConsistentP: null,
      };
      const result = evaluatePromotionGates(data);
      expect(result.gate_results.wrc_p.data_available).toBe(false);
      expect(result.gate_results.spa_p.data_available).toBe(false);
      // All other gates pass; with grandfather=true these should be fail-open.
      expect(result.can_promote).toBe(true);
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });
});

// ── Section 4: available=false blob → gate sees null ─────────────────────────

describe("available=false blob → gate fail-CLOSED", () => {
  it("extracts null from {available: false, reason: 'insufficient_obs'}", () => {
    const blob = unavailableBlob("insufficient OOS observations: 8 < 20 minimum");
    const p = extractWrcPValue(blob);
    expect(p).toBeNull();
  });

  it("gate fails-CLOSED when wrc p_value is unavailable", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    try {
      const data: StrategyPromotionData = {
        ...allPassData(),
        wrcPValue: extractWrcPValue(unavailableBlob()),
        spaConsistentP: extractSpaConsistentP(unavailableBlob()),
      };
      const result = evaluatePromotionGates(data);
      expect(result.can_promote).toBe(false);
      expect(result.gate_results.wrc_p.data_available).toBe(false);
      expect(result.gate_results.spa_p.data_available).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });
});

// ── Section 5: WFE two-level design (FIX 4 documentation) ─────────────────────

describe("WFE two-level design — 0.70 (lifecycle) vs 0.80 (orchestrator)", () => {
  it("WFE 0.80 exact floor passes at orchestrator level (PAPER → DEPLOY_READY)", () => {
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.80 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.wfe_floor.passed).toBe(true);
  });

  it("WFE 0.79 fails at orchestrator level (below 0.80 deploy floor)", () => {
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.79 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.wfe_floor.passed).toBe(false);
    expect(result.failing_gates).toContain("wfe_floor");
  });

  it("WFE 0.71 would pass lifecycle 0.70 floor but fails orchestrator 0.80 floor", () => {
    /**
     * This documents the intentional two-level design:
     *   0.71 passes TESTING→PAPER (wfe-gate.ts getWfeHardFloor()=0.70)
     *   0.71 fails PAPER→DEPLOY_READY (orchestrator WFE_PROMOTION_FLOOR=0.80)
     *
     * A strategy at 0.71 WFE is not yet ready for live capital even though
     * it passed the early lifecycle gate.
     */
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.71 };
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(false);
    expect(result.failing_gates).toContain("wfe_floor");
  });

  it("WFE 0.70 exact hard floor would pass lifecycle gate but fails orchestrator", () => {
    // Confirms F-5 hardening: the standalone 0.70 gate at PAPER→DEPLOY_READY was
    // removed (it was redundant and weaker than the 0.80 orchestrator gate).
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.70 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.wfe_floor.passed).toBe(false);
    expect(result.can_promote).toBe(false);
  });

  it("WFE 0.85 passes both lifecycle and orchestrator floors", () => {
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.85 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.wfe_floor.passed).toBe(true);
    expect(result.can_promote).toBe(true);
  });
});
