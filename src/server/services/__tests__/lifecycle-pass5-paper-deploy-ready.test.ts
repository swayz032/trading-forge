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

  it("blocks with return { success: false } when passed===false", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Anchor from pdrInput declaration — closer to the block guard than the function import site
    const pdrInputIdx = src.indexOf("const pdrInput:");
    expect(pdrInputIdx).toBeGreaterThan(-1);
    const afterCall = src.slice(pdrInputIdx, pdrInputIdx + 4000);
    expect(afterCall).toContain("!gatePdrResult.passed");
    expect(afterCall).toContain("return { success: false");
  });

  it("inserts audit row on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Anchor from pdrInput — audit row is ~2000 chars from there
    const pdrInputIdx = src.indexOf("const pdrInput:");
    expect(pdrInputIdx).toBeGreaterThan(-1);
    const afterCall = src.slice(pdrInputIdx, pdrInputIdx + 4000);
    expect(afterCall).toContain("db.insert(auditLog)");
  });

  it("broadcasts SSE on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("lifecycle:paper_to_deploy_ready_blocked");
  });

  it("increments strategyPromotions counter on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Anchor from pdrInput — strategyPromotions.labels is ~2500 chars from there
    const pdrInputIdx = src.indexOf("const pdrInput:");
    expect(pdrInputIdx).toBeGreaterThan(-1);
    expect(src.slice(pdrInputIdx, pdrInputIdx + 4000)).toContain("strategyPromotions.labels");
  });

  it("fail-open on infrastructure errors (try/catch around evaluator)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const pdrInputIdx = src.indexOf("const pdrInput:");
    expect(pdrInputIdx).toBeGreaterThan(-1);
    const block = src.slice(pdrInputIdx, pdrInputIdx + 6000);
    expect(block).toContain("catch (pdrGateErr)");
    expect(block).toContain("fail-open");
  });

  it("loads latestBtP2D, latestMcP2D, frozenShadowRow as gate inputs", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf('fromState === "PAPER" && toState === "DEPLOY_READY"');
    const block = src.slice(idx, idx + 3000);
    expect(block).toContain("latestBtP2D");
    expect(block).toContain("latestMcP2D");
    expect(block).toContain("frozenShadowRow");
  });
});
