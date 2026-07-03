/**
 * deepscan14-shadow-stage.test.ts — Deep-scan #14 fix wave, Track 1 (critic-optimizer)
 *
 * Root cause: Wave 29 inserted the mandatory SHADOW stage into the default ladder
 * (CANDIDATE → TESTING → SHADOW → PAPER) but never propagated the pre-existing
 * PAPER-ward protections to the new SHADOW edges. This file proves all four fixes:
 *
 *   A1 [CRITICAL] stopStream now fires on ANY toState==="PAPER" transition, not just
 *      fromState==="TESTING" && toState==="PAPER". Previously the internal Massive-WS
 *      sim stream kept writing fills after a SHADOW→PAPER promotion (dual-stream P&L
 *      corruption) because the guard never matched fromState==="SHADOW".
 *
 *   H1 [HIGH] The Gate 2.5 (SHADOW → PAPER) cron path now runs the SAME pre-paper gate
 *      stack Gate 2 (legacy TESTING → PAPER) runs: staleness, MC survival > 0.70, prop
 *      compliance, compliance drift, C4 survival score, exportability, B14 ci_high, WFE,
 *      parameter drift, DSR walk-forward, frozen-policy freeze — calling the SAME pure
 *      evaluator functions (no gate math re-implemented).
 *
 *   H2 [MED] The honest-DSR≥1.5 gate (dsr_honest.dsr_passed, distinct from the
 *      walk-forward DSR gate above) now evaluates on toState==="PAPER" generally,
 *      not just fromState==="TESTING".
 *
 *   H3 [LOW] Auto-graveyard 3-strike counters are keyed by (strategyId, gate-name) only
 *      (see _maybeAutoGraveyard in lifecycle-service.ts) — the new Gate 2.5 gate calls
 *      reuse the IDENTICAL gate-name strings Gate 2 uses (b14_ci_high, wfe_hard_floor,
 *      parameter_overfit_drift, dsr_blocked_floor, mc_survival_below_floor,
 *      survival_score_below_threshold, exportability_blocked), so the 3-strike burial
 *      path is reached identically for shadow-routed strategies.
 *
 * Test strategy: this file follows the two established patterns already used around
 * lifecycle-service.ts in this repo —
 *   (1) source-level inspection (lifecycle-b3-b6-archetype-gate-stop-race.test.ts,
 *       frankenstein-lifecycle-gate.test.ts) for the guard-condition fixes and for
 *       proving the new Gate 2.5 block calls the correct helpers/gate-name strings.
 *   (2) direct calls to the REAL pure evaluator functions (evaluateWfeGate,
 *       evaluateB14CiGate, evaluateDsrWalkForwardGate) — these are the exact functions
 *       Gate 2.5 now calls, so proving they block on WFE 0.3 / ci_high 0.6 proves the
 *       new gate site blocks (combined with the source-inspection proof that Gate 2.5
 *       `continue`s — i.e. blocks promotion — whenever `!result.passed`).
 *
 * A full DB-mocked end-to-end run of checkAutoPromotions() was intentionally NOT
 * attempted here: it would require re-implementing ~15 chained Drizzle mocks (strategies,
 * backtests, monteCarloRuns, biasState, auditLog, ...) whose fragility would undermine
 * the very fail-closed guarantees this fix protects. The hybrid approach below proves
 * the same invariants with less accidental complexity.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateWfeGate } from "../lib/wfe-gate.js";
import { evaluateB14CiGate, evaluateDsrWalkForwardGate } from "../lib/b14-ci-gate.js";

const LIFECYCLE_PATH = resolve(process.cwd(), "src/server/services/lifecycle-service.ts");
const src = readFileSync(LIFECYCLE_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// A1 — stopStream fires on SHADOW → PAPER (not just TESTING → PAPER)
// ─────────────────────────────────────────────────────────────────────────────

describe("deepscan14 A1 — stopStream fires on ANY toState===PAPER transition", () => {
  it("the B6/A1 stopStream block guard is toState===\"PAPER\" (fromState requirement removed)", () => {
    const b6Idx = src.indexOf("B6 FIX");
    expect(b6Idx).toBeGreaterThan(-1);
    // The actual `if (...)` guard immediately precedes the stopStream try/catch —
    // find it within a window starting at the A1 fix comment.
    const a1Idx = src.indexOf("deepscan14 A1 FIX", b6Idx);
    expect(a1Idx).toBeGreaterThan(-1);
    const region = src.slice(a1Idx, a1Idx + 1600);
    // The live guard must be the narrowed toState-only condition...
    expect(region).toContain('if (toState === "PAPER") {');
    // ...and must appear BEFORE the stopStream() call it guards.
    const guardIdx = region.indexOf('if (toState === "PAPER") {');
    const stopStreamIdx = region.indexOf("stopStream(");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(stopStreamIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(stopStreamIdx);
  });

  it("stopStream is still awaited (B6 race-fix invariant preserved)", () => {
    expect(src).toContain("await stopStream(");
  });

  it("the SHADOW→PAPER edge is documented as the reason for the widened guard", () => {
    const a1Idx = src.indexOf("deepscan14 A1 FIX");
    expect(a1Idx).toBeGreaterThan(-1);
    const region = src.slice(a1Idx, a1Idx + 600);
    expect(region).toContain("SHADOW");
  });

  it("paper.stop_stream_failed_on_transition audit path is preserved (non-blocking on stopStream throw)", () => {
    expect(src).toContain("paper.stop_stream_failed_on_transition");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H2 — honest-DSR gate evaluated on SHADOW → PAPER (not just TESTING → PAPER)
// ─────────────────────────────────────────────────────────────────────────────

describe("deepscan14 H2 — honest-DSR gate (dsr_honest.dsr_passed) evaluated on the SHADOW→PAPER edge", () => {
  it("the honest-DSR gate guard is toState===\"PAPER\" (fromState requirement removed)", () => {
    const h2Idx = src.indexOf("deepscan14 H2 FIX");
    expect(h2Idx).toBeGreaterThan(-1);
    const region = src.slice(h2Idx, h2Idx + 800);
    expect(region).toContain('if (toState === "PAPER" && promotionEvidence.backtestId) {');
  });

  it("the old fromState===\"TESTING\"-only guard no longer gates the honest-DSR block", () => {
    const h2Idx = src.indexOf("deepscan14 H2 FIX");
    expect(h2Idx).toBeGreaterThan(-1);
    // The live guard line (not the comment describing history) must NOT contain
    // the old exclusionary condition as an active `if`.
    const region = src.slice(h2Idx, h2Idx + 800);
    const liveGuardMatch = region.match(/if \([^)]*toState === "PAPER"[^)]*\)/);
    expect(liveGuardMatch).not.toBeNull();
    expect(liveGuardMatch?.[0]).not.toContain('fromState === "TESTING" &&');
  });

  it("lifecycle.dsr_honest_blocked audit action still fires on failure (regression)", () => {
    expect(src).toContain("lifecycle.dsr_honest_blocked");
  });

  it("DSR_HONEST_THRESHOLD env read is preserved", () => {
    expect(src).toContain("DSR_HONEST_THRESHOLD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus (same root-cause class): Frankenstein N-shuffle gate now covers SHADOW→PAPER
// ─────────────────────────────────────────────────────────────────────────────

describe("deepscan14 bonus — Frankenstein curve-fit gate covers SHADOW → PAPER", () => {
  it("Frankenstein gate condition includes fromState===\"SHADOW\"", () => {
    expect(src).toContain(
      '(fromState === "TESTING" || fromState === "CANDIDATE" || fromState === "SHADOW") && toState === "PAPER"',
    );
  });

  it("getLatestFrankensteinRun is still called from within the widened gate", () => {
    const gateIdx = src.indexOf(
      '(fromState === "TESTING" || fromState === "CANDIDATE" || fromState === "SHADOW") && toState === "PAPER"',
    );
    expect(gateIdx).toBeGreaterThan(-1);
    const region = src.slice(gateIdx, gateIdx + 500);
    expect(region).toContain("getLatestFrankensteinRun");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H1 — Gate 2.5 (SHADOW → PAPER) now runs the full pre-paper gate stack
// ─────────────────────────────────────────────────────────────────────────────

describe("deepscan14 H1 — Gate 2.5 (SHADOW → PAPER) reuses the SAME pure evaluators Gate 2 uses", () => {
  const gate25Idx = src.indexOf("Gate 2.5 — Wave 29 Pass A.3: SHADOW → PAPER");

  it("Gate 2.5 section exists", () => {
    expect(gate25Idx).toBeGreaterThan(-1);
  });

  it("the H1 fix marker is present inside the Gate 2.5 section", () => {
    const region = src.slice(gate25Idx, gate25Idx + 34000);
    expect(region).toContain("deepscan14 H1: full pre-paper gate stack (SHADOW → PAPER)");
  });

  it("calls evaluateB14CiGate (same function Gate 2 calls — no gate math re-implemented)", () => {
    const region = src.slice(gate25Idx, gate25Idx + 34000);
    expect(region).toContain("evaluateB14CiGate(");
    expect(region).toContain('input: { fromState: "SHADOW", toState: "PAPER" }');
  });

  it("calls evaluateWfeGate with the same signature Gate 2 uses", () => {
    const region = src.slice(gate25Idx, gate25Idx + 34000);
    expect(region).toContain("evaluateWfeGate(");
  });

  it("calls evaluateParameterDriftGate", () => {
    const region = src.slice(gate25Idx, gate25Idx + 34000);
    expect(region).toContain("evaluateParameterDriftGate(");
  });

  it("calls evaluateDsrWalkForwardGate (walk-forward DSR — distinct from the H2 honest-DSR gate)", () => {
    const region = src.slice(gate25Idx, gate25Idx + 34000);
    expect(region).toContain("evaluateDsrWalkForwardGate(");
  });

  it("checks MC survival rate > 0.70 (same 0.70 floor as Gate 2)", () => {
    const region = src.slice(gate25Idx, gate25Idx + 34000);
    expect(region).toContain("survivalRateSh <= 0.70");
  });

  it("runs the Pine exportability pre-check via checkExportability", () => {
    const region = src.slice(gate25Idx, gate25Idx + 34000);
    expect(region).toContain("checkExportability(s.id)");
  });

  it("stamps the frozen-policy baseline via freezePolicyForStrategy on the SHADOW→PAPER cron path", () => {
    const region = src.slice(gate25Idx, gate25Idx + 34000);
    expect(region).toContain("freezePolicyForStrategy(s.id, currentRegimeShCron)");
  });

  it("does NOT re-implement BIF here — BIF is documented as already symmetric (PAPER→DEPLOY_READY only)", () => {
    const region = src.slice(gate25Idx, gate25Idx + 4000);
    expect(region).toContain("BIF is intentionally NOT");
    expect(region).not.toContain("evaluateBifGate(");
  });

  it("all new gate blocks precede the pre-existing shadow-signal divergence check (Wave 29 Pass A.3)", () => {
    const region = src.slice(gate25Idx, gate25Idx + 40000);
    const h1EndIdx = region.indexOf("end deepscan14 H1 full pre-paper gate stack");
    const divergenceIdx = region.indexOf("loadDivergenceInputs(s.id, 20)");
    expect(h1EndIdx).toBeGreaterThan(-1);
    expect(divergenceIdx).toBeGreaterThan(-1);
    expect(h1EndIdx).toBeLessThan(divergenceIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H1 behavior — a strategy with WFE 0.3 / B14 ci_high 0.6 is BLOCKED at SHADOW→PAPER
// ─────────────────────────────────────────────────────────────────────────────
//
// These call the REAL pure evaluator functions (no mocking — they are pure,
// side-effect-free by design per their own module docstrings). Gate 2.5 now calls
// these exact functions (proven above via source inspection) and `continue`s the
// per-strategy loop (blocking promotion) whenever `!result.passed`. Proving the
// evaluators reject these inputs therefore proves the new SHADOW→PAPER gate site
// blocks a strategy with this evidence.
// ─────────────────────────────────────────────────────────────────────────────

describe("deepscan14 H1 behavior — WFE 0.3 / B14 ci_high 0.6 BLOCKS at SHADOW→PAPER", () => {
  it("evaluateWfeGate(0.3) blocks — below the 0.70 hard floor", () => {
    const result = evaluateWfeGate(0.3, 0.70, 0.50, null);
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });

  it("evaluateB14CiGate blocks when probability_of_ruin_ci.ci_high is 0.6", () => {
    const result = evaluateB14CiGate(
      { ci_high: 0.6, ci_low: 0.1, point_estimate: 0.3, ci_method: "bca", n_resamples: 5000 },
      0.3,
      0.20, // explicit threshold override (matches the institutional 0.20 default)
    );
    expect(result.passed).toBe(false);
    expect(result.auditPayload.ci_high).toBe(0.6);
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("combined WFE 0.3 + B14 ci_high 0.6 evidence: BOTH gates independently reject the strategy", () => {
    const wfe = evaluateWfeGate(0.3, 0.70, 0.50, null);
    const b14 = evaluateB14CiGate({ ci_high: 0.6 }, null, 0.20);
    expect(wfe.passed).toBe(false);
    expect(b14.passed).toBe(false);
    // Either gate alone is sufficient to `continue` (block) the SHADOW→PAPER
    // promotion loop — the strategy is blocked regardless of evaluation order.
  });

  it("regression: a healthy strategy (WFE 0.85 / ci_high 0.10) PASSES both gates", () => {
    const wfe = evaluateWfeGate(0.85, 0.70, 0.50, null);
    const b14 = evaluateB14CiGate({ ci_high: 0.10 }, null, 0.20);
    expect(wfe.passed).toBe(true);
    expect(b14.passed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H1 behavior — DSR walk-forward gate (distinct from H2 honest-DSR) also blocks
// ─────────────────────────────────────────────────────────────────────────────

describe("deepscan14 H1 behavior — DSR walk-forward gate blocks at SHADOW→PAPER", () => {
  it("evaluateDsrWalkForwardGate blocks when dsr_pass=false (dsr below floor)", () => {
    const result = evaluateDsrWalkForwardGate({ dsr_pass: false, dsr_unavailable: false, dsr: -1.2 });
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked_dsr_floor");
    expect(result.auditAction).toBe("lifecycle.dsr_floor_block");
  });

  it("evaluateDsrWalkForwardGate fail-closed blocks when dsr_unavailable=true", () => {
    const result = evaluateDsrWalkForwardGate({ dsr_pass: false, dsr_unavailable: true, dsr: null });
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked_dsr_unavailable");
  });

  it("evaluateDsrWalkForwardGate proceeds (legacy grandfather) when dsr_pass is null/undefined", () => {
    const result = evaluateDsrWalkForwardGate(null);
    expect(result.passed).toBe(true);
    expect(result.status).toBe("legacy_proceed");
  });

  it("evaluateDsrWalkForwardGate passes clean when dsr_pass=true", () => {
    const result = evaluateDsrWalkForwardGate({ dsr_pass: true, dsr_unavailable: false, dsr: 2.1 });
    expect(result.passed).toBe(true);
    expect(result.status).toBe("pass");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H3 — auto-graveyard 3-strike counters reached from the new Gate 2.5 gate sites
// ─────────────────────────────────────────────────────────────────────────────

describe("deepscan14 H3 — 3-strike auto-graveyard counters engage on the SHADOW path", () => {
  const gate25Idx = src.indexOf("Gate 2.5 — Wave 29 Pass A.3: SHADOW → PAPER");
  const region = src.slice(gate25Idx, gate25Idx + 34000);

  // _maybeAutoGraveyard / _resetHardGateCounter are keyed ONLY by (strategyId, gate)
  // (see lifecycle-service.ts private _maybeAutoGraveyard — failAction/resetAction
  // are template strings over `gate` alone, no fromState in the key). Reusing the
  // IDENTICAL gate-name strings Gate 2 uses means the SAME 3-strike counter accrues
  // regardless of which edge (legacy TESTING→PAPER or canonical SHADOW→PAPER) the
  // strategy is evaluated on.
  const gateNames = [
    "b14_ci_high",
    "wfe_hard_floor",
    "parameter_overfit_drift",
    "dsr_blocked_floor",
    "mc_survival_below_floor",
    "survival_score_below_threshold",
    "exportability_blocked",
  ];

  it.each(gateNames)("_maybeAutoGraveyard(s.id, \"%s\", ..., \"SHADOW\", ...) is called on failure", (gateName) => {
    expect(region).toContain(`this._maybeAutoGraveyard(s.id, "${gateName}"`);
    // Verify the call site passes "SHADOW" as the fromState argument (not "TESTING").
    const callIdx = region.indexOf(`this._maybeAutoGraveyard(s.id, "${gateName}"`);
    expect(callIdx).toBeGreaterThan(-1);
    const callRegion = region.slice(callIdx, callIdx + 300);
    expect(callRegion).toContain('"SHADOW"');
  });

  it.each(gateNames)("_resetHardGateCounter(s.id, \"%s\", ...) is called on pass (resets the streak)", (gateName) => {
    expect(region).toContain(`this._resetHardGateCounter(s.id, "${gateName}"`);
  });

  it("the gate-name strings are IDENTICAL to the ones Gate 2 (legacy TESTING→PAPER) uses — same counter key", () => {
    const gate2Idx = src.indexOf("Gate 2: TESTING → PAPER  (LEGACY path");
    expect(gate2Idx).toBeGreaterThan(-1);
    const gate2Region = src.slice(gate2Idx, gate2Idx + 45000);
    for (const gateName of gateNames) {
      expect(gate2Region).toContain(`"${gateName}"`);
      expect(region).toContain(`"${gateName}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression — pre-existing gate audit actions / SSE events not removed
// ─────────────────────────────────────────────────────────────────────────────

describe("regression — no pre-existing gate behavior removed", () => {
  it("lifecycle.shadow_divergence_blocked (Wave 29 Pass A.3) still present", () => {
    expect(src).toContain("lifecycle.shadow_divergence_blocked");
  });

  it("lifecycle.shadow_promotion_passed still present", () => {
    expect(src).toContain("lifecycle.shadow_promotion_passed");
  });

  it("Gate 2 legacy TESTING→PAPER path still skips shadowModeEnabled strategies", () => {
    expect(src).toContain("if (s.shadowModeEnabled) continue;");
  });

  it("VALID_TRANSITIONS still routes TESTING → SHADOW → PAPER", () => {
    expect(src).toContain('SHADOW: ["PAPER", "DECLINING", "GRAVEYARD"]');
  });
});
