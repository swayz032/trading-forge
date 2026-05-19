/**
 * Pass 7 — Scout Quality Gates Tests
 *
 * Covers:
 *   - DSL Quality Critic: accept path, reject path, fail-OPEN on parse error,
 *     fail-OPEN on LLM throw, fail-OPEN on null response, fail-OPEN on
 *     budget exhaustion, score-threshold heuristic when accept boolean missing.
 *   - Daily budget cap: 100 calls/day → fail-open at 101st with
 *     source='budget_exhausted'.
 *   - Concerns array shape preserved through reject path.
 *   - Reasoning text propagated to result.
 *
 * Strategy production-check helper covered in scheduler tests below.
 *
 * No DB connection required — pure unit tests + mocked callOpenAI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ catch: vi.fn() })) })),
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

import {
  runDslQualityCritic,
  __resetDslCriticBudgetForTests,
} from "../services/agent-service.js";

const sampleDsl = {
  name: "vwap_fade_mnq",
  symbol: "MNQ",
  timeframe: "5m",
  direction: "both",
  entry_indicator: "vwap_reversion",
};
const samplePayload = {
  dsl: sampleDsl as Record<string, unknown>,
  sourceFind: {
    title: "VWAP fade on MNQ during open drive",
    source: "tavily",
    description: "Fade extreme moves away from VWAP during first 30 minutes of RTH.",
  },
};

describe("runDslQualityCritic — Pass 7 Task 2", () => {
  beforeEach(() => {
    __resetDslCriticBudgetForTests();
  });

  it("accepts when LLM returns accept=true", async () => {
    const llm = vi.fn().mockResolvedValue(
      JSON.stringify({ score: 8, accept: true, concerns: [], reasoning: "looks good" }),
    );
    const r = await runDslQualityCritic(samplePayload, "j1", llm as any);
    expect(r.accept).toBe(true);
    expect(r.score).toBe(8);
    expect(r.source).toBe("critic");
    expect(r.reasoning).toBe("looks good");
  });

  it("rejects when LLM returns accept=false", async () => {
    const llm = vi.fn().mockResolvedValue(
      JSON.stringify({ score: 3, accept: false, concerns: [{ field: "stop_loss" }], reasoning: "stop too tight" }),
    );
    const r = await runDslQualityCritic(samplePayload, "j2", llm as any);
    expect(r.accept).toBe(false);
    expect(r.score).toBe(3);
    expect(r.concerns).toHaveLength(1);
    expect(r.source).toBe("critic");
  });

  it("uses score>=6 heuristic when accept boolean missing", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ score: 7, reasoning: "ok" }));
    const r = await runDslQualityCritic(samplePayload, "j3", llm as any);
    expect(r.accept).toBe(true);
    expect(r.score).toBe(7);
  });

  it("uses score<6 heuristic to reject when accept missing", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ score: 4 }));
    const r = await runDslQualityCritic(samplePayload, "j4", llm as any);
    expect(r.accept).toBe(false);
    expect(r.score).toBe(4);
  });

  it("fails OPEN on non-JSON response (better noisy than dropped)", async () => {
    const llm = vi.fn().mockResolvedValue("not json {garbage");
    const r = await runDslQualityCritic(samplePayload, "j5", llm as any);
    expect(r.accept).toBe(true);
    expect(r.source).toBe("fail_open");
    expect(r.reasoning).toBe("critic_parse_failed_fail_open");
  });

  it("fails OPEN on LLM throw", async () => {
    const llm = vi.fn().mockRejectedValue(new Error("network blew up"));
    const r = await runDslQualityCritic(samplePayload, "j6", llm as any);
    expect(r.accept).toBe(true);
    expect(r.source).toBe("fail_open");
    expect(r.reasoning).toBe("llm_threw_fail_open");
  });

  it("fails OPEN on null response", async () => {
    const llm = vi.fn().mockResolvedValue(null);
    const r = await runDslQualityCritic(samplePayload, "j7", llm as any);
    expect(r.accept).toBe(true);
    expect(r.source).toBe("fail_open");
    expect(r.reasoning).toBe("llm_null_fail_open");
  });

  it("fails OPEN on undefined response", async () => {
    const llm = vi.fn().mockResolvedValue(undefined);
    const r = await runDslQualityCritic(samplePayload, "j7b", llm as any);
    expect(r.accept).toBe(true);
    expect(r.source).toBe("fail_open");
  });

  // P2E (Wave 9, 2026-05-17): budget exhaustion is now FAIL-CLOSED (was fail-open).
  // accept:false ensures no strategy silently bypasses the critic on cap day.
  it("fails CLOSED with budget_exhausted after 100 calls/day (P2E: fail-CLOSED)", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ accept: true, score: 7 }));
    for (let i = 0; i < 100; i++) {
      await runDslQualityCritic(samplePayload, `b${i}`, llm as any);
    }
    const r = await runDslQualityCritic(samplePayload, "b101", llm as any);
    expect(r.accept).toBe(false);  // CHANGED: was true (fail-open), now false (fail-CLOSED)
    expect(r.source).toBe("budget_exhausted");
    expect(r.concerns).toContain("critic_budget_exhausted");
    expect(llm).toHaveBeenCalledTimes(100);
  });

  it("calls dsl_quality_critic role with strategy_candidate signal type", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ accept: true, score: 8 }));
    await runDslQualityCritic(samplePayload, "j8", llm as any);
    const args = llm.mock.calls[0];
    expect(args[0]).toBe("dsl_quality_critic");
    expect(args[2]).toMatchObject({ signalType: "strategy_candidate" });
  });

  it("passes DSL and sourceFind in user message JSON", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ accept: true, score: 8 }));
    await runDslQualityCritic(samplePayload, "j9", llm as any);
    const userMsg = llm.mock.calls[0][1][0];
    expect(userMsg.role).toBe("user");
    const parsed = JSON.parse(userMsg.content);
    expect(parsed.dsl.name).toBe("vwap_fade_mnq");
    expect(parsed.sourceFind.title).toContain("VWAP fade");
  });

  it("preserves concerns array when reject", async () => {
    const concerns = [
      { field: "stop_loss_atr_multiple", issue: "too tight at 0.3" },
      { field: "entry_params", issue: "missing required key" },
    ];
    const llm = vi.fn().mockResolvedValue(
      JSON.stringify({ accept: false, score: 2, concerns, reasoning: "two issues" }),
    );
    const r = await runDslQualityCritic(samplePayload, "j10", llm as any);
    expect(r.concerns).toEqual(concerns);
    expect(r.accept).toBe(false);
  });

  it("returns empty concerns array when LLM omits them", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ accept: true, score: 8 }));
    const r = await runDslQualityCritic(samplePayload, "j11", llm as any);
    expect(r.concerns).toEqual([]);
  });

  it("reasoning defaults to empty string when LLM omits it", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ accept: true, score: 8 }));
    const r = await runDslQualityCritic(samplePayload, "j12", llm as any);
    expect(r.reasoning).toBe("");
  });

  it("budget counter resets per day", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ accept: true, score: 8 }));
    // Burn the budget
    for (let i = 0; i < 100; i++) {
      await runDslQualityCritic(samplePayload, `d${i}`, llm as any);
    }
    expect((await runDslQualityCritic(samplePayload, "next", llm as any)).source).toBe("budget_exhausted");
    // Reset (simulating day rollover)
    __resetDslCriticBudgetForTests();
    const r = await runDslQualityCritic(samplePayload, "after-reset", llm as any);
    expect(r.source).toBe("critic");
  });

  it("score=0 with accept=false rejects (clear reject signal)", async () => {
    const llm = vi.fn().mockResolvedValue(
      JSON.stringify({ score: 0, accept: false, reasoning: "completely broken" }),
    );
    const r = await runDslQualityCritic(samplePayload, "j13", llm as any);
    expect(r.accept).toBe(false);
    expect(r.score).toBe(0);
  });

  it("score=10 max accepts cleanly", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ score: 10, accept: true }));
    const r = await runDslQualityCritic(samplePayload, "j14", llm as any);
    expect(r.accept).toBe(true);
    expect(r.score).toBe(10);
  });

  it("non-numeric score defaults to 0 (heuristic rejects)", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ score: "high" }));
    const r = await runDslQualityCritic(samplePayload, "j15", llm as any);
    expect(r.score).toBe(0);
    expect(r.accept).toBe(false);
  });
});
