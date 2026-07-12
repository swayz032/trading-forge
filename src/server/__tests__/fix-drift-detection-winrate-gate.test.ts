/**
 * fix-drift-detection-winrate-gate.test.ts — 2026-06-24 bug fix
 *
 * MANDATE: Win rate is an OBSERVED output metric — never a target, never a gate
 * (CLAUDE.md §1 + win-rate-is-output rule). The drift-detection-service was
 * auto-demoting PAPER → DECLINING strategies when win-rate deviation exceeded 2σ,
 * in direct violation of the mandate.
 *
 * FIX: winRate severity capped at "investigate" (never "alert"), so it cannot
 * enter the alerts[] filter that drives auto-demotion. Audit trail (correlationId)
 * added to demotion path. R-expectancy / avg-trade-PnL / drawdown remain as the
 * authoritative demotion signals.
 *
 * Tests:
 *  1. Win-rate deviation > 2σ (expectancy/drawdown stable) → NO auto-demotion
 *  2. Win-rate is still REPORTED for observability (not suppressed) — severity="investigate"
 *  3. Expectancy (avgTradePnl) deterioration > 2σ DOES auto-demote (gate still works)
 *  4. Drawdown (maxDrawdown) > 1.5× backtest DOES auto-demote (gate still works)
 *  5. Both winRate (>2σ) AND expectancy (>2σ) → demotion fires once (driven by expectancy, not winRate)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock state ───────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  demoteCalls: [] as Array<{ strategyId: string; from: string; to: string }>,
  sseBroadcasts: [] as Array<{ event: string; data: unknown }>,
  logWarns: [] as Array<unknown[]>,
  logErrors: [] as Array<unknown[]>,
  auditRows: [] as Array<{ action: string; [k: string]: unknown }>,
  // freshscan11 MED: promoteStrategy can return {success:false} WITHOUT throwing (optimistic-lock
  // trip). Default happy-path is success:true; test 6 flips it to prove the consumer suppresses the
  // false demotion signal.
  promoteResult: { success: true } as { success: boolean; error?: string },
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  backtests: { strategyId: "strategy_id", status: "status", createdAt: "created_at" },
  paperTrades: { sessionId: "session_id", exitTime: "exit_time" },
  complianceReviews: {},
  paperSessions: {},
  strategies: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn((event: string, data: unknown) => {
    mockState.sseBroadcasts.push({ event, data });
  }),
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn((...args: unknown[]) => { mockState.logWarns.push(args); }),
    error: vi.fn((...args: unknown[]) => { mockState.logErrors.push(args); }),
    debug: vi.fn(),
  },
}));

vi.mock("./lifecycle-service.js", () => ({}));

// Lifecycle service is dynamically imported inside detectDrift — mock it here
vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: vi.fn().mockImplementation(() => ({
    promoteStrategy: vi.fn(async (strategyId: string, from: string, to: string) => {
      mockState.demoteCalls.push({ strategyId, from, to });
      return mockState.promoteResult;
    }),
  })),
}));

// freshscan11 MED: capture the drift.auto_demotion_refused audit written when promoteStrategy refuses.
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async (row: { action: string; [k: string]: unknown }) => {
    mockState.auditRows.push(row);
  }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { detectDrift } from "../services/drift-detection-service.js";
import { db } from "../db/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a backtest row with given metrics.
 * winRate is stored as a fraction (0.0–1.0).
 */
function makeBacktest(overrides: {
  winRate?: number;
  avgTradePnl?: number;
  maxDrawdown?: number;
} = {}) {
  return {
    id: "bt-1",
    strategyId: "strat-1",
    status: "completed",
    createdAt: new Date("2026-01-01"),
    winRate: String(overrides.winRate ?? 0.60),       // 60% expected
    avgTradePnl: String(overrides.avgTradePnl ?? 100), // $100 expected avg
    maxDrawdown: String(overrides.maxDrawdown ?? 500), // $500 expected max DD
  };
}

