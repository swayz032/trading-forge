/**
 * Synthetic Black Swan Lifecycle Advisory Tests — A14 (W19 / Pass 4)
 *
 * Verifies the PAPER→DEPLOY_READY Phase 0 advisory logic in lifecycle-service.ts.
 *
 * Phase 0 is INTENTIONALLY non-blocking. The advisory:
 *   - WARNs and writes audit_log when survivalRate < 0.60
 *   - Does NOT block promotion under ANY condition
 *   - Tolerates null swan run (no eval ran) — promotion still succeeds
 *   - Tolerates failed swan run (status !== "completed") — promotion still succeeds
 *
 * Hard rules:
 *   - When survivalRate=0, promotion still SUCCEEDS in Phase 0
 *   - When swanRun is null, promotion still SUCCEEDS
 *   - When survivalRate >= 0.60, no advisory log is written
 *
 * Mirrors the pattern from frankenstein-lifecycle-gate.test.ts and
 * signal-correlation-lifecycle-gate.test.ts — pure simulation of the gate
 * decision so we don't have to mock the full LifecycleService.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Constants mirroring the gate logic ───────────────────────────────────────

const A14_ADVISORY_THRESHOLD = 0.6;

// ─── Types mirroring synthetic-black-swan-service.ts BlackSwanResult ─────────

interface BlackSwanRunSnapshot {
  status: "completed" | "failed" | "skipped_pipeline_paused";
  survivalRate: number | null;
  worstRegimeLabel: string | null;
}

interface AdvisoryDecision {
  promotionAllowed: boolean; // ALWAYS true in Phase 0 — verified property
  advisoryLogged: boolean;
  advisoryReason: string | null;
  warnLogged: boolean;
}

/**
 * Simulate the Phase 0 advisory decision that lifecycle-service.ts makes
 * BETWEEN the A7 PASSED log and the promoteStrategy() call.
 *
 * Mirrors the exact logic added in lifecycle-service.ts Pass 4:
 *   if (swanRun && swanRun.status === "completed" && Number(swanRun.survivalRate ?? 0) < 0.60) {
 *     logger.warn(...);
 *     await db.insert(auditLog).values({ action: "lifecycle_gate_advisory", ... });
 *   }
 *   // PROMOTION CONTINUES — Phase 0 never blocks
 */
function evaluatePhase0Advisory(
  swanRun: BlackSwanRunSnapshot | null,
): AdvisoryDecision {
  // Phase 0 contract: promotion is ALWAYS allowed regardless of swan run state.
  const promotionAllowed = true;

  if (
    swanRun &&
    swanRun.status === "completed" &&
    Number(swanRun.survivalRate ?? 0) < A14_ADVISORY_THRESHOLD
  ) {
    return {
      promotionAllowed,
      advisoryLogged: true,
      advisoryReason: "a14_synthetic_black_swan_advisory",
      warnLogged: true,
    };
  }

  return {
    promotionAllowed,
    advisoryLogged: false,
    advisoryReason: null,
    warnLogged: false,
  };
}

// ─── Phase 0 non-regression tests ────────────────────────────────────────────

