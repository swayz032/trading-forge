/**
 * wave27-5-pass-b-wfe-gate.test.ts — Wave 27.5 Pass B.2 (paper-parity)
 *
 * Tests the pure-function evaluateWfeGate helper.
 * Covers:
 *   - WFE >= 0.70 → passes (happy path)
 *   - WFE < 0.50 → blocked (hard floor)
 *   - 0.50 <= WFE < 0.70 → BLOCKED (institutional 2026 hard floor — NOT a warn-and-allow)
 *   - WFE = 0.70 exactly → passes (boundary)
 *   - WFE = 0.50 exactly → blocked (boundary at warn floor)
 *   - null WFE → legacy proceed + audit
 *   - env-var threshold override respected
 *   - audit action names correct for each outcome
 *   - SSE payload fields present on every evaluation
 *   - boundary conditions for hard and warn floors
 *
 * PARITY FIX (2026-06-22): The [0.50, 0.70) band was previously "warned (allow)".
 * CLAUDE.md §12 and the Wave 27.5 certification document WFE_HARD_FLOOR (0.70) as
 * a HARD BLOCK. The [0.50, 0.70) band must block — status="blocked", passed=false,
 * auditAction="lifecycle.wfe_hard_floor_block". The warn audit action is still
 * emitted as a secondary informational entry; the primary gate decision is BLOCK.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  evaluateWfeGate,
  getWfeHardFloor,
  getWfeWarnFloor,
  type WfeGateStatus,
} from "../lib/wfe-gate.js";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  delete process.env.WFE_HARD_FLOOR;
  delete process.env.WFE_WARN_FLOOR;
});

// ─── Env-var helpers ──────────────────────────────────────────────────────────

describe("getWfeHardFloor / getWfeWarnFloor defaults", () => {
  it("hard floor defaults to 0.70", () => {
    expect(getWfeHardFloor()).toBe(0.70);
  });

  it("warn floor defaults to 0.50", () => {
    expect(getWfeWarnFloor()).toBe(0.50);
  });

  it("hard floor respects env var WFE_HARD_FLOOR", () => {
    process.env.WFE_HARD_FLOOR = "0.80";
    expect(getWfeHardFloor()).toBe(0.80);
  });

  it("warn floor respects env var WFE_WARN_FLOOR", () => {
    process.env.WFE_WARN_FLOOR = "0.40";
    expect(getWfeWarnFloor()).toBe(0.40);
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("evaluateWfeGate — WFE >= hard floor → passed", () => {
  it("returns passed status when wfeOverall = 0.70 (exactly at floor)", () => {
    const result = evaluateWfeGate(0.70, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("passed");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });

  it("returns passed status when wfeOverall = 0.90 (well above floor)", () => {
    const result = evaluateWfeGate(0.90, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("passed");
    expect(result.passed).toBe(true);
  });
});

// ─── [0.50, 0.70) band → now BLOCKED (institutional 2026 hard floor) ──────────
//
// PARITY FIX 2026-06-22: This band was previously "warned (allow)" — a doc/code
// disagreement. CLAUDE.md §12 states WFE_HARD_FLOOR (0.70) is a HARD BLOCK.
// All three cases below must now return blocked, passed=false.

describe("evaluateWfeGate — WFE in [0.50, 0.70) → BLOCKED (institutional hard floor)", () => {
  it("returns blocked when wfeOverall = 0.60 (between 0.50 and 0.70)", () => {
    const result = evaluateWfeGate(0.60, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("returns blocked when wfeOverall = 0.50 (exactly at warn floor — below hard floor)", () => {
    const result = evaluateWfeGate(0.50, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("returns blocked when wfeOverall = 0.699 (just below hard floor)", () => {
    const result = evaluateWfeGate(0.699, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("returns blocked when wfeOverall = 0.501 (just above warn floor — still below hard floor)", () => {
    const result = evaluateWfeGate(0.501, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
  });
});

// ─── Hard block ───────────────────────────────────────────────────────────────

describe("evaluateWfeGate — WFE < warn floor → blocked", () => {
  it("returns blocked status when wfeOverall = 0.49 (just below warn floor)", () => {
    const result = evaluateWfeGate(0.49, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("returns blocked when wfeOverall = 0.10 (very low WFE — likely overfit)", () => {
    const result = evaluateWfeGate(0.10, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
  });

  it("returns blocked when wfeOverall = 0 (zero WFE)", () => {
    const result = evaluateWfeGate(0, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
  });
});

// ─── Legacy null path ─────────────────────────────────────────────────────────

describe("evaluateWfeGate — null WFE → legacy proceed", () => {
  it("returns legacy_null status when wfeOverall is null", () => {
    const result = evaluateWfeGate(null, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("legacy_null");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.wfe_unavailable_legacy");
    expect(result.wfeOverall).toBeNull();
  });

  it("returns legacy_null status when wfeOverall is undefined", () => {
    const result = evaluateWfeGate(undefined, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("legacy_null");
    expect(result.passed).toBe(true);
  });
});

// ─── Env-var override in gate ─────────────────────────────────────────────────

describe("evaluateWfeGate — env-var override respected via argument passthrough", () => {
  it("uses provided hardFloor argument (0.80) for threshold comparison — WFE 0.75 below override floor → blocked", () => {
    // WFE 0.75 is above default 0.70 but below override 0.80 → should block (not pass)
    const result = evaluateWfeGate(0.75, 0.80, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("uses provided hardFloor argument (0.80) — WFE 0.80 exactly at override floor → passed", () => {
    const result = evaluateWfeGate(0.80, 0.80, 0.50);
    expect(result.status).toBe<WfeGateStatus>("passed");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });
});

// ─── Critical boundary cases ──────────────────────────────────────────────────

describe("evaluateWfeGate — critical boundary cases (institutional contract)", () => {
  it("WFE = 0.70 exactly → passed (at hard floor, not below)", () => {
    const result = evaluateWfeGate(0.70, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("passed");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });

  it("WFE = 0.6999 (just below 0.70) → blocked", () => {
    const result = evaluateWfeGate(0.6999, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
  });

  it("WFE = 0.50 exactly → blocked (warn floor is below hard floor)", () => {
    const result = evaluateWfeGate(0.50, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("legacy null → proceed (grandfather path unchanged)", () => {
    const result = evaluateWfeGate(null, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("legacy_null");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.wfe_unavailable_legacy");
  });
});

// ─── Result payload completeness (SSE source) ─────────────────────────────────

describe("evaluateWfeGate — result payload (SSE surface)", () => {
  it("always returns wfeOverall, hardFloor, warnFloor in result", () => {
    // 0.60 now blocks (was warn) — but payload shape is unchanged
    const cases = [0.90, 0.60, 0.30, null];
    for (const wfe of cases) {
      const result = evaluateWfeGate(wfe, 0.70, 0.50);
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("passed");
      expect(result).toHaveProperty("wfeOverall");
      expect(result).toHaveProperty("hardFloor");
      expect(result).toHaveProperty("warnFloor");
      expect(result.hardFloor).toBe(0.70);
      expect(result.warnFloor).toBe(0.50);
    }
  });
});

// ─── CPCV-exempt path (hardening/phase-0) ────────────────────────────────────
//
// walk_forward.py emits wfe_status="cpcv_not_applicable" when mode="cpcv".
// This is NOT a legacy null and NOT a degenerate IS failure — the WFE ratio is
// structurally inapplicable to CPCV paths. The gate MUST:
//   - return status="cpcv_exempt" (not "legacy_null")
//   - return passed=true (do NOT block)
//   - return auditAction="lifecycle.wfe_cpcv_exempt" (distinct from "lifecycle.wfe_unavailable_legacy")
//
// Critical regression guard: a plain-WF backtest with wfe_overall=0.30 (below floor)
// MUST still BLOCK regardless of any wfe_status changes to other paths.

describe("evaluateWfeGate — CPCV-exempt path (hardening/phase-0)", () => {
  it("wfe_status=cpcv_not_applicable + null wfeOverall → cpcv_exempt, passed=true, distinct auditAction", () => {
    const result = evaluateWfeGate(null, 0.70, 0.50, "cpcv_not_applicable");
    expect(result.status).toBe<WfeGateStatus>("cpcv_exempt");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.wfe_cpcv_exempt");
    expect(result.wfeOverall).toBeNull();
  });

  it("wfe_status=cpcv_not_applicable takes precedence over low numeric wfeOverall (0.30 would block)", () => {
    // Producer sets wfe_overall=None in Python → arrives as null.
    // Test ensures that even if a stale/wrong numeric value arrives with the CPCV status,
    // the wfe_status label takes precedence.
    const result = evaluateWfeGate(0.30, 0.70, 0.50, "cpcv_not_applicable");
    expect(result.status).toBe<WfeGateStatus>("cpcv_exempt");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.wfe_cpcv_exempt");
  });

  it("cpcv_exempt is NOT legacy_null — distinct status for distinct audit trail", () => {
    const cpcvResult = evaluateWfeGate(null, 0.70, 0.50, "cpcv_not_applicable");
    const legacyResult = evaluateWfeGate(null, 0.70, 0.50, null);
    expect(cpcvResult.status).toBe<WfeGateStatus>("cpcv_exempt");
    expect(legacyResult.status).toBe<WfeGateStatus>("legacy_null");
    expect(cpcvResult.auditAction).not.toBe(legacyResult.auditAction);
    expect(cpcvResult.auditAction).toBe("lifecycle.wfe_cpcv_exempt");
    expect(legacyResult.auditAction).toBe("lifecycle.wfe_unavailable_legacy");
  });

  it("cpcv_exempt does NOT affect degenerate_is path (regression: degenerate_is still BLOCKS)", () => {
    // degenerate_is is checked AFTER cpcv_not_applicable — they cannot fire simultaneously.
    // Regression guard: wfe_status="degenerate_is" must still block.
    const degResult = evaluateWfeGate(0.90, 0.70, 0.50, "degenerate_is");
    expect(degResult.status).toBe<WfeGateStatus>("degenerate_is_block");
    expect(degResult.passed).toBe(false);
  });

  it("regression: plain-WF wfe_overall=0.30 (no wfe_status) → BLOCKED, not exempt", () => {
    const result = evaluateWfeGate(0.30, 0.70, 0.50, null);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("regression: plain-WF wfe_overall=0.80 (no wfe_status) → PASSED normally", () => {
    const result = evaluateWfeGate(0.80, 0.70, 0.50, null);
    expect(result.status).toBe<WfeGateStatus>("passed");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });
});
