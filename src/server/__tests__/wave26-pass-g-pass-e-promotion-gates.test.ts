/**
 * wave26-pass-g-pass-e-promotion-gates.test.ts
 *
 * Wave 26 Pass G Pass E — Promotion Gate Orchestrator tests.
 *
 * Tests the pure evaluatePromotionGates() function covering:
 *   1. Gate outputs: all 5 gates present in result
 *   2. AND logic: all must pass for can_promote=true
 *   3. Individual gate blocking behavior
 *   4. Fail-open semantics for missing data
 *   5. WFE floor 0.80 (lifted from 0.70)
 *   6. CPCV min_paths floor = 15
 *   7. WRC p < 0.05 gate
 *   8. SPA spa_consistent_p < 0.05 gate
 *   9. B14 ci_high gate delegation
 *  10. Env var overrides for WFE floor and CPCV min paths
 *  11. Failing gates listed in failing_gates array
 *  12. Promotion.gate_failed audit name correctness
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  evaluatePromotionGates,
  getWfePromotionFloor,
  getCpcvMinPaths,
  type StrategyPromotionData,
  type GateName,
} from "../lib/promotion-gate-orchestrator.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function allPassData(): StrategyPromotionData {
  return {
    ruinCi: { ci_high: 0.20, ci_low: 0.05, point_estimate: 0.15 },
    ruinPointEstimate: 0.15,
    wfeOverall: 0.85,
    cpcvNPaths: 15,
    wrcPValue: 0.02,
    spaConsistentP: 0.03,
  };
}

// ── Output schema ────────────────────────────────────────────────────────────

describe("PromotionGateOrchestrator — output schema", () => {
  it("returns all 5 gate keys", () => {
    const result = evaluatePromotionGates(allPassData());
    const expected: GateName[] = ["b14_ci_high", "wfe_floor", "cpcv_n_paths", "wrc_p", "spa_p"];
    for (const gate of expected) {
      expect(result.gate_results).toHaveProperty(gate);
    }
  });

  it("each gate result has passed, value, threshold, reason, data_available", () => {
    const result = evaluatePromotionGates(allPassData());
    for (const [, gateRes] of Object.entries(result.gate_results)) {
      expect(gateRes).toHaveProperty("passed");
      expect(gateRes).toHaveProperty("value");
      expect(gateRes).toHaveProperty("threshold");
      expect(gateRes).toHaveProperty("reason");
      expect(gateRes).toHaveProperty("data_available");
    }
  });

  it("can_promote is a boolean", () => {
    expect(typeof evaluatePromotionGates(allPassData()).can_promote).toBe("boolean");
  });

  it("n_gates_failed is a number", () => {
    expect(typeof evaluatePromotionGates(allPassData()).n_gates_failed).toBe("number");
  });

  it("failing_gates is an array", () => {
    expect(Array.isArray(evaluatePromotionGates(allPassData()).failing_gates)).toBe(true);
  });
});

// ── AND logic ────────────────────────────────────────────────────────────────

describe("PromotionGateOrchestrator — AND logic", () => {
  it("can_promote=true when all gates pass", () => {
    const result = evaluatePromotionGates(allPassData());
    expect(result.can_promote).toBe(true);
    expect(result.n_gates_failed).toBe(0);
    expect(result.failing_gates).toHaveLength(0);
  });

  it("can_promote=false when WFE fails", () => {
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.70 }; // below 0.80
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(false);
    expect(result.failing_gates).toContain("wfe_floor");
  });

  it("can_promote=false when CPCV fails", () => {
    const data: StrategyPromotionData = { ...allPassData(), cpcvNPaths: 10 }; // below 15
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(false);
    expect(result.failing_gates).toContain("cpcv_n_paths");
  });

  it("can_promote=false when WRC fails", () => {
    const data: StrategyPromotionData = { ...allPassData(), wrcPValue: 0.10 }; // >= 0.05
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(false);
    expect(result.failing_gates).toContain("wrc_p");
  });

  it("can_promote=false when SPA fails", () => {
    const data: StrategyPromotionData = { ...allPassData(), spaConsistentP: 0.08 }; // >= 0.05
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(false);
    expect(result.failing_gates).toContain("spa_p");
  });

  it("can_promote=false when multiple gates fail", () => {
    const data: StrategyPromotionData = {
      ...allPassData(),
      wfeOverall: 0.60,    // fails WFE
      wrcPValue: 0.12,     // fails WRC
    };
    const result = evaluatePromotionGates(data);
    expect(result.can_promote).toBe(false);
    expect(result.n_gates_failed).toBe(2);
    expect(result.failing_gates).toContain("wfe_floor");
    expect(result.failing_gates).toContain("wrc_p");
  });
});

// ── WFE floor 0.80 ───────────────────────────────────────────────────────────

describe("WFE floor (0.80 institutional standard)", () => {
  it("WFE exactly 0.80 passes", () => {
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.80 };
    const result = evaluatePromotionGates(data, 0.80);
    expect(result.gate_results.wfe_floor.passed).toBe(true);
  });

  it("WFE 0.799 fails", () => {
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.799 };
    const result = evaluatePromotionGates(data, 0.80);
    expect(result.gate_results.wfe_floor.passed).toBe(false);
    expect(result.gate_results.wfe_floor.reason).toMatch(/wfe_floor_failed/);
  });

  it("WFE 0.70 (old floor) would pass old gate but fails new 0.80 gate", () => {
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.70 };
    const result = evaluatePromotionGates(data, 0.80);
    expect(result.gate_results.wfe_floor.passed).toBe(false);
    expect(result.gate_results.wfe_floor.value).toBeCloseTo(0.70, 3);
    expect(result.gate_results.wfe_floor.threshold).toBe(0.80);
  });

  it("null WFE fails-CLOSED by default (F-4 hardening)", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    try {
      const data: StrategyPromotionData = { ...allPassData(), wfeOverall: null };
      const result = evaluatePromotionGates(data, 0.80);
      expect(result.gate_results.wfe_floor.passed).toBe(false);
      expect(result.gate_results.wfe_floor.data_available).toBe(false);
      expect(result.gate_results.wfe_floor.reason).toContain("fail-closed");
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });

  it("null WFE fails-open when PROMOTION_GRANDFATHER_PRE_PASS_E=true (grandfather opt-in)", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    try {
      const data: StrategyPromotionData = { ...allPassData(), wfeOverall: null };
      const result = evaluatePromotionGates(data, 0.80);
      expect(result.gate_results.wfe_floor.passed).toBe(true);
      expect(result.gate_results.wfe_floor.data_available).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });

  it("audit reason contains gate.wfe_floor_failed when WFE fails", () => {
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.75 };
    const result = evaluatePromotionGates(data, 0.80);
    expect(result.gate_results.wfe_floor.reason).toContain("wfe_floor_failed");
  });
});

// ── CPCV n_paths floor 15 ────────────────────────────────────────────────────

describe("CPCV n_paths floor (15 institutional standard)", () => {
  it("exactly 15 paths passes", () => {
    const data: StrategyPromotionData = { ...allPassData(), cpcvNPaths: 15 };
    const result = evaluatePromotionGates(data, undefined, 15);
    expect(result.gate_results.cpcv_n_paths.passed).toBe(true);
  });

  it("14 paths fails", () => {
    const data: StrategyPromotionData = { ...allPassData(), cpcvNPaths: 14 };
    const result = evaluatePromotionGates(data, undefined, 15);
    expect(result.gate_results.cpcv_n_paths.passed).toBe(false);
    expect(result.gate_results.cpcv_n_paths.reason).toContain("insufficient_paths");
  });

  it("30 paths passes", () => {
    const data: StrategyPromotionData = { ...allPassData(), cpcvNPaths: 30 };
    const result = evaluatePromotionGates(data, undefined, 15);
    expect(result.gate_results.cpcv_n_paths.passed).toBe(true);
  });

  it("null n_paths fails-CLOSED by default (F-4 hardening)", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    try {
      const data: StrategyPromotionData = { ...allPassData(), cpcvNPaths: null };
      const result = evaluatePromotionGates(data, undefined, 15);
      expect(result.gate_results.cpcv_n_paths.passed).toBe(false);
      expect(result.gate_results.cpcv_n_paths.data_available).toBe(false);
      expect(result.gate_results.cpcv_n_paths.reason).toContain("no_run");
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });

  it("null n_paths fails-open when PROMOTION_GRANDFATHER_PRE_PASS_E=true (grandfather opt-in)", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    try {
      const data: StrategyPromotionData = { ...allPassData(), cpcvNPaths: null };
      const result = evaluatePromotionGates(data, undefined, 15);
      expect(result.gate_results.cpcv_n_paths.passed).toBe(true);
      expect(result.gate_results.cpcv_n_paths.data_available).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });
});

// ── WRC gate ─────────────────────────────────────────────────────────────────

describe("WRC p-value gate", () => {
  it("p_value 0.01 passes", () => {
    const data: StrategyPromotionData = { ...allPassData(), wrcPValue: 0.01 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.wrc_p.passed).toBe(true);
  });

  it("p_value exactly 0.05 fails (strict <)", () => {
    const data: StrategyPromotionData = { ...allPassData(), wrcPValue: 0.05 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.wrc_p.passed).toBe(false);
  });

  it("p_value 0.049 passes", () => {
    const data: StrategyPromotionData = { ...allPassData(), wrcPValue: 0.049 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.wrc_p.passed).toBe(true);
  });

  it("p_value 0.50 fails", () => {
    const data: StrategyPromotionData = { ...allPassData(), wrcPValue: 0.50 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.wrc_p.passed).toBe(false);
    expect(result.gate_results.wrc_p.reason).toContain("not_significant");
  });

  it("null wrcPValue fails-CLOSED by default (F-4 hardening)", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    try {
      const data: StrategyPromotionData = { ...allPassData(), wrcPValue: null };
      const result = evaluatePromotionGates(data);
      expect(result.gate_results.wrc_p.passed).toBe(false);
      expect(result.gate_results.wrc_p.data_available).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });

  it("null wrcPValue fails-open when PROMOTION_GRANDFATHER_PRE_PASS_E=true", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    try {
      const data: StrategyPromotionData = { ...allPassData(), wrcPValue: null };
      const result = evaluatePromotionGates(data);
      expect(result.gate_results.wrc_p.passed).toBe(true);
      expect(result.gate_results.wrc_p.data_available).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });
});

// ── SPA gate ──────────────────────────────────────────────────────────────────

describe("SPA spa_consistent_p gate", () => {
  it("spa_consistent_p 0.01 passes", () => {
    const data: StrategyPromotionData = { ...allPassData(), spaConsistentP: 0.01 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.spa_p.passed).toBe(true);
  });

  it("spa_consistent_p exactly 0.05 fails (strict <)", () => {
    const data: StrategyPromotionData = { ...allPassData(), spaConsistentP: 0.05 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.spa_p.passed).toBe(false);
  });

  it("spa_consistent_p 0.049 passes", () => {
    const data: StrategyPromotionData = { ...allPassData(), spaConsistentP: 0.049 };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.spa_p.passed).toBe(true);
  });

  it("null spaConsistentP fails-CLOSED by default (F-4 hardening)", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    try {
      const data: StrategyPromotionData = { ...allPassData(), spaConsistentP: null };
      const result = evaluatePromotionGates(data);
      expect(result.gate_results.spa_p.passed).toBe(false);
      expect(result.gate_results.spa_p.data_available).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });

  it("null spaConsistentP fails-open when PROMOTION_GRANDFATHER_PRE_PASS_E=true", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    try {
      const data: StrategyPromotionData = { ...allPassData(), spaConsistentP: null };
      const result = evaluatePromotionGates(data);
      expect(result.gate_results.spa_p.passed).toBe(true);
      expect(result.gate_results.spa_p.data_available).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });
});

// ── B14 gate ──────────────────────────────────────────────────────────────────

describe("B14 ci_high gate (delegated to evaluateB14CiGate)", () => {
  it("ci_high 0.20 passes (below 0.40 threshold)", () => {
    const data: StrategyPromotionData = {
      ...allPassData(),
      ruinCi: { ci_high: 0.20, ci_low: 0.05, point_estimate: 0.12 },
    };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.b14_ci_high.passed).toBe(true);
  });

  it("ci_high 0.45 fails (above 0.40 threshold)", () => {
    const data: StrategyPromotionData = {
      ...allPassData(),
      ruinCi: { ci_high: 0.45, ci_low: 0.20, point_estimate: 0.35 },
    };
    const result = evaluatePromotionGates(data);
    expect(result.gate_results.b14_ci_high.passed).toBe(false);
  });

  it("null ruinCi fails-CLOSED by default (F-4 hardening)", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    try {
      const data: StrategyPromotionData = {
        ...allPassData(),
        ruinCi: null,
        ruinPointEstimate: null,
      };
      const result = evaluatePromotionGates(data);
      expect(result.gate_results.b14_ci_high.passed).toBe(false);
      expect(result.gate_results.b14_ci_high.data_available).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });

  it("null ruinCi fails-open when PROMOTION_GRANDFATHER_PRE_PASS_E=true (grandfather opt-in)", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    try {
      const data: StrategyPromotionData = {
        ...allPassData(),
        ruinCi: null,
        ruinPointEstimate: null,
      };
      const result = evaluatePromotionGates(data);
      expect(result.gate_results.b14_ci_high.passed).toBe(true);
      expect(result.gate_results.b14_ci_high.data_available).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });
});

// ── Env var overrides ─────────────────────────────────────────────────────────

describe("Env var overrides", () => {
  const origWfe = process.env.WFE_PROMOTION_FLOOR;
  const origCpcv = process.env.CPCV_MIN_PATHS;

  afterEach(() => {
    if (origWfe === undefined) delete process.env.WFE_PROMOTION_FLOOR;
    else process.env.WFE_PROMOTION_FLOOR = origWfe;
    if (origCpcv === undefined) delete process.env.CPCV_MIN_PATHS;
    else process.env.CPCV_MIN_PATHS = origCpcv;
  });

  it("getWfePromotionFloor defaults to 0.80", () => {
    delete process.env.WFE_PROMOTION_FLOOR;
    expect(getWfePromotionFloor()).toBeCloseTo(0.80, 5);
  });

  it("WFE_PROMOTION_FLOOR env override respected", () => {
    process.env.WFE_PROMOTION_FLOOR = "0.90";
    expect(getWfePromotionFloor()).toBeCloseTo(0.90, 5);
  });

  it("getCpcvMinPaths defaults to 15", () => {
    delete process.env.CPCV_MIN_PATHS;
    expect(getCpcvMinPaths()).toBe(15);
  });

  it("CPCV_MIN_PATHS env override respected", () => {
    process.env.CPCV_MIN_PATHS = "20";
    expect(getCpcvMinPaths()).toBe(20);
  });

  it("orchestrator honours WFE override via env when no wfeFloor arg passed", () => {
    process.env.WFE_PROMOTION_FLOOR = "0.90";
    const data: StrategyPromotionData = { ...allPassData(), wfeOverall: 0.85 };
    const result = evaluatePromotionGates(data);  // no arg override — reads env
    expect(result.gate_results.wfe_floor.threshold).toBeCloseTo(0.90, 5);
    expect(result.gate_results.wfe_floor.passed).toBe(false);
  });
});

// ── failing_gates list ────────────────────────────────────────────────────────

describe("failing_gates list accuracy", () => {
  it("empty when all pass", () => {
    expect(evaluatePromotionGates(allPassData()).failing_gates).toHaveLength(0);
  });

  it("lists all failing gate names", () => {
    const data: StrategyPromotionData = {
      ...allPassData(),
      wfeOverall: 0.70,
      cpcvNPaths: 5,
      wrcPValue: 0.20,
      spaConsistentP: 0.15,
    };
    const result = evaluatePromotionGates(data, 0.80, 15);
    expect(result.failing_gates).toContain("wfe_floor");
    expect(result.failing_gates).toContain("cpcv_n_paths");
    expect(result.failing_gates).toContain("wrc_p");
    expect(result.failing_gates).toContain("spa_p");
    expect(result.n_gates_failed).toBe(4);
  });
});

// ── Backward compatibility ────────────────────────────────────────────────────

describe("Backward compatibility — all null data", () => {
  it("empty data fails-CLOSED on all null gates (F-4 hardening, default)", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    try {
      const data: StrategyPromotionData = {};
      const result = evaluatePromotionGates(data, 0.80, 15);
      // All gates fail-closed → can_promote = false
      expect(result.can_promote).toBe(false);
      for (const gateRes of Object.values(result.gate_results)) {
        expect(gateRes.data_available).toBe(false);
        // Each null gate should fail-closed
        expect(gateRes.passed).toBe(false);
      }
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });

  it("empty data fails-open on all gates when PROMOTION_GRANDFATHER_PRE_PASS_E=true (legacy backtest opt-in)", () => {
    const orig = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    try {
      const data: StrategyPromotionData = {};
      const result = evaluatePromotionGates(data, 0.80, 15);
      // All gates fail-open → can_promote = true (grandfather window active)
      expect(result.can_promote).toBe(true);
      expect(result.n_gates_failed).toBe(0);
      for (const gateRes of Object.values(result.gate_results)) {
        expect(gateRes.passed).toBe(true);
        expect(gateRes.data_available).toBe(false);
      }
    } finally {
      if (orig === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
      else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = orig;
    }
  });
});
