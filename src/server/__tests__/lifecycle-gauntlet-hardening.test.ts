/**
 * lifecycle-gauntlet-hardening.test.ts — Promotion Gauntlet Fail-Closed Hardening
 *
 * TDD tests for F-1 through F-6 fixes. Written FAILING first, then made green by fixes.
 *
 * F-1: PAPER→DEPLOY_READY evaluator error → fail-CLOSED (return success:false)
 * F-2a: SHADOW→PAPER evaluator error in _promoteStrategyInner → fail-CLOSED
 * F-2b: SHADOW→PAPER cron grandfather window → ABORT + lifecycle.shadow_divergence_unavailable_blocked audit
 * F-3: CANDIDATE→PAPER: production caller identified (backtest fast-track); VALID_TRANSITIONS preserved;
 *       _promoteStrategyInner does NOT require shadow evidence (fast-track has its own gates)
 * F-4: Orchestrator null-datum gates → fail-CLOSED by default; fail-OPEN only when PROMOTION_GRANDFATHER_PRE_PASS_E="true"
 *       Also: orchestrator outer try/catch in cron → fail-CLOSED
 * F-5: Standalone WFE gate (floor 0.70) removed from PAPER→DEPLOY_READY cron path; only orchestrator 0.80 governs
 * F-6: TESTING→PAPER cron B14 CI gate catch → fail-CLOSED
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LIFECYCLE_PATH = resolve(process.cwd(), "src/server/services/lifecycle-service.ts");
const ORCHESTRATOR_PATH = resolve(process.cwd(), "src/server/lib/promotion-gate-orchestrator.ts");

// ─────────────────────────────────────────────────────────────────────────────
// F-1: PAPER→DEPLOY_READY evaluator catch → fail-CLOSED
// ─────────────────────────────────────────────────────────────────────────────

describe("F-1 — PAPER→DEPLOY_READY evaluator fail-CLOSED", () => {
  it("catch block does NOT contain 'fail-open' in PAPER→DEPLOY_READY evaluator catch", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Find the pdrGateErr catch block
    const pdrCatchIdx = src.indexOf("catch (pdrGateErr)");
    expect(pdrCatchIdx).toBeGreaterThan(-1);
    // Read 400 chars after catch
    const catchBlock = src.slice(pdrCatchIdx, pdrCatchIdx + 400);
    expect(catchBlock).not.toContain("fail-open");
    expect(catchBlock).not.toContain("promotion continues via legacy gates");
  });

  it("catch block returns { success: false } on pdrGateErr", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const pdrCatchIdx = src.indexOf("catch (pdrGateErr)");
    expect(pdrCatchIdx).toBeGreaterThan(-1);
    const catchBlock = src.slice(pdrCatchIdx, pdrCatchIdx + 700);
    expect(catchBlock).toContain("return { success: false");
  });

  it("catch block returns error string containing 'paper_to_deploy_ready_gate_evaluator_error'", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const pdrCatchIdx = src.indexOf("catch (pdrGateErr)");
    expect(pdrCatchIdx).toBeGreaterThan(-1);
    const catchBlock = src.slice(pdrCatchIdx, pdrCatchIdx + 700);
    expect(catchBlock).toContain("paper_to_deploy_ready_gate_evaluator_error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-2a: SHADOW→PAPER evaluator catch in _promoteStrategyInner → fail-CLOSED
// ─────────────────────────────────────────────────────────────────────────────

describe("F-2a — SHADOW→PAPER evaluator fail-CLOSED in _promoteStrategyInner", () => {
  it("catch block does NOT contain 'fail-open' in SHADOW→PAPER evaluator catch", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const catchIdx = src.indexOf("catch (shadowGateErr)");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = src.slice(catchIdx, catchIdx + 400);
    expect(catchBlock).not.toContain("fail-open");
    expect(catchBlock).not.toContain("promotion continues");
  });

  it("catch block returns { success: false } on shadowGateErr", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const catchIdx = src.indexOf("catch (shadowGateErr)");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = src.slice(catchIdx, catchIdx + 700);
    expect(catchBlock).toContain("return { success: false");
  });

  it("catch block returns error string containing 'shadow_to_paper_gate_evaluator_error'", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const catchIdx = src.indexOf("catch (shadowGateErr)");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = src.slice(catchIdx, catchIdx + 700);
    expect(catchBlock).toContain("shadow_to_paper_gate_evaluator_error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-2b: SHADOW→PAPER cron grandfather window → ABORT (not promote)
// ─────────────────────────────────────────────────────────────────────────────

describe("F-2b — SHADOW→PAPER cron grandfather window — ABORT not promote", () => {
  it("shadowStratErr catch does NOT call promoteStrategy (no grandfather promotion)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const catchIdx = src.indexOf("catch (shadowStratErr");
    expect(catchIdx).toBeGreaterThan(-1);
    // Read 600 chars — should NOT contain a promoteStrategy call inside the catch
    const catchBlock = src.slice(catchIdx, catchIdx + 600);
    // The old code called this.promoteStrategy inside the catch; fix removes it
    expect(catchBlock).not.toMatch(/promoteStrategy\s*\(/);
  });

  it("shadowStratErr catch emits lifecycle.shadow_divergence_unavailable_blocked audit action", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("lifecycle.shadow_divergence_unavailable_blocked");
  });

  it("shadowStratErr catch does NOT contain legacy 'grandfather window' promotion-continues log text", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const catchIdx = src.indexOf("catch (shadowStratErr");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = src.slice(catchIdx, catchIdx + 600);
    expect(catchBlock).not.toContain("promotion proceeds via classical gates");
    expect(catchBlock).not.toContain("proceeded via legacy fallback");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-3: CANDIDATE→SHADOW — fast-track routes through SHADOW, not PAPER (2026-06-23 fix)
// NO strategy may reach PAPER without SHADOW skew measurement.
// ─────────────────────────────────────────────────────────────────────────────

describe("F-3 — CANDIDATE→SHADOW (fast-track routes through shadow, not paper)", () => {
  it("VALID_TRANSITIONS CANDIDATE does NOT allow CANDIDATE→PAPER (fail-closed, real money gate)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const candidateIdx = src.indexOf('CANDIDATE: [');
    expect(candidateIdx).toBeGreaterThan(-1);
    const lineEnd = src.indexOf(']', candidateIdx);
    const candidateLine = src.slice(candidateIdx, lineEnd + 1);
    // PAPER must NOT appear as a direct CANDIDATE target
    expect(candidateLine).not.toContain('"PAPER"');
  });

  it("VALID_TRANSITIONS CANDIDATE allows CANDIDATE→SHADOW (fast-track skew measurement entry)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const candidateIdx = src.indexOf('CANDIDATE: [');
    expect(candidateIdx).toBeGreaterThan(-1);
    const lineEnd = src.indexOf(']', candidateIdx);
    const candidateLine = src.slice(candidateIdx, lineEnd + 1);
    expect(candidateLine).toContain('"SHADOW"');
  });

  it("backtest-service.ts fast-track calls promoteStrategy with SHADOW target (not PAPER)", () => {
    const backtestSrc = readFileSync(
      resolve(process.cwd(), "src/server/services/backtest-service.ts"),
      "utf8",
    );
    // The fast-track must call promoteStrategy targeting SHADOW
    expect(backtestSrc).toContain("CANDIDATE");
    expect(backtestSrc).toContain('"SHADOW"');
    expect(backtestSrc).toContain("promoteStrategy");
    // The literal fast-track promote call must not say "CANDIDATE", "PAPER"
    expect(backtestSrc).not.toMatch(/promoteStrategy\s*\(\s*\n\s*strategyId\s*,\s*\n\s*"CANDIDATE"\s*,\s*\n\s*"PAPER"/);
  });

  it("lifecycle-service.ts documents F-3 fix rationale (CANDIDATE→SHADOW route)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // A comment documenting the F-3 decision must exist near VALID_TRANSITIONS
    const candidateIdx = src.indexOf('CANDIDATE: [');
    expect(candidateIdx).toBeGreaterThan(-1);
    const surroundingBlock = src.slice(Math.max(0, candidateIdx - 800), candidateIdx + 300);
    expect(surroundingBlock).toContain("F-3");
    expect(surroundingBlock).toContain("SHADOW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-4: Orchestrator null-datum gates → fail-CLOSED by default
// ─────────────────────────────────────────────────────────────────────────────

describe("F-4 — Orchestrator null-datum gates default to fail-CLOSED", () => {
  const origFlag = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;

  beforeEach(() => {
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
  });

  afterEach(() => {
    if (origFlag === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = origFlag;
  });

  it("PROMOTION_GRANDFATHER_PRE_PASS_E env var referenced in orchestrator source", () => {
    const src = readFileSync(ORCHESTRATOR_PATH, "utf8");
    expect(src).toContain("PROMOTION_GRANDFATHER_PRE_PASS_E");
  });

  it("null cpcvNPaths → passed:false when PROMOTION_GRANDFATHER_PRE_PASS_E not set (fail-CLOSED)", async () => {
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({ cpcvNPaths: null, wfeOverall: 0.85, wrcPValue: 0.02, spaConsistentP: 0.03 });
    expect(result.gate_results.cpcv_n_paths.passed).toBe(false);
    expect(result.gate_results.cpcv_n_paths.data_available).toBe(false);
    expect(result.gate_results.cpcv_n_paths.reason).toContain("fail-closed");
  });

  it("null wrcPValue → passed:false when PROMOTION_GRANDFATHER_PRE_PASS_E not set (fail-CLOSED)", async () => {
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({ wrcPValue: null, wfeOverall: 0.85, cpcvNPaths: 15, spaConsistentP: 0.03 });
    expect(result.gate_results.wrc_p.passed).toBe(false);
    expect(result.gate_results.wrc_p.data_available).toBe(false);
    expect(result.gate_results.wrc_p.reason).toContain("fail-closed");
  });

  it("null spaConsistentP → passed:false when PROMOTION_GRANDFATHER_PRE_PASS_E not set (fail-CLOSED)", async () => {
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({ spaConsistentP: null, wfeOverall: 0.85, cpcvNPaths: 15, wrcPValue: 0.02 });
    expect(result.gate_results.spa_p.passed).toBe(false);
    expect(result.gate_results.spa_p.data_available).toBe(false);
    expect(result.gate_results.spa_p.reason).toContain("fail-closed");
  });

  it("null ruinCi + null ruinPointEstimate → passed:false when PROMOTION_GRANDFATHER_PRE_PASS_E not set (fail-CLOSED)", async () => {
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({ ruinCi: null, ruinPointEstimate: null, wfeOverall: 0.85, cpcvNPaths: 15, wrcPValue: 0.02, spaConsistentP: 0.03 });
    expect(result.gate_results.b14_ci_high.passed).toBe(false);
    expect(result.gate_results.b14_ci_high.data_available).toBe(false);
    expect(result.gate_results.b14_ci_high.reason).toContain("fail-closed");
  });

  it("null cpcvNPaths → passed:true ONLY when PROMOTION_GRANDFATHER_PRE_PASS_E='true' (opt-in fail-open)", async () => {
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({ cpcvNPaths: null, wfeOverall: 0.85, wrcPValue: 0.02, spaConsistentP: 0.03 });
    expect(result.gate_results.cpcv_n_paths.passed).toBe(true);
    expect(result.gate_results.cpcv_n_paths.data_available).toBe(false);
  });

  it("null wrcPValue → passed:true ONLY when PROMOTION_GRANDFATHER_PRE_PASS_E='true'", async () => {
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({ wrcPValue: null, wfeOverall: 0.85, cpcvNPaths: 15, spaConsistentP: 0.03 });
    expect(result.gate_results.wrc_p.passed).toBe(true);
    expect(result.gate_results.wrc_p.data_available).toBe(false);
  });

  it("null spaConsistentP → passed:true ONLY when PROMOTION_GRANDFATHER_PRE_PASS_E='true'", async () => {
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({ spaConsistentP: null, wfeOverall: 0.85, cpcvNPaths: 15, wrcPValue: 0.02 });
    expect(result.gate_results.spa_p.passed).toBe(true);
    expect(result.gate_results.spa_p.data_available).toBe(false);
  });

  it("null ruinCi → passed:true ONLY when PROMOTION_GRANDFATHER_PRE_PASS_E='true'", async () => {
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({ ruinCi: null, ruinPointEstimate: null, wfeOverall: 0.85, cpcvNPaths: 15, wrcPValue: 0.02, spaConsistentP: 0.03 });
    expect(result.gate_results.b14_ci_high.passed).toBe(true);
    expect(result.gate_results.b14_ci_high.data_available).toBe(false);
  });

  it("empty data with PROMOTION_GRANDFATHER_PRE_PASS_E='true' → all null gates pass (backward compat)", async () => {
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({});
    expect(result.can_promote).toBe(true);
    expect(result.n_gates_failed).toBe(0);
  });

  it("empty data with PROMOTION_GRANDFATHER_PRE_PASS_E unset → all null gates FAIL (fail-CLOSED)", async () => {
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({});
    // B14, CPCV, WRC, SPA all null → all fail-closed
    expect(result.gate_results.cpcv_n_paths.passed).toBe(false);
    expect(result.gate_results.wrc_p.passed).toBe(false);
    expect(result.gate_results.spa_p.passed).toBe(false);
    expect(result.gate_results.b14_ci_high.passed).toBe(false);
    expect(result.can_promote).toBe(false);
  });

  it("orchestrator outer catch in cron does NOT contain 'fail-open' text", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const orchCatchIdx = src.indexOf("catch (orchErr)");
    expect(orchCatchIdx).toBeGreaterThan(-1);
    const catchBlock = src.slice(orchCatchIdx, orchCatchIdx + 500);
    expect(catchBlock).not.toContain("fail-open");
    expect(catchBlock).not.toContain("non-blocking — promotion continues");
  });

  it("orchestrator outer catch in cron emits audit action and uses continue to skip", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const orchCatchIdx = src.indexOf("catch (orchErr)");
    expect(orchCatchIdx).toBeGreaterThan(-1);
    // Use 2100 chars to capture the full catch block including the audit insert, .catch chain,
    // and continue. Widened from 1800 (deep-scan #16 Wave-1 Track 5, HIGH E-6) to accommodate
    // the additive tf_wfe_gate_total error-outcome counter increment line at the top of this
    // catch block — a non-blocking observability addition, not a control-flow change.
    const catchBlock = src.slice(orchCatchIdx, orchCatchIdx + 2100);
    // Must skip promotion — either via continue or return
    const hasContinue = catchBlock.includes("continue;");
    expect(hasContinue).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-5: Standalone WFE 0.70 gate removed from PAPER→DEPLOY_READY cron path
// ─────────────────────────────────────────────────────────────────────────────

describe("F-5 — Double WFE evaluation removed from PAPER→DEPLOY_READY cron path", () => {
  it("only ONE evaluateWfeGate call exists in PAPER→DEPLOY_READY cron block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    // The PAPER→DEPLOY_READY cron section starts after the SHADOW→PAPER section
    // Use the "Gate 3: PAPER → DEPLOY_READY" anchor to isolate the block
    const pdrCronStart = src.indexOf("Gate 3: PAPER → DEPLOY_READY");
    expect(pdrCronStart).toBeGreaterThan(-1);

    // The next major gate section after PAPER→DEPLOY_READY loop ends the block
    // Use "Gate 4" or "PILOT" as boundary — safe enough for isolation
    const pdrCronEnd = src.indexOf("Gate 4", pdrCronStart);
    const pdrBlock = pdrCronEnd > 0
      ? src.slice(pdrCronStart, pdrCronEnd)
      : src.slice(pdrCronStart, pdrCronStart + 25000); // fallback: read 25K chars

    // Count occurrences of evaluateWfeGate in the PAPER→DEPLOY_READY cron block
    const wfeCallCount = (pdrBlock.match(/evaluateWfeGate\(/g) ?? []).length;

    // F-5 fix: the standalone evaluateWfeGate call with 0.70 floor is REMOVED.
    // Only the orchestrator now evaluates WFE (at 0.80 floor), and the orchestrator
    // calls evaluateWfeGate internally — that call is inside promotion-gate-orchestrator.ts,
    // not in lifecycle-service.ts. So lifecycle-service.ts should have 0 direct
    // evaluateWfeGate calls in the PAPER→DEPLOY_READY cron section.
    expect(wfeCallCount).toBe(0);
  });

  it("orchestrator still contains evaluateWfeGate (0.80 floor) in promotion-gate-orchestrator.ts", () => {
    const src = readFileSync(ORCHESTRATOR_PATH, "utf8");
    expect(src).toContain("evaluateWfeGate");
  });

  it("WFE_HARD_FLOOR env var comment is absent or refers only to TESTING→PAPER in lifecycle-service cron", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // After F-5 fix, the standalone WFE gate block at PAPER→DEPLOY_READY that references
    // WFE_HARD_FLOOR should be gone. The TESTING→PAPER WFE call is unaffected.
    // Count evaluateWfeGate calls in lifecycle-service.ts total.
    const allWfeCalls = (src.match(/evaluateWfeGate\(/g) ?? []).length;
    // TESTING→PAPER = 1 call; PAPER→DEPLOY_READY standalone = 0 (removed by F-5);
    // deepscan14 H1 = 1 call added at SHADOW→PAPER (Gate 2.5) to restore the full
    // pre-paper gate stack on the canonical Wave 29 ladder; goalscan-crit WAVE 2
    // added 1 more call to bring the manual _promoteStrategyInner path to parity
    // with the cron gate stack. Total is now 3.
    expect(allWfeCalls).toBeLessThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-6: TESTING→PAPER cron B14 CI gate catch → fail-CLOSED
// ─────────────────────────────────────────────────────────────────────────────

describe("F-6 — TESTING→PAPER cron B14 CI gate fail-CLOSED", () => {
  it("b14TpErr catch block does NOT contain 'fail-open' or 'non-blocking'", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const catchIdx = src.indexOf("catch (b14TpErr)");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = src.slice(catchIdx, catchIdx + 400);
    expect(catchBlock).not.toContain("fail-open");
    expect(catchBlock).not.toContain("non-blocking — promotion continues");
  });

  it("b14TpErr catch block uses continue to skip promotion", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const catchIdx = src.indexOf("catch (b14TpErr)");
    expect(catchIdx).toBeGreaterThan(-1);
    // Use 1700 chars to capture full catch block including audit insert and continue.
    // Widened from 1500 (deep-scan #16 Wave-1 Track 5, HIGH E-6) to accommodate the
    // additive tf_b14_gate_total error-outcome counter increment line at the top of
    // this catch block — a non-blocking observability addition, not a control-flow change.
    const catchBlock = src.slice(catchIdx, catchIdx + 1700);
    expect(catchBlock).toContain("continue;");
  });

  it("b14TpErr catch block emits audit row (db.insert)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const catchIdx = src.indexOf("catch (b14TpErr)");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = src.slice(catchIdx, catchIdx + 1700);
    expect(catchBlock).toContain("db.insert(auditLog)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator real-data paths still work correctly after F-4 changes
// ─────────────────────────────────────────────────────────────────────────────

describe("Orchestrator real-data paths (non-null) remain correct after F-4", () => {
  const origFlag = process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;

  beforeEach(() => {
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
  });

  afterEach(() => {
    if (origFlag === undefined) delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
    else process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = origFlag;
  });

  it("all gates pass with real data (wfe=0.85, cpcv=15, wrc=0.02, spa=0.03, ci_high=0.20)", async () => {
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({
      ruinCi: { ci_high: 0.20, ci_low: 0.05, point_estimate: 0.15 },
      ruinPointEstimate: 0.15,
      wfeOverall: 0.85,
      cpcvNPaths: 15,
      wrcPValue: 0.02,
      spaConsistentP: 0.03,
    });
    expect(result.can_promote).toBe(true);
    expect(result.n_gates_failed).toBe(0);
  });

  it("WFE 0.75 still fails (below 0.80 floor)", async () => {
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({
      ruinCi: { ci_high: 0.20, ci_low: 0.05, point_estimate: 0.15 },
      wfeOverall: 0.75,
      cpcvNPaths: 15,
      wrcPValue: 0.02,
      spaConsistentP: 0.03,
    });
    expect(result.gate_results.wfe_floor.passed).toBe(false);
    expect(result.can_promote).toBe(false);
  });

  it("CPCV 14 still fails (below 15 floor)", async () => {
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({
      ruinCi: { ci_high: 0.20, ci_low: 0.05, point_estimate: 0.15 },
      wfeOverall: 0.85,
      cpcvNPaths: 14,
      wrcPValue: 0.02,
      spaConsistentP: 0.03,
    });
    expect(result.gate_results.cpcv_n_paths.passed).toBe(false);
    expect(result.can_promote).toBe(false);
  });

  it("WRC p=0.06 still fails (>= 0.05 threshold)", async () => {
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({
      ruinCi: { ci_high: 0.20, ci_low: 0.05, point_estimate: 0.15 },
      wfeOverall: 0.85,
      cpcvNPaths: 15,
      wrcPValue: 0.06,
      spaConsistentP: 0.03,
    });
    expect(result.gate_results.wrc_p.passed).toBe(false);
    expect(result.can_promote).toBe(false);
  });

  it("B14 ci_high=0.45 still fails (above 0.40 threshold)", async () => {
    const { evaluatePromotionGates } = await import(
      "../../server/lib/promotion-gate-orchestrator.js"
    );
    const result = evaluatePromotionGates({
      ruinCi: { ci_high: 0.45, ci_low: 0.20, point_estimate: 0.35 },
      wfeOverall: 0.85,
      cpcvNPaths: 15,
      wrcPValue: 0.02,
      spaConsistentP: 0.03,
    });
    expect(result.gate_results.b14_ci_high.passed).toBe(false);
    expect(result.can_promote).toBe(false);
  });
});
