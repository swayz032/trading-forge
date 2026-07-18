/**
 * lifecycle-pass5-shadow-paper.test.ts — Pass 5 Track C
 *
 * Source-code analysis tests for evaluateShadowToPaperGate wiring
 * in _promoteStrategyInner. Mocks shadow-to-paper-gate.ts (Track A —
 * not yet merged). No DB or service calls required.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LIFECYCLE_PATH = resolve(process.cwd(), "src/server/services/lifecycle-service.ts");

describe("Pass 5 Track C — SHADOW→PAPER evaluator wiring in lifecycle-service.ts", () => {
  it("imports evaluateShadowToPaperGate dynamically from shadow-to-paper-gate.js", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("evaluateShadowToPaperGate");
    expect(src).toContain("shadow-to-paper-gate.js");
  });

  it("evaluateShadowToPaperGate call is inside fromState === 'SHADOW' && toState === 'PAPER' guard", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const block = src.indexOf('fromState === "SHADOW" && toState === "PAPER"');
    expect(block).toBeGreaterThan(-1);
    const afterBlock = src.slice(block, block + 2000);
    expect(afterBlock).toContain("evaluateShadowToPaperGate");
  });

  it("blocks with return { success: false } when passed===false", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("evaluateShadowToPaperGate");
    const afterCall = src.slice(idx, idx + 3000);
    expect(afterCall).toContain("!shadowGateResult.passed");
    expect(afterCall).toContain("return { success: false");
  });

  it("inserts audit row on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("shadow-to-paper-gate.js");
    const block = src.slice(idx, idx + 2000);
    expect(block).toContain("db.insert(auditLog)");
  });

  it("broadcasts SSE on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Refactored into the shared LIFECYCLE_GATE_EVENTS constants object — assert the
    // symbol reference, not the raw string value.
    expect(src).toContain("LIFECYCLE_GATE_EVENTS.SHADOW_TO_PAPER_BLOCKED");
  });

  it("fail-CLOSED on infrastructure errors (catch (shadowGateErr) returns { success: false })", () => {
    // F-2a Hardening 2026-06-23: catch now fail-CLOSED (not fail-open)
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("shadow-to-paper-gate.js");
    const afterCall = src.slice(idx, idx + 2000);
    expect(afterCall).toContain("catch (shadowGateErr)");
    // Must return fail-closed (use 700 chars to capture return statement)
    const catchIdx = src.indexOf("catch (shadowGateErr)");
    const catchBlock = src.slice(catchIdx, catchIdx + 700);
    expect(catchBlock).toContain("return { success: false");
    expect(catchBlock).toContain("shadow_to_paper_gate_evaluator_error");
  });

  it("loads divergence inputs via loadDivergenceInputs", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf('fromState === "SHADOW" && toState === "PAPER"');
    const block = src.slice(idx, idx + 2000);
    expect(block).toContain("loadDivergenceInputs");
    expect(block).toContain("divInputs");
  });

  it("passes strategyId, shadowSignals, backtestExpected, backtestExpectedCount to evaluateShadowToPaperGate call", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Find the actual call (second occurrence — first is the import destructuring)
    const firstIdx = src.indexOf("evaluateShadowToPaperGate");
    const callIdx = src.indexOf("evaluateShadowToPaperGate", firstIdx + 1);
    expect(callIdx).toBeGreaterThan(-1);
    const block = src.slice(callIdx, callIdx + 500);
    expect(block).toContain("strategyId: id");
    // Track C fix: evaluator requires flat fields, not divergenceInputs bag
    expect(block).toContain("shadowSignals: divInputs.shadowSignals");
    expect(block).toContain("backtestExpected: divInputs.backtestExpected");
    expect(block).toContain("backtestExpectedCount: divInputs.backtestExpected.length");
  });
});
