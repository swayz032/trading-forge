/**
 * Deep-scan #11 Fix Track Q — FIX 6: critic fail-open visibility tests
 *
 * Verifies that the three fail-open paths in runDslQualityCritic each:
 *   1. Still return accept:true (fail-open deliberate)
 *   2. Fire a dsl_critic.invocation_failed_fail_open audit row (status: warning)
 *   3. Fire a deduped-daily Discord WARN via notifyWarning (once per day)
 *
 * NOTE: agent-service.ts imports the DB; must mock db/index.js + all
 * transitive service imports before importing agent-service.js. Pattern
 * follows wave9-critic-budget-closed.test.ts exactly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (must come before any import of agent-service) ───────────────
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
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));
vi.mock("../lib/dlq-service.js", () => ({ captureToDLQ: vi.fn() }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));
vi.mock("../services/llm-input-sanitizer.js", () => ({
  sanitizeExternalContent: vi.fn().mockReturnValue(""),
}));
vi.mock("../services/llm-output-validator.js", () => ({
  validateRawLLMResponse: vi.fn().mockReturnValue({ passed: true }),
  validateDSLOutput: vi.fn().mockResolvedValue({ passed: true }),
}));
vi.mock("../services/llm-sandbox-service.js", () => ({
  sandboxCheckCode: vi.fn().mockResolvedValue({ passed: true }),
}));
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
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));
// FIX 6: notification-service mock so we can spy on notifyWarning
vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
  notifyInfo: vi.fn(),
  _resetForTests: vi.fn(),
}));

// ─── Import under test (after all mocks are hoisted) ─────────────────────────
import {
  runDslQualityCritic,
  __resetDslCriticBudgetForTests,
  __resetCriticFailOpenDiscordForTests,
} from "../services/agent-service.js";
import { insertAuditRow as mockInsertAuditRow } from "../lib/audit-log-helper.js";
import { notifyWarning as mockNotifyWarning } from "../services/notification-service.js";

// ─── Shared test payload ──────────────────────────────────────────────────────
const TEST_PAYLOAD = {
  dsl: { strategy: { name: "test_fix6", symbol: "MES", timeframe: "5m" } },
  sourceFind: { title: "Fix 6 Test Strategy", source: "youtube", description: "Test" },
};

// ─── Reset shared state between tests ────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  __resetDslCriticBudgetForTests();
  __resetCriticFailOpenDiscordForTests();
});

// ─────────────────────────────────────────────────────────────────────────────
// Path 1: LLM throws
// ─────────────────────────────────────────────────────────────────────────────

describe("FIX 6: fail-open path — LLM throws", () => {
  it("still returns accept:true (fail-open deliberate)", async () => {
    const mockLLM = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const result = await runDslQualityCritic(TEST_PAYLOAD, "journal-throw-1", mockLLM);
    expect(result.accept).toBe(true);
    expect(result.source).toBe("fail_open");
    expect(result.reasoning).toBe("llm_threw_fail_open");
  });

  it("fires audit row with action=dsl_critic.invocation_failed_fail_open, status=warning", async () => {
    const mockLLM = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    await runDslQualityCritic(TEST_PAYLOAD, "journal-throw-audit", mockLLM);

    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsl_critic.invocation_failed_fail_open",
        entityId: "journal-throw-audit",
        status: "warning",
      }),
    );
  });

  it("fires Discord WARN via notifyWarning on first fail-open", async () => {
    const mockLLM = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    await runDslQualityCritic(TEST_PAYLOAD, "journal-throw-discord", mockLLM);

    expect(mockNotifyWarning).toHaveBeenCalledOnce();
    expect(mockNotifyWarning).toHaveBeenCalledWith(
      "DSL Critic Fail-Open",
      expect.stringContaining("llm_threw_fail_open"),
      expect.objectContaining({ reason: "llm_threw_fail_open" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path 2: LLM returns null
// ─────────────────────────────────────────────────────────────────────────────

describe("FIX 6: fail-open path — LLM returns null", () => {
  it("returns accept:true with reasoning=llm_null_fail_open", async () => {
    const mockLLM = vi.fn().mockResolvedValue(null);
    const result = await runDslQualityCritic(TEST_PAYLOAD, "journal-null-1", mockLLM);
    expect(result.accept).toBe(true);
    expect(result.source).toBe("fail_open");
    expect(result.reasoning).toBe("llm_null_fail_open");
  });

  it("fires audit row for null path", async () => {
    const mockLLM = vi.fn().mockResolvedValue(null);
    await runDslQualityCritic(TEST_PAYLOAD, "journal-null-audit", mockLLM);

    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsl_critic.invocation_failed_fail_open",
        entityId: "journal-null-audit",
        status: "warning",
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path 3: JSON parse failure
// ─────────────────────────────────────────────────────────────────────────────

describe("FIX 6: fail-open path — JSON parse failure", () => {
  it("returns accept:true with reasoning=critic_parse_failed_fail_open", async () => {
    const mockLLM = vi.fn().mockResolvedValue("not valid json {{{{");
    const result = await runDslQualityCritic(TEST_PAYLOAD, "journal-parse-1", mockLLM);
    expect(result.accept).toBe(true);
    expect(result.source).toBe("fail_open");
    expect(result.reasoning).toBe("critic_parse_failed_fail_open");
  });

  it("fires audit row for JSON parse failure path", async () => {
    const mockLLM = vi.fn().mockResolvedValue("not valid json {{{{");
    await runDslQualityCritic(TEST_PAYLOAD, "journal-parse-audit", mockLLM);

    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsl_critic.invocation_failed_fail_open",
        entityId: "journal-parse-audit",
        status: "warning",
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dedup: Discord WARN fires at most once per day
// ─────────────────────────────────────────────────────────────────────────────

describe("FIX 6: deduped-daily Discord WARN", () => {
  it("second fail-open on the same day does NOT send a second Discord WARN", async () => {
    const mockLLM = vi.fn().mockRejectedValue(new Error("LLM down"));
    // First call: Discord WARN fires
    await runDslQualityCritic(TEST_PAYLOAD, "journal-dedup-1", mockLLM);
    // Second call (same day-key): Discord WARN must NOT fire again
    await runDslQualityCritic(TEST_PAYLOAD, "journal-dedup-2", mockLLM);

    expect(mockNotifyWarning).toHaveBeenCalledOnce();
  });

  it("audit row fires on EVERY fail-open (not deduped)", async () => {
    const mockLLM = vi.fn().mockRejectedValue(new Error("LLM down"));
    await runDslQualityCritic(TEST_PAYLOAD, "journal-every-1", mockLLM);
    await runDslQualityCritic(TEST_PAYLOAD, "journal-every-2", mockLLM);

    const auditCalls = vi.mocked(mockInsertAuditRow).mock.calls.filter((args) => {
      const call = args[0] as Record<string, unknown>;
      return call.action === "dsl_critic.invocation_failed_fail_open";
    });
    expect(auditCalls.length).toBe(2);
  });

  it("after reset, Discord WARN fires again", async () => {
    const mockLLM = vi.fn().mockRejectedValue(new Error("LLM down"));
    await runDslQualityCritic(TEST_PAYLOAD, "journal-reset-1", mockLLM);
    expect(mockNotifyWarning).toHaveBeenCalledOnce();

    // Reset dedup state (simulates new day / test isolation)
    __resetCriticFailOpenDiscordForTests();
    vi.mocked(mockNotifyWarning).mockClear();

    await runDslQualityCritic(TEST_PAYLOAD, "journal-reset-2", mockLLM);
    expect(mockNotifyWarning).toHaveBeenCalledOnce();
  });
});
