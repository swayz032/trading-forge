import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// ops-experience 2026-07-21 — observability-room backend: the two NEW report
// scopes each own a DIFFERENT shape and each must be honest-empty.
//
//   soak      → rails_nightly_reports cert verdicts. An EMPTY table is a genuinely
//               empty history (soak:[], NOT degraded); a query FAILURE is degraded
//               so "the desk is broken" never reads as "no soak runs".
//   weekly-ab → read-only-consumes buildABComparisonData (the money-path builder,
//               NOT re-querying its tables). Pre-deploy both sub-accounts have 0
//               trades → hasData:false (never a fabricated edge); a builder throw
//               fail-softs to ab:null + degraded.
//
// Both are mocked at the module edge (db + the A/B builder) so the contract — not a
// live database — is what's locked.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../db/index.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../routes/ab-comparison.js", () => ({ buildABComparisonData: vi.fn() }));

import { db } from "../../db/index.js";
import { buildABComparisonData } from "../../routes/ab-comparison.js";
import {
  assemblePaperFloorReports,
  assembleSoakReports,
  assembleWeeklyAbReports,
} from "../../lib/slumhouse/reports-data.js";

const dbExecute = db.execute as unknown as ReturnType<typeof vi.fn>;
const abBuild = buildABComparisonData as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assembleSoakReports — cert-verdict shape, honest-empty", () => {
  it("empty rails table → soak:[] and NOT degraded (an empty history is not a failure)", async () => {
    dbExecute.mockResolvedValue([]);
    const out = await assembleSoakReports();
    expect(out.scope).toBe("soak");
    expect(out.soak).toEqual([]);
    expect(out.degraded).toBeUndefined();
  });

  it("★ query failure → soak:[] + degraded:true (a broken read never masquerades as 'no runs')", async () => {
    dbExecute.mockRejectedValue(new Error("db down"));
    const out = await assembleSoakReports();
    expect(out.soak).toEqual([]);
    expect(out.degraded).toBe(true);
  });

  it("rows map to cert verdicts; summary/checks/sha surface ONLY when the certificate has them", async () => {
    dbExecute.mockResolvedValue([
      {
        report_date: "2026-07-21",
        build_sha: "abcdef1234567890",
        verdict: "green",
        certificate: { summary: "held for 72h", checks: { passed: 40, total: 40 } },
      },
      { report_date: "2026-07-20", build_sha: null, verdict: "drift", certificate: {} },
    ]);
    const out = await assembleSoakReports();
    expect(out.soak).toHaveLength(2);
    expect(out.soak[0]).toMatchObject({ reportDate: "2026-07-21", verdict: "green", summary: "held for 72h" });
    expect(out.soak[0].checks).toEqual({ passed: 40, total: 40 });
    // Nothing is fabricated when the certificate is bare — honest nulls, not zeros.
    expect(out.soak[1].summary).toBeNull();
    expect(out.soak[1].checks).toBeNull();
    expect(out.soak[1].buildSha).toBeNull();
    expect(out.degraded).toBeUndefined();
  });
});

describe("assembleWeeklyAbReports — Sharpe/P&L delta shape, honest-empty", () => {
  const metrics = (over: Record<string, number> = {}) => ({
    rolling_20_session_sharpe: 0,
    cumulative_pnl: 0,
    max_drawdown: 0,
    trade_count: 0,
    ...over,
  });

  it("★ pre-deploy (0 trades both sides) → ab.hasData:false, NOT degraded (never a fabricated edge)", async () => {
    abBuild.mockResolvedValue({
      sub_account_1: metrics(),
      sub_account_2: metrics(),
      delta: { sharpe_delta: 0, pnl_delta: 0, drawdown_delta: 0 },
      kill_switch_status: { is_armed: false, currently_dormant: true, last_evaluated: null },
      last_updated: new Date("2026-07-21T00:00:00Z"),
    });
    const out = await assembleWeeklyAbReports();
    expect(out.scope).toBe("weekly-ab");
    expect(out.ab).not.toBeNull();
    expect(out.ab!.hasData).toBe(false);
    expect(out.degraded).toBeUndefined();
  });

  it("live sessions → hasData:true with deltas traced to the builder (not re-derived)", async () => {
    abBuild.mockResolvedValue({
      sub_account_1: metrics({ rolling_20_session_sharpe: 1.2, cumulative_pnl: 1000, trade_count: 18 }),
      sub_account_2: metrics({ rolling_20_session_sharpe: 1.4, cumulative_pnl: 1240, trade_count: 20 }),
      delta: { sharpe_delta: 0.2, pnl_delta: 240, drawdown_delta: -50 },
      kill_switch_status: { is_armed: true, currently_dormant: false, last_evaluated: new Date("2026-07-21T03:00:00Z") },
      last_updated: new Date("2026-07-21T03:00:00Z"),
    });
    const out = await assembleWeeklyAbReports();
    expect(out.ab!.hasData).toBe(true);
    expect(out.ab!.sharpeDelta).toBeCloseTo(0.2);
    expect(out.ab!.pnlDelta).toBe(240);
    expect(out.ab!.challenger.trades).toBe(20);
    expect(out.ab!.baseline.trades).toBe(18);
    expect(out.ab!.killSwitch.isArmed).toBe(true);
    expect(out.degraded).toBeUndefined();
  });

  it("★ builder throws → ab:null + degraded:true (read-only consume fail-softs honestly)", async () => {
    abBuild.mockRejectedValue(new Error("ab desk down"));
    const out = await assembleWeeklyAbReports();
    expect(out.ab).toBeNull();
    expect(out.degraded).toBe(true);
  });
});

