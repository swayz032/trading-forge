/**
 * assertCrossValidatedSource Tests — Pass 19
 *
 * Verifies the cross-validation insert guard rejects any source that is NOT:
 *   - 'graduated_bucket' (canonical cross-validated path)
 *   - 'clone' (operator-initiated — inherits parent's cross-validated tag)
 *   - 'b4_regen' (regen from declining strategy)
 *   - 'evolved' (LLM-guided mutation child; passes auditGraduatedConfig before
 *     INSERT — added deepscan11 Track P FIX 1, 2026-07-02)
 *   - any source with tags including 'cross-validated'
 *
 * Guards every db.insert(strategies) call site from creating rows without
 * cross-validation provenance.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Module mocks — prevent DB/env initialization ────────────────────────────
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(), select: vi.fn(), update: vi.fn(), execute: vi.fn(), delete: vi.fn(),
  },
}));
vi.mock("../db/schema.js", () => ({
  strategies: Symbol("strategies"), auditLog: Symbol("auditLog"),
  systemJournal: Symbol("systemJournal"), backtests: Symbol("backtests"),
  strategyPendingBuckets: Symbol("strategyPendingBuckets"),
  strategyPendingMentions: Symbol("strategyPendingMentions"),
}));
vi.mock("../services/backtest-service.js", () => ({ runBacktest: vi.fn() }));
vi.mock("../services/ollama-client.js", () => ({ OllamaClient: class {} }));
vi.mock("../services/graveyard-gate.js", () => ({ GraveyardGate: class {} }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../services/model-router.js", () => ({ callOpenAI: vi.fn(), callOpenAIOrFallback: vi.fn() }));
vi.mock("../services/pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true), getMode: vi.fn().mockResolvedValue("ACTIVE") }));
vi.mock("../lib/dlq-service.js", () => ({ captureToDLQ: vi.fn() }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../services/llm-input-sanitizer.js", () => ({ sanitizeExternalContent: vi.fn().mockReturnValue("") }));
vi.mock("../services/llm-output-validator.js", () => ({ validateRawLLMResponse: vi.fn().mockReturnValue({ passed: true }), validateDSLOutput: vi.fn().mockResolvedValue({ passed: true }) }));
vi.mock("../services/llm-sandbox-service.js", () => ({ sandboxCheckCode: vi.fn().mockResolvedValue({ passed: true }) }));
vi.mock("../services/dsl-diversity-service.js", () => ({ checkDslDiversity: vi.fn(), persistDslFeatureVector: vi.fn(), auditDslDiversityRejection: vi.fn() }));
vi.mock("../services/scout-formatter.js", () => ({ tier1RegexFilter: vi.fn(), stripMarkdown: vi.fn(), generateOneSentenceLead: vi.fn() }));

import { assertCrossValidatedSource } from "../services/agent-service.js";

describe("assertCrossValidatedSource", () => {
  // ─── ALLOWED paths ─────────────────────────────────────────────────────────

  it("allows source=graduated_bucket without cross-validated tag", () => {
    expect(() => assertCrossValidatedSource("graduated_bucket", [])).not.toThrow();
  });

  it("allows source=graduated_bucket WITH cross-validated tag", () => {
    expect(() => assertCrossValidatedSource("graduated_bucket", ["cross-validated"])).not.toThrow();
  });

  it("allows source=clone (operator-initiated)", () => {
    expect(() => assertCrossValidatedSource("clone", [])).not.toThrow();
  });

  it("allows source=b4_regen (regen from declining strategy)", () => {
    expect(() => assertCrossValidatedSource("b4_regen", [])).not.toThrow();
  });

  it("allows any source when tags includes 'cross-validated'", () => {
    expect(() => assertCrossValidatedSource("ollama", ["cross-validated"])).not.toThrow();
  });

  it("allows any source when tags includes 'cross-validated' alongside other tags", () => {
    expect(() => assertCrossValidatedSource("manual", ["dsl-compiled", "cross-validated", "3-source-consensus"])).not.toThrow();
  });

  // ─── BLOCKED paths ─────────────────────────────────────────────────────────

  it("blocks source=ollama without cross-validated tag", () => {
    expect(() => assertCrossValidatedSource("ollama", [])).toThrow(
      "strategy_insert_violation",
    );
  });

  it("blocks source=openclaw without cross-validated tag", () => {
    expect(() => assertCrossValidatedSource("openclaw", ["dsl-compiled"])).toThrow(
      "strategy_insert_violation",
    );
  });

  it("blocks source=manual without cross-validated tag", () => {
    expect(() => assertCrossValidatedSource("manual", ["agent-generated"])).toThrow(
      "strategy_insert_violation",
    );
  });

  it("blocks source=n8n without cross-validated tag", () => {
    expect(() => assertCrossValidatedSource("n8n", [])).toThrow(
      "strategy_insert_violation",
    );
  });

  it("blocks empty string source without cross-validated tag", () => {
    expect(() => assertCrossValidatedSource("", [])).toThrow(
      "strategy_insert_violation",
    );
  });

  it("error message includes the offending source", () => {
    try {
      assertCrossValidatedSource("ollama", []);
      expect.fail("should have thrown");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain("source=ollama");
    }
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  it("treats tags as case-sensitive — 'Cross-Validated' does not exempt", () => {
    // The guard checks tags.includes('cross-validated') exactly.
    // Malformed tags do not grant exemption.
    expect(() => assertCrossValidatedSource("ollama", ["Cross-Validated"])).toThrow(
      "strategy_insert_violation",
    );
  });

  it("empty tags array is not exempt for non-allowed sources", () => {
    expect(() => assertCrossValidatedSource("unknown_source", [])).toThrow(
      "strategy_insert_violation",
    );
  });

  it("allows source=evolved without cross-validated tag (LLM-guided mutation child, Track P FIX 1)", () => {
    expect(() => assertCrossValidatedSource("evolved", [])).not.toThrow();
  });

  it("evolved source with cross-validated tag IS allowed (parent had CV)", () => {
    // Evolution from a cross-validated strategy inherits the tag.
    expect(() => assertCrossValidatedSource("evolved", ["cross-validated", "evolved"])).not.toThrow();
  });
});