/**
 * Build trade rows with explicit pnl values per trade.
 * All trades get approximately the same pnl to keep stdDev low while keeping avgPnl stable.
 */
function makeTrades(pnls: number[]) {
  return pnls.map((pnl, i) => ({
    id: `trade-${i}`,
    sessionId: "sess-1",
    pnl: String(pnl),
    exitTime: new Date(`2026-05-${String((i % 28) + 1).padStart(2, "0")}`),
  }));
}

/**
 * Build trades where win rate deviates from backtest (60% expected)
 * but avg PnL stays close to backtest ($100 expected).
 *
 * Strategy: keep all trade PnLs near $100 or $102 so avgPnl ≈ $100
 * but only 2 out of 10 are "wins" (pnl > 0) — so live win rate = 20%.
 * All "losing" trades are SLIGHTLY positive to fool the gate into seeing
 * stable avgPnl but drifted win rate.
 *
 * Wait — pnl > 0 is the win condition. If we want 20% win rate but ~$100 avg,
 * we need: 2 wins × high-pnl + 8 near-zero-positive trades that are NOT counted
 * as wins. That's impossible — any pnl > 0 is a win.
 *
 * Correct approach: 20% wins (pnl > 0) with stable OVERALL avg pnl.
 * Example: 20 losses × -$12 + 5 wins × $100 → avg = (5×100 + 20×-12)/25 = (500-240)/25 = $10.4
 * That's too far from $100 avg.
 *
 * Better: use a small loss-per-loser to keep avg close to backtest.
 * With 30 trades at 20% win rate (6 wins):
 *   6 wins × $500 + 24 losses × -$X → avg close to $100
 *   6×500 + 24×(-X) = 30 × 100 → 3000 + 24×(-X) = 3000 → X = 0
 * So losses of $0 keeps avg at $100 with 6 wins at $500... but $0 pnl is NOT a loss.
 * Use losses at $-1 so they're losses (pnl < 0):
 *   6×500 + 24×(-1) = 3000 - 24 = 2976 / 30 = $99.2 ≈ $100 ✓  win rate = 6/30 = 20% ✓
 */
function makeWinRateDriftTrades(): ReturnType<typeof makeTrades> {
  // 6 big wins + 24 tiny losses → win_rate=20% but avg_pnl≈$99 (near backtest $100)
  const pnls: number[] = [
    500, 500, 500, 500, 500, 500,      // 6 wins
    -1, -1, -1, -1, -1, -1, -1, -1,   // 8 losses
    -1, -1, -1, -1, -1, -1, -1, -1,   // 8 more losses
    -1, -1, -1, -1, -1, -1, -1, -1,   // 8 more losses
  ];
  return makeTrades(pnls);
}

/**
 * Build trades where avgTradePnl deviates dramatically from backtest ($100 expected)
 * but win rate stays close to 60% expected.
 *
 * Strategy: all trades have very similar absolute PnL values → near-zero stdDev →
 * pnlDeviation = |liveAvg - backtestAvg| / stdDev → huge (>> 2).
 *
 * Use 30 trades: 18 losses of -$99 + 12 losses of -$101
 *   → win_rate = 0/30 = 0% (clearly not 60%, but we only check avgTradePnl here)
 *   → liveAvgPnl = (18×(-99) + 12×(-101)) / 30 = (-1782 - 1212) / 30 = -99.8
 *   → delta from backtest ($100): |(-99.8) - 100| = $199.8
 *   → stdDev ≈ $1 (tiny — all values near -$100)
 *   → pnlDeviation ≈ $199.8 / $1 ≈ 200 → "alert"
 *
 * Note: win rate will also be an "investigate" (0% vs 60%), but test 3
 * only asserts on avgTradePnl severity — which is "alert" here.
 */
