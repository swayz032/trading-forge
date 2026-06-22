/**
 * Wave 9 — P2E: critic budget exhaustion fail-CLOSED tests (2026-05-17)
 *
 * Verifies:
 *   1. Budget exhaustion returns accept:false (fail-CLOSED)
 *   2. audit_log row fires with action="dsl_quality_critic.budget_exhausted_fail_closed"
 *   3. Ollama fallback path is reachable when OLLAMA_DSL_CRITIC_FALLBACK=true
 *   4. Ollama failure still results in fail-CLOSED
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(), select: vi.fn(), update: vi.fn(), execute: vi.fn(), delete: vi.fn(),
  },
}));
vi.mock("../db/schema.js", () => ({
  strategies: Symbol("strategies"),
  auditLog: Symbol("auditLog"),
  systemJournal: Symbol("systemJournal"),
  backtests: Symbol("backtests"),
  strategyPendingBuckets: Symbol("strategyPendingBuckets"),
  strategyPendingMentions: Symbol("strategyPendingMentions"),
}));
vi.mock("../services/backtest-service.js", () => ({ runBacktest: vi.fn() }));
vi.mock("../services/graveyard-gate.js", () => ({ GraveyardGate: class {} }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../services/model-router.js", () => ({ callOpenAI: vi.fn(), callOpenAIOrFallback: vi.fn() }));
vi.mock("../services/pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true), getMode: vi.fn().mockResolvedValue("ACTIVE") }));
vi.mock("../lib/dlq-service.js", () => ({ captureToDLQ: vi.fn() }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../services/llm-input-sanitizer.js", () => ({ sanitizeExternalContent: vi.fn().mockReturnValue("") }));
vi.mock("../services/llm-output-validator.js", () => ({
  validateRawLLMResponse: vi.fn().mockReturnValue({ passed: true }),
  validateDSLOutput: vi.fn().mockResolvedValue({ passed: true }),
}));
vi.mock("../services/llm-sandbox-service.js", () => ({ sandboxCheckCode: vi.fn().mockResolvedValue({ passed: true }) }));
vi.mock("../services/dsl-diversity-service.js", () => ({
  checkDslDiversity: vi.fn(),
  persistDslFeatureVector: vi.fn(),
  auditDslDiversityRejection: vi.fn(),
}));
vi.mock("../services/scout-formatter.js", () => ({
  tier1RegexFilter: vi.fn(),
  stripMarkdown: vi.fn(),
  generateOneSentenceLead: vi.fn(),
}));

vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn().mockResolvedValue(undefined) }));

// Ollama client mock — we control responses per test
const mockOllamaGenerate = vi.fn();
vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: class {
    generate = mockOllamaGenerate;
    chat = vi.fn();
    embed = vi.fn();
    baseUrl = "http://localhost:11434";
  },
}));

import {
  runDslQualityCritic,
  runDslQualityCriticOllama,
  __resetDslCriticBudgetForTests,
} from "../services/agent-service.js";
import { insertAuditRow as mockInsertAuditRow } from "../lib/audit-log-helper.js";

const TEST_PAYLOAD = {
  dsl: { strategy: { name: "test", symbol: "MES", timeframe: "5m" } },
  sourceFind: { title: "Test Strategy", source: "youtube", description: "Test" },
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetDslCriticBudgetForTests();
  delete process.env.OLLAMA_DSL_CRITIC_FALLBACK;
});

afterEach(() => {
  delete process.env.OLLAMA_DSL_CRITIC_FALLBACK;
});

describe("Wave 9 P2E: critic budget exhaustion — fail-CLOSED", () => {
  it("returns accept:false when budget is exhausted (default fail-CLOSED)", async () => {
    // Exhaust the budget
    const mockOpenAI = vi.fn().mockResolvedValue(
      JSON.stringify({ score: 8, accept: true, concerns: [], reasoning: "good" }),
    );
    // Fill budget to 100
    for (let i = 0; i < 100; i++) {
      await runDslQualityCritic(TEST_PAYLOAD, `journal-${i}`, mockOpenAI);
    }
    // 101st call should fail CLOSED
    const result = await runDslQualityCritic(TEST_PAYLOAD, "journal-exhausted", mockOpenAI);
    expect(result.accept).toBe(false);
    expect(result.score).toBe(0);
    expect(result.source).toBe("budget_exhausted");
    expect(result.concerns).toContain("critic_budget_exhausted");
    expect(result.reasoning).toBe("daily_cap_reached_fail_closed");
  });

  it("fires audit row with action=dsl_quality_critic.budget_exhausted_fail_closed", async () => {
    const mockOpenAI = vi.fn().mockResolvedValue(
      JSON.stringify({ score: 8, accept: true, concerns: [], reasoning: "good" }),
    );
    // Exhaust budget
    for (let i = 0; i < 100; i++) {
      await runDslQualityCritic(TEST_PAYLOAD, `journal-${i}`, mockOpenAI);
    }
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    mockInsertAuditRow.mockClear();

    await runDslQualityCritic(TEST_PAYLOAD, "journal-exhausted", mockOpenAI);

    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsl_quality_critic.budget_exhausted_fail_closed",
        status: "rejected",
        entityId: "journal-exhausted",
      }),
    );
  });

  it("returns accept:false (not fail-open true) — no silent pass", async () => {
    const mockOpenAI = vi.fn().mockResolvedValue(
      JSON.stringify({ score: 8, accept: true, concerns: [], reasoning: "good" }),
    );
    for (let i = 0; i < 100; i++) {
      await runDslQualityCritic(TEST_PAYLOAD, `journal-${i}`, mockOpenAI);
    }
    const result = await runDslQualityCritic(TEST_PAYLOAD, "journal-100", mockOpenAI);
    // Previously this returned accept:true (silent pass) — must now be false
    expect(result.accept).toBe(false);
  });
});

describe("Wave 9 P2E: Ollama fallback path", () => {
  it("uses Ollama when OLLAMA_DSL_CRITIC_FALLBACK=true and budget exhausted", async () => {
    process.env.OLLAMA_DSL_CRITIC_FALLBACK = "true";
    mockOllamaGenerate.mockResolvedValue({
      response: JSON.stringify({ score: 8, accept: true, concerns: [], reasoning: "ollama approved" }),
    });

    const mockOpenAI = vi.fn().mockResolvedValue(
      JSON.stringify({ score: 8, accept: true, concerns: [], reasoning: "good" }),
    );
    for (let i = 0; i < 100; i++) {
      await runDslQualityCritic(TEST_PAYLOAD, `journal-${i}`, mockOpenAI);
    }

    const result = await runDslQualityCritic(TEST_PAYLOAD, "journal-ollama", mockOpenAI);
    expect(result.source).toBe("ollama_fallback");
    expect(result.accept).toBe(true);
    expect(result.score).toBe(8);
  });

  it("Ollama fallback fires audit row with action=dsl_quality_critic.budget_exhausted_ollama_fallback", async () => {
    process.env.OLLAMA_DSL_CRITIC_FALLBACK = "true";
    mockOllamaGenerate.mockResolvedValue({
      response: JSON.stringify({ score: 7, accept: true, concerns: [], reasoning: "ok" }),
    });

    const mockOpenAI = vi.fn().mockResolvedValue(
      JSON.stringify({ score: 8, accept: true, concerns: [], reasoning: "good" }),
    );
    for (let i = 0; i < 100; i++) {
      await runDslQualityCritic(TEST_PAYLOAD, `journal-${i}`, mockOpenAI);
    }
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
    mockInsertAuditRow.mockClear();

    await runDslQualityCritic(TEST_PAYLOAD, "journal-ollama-audit", mockOpenAI);

    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsl_quality_critic.budget_exhausted_ollama_fallback",
        entityId: "journal-ollama-audit",
      }),
    );
  });

  it("Ollama failure still returns fail-CLOSED when budget exhausted", async () => {
    process.env.OLLAMA_DSL_CRITIC_FALLBACK = "true";
    mockOllamaGenerate.mockRejectedValue(new Error("Ollama unavailable"));

    const mockOpenAI = vi.fn().mockResolvedValue(
      JSON.stringify({ score: 8, accept: true, concerns: [], reasoning: "good" }),
    );
    for (let i = 0; i < 100; i++) {
      await runDslQualityCritic(TEST_PAYLOAD, `journal-${i}`, mockOpenAI);
    }

    const result = await runDslQualityCritic(TEST_PAYLOAD, "journal-ollama-fail", mockOpenAI);
    // Ollama failed + budget exhausted = fail-CLOSED
    expect(result.accept).toBe(false);
    expect(result.source).toBe("budget_exhausted");
  });

  it("runDslQualityCriticOllama returns null on non-JSON response", async () => {
    mockOllamaGenerate.mockResolvedValue({ response: "not valid json here" });
    const result = await runDslQualityCriticOllama(TEST_PAYLOAD, "journal-bad-json");
    expect(result).toBeNull();
  });

  it("runDslQualityCriticOllama returns DslQualityCriticResult on valid JSON", async () => {
    mockOllamaGenerate.mockResolvedValue({
      response: JSON.stringify({ score: 7, accept: true, concerns: ["minor issue"], reasoning: "looks ok" }),
    });
    const result = await runDslQualityCriticOllama(TEST_PAYLOAD, "journal-good");
    expect(result).not.toBeNull();
    expect(result?.source).toBe("ollama_fallback");
    expect(result?.accept).toBe(true);
    expect(result?.score).toBe(7);
  });

  it("default OLLAMA_DSL_CRITIC_FALLBACK=false — no Ollama call on budget exhaustion", async () => {
    // env not set → default is false
    const mockOpenAI = vi.fn().mockResolvedValue(
      JSON.stringify({ score: 8, accept: true, concerns: [], reasoning: "good" }),
    );
    for (let i = 0; i < 100; i++) {
      await runDslQualityCritic(TEST_PAYLOAD, `journal-${i}`, mockOpenAI);
    }

    const result = await runDslQualityCritic(TEST_PAYLOAD, "journal-no-ollama", mockOpenAI);
    // Ollama should NOT have been called
    expect(mockOllamaGenerate).not.toHaveBeenCalled();
    expect(result.accept).toBe(false);
  });
});
