/**
 * carter-recommend.test.ts
 *
 * Covers the 4 Carter recommendation-engine handlers:
 *   - diagnose_pipeline            — stage counts + recent blocks + oldest-stuck + summary
 *   - analyze_gate_blocks          — frequency view, param clamp, paper_signal_logs → audit_log fallback
 *   - review_strategy              — input validation, strategy_not_found, critique bundle + blocking gate
 *   - find_hardening_opportunities — recent errors / stale / stuck / open-issues + summary, fail-soft
 *
 * DB is mocked with a chainable builder backed by a FIFO queue of result-sets:
 * each awaited query pulls the next queued result. Terminal `.limit()` resolves
 * directly; queries ending in `.orderBy()`/`.groupBy()`/`.where()` resolve via the
 * thenable chain. Order the queue to match each handler's query execution order.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { queue: [] as unknown[][] };
  const pull = () => Promise.resolve(state.queue.length ? state.queue.shift()! : []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "from", "where", "leftJoin", "innerJoin", "orderBy", "groupBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => pull();
  // Thenable: awaiting a query that does NOT end in .limit() pulls the next result.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.then = (onF: any, onR: any) => pull().then(onF, onR);
  return { state, chain };
});

vi.mock("../../db/index.js", () => ({ db: h.chain }));
vi.mock("../../db/schema.js", () => ({
  strategies: {},
  backtests: {},
  monteCarloRuns: {},
  auditLog: {},
  lifecycleTransitions: {},
  paperSignalLogs: {},
  carterIssues: {},
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { CARTER_RECOMMEND_HANDLERS } from "../../lib/carter/carter-recommend.js";

beforeEach(() => {
  h.state.queue = [];
});

// ─── diagnose_pipeline ────────────────────────────────────────────────────────

describe("diagnose_pipeline", () => {
  const diagnose = CARTER_RECOMMEND_HANDLERS["diagnose_pipeline"]!;

  it("aggregates stage counts, recent blocks, and oldest-stuck", async () => {
    h.state.queue = [
      // stageRows
      [
        { state: "CANDIDATE", n: 5 },
        { state: "TESTING", n: 2 },
      ],
      // blockRows (audit_log block rows)
      [
        { action: "lifecycle.pbo_overfit_block", errorMessage: "pbo too high", result: null, createdAt: new Date() },
        { action: "lifecycle.pbo_overfit_block", errorMessage: null, result: null, createdAt: new Date() },
        { action: "b14.gate_evaluated_block", errorMessage: null, result: { reason: "ruin high" }, createdAt: new Date() },
      ],
      // lastTransRows (empty → no oldest-stuck name fetch)
      [],
    ];
    const r = (await diagnose({})) as Record<string, unknown>;
    expect(r["stage_counts"]).toEqual({ CANDIDATE: 5, TESTING: 2 });
    const blocks = r["recent_blocks"] as Array<Record<string, unknown>>;
    expect(blocks[0]!["gate_or_action"]).toBe("lifecycle.pbo_overfit_block");
    expect(blocks[0]!["count"]).toBe(2);
    expect(blocks[0]!["sample_reason"]).toBe("pbo too high");
    expect(blocks[1]!["sample_reason"]).toBe("ruin high");
    expect(r["oldest_stuck"]).toEqual([]);
    expect(typeof r["summary"]).toBe("string");
  });

  it("resolves oldest-stuck strategy names + days-in-state", async () => {
    const old = new Date(Date.now() - 12 * 86_400_000).toISOString();
    h.state.queue = [
      [{ state: "PAPER", n: 1 }], // stageRows
      [], // blockRows
      [{ strategyId: "s1", lastAt: old }], // lastTransRows
      [{ id: "s1", name: "orb_mnq_15m", lifecycleState: "PAPER" }], // stratRows
    ];
    const r = (await diagnose({})) as Record<string, unknown>;
    const stuck = r["oldest_stuck"] as Array<Record<string, unknown>>;
    expect(stuck[0]!["strategy"]).toBe("orb_mnq_15m");
    expect(stuck[0]!["state"]).toBe("PAPER");
    expect(stuck[0]!["days_in_state"]).toBe(12);
  });

  it("fails soft to a structured error when a query throws", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orig = (h.chain as any).groupBy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (h.chain as any).groupBy = () => {
      throw new Error("db down");
    };
    try {
      const r = (await diagnose({})) as Record<string, unknown>;
      expect(r["error"]).toBe("diagnose_pipeline_failed");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (h.chain as any).groupBy = orig;
    }
  });
});

// ─── analyze_gate_blocks ──────────────────────────────────────────────────────

describe("analyze_gate_blocks", () => {
  const analyze = CARTER_RECOMMEND_HANDLERS["analyze_gate_blocks"]!;
  const COUNTERFACTUAL =
    "Frequency only — the deep costing-vs-saving counterfactual is " +
    "src/engine/gate_block_analyzer.py, run offline.";

  it("groups paper_signal_logs reasons by frequency and clamps sinceDays", async () => {
    h.state.queue = [
      [
        { reason: "daily_trade_cap" },
        { reason: "daily_trade_cap" },
        { reason: "lunch_blackout" },
        { reason: null },
      ],
    ];
    const r = (await analyze({ sinceDays: 999 })) as Record<string, unknown>;
    expect(r["since_days"]).toBe(60); // clamped to max
    expect(r["source"]).toBe("paper_signal_logs");
    expect(r["total_blocked"]).toBe(4);
    const byGate = r["by_gate"] as Array<Record<string, unknown>>;
    expect(byGate[0]).toEqual({ gate_or_reason: "daily_trade_cap", count: 2 });
    expect(r["note"]).toBe(COUNTERFACTUAL);
  });

  it("clamps sinceDays floor to 1", async () => {
    h.state.queue = [[]]; // empty paper_signal_logs → triggers audit fallback
    h.state.queue.push([{ action: "lifecycle.pbo_overfit_block" }]); // audit_log fallback
    const r = (await analyze({ sinceDays: -5 })) as Record<string, unknown>;
    expect(r["since_days"]).toBe(1);
    expect(r["source"]).toBe("audit_log");
    expect(r["total_blocked"]).toBe(1);
  });

  it("defaults sinceDays to 7 when not provided", async () => {
    h.state.queue = [[{ reason: "macro_blackout" }]];
    const r = (await analyze({})) as Record<string, unknown>;
    expect(r["since_days"]).toBe(7);
    expect(r["strategy"]).toBeNull();
  });
});

// ─── review_strategy ──────────────────────────────────────────────────────────

describe("review_strategy", () => {
  const review = CARTER_RECOMMEND_HANDLERS["review_strategy"]!;

  it("throws when neither strategyId nor name is provided", async () => {
    await expect(review({})).rejects.toThrow(/strategyId or .*name is required/);
  });

  it("throws strategy_not_found when the lookup returns no rows", async () => {
    h.state.queue = [[]]; // strategy lookup empty
    await expect(review({ name: "ghost" })).rejects.toThrow("strategy_not_found");
  });

  it("assembles a critique bundle with latest backtest, MC, and a B14 blocking gate", async () => {
    h.state.queue = [
      // strategy lookup
      [
        {
          id: "abc",
          name: "vwap_mes_5m",
          lifecycleState: "PAPER",
          symbol: "MES",
          symbols: ["MES"],
          exitPlanConfig: null,
          config: {
            entry_quality: { confluence_factors: ["structural_setup"] },
            position_size: { type: "risk_derived_pyramid" },
            exit_plan_config: { exit_style: "static_styleC" },
          },
        },
      ],
      // latest backtest
      [
        {
          id: "bt1",
          sharpeRatio: "1.8",
          profitFactor: "1.6",
          bif: "2.1",
          walkForwardResults: { wfe_overall: 0.75, pbo_overall: 0.10 },
          status: "completed",
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        },
      ],
      // latest MC run (ruin ci_high huge → B14 blocks)
      [
        {
          probabilityOfRuin: "0.5",
          riskMetrics: { probability_of_ruin_ci: { ci_high: 0.99 }, survival_rate: 0.4, ruin_basis: "firm_breach" },
          createdAt: new Date(),
        },
      ],
    ];
    const r = (await review({ name: "vwap_mes_5m" })) as Record<string, unknown>;
    expect(r["id"]).toBe("abc");
    expect(r["symbols"]).toEqual(["MES"]);
    expect(r["entry_quality"]).toEqual({ confluence_factors: ["structural_setup"] });
    expect(r["exit_plan_config"]).toEqual({ exit_style: "static_styleC" });
    const bt = r["latest_backtest"] as Record<string, unknown>;
    expect(bt["sharpe"]).toBe(1.8);
    expect(bt["wfe"]).toBe(0.75);
    expect(bt["bif"]).toBe(2.1);
    expect(bt["created_at"]).toBe("2026-06-20T00:00:00.000Z");
    const mc = r["monte_carlo"] as Record<string, unknown>;
    expect(mc["probability_of_ruin_ci_high"]).toBe(0.99);
    expect(String(r["blocking_gate"])).toMatch(/B14/);
  });

  it("returns null backtest/MC and no blocking gate when none exist", async () => {
    h.state.queue = [
      [{ id: "x", name: "fresh", lifecycleState: "CANDIDATE", symbol: "MNQ", symbols: ["MNQ"], config: {}, exitPlanConfig: null }],
      [], // no backtest
    ];
    const r = (await review({ strategyId: "x" })) as Record<string, unknown>;
    expect(r["latest_backtest"]).toBeNull();
    expect(r["monte_carlo"]).toBeNull();
    expect(r["blocking_gate"]).toBeNull();
  });
});

// ─── find_hardening_opportunities ─────────────────────────────────────────────

describe("find_hardening_opportunities", () => {
  const find = CARTER_RECOMMEND_HANDLERS["find_hardening_opportunities"]!;

  it("returns recent errors, stale, stuck, open issues, and a summary", async () => {
    h.state.queue = [
      // recent_errors
      [{ action: "monte_carlo.bca_ci_failed", status: "critical", createdAt: new Date("2026-06-28T00:00:00.000Z") }],
      // stale lastBtRows (groupBy) — empty so no name fetch
      [],
      // stuck_pre_paper
      [{ name: "orb_mnq_15m", state: "CANDIDATE", changedAt: new Date(Date.now() - 5 * 86_400_000) }],
      // open_issues
      [{ issueKey: "ollama_down", severity: "warning", title: "Ollama unreachable", lastSeen: new Date() }],
    ];
    const r = (await find({})) as Record<string, unknown>;
    const errs = r["recent_errors"] as Array<Record<string, unknown>>;
    expect(errs[0]!["action"]).toBe("monte_carlo.bca_ci_failed");
    expect(errs[0]!["status"]).toBe("critical");
    expect(r["stale_strategies"]).toEqual([]);
    const stuck = r["stuck_pre_paper"] as Array<Record<string, unknown>>;
    expect(stuck[0]!["name"]).toBe("orb_mnq_15m");
    expect(stuck[0]!["days_in_state"]).toBe(5);
    const open = r["open_issues"] as Array<Record<string, unknown>>;
    expect(open[0]!["issue_key"]).toBe("ollama_down");
    expect(typeof r["summary"]).toBe("string");
  });

  it("omits open_issues when the carter_issues query returns no rows", async () => {
    h.state.queue = [
      [], // recent_errors
      [], // stale group
      [], // stuck_pre_paper
      [], // open_issues empty
    ];
    const r = (await find({})) as Record<string, unknown>;
    expect("open_issues" in r).toBe(false);
    expect(r["summary"]).toMatch(/0 open issue/);
  });

  it("resolves stale strategies with last_backtest_days when older than staleness window", async () => {
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    h.state.queue = [
      [], // recent_errors
      [{ strategyId: "s9", lastAt: old }], // stale group (older than 30d default)
      [{ id: "s9", name: "stale_strat" }], // name fetch
      [], // stuck_pre_paper
      [], // open_issues
    ];
    const r = (await find({})) as Record<string, unknown>;
    const stale = r["stale_strategies"] as Array<Record<string, unknown>>;
    expect(stale[0]!["name"]).toBe("stale_strat");
    expect(stale[0]!["last_backtest_days"]).toBe(90);
  });
});
