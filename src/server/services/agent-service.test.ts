import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before import
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: "strategy-uuid-1" }]),
    limit: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("./backtest-service.js", () => ({
  runBacktest: vi.fn().mockResolvedValue({
    id: "backtest-uuid-1",
    status: "completed",
    total_return: 0.15,
    sharpe_ratio: 2.1,
    max_drawdown: -1500,
    win_rate: 0.65,
    profit_factor: 2.3,
    total_trades: 100,
    avg_trade_pnl: 150,
    avg_daily_pnl: 350,
    tier: "TIER_1",
    forge_score: 85,
    equity_curve: [100, 105, 110],
    trades: [],
    daily_pnls: [200, -100, 300],
    execution_time_ms: 5000,
  }),
}));

vi.mock("./ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue({
      response: JSON.stringify({
        strengths: ["Good Sharpe ratio"],
        weaknesses: ["Small sample size"],
        suggestions: ["Test more timeframes"],
        overall_assessment: "Promising but needs validation",
      }),
    }),
  })),
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Pipeline control: tests assume ACTIVE so guards in runStrategy/batchSubmit
// don't short-circuit before the test setup can run.
vi.mock("./pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

// FIX 4 — strategy-prevalidator default mock returns "passed" so existing
// tests are unaffected. Specific tests override this mock to assert that
// the prevalidator is invoked AND that rejection short-circuits runStrategy.
vi.mock("./strategy-prevalidator.js", () => ({
  prevalidateCandidate: vi.fn().mockResolvedValue({
    passed: true,
    fingerprint: "test-fingerprint",
    reasons: [],
    checks: {
      graveyard: { passed: true, existingCount: 0 },
      correlation: { passed: true, deployedCount: 0 },
      regime: { passed: true },
    },
  }),
}));

import { AgentService } from "./agent-service.js";
import { runBacktest } from "./backtest-service.js";
import { db } from "../db/index.js";
import { prevalidateCandidate } from "./strategy-prevalidator.js";

describe("AgentService", () => {
  let service: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentService();
  });

  describe("runStrategy", () => {
    it("inserts strategy, calls runBacktest, logs to journal and audit", async () => {
      // Mock the chain for insert: insert().values().returning()
      const mockReturning = vi.fn().mockResolvedValue([{ id: "strategy-uuid-1" }]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: mockValues });

      const input = {
        strategy_name: "BB Mean Reversion",
        one_sentence: "Buy when price touches lower BB on MES 15min",
        python_code: "import vectorbt as vbt\n# strategy code here",
        params: { period: 20, std_dev: 2.0 },
        symbol: "MES" as const,
        timeframe: "15min",
        start_date: "2024-01-01",
        end_date: "2024-12-31",
        source: "ollama" as const,
      };

      const result = await service.runStrategy(input);

      // Verify strategy was inserted
      expect(db.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalled();

      // Verify backtest was called with strategy ID and the new optional
      // parameters (strategyClass, externalId, correlationId) — added when
      // runBacktest gained service-layer correlationId threading.
      expect(runBacktest).toHaveBeenCalledWith(
        "strategy-uuid-1",
        expect.objectContaining({
          strategy: expect.objectContaining({
            name: "BB Mean Reversion",
            symbol: "MES",
            python_code: "import vectorbt as vbt\n# strategy code here",
          }),
        }),
        undefined,
        undefined,
        undefined,
      );

      // Verify result shape
      expect(result).toHaveProperty("strategyId", "strategy-uuid-1");
      expect(result).toHaveProperty("status", "completed");
    });

    // ─── FIX 4: prevalidator is wired into runStrategy ──────────────────
    it("calls prevalidateCandidate before backtest (wires the prevalidator)", async () => {
      const mockReturning = vi.fn().mockResolvedValue([{ id: "strategy-uuid-1" }]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: mockValues });

      const input = {
        strategy_name: "Trend Follow MA",
        one_sentence: "Trend follow on 15min MES with simple moving average crossover",
        python_code: "pass",
        params: {},
        symbol: "MES" as const,
        timeframe: "15min",
        source: "ollama" as const,
      };

      await service.runStrategy(input);

      // Prevalidator must be called — this closes the orphan-in-process gap
      // where direct API hits via POST /api/agent/run-strategy bypassed it.
      expect(prevalidateCandidate).toHaveBeenCalled();
      const callArg = (prevalidateCandidate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArg).toHaveProperty("market", "MES");
      expect(callArg).toHaveProperty("timeframe", "15min");
      // Concept name should be derived from "trend follow" archetype keyword
      expect(callArg.conceptName).toBe("trend_follow");
    });

    it("short-circuits with status=blocked_prevalidator when prevalidator rejects (no backtest run)", async () => {
      // Override the default passed=true mock to return rejection
      (prevalidateCandidate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        passed: false,
        fingerprint: "f-test",
        reasons: ["graveyard-match: 3 prior journal entries"],
        checks: {
          graveyard: { passed: false, existingCount: 3 },
          correlation: { passed: true, deployedCount: 0 },
          regime: { passed: true },
        },
      });

      // Mock the audit-log insert chain
      const mockAuditValues = vi.fn().mockResolvedValue(undefined);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: mockAuditValues,
      });

      const input = {
        strategy_name: "Bad Mean Reversion Strategy",
        one_sentence: "Mean revert on 5min ES bollinger bands",
        python_code: "pass",
        params: {},
        symbol: "MES" as const,
        timeframe: "5min",
        source: "ollama" as const,
      };

      const result = await service.runStrategy(input);

      // The runStrategy must short-circuit BEFORE running the backtest —
      // this is the contract that closes the silent-bypass gap.
      expect(runBacktest).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        strategyId: null,
        backtestId: null,
        status: "blocked_prevalidator",
      });

      // Audit row must be written so the rejection is queryable
      expect(db.insert).toHaveBeenCalled();
      const auditCall = mockAuditValues.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).action === "strategy.prevalidator-rejected",
      );
      expect(auditCall).toBeDefined();
    });
  });

  describe("critiqueResults", () => {
    it("formats prompt and returns structured critique", async () => {
      const result = await service.critiqueResults({
        results: {
          sharpe_ratio: 2.1,
          max_drawdown: -1500,
          win_rate: 0.65,
          profit_factor: 2.3,
          total_trades: 100,
          avg_daily_pnl: 350,
        },
      });

      expect(result.critique).toHaveProperty("strengths");
      expect(result.critique).toHaveProperty("weaknesses");
      expect(result.critique).toHaveProperty("suggestions");
      expect(result.critique).toHaveProperty("overall_assessment");
    });

    it("throws when neither backtestId nor results provided", async () => {
      await expect(service.critiqueResults({})).rejects.toThrow(
        "Either backtestId or results must be provided"
      );
    });
  });

  describe("batchSubmit", () => {
    it("rejects batches over 20 strategies", async () => {
      const strategies = Array.from({ length: 21 }, (_, i) => ({
        strategy_name: `Strategy ${i}`,
        one_sentence: "test",
        python_code: "pass",
        params: {},
        symbol: "MES" as const,
        timeframe: "15min",
        start_date: "2024-01-01",
        end_date: "2024-12-31",
        source: "ollama" as const,
      }));

      await expect(service.batchSubmit(strategies)).rejects.toThrow(
        "Maximum 20 strategies per batch"
      );
    });

    it("processes strategies sequentially and returns results", async () => {
      const mockReturning = vi.fn().mockResolvedValue([{ id: "s-1" }]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: mockValues });

      const strategies = [
        {
          strategy_name: "Strat A",
          one_sentence: "test A",
          python_code: "pass",
          params: {},
          symbol: "MES" as const,
          timeframe: "15min",
          start_date: "2024-01-01",
          end_date: "2024-12-31",
          source: "ollama" as const,
        },
        {
          strategy_name: "Strat B",
          one_sentence: "test B",
          python_code: "pass",
          params: {},
          symbol: "MNQ" as const,
          timeframe: "15min",
          start_date: "2024-01-01",
          end_date: "2024-12-31",
          source: "ollama" as const,
        },
      ];

      const result = await service.batchSubmit(strategies);

      expect(result.count).toBe(2);
      expect(result.results).toHaveLength(2);
    });
  });

  describe("scoutIdeas", () => {
    it("deduplicates by content hash", async () => {
      // Mock select chain for cross-time dedup (returns empty — no existing ideas)
      const mockWhere = vi.fn().mockResolvedValue([]);
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

      // Mock insert chain
      const mockReturning = vi.fn().mockResolvedValue([{ id: "idea-1" }]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: mockValues });

      const ideas = [
        { source: "openclaw", title: "RSI Strategy", description: "Buy when RSI < 30" },
        { source: "openclaw", title: "RSI Strategy", description: "Buy when RSI < 30" }, // duplicate
      ];

      const result = await service.scoutIdeas(ideas);

      expect(result.received).toBe(2);
      expect(result.batch_duplicate_count).toBe(1);
      expect(result.cross_time_duplicate_count).toBe(0);
      expect(result.new_count).toBe(1);
    });
  });
});