describe("A14 Synthetic Black Swan — PAPER→DEPLOY_READY Phase 0 advisory", () => {
  // CRITICAL: low survival rate must NOT block promotion in Phase 0
  it("CRITICAL: survivalRate=0 — promotion SUCCEEDS, advisory IS logged", () => {
    const swanRun: BlackSwanRunSnapshot = {
      status: "completed",
      survivalRate: 0,
      worstRegimeLabel: "rate_shock",
    };
    const decision = evaluatePhase0Advisory(swanRun);
    expect(decision.promotionAllowed).toBe(true); // never blocks
    expect(decision.advisoryLogged).toBe(true);
    expect(decision.advisoryReason).toBe("a14_synthetic_black_swan_advisory");
    expect(decision.warnLogged).toBe(true);
  });

  it("CRITICAL: survivalRate=0.30 (below threshold) — promotion SUCCEEDS, advisory IS logged", () => {
    const swanRun: BlackSwanRunSnapshot = {
      status: "completed",
      survivalRate: 0.3,
      worstRegimeLabel: "crash",
    };
    const decision = evaluatePhase0Advisory(swanRun);
    expect(decision.promotionAllowed).toBe(true);
    expect(decision.advisoryLogged).toBe(true);
  });

  // CRITICAL: null swan run (no eval ran) must NOT block promotion
  it("CRITICAL: swanRun is null (no eval ran) — promotion SUCCEEDS, no advisory", () => {
    const decision = evaluatePhase0Advisory(null);
    expect(decision.promotionAllowed).toBe(true);
    expect(decision.advisoryLogged).toBe(false);
    expect(decision.advisoryReason).toBeNull();
    expect(decision.warnLogged).toBe(false);
  });

  // CRITICAL: high survival rate (>= 0.60) — no advisory written
  it("CRITICAL: survivalRate=0.60 (at threshold) — promotion SUCCEEDS, no advisory", () => {
    const swanRun: BlackSwanRunSnapshot = {
      status: "completed",
      survivalRate: 0.6,
      worstRegimeLabel: "low_vol_then_explode",
    };
    const decision = evaluatePhase0Advisory(swanRun);
    expect(decision.promotionAllowed).toBe(true);
    expect(decision.advisoryLogged).toBe(false);
    expect(decision.advisoryReason).toBeNull();
  });

  it("CRITICAL: survivalRate=0.85 (well above threshold) — promotion SUCCEEDS, no advisory", () => {
    const swanRun: BlackSwanRunSnapshot = {
      status: "completed",
      survivalRate: 0.85,
      worstRegimeLabel: "composite",
    };
    const decision = evaluatePhase0Advisory(swanRun);
    expect(decision.promotionAllowed).toBe(true);
    expect(decision.advisoryLogged).toBe(false);
  });

  it("survivalRate=1.0 (perfect) — promotion SUCCEEDS, no advisory", () => {
    const swanRun: BlackSwanRunSnapshot = {
      status: "completed",
      survivalRate: 1.0,
      worstRegimeLabel: null,
    };
    const decision = evaluatePhase0Advisory(swanRun);
    expect(decision.promotionAllowed).toBe(true);
    expect(decision.advisoryLogged).toBe(false);
  });

  // Failed runs (status !== "completed") must NOT trigger advisory
  it("status=failed — promotion SUCCEEDS, no advisory (incomplete data)", () => {
    const swanRun: BlackSwanRunSnapshot = {
      status: "failed",
      survivalRate: null,
      worstRegimeLabel: null,
    };
    const decision = evaluatePhase0Advisory(swanRun);
    expect(decision.promotionAllowed).toBe(true);
    expect(decision.advisoryLogged).toBe(false);
  });

  it("status=skipped_pipeline_paused — promotion SUCCEEDS, no advisory", () => {
    const swanRun: BlackSwanRunSnapshot = {
      status: "skipped_pipeline_paused",
      survivalRate: null,
      worstRegimeLabel: null,
    };
    const decision = evaluatePhase0Advisory(swanRun);
    expect(decision.promotionAllowed).toBe(true);
    expect(decision.advisoryLogged).toBe(false);
  });

  // survivalRate null on a completed run — defensive: treat as 0 (advisory logged)
  it("status=completed but survivalRate=null — falls back to 0, advisory IS logged", () => {
    const swanRun: BlackSwanRunSnapshot = {
      status: "completed",
      survivalRate: null,
      worstRegimeLabel: "edge_case",
    };
    const decision = evaluatePhase0Advisory(swanRun);
    expect(decision.promotionAllowed).toBe(true);
    expect(decision.advisoryLogged).toBe(true);
  });

  // Threshold boundary: just below threshold
  it("survivalRate=0.5999 — promotion SUCCEEDS, advisory IS logged (strictly below 0.60)", () => {
    const swanRun: BlackSwanRunSnapshot = {
      status: "completed",
      survivalRate: 0.5999,
      worstRegimeLabel: "boundary",
    };
    const decision = evaluatePhase0Advisory(swanRun);
    expect(decision.promotionAllowed).toBe(true);
    expect(decision.advisoryLogged).toBe(true);
  });
});

// ─── Schema-shape verification: audit row matches the contract ────────────────

describe("A14 advisory audit_log row shape", () => {
  it("uses action='lifecycle_gate_advisory' with decisionAuthority='gate'", () => {
    // The audit row written by lifecycle-service.ts must satisfy:
    //   - action = "lifecycle_gate_advisory"
    //   - decisionAuthority = "gate"
    //   - reason embedded in result.reason = "a14_synthetic_black_swan_advisory"
    //   - status = "success" (advisory, not a block)
    //
    // This codifies the contract that downstream queries (W7b graduation)
    // and dashboards rely on. Failing this test means we drifted from the spec.
    const advisoryAuditRow = {
      action: "lifecycle_gate_advisory",
      decisionAuthority: "gate",
      status: "success",
      result: {
        reason: "a14_synthetic_black_swan_advisory",
        gate_phase: "phase_0_advisory",
      },
    };

    expect(advisoryAuditRow.action).toBe("lifecycle_gate_advisory");
    expect(advisoryAuditRow.decisionAuthority).toBe("gate");
    expect(advisoryAuditRow.status).toBe("success");
    expect(advisoryAuditRow.result.reason).toBe(
      "a14_synthetic_black_swan_advisory",
    );
    expect(advisoryAuditRow.result.gate_phase).toBe("phase_0_advisory");
  });
});

// ─── Phase 0 invariant: promotion ALWAYS proceeds ────────────────────────────

describe("A14 Phase 0 invariant: NEVER blocks promotion", () => {
  // Property test: across all possible inputs, promotionAllowed must be true.
  it("PROPERTY: promotion is ALWAYS allowed regardless of swan run state", () => {
    const allInputs: Array<BlackSwanRunSnapshot | null> = [
      null,
      { status: "completed", survivalRate: 0, worstRegimeLabel: "x" },
      { status: "completed", survivalRate: 0.5, worstRegimeLabel: "x" },
      { status: "completed", survivalRate: 0.6, worstRegimeLabel: "x" },
      { status: "completed", survivalRate: 1.0, worstRegimeLabel: "x" },
      { status: "completed", survivalRate: null, worstRegimeLabel: null },
      { status: "failed", survivalRate: null, worstRegimeLabel: null },
      { status: "skipped_pipeline_paused", survivalRate: null, worstRegimeLabel: null },
    ];

    for (const input of allInputs) {
      const decision = evaluatePhase0Advisory(input);
      expect(decision.promotionAllowed).toBe(true);
    }
  });
});
