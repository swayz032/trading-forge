/**
 * lifecycle-pass5-paper-deploy-ready.test.ts — Pass 5 Track C/D
 *
 * Source-code analysis tests for evaluatePaperToDeployReadyGates wiring
 * in _promoteStrategyInner. Mocks paper-to-deploy-ready-gates.ts (Track A —
 * not yet merged). No DB or service calls required.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LIFECYCLE_PATH = resolve(process.cwd(), "src/server/services/lifecycle-service.ts");

describe("Pass 5 Track C — PAPER→DEPLOY_READY evaluator wiring in lifecycle-service.ts", () => {
  it("imports evaluatePaperToDeployReadyGates dynamically from paper-to-deploy-ready-gates.js", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("evaluatePaperToDeployReadyGates");
    expect(src).toContain("paper-to-deploy-ready-gates.js");
  });

  it("evaluatePaperToDeployReadyGates call is inside fromState === 'PAPER' && toState === 'DEPLOY_READY' guard", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const pdrBlock = src.indexOf('fromState === "PAPER" && toState === "DEPLOY_READY"');
    expect(pdrBlock).toBeGreaterThan(-1);
    const afterBlock = src.slice(pdrBlock, pdrBlock + 2000);
    expect(afterBlock).toContain("evaluatePaperToDeployReadyGates");
  });

  // 2026-06-29 (deep-scan #4): these were brittle fixed-char-window slices that broke
  // when Track A added code between `const pdrInput:` and the block (the snippets were
  // already beyond the 4000/6000-char windows at baseline). Rewritten to robust
  // whole-file assertions on the UNIQUE PDR markers — same intent, refactor-proof.
  it("blocks with return { success: false } when passed===false", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("!gatePdrResult.passed");
    // The block guard and its fail-closed return both present in the consolidated path.
    // Window spans the in-block audit insert + SSE broadcast that sit before the return.
    const guardIdx = src.indexOf("!gatePdrResult.passed");
    expect(src.slice(guardIdx, guardIdx + 1300)).toContain("return { success: false");
  });

  it("inserts audit row on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // PDR-specific audit action (unique marker — not the generic db.insert(auditLog)).
    expect(src).toContain("lifecycle.paper_to_deploy_ready_blocked");
    const actionIdx = src.indexOf("lifecycle.paper_to_deploy_ready_blocked");
    expect(src.slice(actionIdx - 300, actionIdx)).toContain("db.insert(auditLog)");
  });

  it("broadcasts SSE on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // SSE is broadcast via the typed catalog constant, not a raw colon-string.
    expect(src).toContain("LIFECYCLE_GATE_EVENTS.PAPER_TO_DEPLOY_READY_BLOCKED");
  });

  it("increments strategyPromotions counter on the PAPER→DEPLOY_READY path", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain('strategyPromotions.labels({ from_state: "PAPER", to_state: "DEPLOY_READY"');
  });

  it("fail-CLOSED on infrastructure errors (catch (pdrGateErr) returns { success: false })", () => {
    // F-1 Hardening 2026-06-23: catch is fail-CLOSED (not fail-open).
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("catch (pdrGateErr)");
    const catchIdx = src.indexOf("catch (pdrGateErr)");
    const catchBlock = src.slice(catchIdx, catchIdx + 900);
    expect(catchBlock).toContain("return { success: false");
    expect(catchBlock).toContain("paper_to_deploy_ready_gate_evaluator_error");
  });

  it("loads latestBtP2D, latestMcP2D, frozenShadowRow as gate inputs", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf('fromState === "PAPER" && toState === "DEPLOY_READY"');
    // Window widened 3000 -> 21000 (gate3-manual-cron-parity-2026-07-17): the new
    // Gate 3 precondition-parity block now sits between the guard and latestBtP2D
    // (BEFORE it, by design — the precondition must run before the evaluator and
    // every other gate), pushing latestMcP2D/frozenShadowRow further from the
    // guard than the old fixed window covered. Same intent, larger window.
    const block = src.slice(idx, idx + 21000);
    expect(block).toContain("latestBtP2D");
    expect(block).toContain("latestMcP2D");
    expect(block).toContain("frozenShadowRow");
  });
});