describe("assemblePaperFloorReports — all-strategy fight card", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    session_id: "session-a",
    strategy_id: "strategy-a",
    strategy_name: "London Sweep",
    symbols: ["MES"],
    timeframe: "5m",
    status: "active",
    started_at: new Date("2026-07-23T12:00:00Z"),
    last_signal_at: new Date("2026-07-23T14:00:00Z"),
    starting_capital: "50000",
    current_equity: "51250",
    trades: 12,
    wins: 8,
    losses: 4,
    realized_pnl: "1100",
    unrealized_pnl: "150",
    open_position_count: 1,
    last_trade_at: new Date("2026-07-23T13:55:00Z"),
    last_position_at: new Date("2026-07-23T13:58:00Z"),
    positions: [{
      id: "position-a",
      symbol: "MES",
      side: "long",
      contracts: 2,
      entryPrice: "6350.25",
      currentPrice: "6352.00",
      unrealizedPnl: "150",
      entryTime: new Date("2026-07-23T13:58:00Z"),
    }],
    ...over,
  });

  it("honest empty returns no fighters and is not degraded", async () => {
    dbExecute.mockResolvedValue([]);
    const out = await assemblePaperFloorReports(new Map());
    expect(out.scope).toBe("paper-floor");
    expect(out.fighters).toEqual([]);
    expect(out.summary.activeStrategies).toBe(0);
    expect(out.degraded).toBeUndefined();
  });

  it("ranks every strategy by actual net equity P&L and carries Massive stream state", async () => {
    dbExecute.mockResolvedValue([
      row(),
      row({
        session_id: "session-b",
        strategy_id: "strategy-b",
        strategy_name: "NY Reversal",
        symbols: ["MNQ"],
        current_equity: "49750",
        realized_pnl: "-250",
        unrealized_pnl: "0",
        trades: 5,
        wins: 2,
        losses: 3,
        open_position_count: 0,
        positions: [],
      }),
    ]);
    const streams = new Map([
      ["session-a", { symbols: ["MES"], connected: true }],
      ["session-b", { symbols: ["MNQ"], connected: false }],
    ]);
    const out = await assemblePaperFloorReports(streams);

    expect(out.fighters.map((fighter) => fighter.strategyId)).toEqual(["strategy-a", "strategy-b"]);
    expect(out.fighters[0]).toMatchObject({
      rank: 1,
      netPnl: 1250,
      returnPct: 2.5,
      winRate: 8 / 12,
      openPositionCount: 1,
      feed: { provider: "Massive", connected: true, state: "connected" },
    });
    expect(out.fighters[0].positions[0]).toMatchObject({ symbol: "MES", side: "long", unrealizedPnl: 150 });
    expect(out.fighters[1]).toMatchObject({ rank: 2, netPnl: -250, feed: { state: "disconnected" } });
    expect(out.summary).toMatchObject({
      activeStrategies: 2,
      openPositions: 1,
      combinedNetPnl: 1000,
      leaderStrategyIds: ["strategy-a"],
      tiedForLead: false,
      scoreBasis: "net_paper_pnl",
    });
  });

  it("does not invent a winner when top net P&L is tied to the cent", async () => {
    dbExecute.mockResolvedValue([
      row(),
      row({ session_id: "session-b", strategy_id: "strategy-b", strategy_name: "Twin", current_equity: "51250.004" }),
    ]);
    const out = await assemblePaperFloorReports();
    expect(out.fighters.map((fighter) => fighter.rank)).toEqual([1, 1]);
    expect(out.summary.tiedForLead).toBe(true);
    expect(out.summary.leaderStrategyIds).toEqual(["strategy-a", "strategy-b"]);
  });

  it("query failure is visibly degraded rather than a quiet arena", async () => {
    dbExecute.mockRejectedValue(new Error("paper tables unavailable"));
    const out = await assemblePaperFloorReports();
    expect(out.fighters).toEqual([]);
    expect(out.degraded).toBe(true);
    expect(out.error).toBe("paper_floor_query_failed");
  });
});