function makeExpectancyDriftTrades(): ReturnType<typeof makeTrades> {
  // 18 × -$99 + 12 × -$101 → avg ≈ -$99.8 vs backtest $100 (massive delta, tiny stdDev)
  const pnls: number[] = [
    -99, -99, -99, -99, -99, -99, -99, -99, -99,  // 9 losses
    -99, -99, -99, -99, -99, -99, -99, -99, -99,  // 9 more (total 18 at -$99)
    -101, -101, -101, -101, -101, -101,             // 6 losses
    -101, -101, -101, -101, -101, -101,             // 6 more (total 12 at -$101)
  ];
  return makeTrades(pnls);
}

/**
 * Wire db mocks so:
 *   db.select() chain returns [backtest] then [trades]
 */
function setupDbForDetect(
  backtest: ReturnType<typeof makeBacktest> | null,
  trades: ReturnType<typeof makeTrades>,
) {
  vi.mocked(db.select)
    // First call: backtest lookup
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(backtest ? [backtest] : []),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>)
    // Second call: paper trades
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(trades),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockState.demoteCalls = [];
  mockState.sseBroadcasts = [];
  mockState.logWarns = [];
  mockState.logErrors = [];
  mockState.auditRows = [];
  mockState.promoteResult = { success: true };
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("drift-detection-service — winRate mandate fix", () => {

  it("1. win-rate deviation > 2σ ALONE does NOT auto-demote (mandate: win rate is never a gate)", async () => {
    // Backtest: 60% win rate, $100 avg PnL, $500 max DD
    const backtest = makeBacktest({ winRate: 0.60, avgTradePnl: 100, maxDrawdown: 500 });

    // Live trades: 6 wins × $500 + 24 losses × $-1
    //   → win_rate = 6/30 = 20% (far below 60% backtest → CLEARLY > 2σ deviation)
    //   → avg_pnl = (6×500 + 24×-1) / 30 = 2976/30 ≈ $99.2 (near $100 backtest → within range)
    // Only win rate drifts. avgTradePnl and drawdown are stable.
    const trades = makeWinRateDriftTrades();

    setupDbForDetect(backtest, trades);

    const reports = await detectDrift("strat-win-rate-only", "sess-1");

    // winRate report should exist (observability preserved)
    const winRateReport = reports.find(r => r.metric === "winRate");
    expect(winRateReport).toBeDefined();
    // Deviation must be computed (non-zero)
    expect(winRateReport!.deviationStdDevs).toBeGreaterThan(2);

    // CRITICAL: severity must NOT be "alert" — capped at "investigate"
    expect(winRateReport!.severity).not.toBe("alert");
    expect(winRateReport!.severity).toBe("investigate");

    // CRITICAL: NO auto-demotion must have fired
    expect(mockState.demoteCalls).toHaveLength(0);

    // No "strategy:drift-demotion" SSE must have fired
    const demotionBroadcast = mockState.sseBroadcasts.find(b => b.event === "strategy:drift-demotion");
    expect(demotionBroadcast).toBeUndefined();
  });

  it("2. winRate is still REPORTED for observability even after fix (not suppressed)", async () => {
    // Backtest has a meaningful win rate
    const backtest = makeBacktest({ winRate: 0.60, avgTradePnl: 100, maxDrawdown: 500 });

    // Use win-rate-drift trades (20% win rate, stable avg)
    const trades = makeWinRateDriftTrades();

    setupDbForDetect(backtest, trades);

    const reports = await detectDrift("strat-observability", "sess-1");

    // winRate MUST appear in reports (observability — not removed)
    const winRateReport = reports.find(r => r.metric === "winRate");
    expect(winRateReport).toBeDefined();
    expect(winRateReport!.metric).toBe("winRate");
    expect(winRateReport!.backtestValue).toBeCloseTo(0.60, 1);
    expect(typeof winRateReport!.liveValue).toBe("number");

    // severity is "investigate" or "ok" — never "alert"
    expect(winRateReport!.severity).not.toBe("alert");
  });

  it("3. avgTradePnl deterioration > 2σ DOES auto-demote (gate still functional)", async () => {
    // Backtest: $100 avg PnL, 60% win rate
    const backtest = makeBacktest({ winRate: 0.60, avgTradePnl: 100, maxDrawdown: 500 });

    // Live trades: 18 wins × $1 + 12 losses × -$250
    //   → win_rate = 18/30 = 60% (stable vs backtest)
    //   → avg_pnl = (18×1 + 12×-250) / 30 = (18 - 3000)/30 = -99.4
    //   → liveAvgPnl ≈ -$99.4, backtestAvgPnl = $100, delta ≈ $199.4
    //   → stdDev of pnls: mix of $1 (18×) and -$250 (12×) → stdDev ≈ $119
    //   → pnlDeviation = $199.4 / $119 ≈ 1.68 — this may be <2.
    // makeExpectancyDriftTrades: 30 trades all near -$100 (tiny stdDev ≈ $1, mean ≈ -$99.8)
    //   pnlDeviation = |(-99.8) - 100| / $1 ≈ 200 → clearly "alert"
    // Win rate: 0/30 = 0% vs 60% backtest → "investigate" (mandate-correct, not "alert")
    const trades = makeExpectancyDriftTrades();

    setupDbForDetect(backtest, trades);

    const reports = await detectDrift("strat-expectancy-drift", "sess-1");

    // avgTradePnl report must exist and be "alert"
    const pnlReport = reports.find(r => r.metric === "avgTradePnl");
    expect(pnlReport).toBeDefined();
    expect(pnlReport!.severity).toBe("alert");

    // Auto-demotion MUST have fired (driven by avgTradePnl, not winRate)
    expect(mockState.demoteCalls.length).toBeGreaterThan(0);
    const demotion = mockState.demoteCalls[0];
    expect(demotion.strategyId).toBe("strat-expectancy-drift");
    expect(demotion.from).toBe("PAPER");
    expect(demotion.to).toBe("DECLINING");

    // drift-demotion SSE must have fired
    const demotionBroadcast = mockState.sseBroadcasts.find(b => b.event === "strategy:drift-demotion");
    expect(demotionBroadcast).toBeDefined();

    // The SSE payload must include correlationId (audit-trail requirement)
    const demotionData = demotionBroadcast!.data as Record<string, unknown>;
    expect(demotionData).toHaveProperty("correlationId");
    expect(typeof demotionData.correlationId).toBe("string");
    expect((demotionData.correlationId as string).length).toBeGreaterThan(0);
  });

  it("4. drawdown > 1.5× backtest DOES auto-demote (gate still functional)", async () => {
    // Backtest: $500 max DD
    const backtest = makeBacktest({ winRate: 0.50, avgTradePnl: 50, maxDrawdown: 500 });

    // Live trades: 30 losses × -$50 in a row → cumulative peak=0 → drawdown=$1500
    //   (backtestMaxDD=500; ddRatio=1500/500=3.0 > 1.5 → maxDrawdown="alert" → demotion)
    // avgTradePnl: stdDev=0 (all identical) → report is skipped per line 84 guard (pnlStdDev > 0)
    // winRate: 0/30=0% vs 50% → "investigate" (capped per mandate — not "alert")
    // Only maxDrawdown fires "alert" here — sufficient to trigger demotion
    const pnls = Array.from({ length: 30 }, () => -50);
    const trades = makeTrades(pnls);

    setupDbForDetect(backtest, trades);

    const reports = await detectDrift("strat-drawdown-drift", "sess-1");

    // maxDrawdown report must exist and be "alert" (live DD > 1.5× backtest)
    const ddReport = reports.find(r => r.metric === "maxDrawdown");
    expect(ddReport).toBeDefined();
    expect(ddReport!.severity).toBe("alert");

    // Auto-demotion must have fired
    expect(mockState.demoteCalls.length).toBeGreaterThan(0);
    expect(mockState.demoteCalls[0].from).toBe("PAPER");
    expect(mockState.demoteCalls[0].to).toBe("DECLINING");
  });

  it("5. winRate AND expectancy both > 2σ → demotion fires exactly once (correlationId in SSE payload)", async () => {
    // Backtest: 60% winRate, $100 avgPnl
    const backtest = makeBacktest({ winRate: 0.60, avgTradePnl: 100, maxDrawdown: 500 });

    // makeExpectancyDriftTrades: 18×-$99 + 12×-$101
    //   → winRate=0/30=0% (deviation 6.7σ from 60% backtest — capped at "investigate" per mandate)
    //   → avgTradePnl=-$99.8 (deviation ≈200σ from $100 backtest — "alert")
    //   → demotion must fire driven by avgTradePnl only (not winRate)
    const trades = makeExpectancyDriftTrades();

    setupDbForDetect(backtest, trades);

    const reports = await detectDrift("strat-both-metrics", "sess-1");

    // winRate: severity capped — NOT alert
    const winRateReport = reports.find(r => r.metric === "winRate");
    expect(winRateReport?.severity).not.toBe("alert");

    // avgTradePnl: severity = alert (drives demotion)
    const pnlReport = reports.find(r => r.metric === "avgTradePnl");
    expect(pnlReport?.severity).toBe("alert");

    // Demotion fires exactly once — not twice (no double-demotion from two-metric storm)
    // promoteStrategy is called once; the SSE broadcast is once
    const demotionBroadcasts = mockState.sseBroadcasts.filter(b => b.event === "strategy:drift-demotion");
    expect(demotionBroadcasts).toHaveLength(1);

    // correlationId present in the demotion SSE (audit trail requirement)
    const payload = demotionBroadcasts[0].data as Record<string, unknown>;
    expect(payload).toHaveProperty("correlationId");
    expect(typeof payload.correlationId).toBe("string");

    // The `trigger` field in the SSE must NOT include "winRate"
    // (it must only list the gated metrics that drove demotion)
    const trigger = payload.trigger as string[] | undefined;
    if (trigger) {
      expect(trigger).not.toContain("winRate");
    }
  });

  it("6. promoteStrategy refuses ({success:false}) → NO false drift-demotion SSE, refusal is audited (freshscan11 MED)", async () => {
    // Expectancy drift that WOULD demote — but the strategy has concurrently left PAPER, so
    // promoteStrategy returns {success:false} WITHOUT throwing. The consumer must NOT emit the
    // (false) strategy:drift-demotion SSE, and must audit the refusal so it isn't silent.
    // RED-proof: revert the drift-detection-service `if (demoteResult.success)` guard and this fails
    // (the SSE fires unconditionally again).
    mockState.promoteResult = { success: false, error: "optimistic_lock: not in PAPER" };
    const backtest = makeBacktest({ winRate: 0.60, avgTradePnl: 100, maxDrawdown: 500 });
    const trades = makeExpectancyDriftTrades();
    setupDbForDetect(backtest, trades);

    await detectDrift("strat-refused-demote", "sess-1");

    // promoteStrategy WAS attempted...
    expect(mockState.demoteCalls.length).toBeGreaterThan(0);
    // ...but the demotion did NOT happen, so NO strategy:drift-demotion SSE may fire.
    const demotionBroadcast = mockState.sseBroadcasts.find(b => b.event === "strategy:drift-demotion");
    expect(demotionBroadcast).toBeUndefined();
    // The refusal MUST be audited (not silent).
    const refusalAudit = mockState.auditRows.find(r => r.action === "drift.auto_demotion_refused");
    expect(refusalAudit).toBeDefined();
    expect((refusalAudit as Record<string, unknown>).entityId).toBe("strat-refused-demote");
  });
});
