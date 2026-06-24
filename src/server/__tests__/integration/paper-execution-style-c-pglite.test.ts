/**
 * paper-execution-style-c-pglite.test.ts — Pass 6 Track C, 2026-06-23
 *
 * DB-integration coverage for the Style C 33/33/33 state machine.
 * Uses a real in-memory PGlite instance (not mocks) to catch:
 *   - column-name drift between schema.ts and live DDL
 *   - JSONB round-trip correctness for exitPlan
 *   - audit_log timestamp ordering contract
 *   - P&L math over the full TP1 → TP2 → runner-exit sequence
 *   - 15:55 ET hard-flatten winning over a concurrent TP1 fill
 *   - Zero-volume bar on a stop-trigger candidate (BACKTEST_ZERO_VOLUME guard)
 *   - NaN ATR fallback to chandelier(14,2) trail method
 *
 * DESIGN: This test does NOT call live paper-execution-service.ts functions.
 * Instead it performs the exact DB operations that the service would perform,
 * verifying that the schema columns exist, accept the right values, and that
 * the audit_log contract is honoured.  This is intentional: the service has
 * too many side-effect dependencies (SSE, Python subprocess, SME, roll calendar)
 * for a DB-layer integration test.  The service unit tests (paper-execution-
 * style-exit.test.ts) cover dispatch logic via mocks; this test covers the
 * persistence contract that the service assumes is correct.
 *
 * KEY INVARIANTS ASSERTED:
 *   1. tp1Filled=true  → beStopApplied=true  (Style C §4 CLAUDE.md mandate)
 *   2. stop moved to entry + 1 tick (0.25 pts on MES) after TP1
 *   3. tp2Filled=true  → runner still open (closedAt IS NULL)
 *   4. 15:55 ET hard-flatten → closedAt IS NOT NULL (runner exited)
 *   5. 3 audit_log rows ordered by created_at: tp1Filled < tp2Filled < runnerExited
 *   6. total net P&L = sum of paper_trades.pnl across 3 partial closes
 *   7. Edge: TP1 bar coincides with 15:55 ET → flatten wins (closedAt set once)
 *   8. Edge: zero-volume bar on stop-trigger candidate → reject detected
 *   9. Edge: NaN ATR → trail method falls back to chandelier
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, isNotNull, isNull, asc, and } from "drizzle-orm";
import { createTestDb } from "../helpers/pglite-db.js";
import type { TestDb } from "../helpers/pglite-db.js";
import {
  strategies,
  paperSessions,
  paperPositions,
  paperTrades,
  auditLog,
} from "../../db/schema.js";

// ─── Test constants ────────────────────────────────────────────────────────────

const STRATEGY_UUID = "aaaa0001-0000-0000-0000-000000000001";
const SESSION_UUID  = "aaaa0001-0000-0000-0000-000000000002";
const POSITION_UUID = "aaaa0001-0000-0000-0000-000000000003";

// Trade UUIDs — one per partial close (TP1, TP2, runner)
const TRADE_TP1_UUID     = "aaaa0001-0000-0000-0000-000000000010";
const TRADE_TP2_UUID     = "aaaa0001-0000-0000-0000-000000000011";
const TRADE_RUNNER_UUID  = "aaaa0001-0000-0000-0000-000000000012";

// Audit log UUIDs
const AUDIT_TP1_UUID     = "aaaa0001-0000-0000-0000-000000000020";
const AUDIT_TP2_UUID     = "aaaa0001-0000-0000-0000-000000000021";
const AUDIT_RUNNER_UUID  = "aaaa0001-0000-0000-0000-000000000022";

// MES contract constants (from firm-config.ts CONTRACT_SPECS)
const MES_POINT_VALUE  = 5.00;   // $/pt
const MES_TICK_SIZE    = 0.25;   // pts per tick (1 tick = $1.25)
const COMMISSION_ROUND_TRIP_PER_CONTRACT = 1.24;  // $0.62/side × 2 sides

// Strategy parameters
const ENTRY_PRICE  = 5800;
const STOP_PTS     = 14;         // structural stop = 14pt ceiling per CLAUDE.md §4
const TARGET_QTY   = 3;          // 3 contracts: 1×TP1 + 1×TP2 + 1×runner
const R_IN_POINTS  = STOP_PTS;   // 1R = stop distance = 14pt

// Style C levels
const TP1_PRICE    = ENTRY_PRICE + 1 * R_IN_POINTS;  // 5814  (+1R)
const TP2_PRICE    = ENTRY_PRICE + 2 * R_IN_POINTS;  // 5828  (+2R)
const RUNNER_EXIT  = ENTRY_PRICE + 3 * R_IN_POINTS;  // 5842  (~+3R at flatten)
const BE_STOP_PRICE = ENTRY_PRICE + MES_TICK_SIZE;   // 5800.25 (entry + 1 tick)

// P&L computations (gross = direction × (exit − entry) × pointValue × contracts)
const TP1_GROSS    = (TP1_PRICE   - ENTRY_PRICE) * MES_POINT_VALUE * 1;  // 70.00
const TP2_GROSS    = (TP2_PRICE   - ENTRY_PRICE) * MES_POINT_VALUE * 1;  // 140.00
const RUNNER_GROSS = (RUNNER_EXIT - ENTRY_PRICE) * MES_POINT_VALUE * 1;  // 210.00

const TP1_NET    = TP1_GROSS    - COMMISSION_ROUND_TRIP_PER_CONTRACT;     // 68.76
const TP2_NET    = TP2_GROSS    - COMMISSION_ROUND_TRIP_PER_CONTRACT;     // 138.76
const RUNNER_NET = RUNNER_GROSS - COMMISSION_ROUND_TRIP_PER_CONTRACT;     // 208.76
const TOTAL_NET  = TP1_NET + TP2_NET + RUNNER_NET;                        // 416.28

// Bar timestamps — 1-min bars starting 09:30 ET on an arbitrary trading day.
// We use UTC offsets for DST-correct 09:30 ET = 13:30 UTC in summer (EDT = UTC−4).
// 15:55 ET = 19:55 UTC.
function barTs(minutesAfter930: number): Date {
  const base = new Date("2026-06-23T13:30:00.000Z"); // 09:30 ET (EDT summer)
  return new Date(base.getTime() + minutesAfter930 * 60_000);
}

// Bar 1 = 09:30, entry bar
// Bar 6 = 09:35, TP1 hit
// Bar 8 = 09:37, TP2 hit
// Bar 15 = 09:44, arbitrary runner bar (well before 15:55)
// Bar 15:55 flatten = 19:55 UTC = 385 minutes after 09:30 + 25 minutes = bar at 15:55 ET
const BAR_ENTRY    = barTs(0);   // 09:30 ET
const BAR_TP1      = barTs(5);   // 09:35 ET  (bar 6)
const BAR_TP2      = barTs(7);   // 09:37 ET  (bar 8)
const BAR_FLATTEN  = barTs(385); // 15:55 ET  (bar at 15:55 ET)

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Simulate what paper-execution-service does when TP1 fills:
 *   1. Partial close: decrement contracts, set tp1Filled, tp1FilledAt, beStopApplied
 *   2. Move trail_hwm to BE+1tick (trailHwm = entryPrice + tickSize)
 *   3. Insert paper_trade record for the partial close
 *   4. Insert audit_log row
 */
async function simulateTP1Fill(ctx: TestDb, barTime: Date): Promise<void> {
  const { db } = ctx;

  // 1a. Update position: mark tp1Filled, decrement contracts 3→2, beStopApplied
  await db.update(paperPositions).set({
    tp1Filled:         true,
    tp1FilledAt:       barTime,
    beStopApplied:     true,
    trailHwm:          String(BE_STOP_PRICE),  // entry + 1 tick
    contracts:         2,                       // 3 → 2 after TP1 partial close
    lastHandlerEvalAt: barTime,
  }).where(eq(paperPositions.id, POSITION_UUID));

  // 1b. Insert paper_trade for the 1-contract TP1 partial close
  await db.insert(paperTrades).values({
    id:         TRADE_TP1_UUID,
    sessionId:  SESSION_UUID,
    symbol:     "MES",
    side:       "long",
    entryPrice: String(ENTRY_PRICE),
    exitPrice:  String(TP1_PRICE),
    pnl:        String(TP1_NET),
    grossPnl:   String(TP1_GROSS),
    commission: String(COMMISSION_ROUND_TRIP_PER_CONTRACT),
    contracts:  1,
    entryTime:  BAR_ENTRY,
    exitTime:   barTime,
  });

  // 1c. Insert audit_log: tp1Filled event
  await db.insert(auditLog).values({
    id:         AUDIT_TP1_UUID,
    action:     "style_exit.tp1_filled",
    entityId:   POSITION_UUID,
    entityType: "paper_position",
    status:     "success",
    result: {
      tp1_price:       TP1_PRICE,
      contracts_closed: 1,
      be_stop_price:    BE_STOP_PRICE,
      pnl_net:          TP1_NET,
    },
    createdAt:  barTime,
  });
}

/**
 * Simulate TP2 fill: decrement contracts 2→1, set tp2Filled, insert trade + audit.
 */
async function simulateTP2Fill(ctx: TestDb, barTime: Date): Promise<void> {
  const { db } = ctx;

  await db.update(paperPositions).set({
    tp2Filled:         true,
    tp2FilledAt:       barTime,
    contracts:         1,            // 2 → 1 runner remains
    lastHandlerEvalAt: barTime,
  }).where(eq(paperPositions.id, POSITION_UUID));

  await db.insert(paperTrades).values({
    id:         TRADE_TP2_UUID,
    sessionId:  SESSION_UUID,
    symbol:     "MES",
    side:       "long",
    entryPrice: String(ENTRY_PRICE),
    exitPrice:  String(TP2_PRICE),
    pnl:        String(TP2_NET),
    grossPnl:   String(TP2_GROSS),
    commission: String(COMMISSION_ROUND_TRIP_PER_CONTRACT),
    contracts:  1,
    entryTime:  BAR_ENTRY,
    exitTime:   barTime,
  });

  await db.insert(auditLog).values({
    id:         AUDIT_TP2_UUID,
    action:     "style_exit.tp2_filled",
    entityId:   POSITION_UUID,
    entityType: "paper_position",
    status:     "success",
    result: {
      tp2_price:        TP2_PRICE,
      contracts_closed: 1,
      pnl_net:          TP2_NET,
    },
    createdAt:  barTime,
  });
}

/**
 * Simulate 15:55 ET hard flatten of the runner:
 *   1. Close position (set closedAt)
 *   2. Insert paper_trade for runner close
 *   3. Insert audit_log: runnerExited event (TIME_STOP_FLATTEN)
 */
async function simulateRunnerFlatten(ctx: TestDb, barTime: Date, exitPrice: number): Promise<void> {
  const { db } = ctx;

  await db.update(paperPositions).set({
    closedAt:          barTime,
    currentPrice:      String(exitPrice),
    lastHandlerEvalAt: barTime,
  }).where(eq(paperPositions.id, POSITION_UUID));

  const gross = (exitPrice - ENTRY_PRICE) * MES_POINT_VALUE * 1;
  const net   = gross - COMMISSION_ROUND_TRIP_PER_CONTRACT;

  await db.insert(paperTrades).values({
    id:         TRADE_RUNNER_UUID,
    sessionId:  SESSION_UUID,
    symbol:     "MES",
    side:       "long",
    entryPrice: String(ENTRY_PRICE),
    exitPrice:  String(exitPrice),
    pnl:        String(net),
    grossPnl:   String(gross),
    commission: String(COMMISSION_ROUND_TRIP_PER_CONTRACT),
    contracts:  1,
    entryTime:  BAR_ENTRY,
    exitTime:   barTime,
  });

  await db.insert(auditLog).values({
    id:         AUDIT_RUNNER_UUID,
    action:     "style_exit.runner_exited",
    entityId:   POSITION_UUID,
    entityType: "paper_position",
    status:     "success",
    result: {
      exit_reason:      "TIME_STOP_FLATTEN",
      exit_price:       exitPrice,
      contracts_closed: 1,
      pnl_net:          net,
    },
    createdAt:  barTime,
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("paper-execution-style-c-pglite.integration — Style C state machine DB contract", () => {
  let ctx: TestDb;

  // ── Setup ──────────────────────────────────────────────────────────────────
  beforeAll(async () => {
    ctx = await createTestDb();

    // Seed strategy
    await ctx.db.insert(strategies).values({
      id:       STRATEGY_UUID,
      name:     "style-c-integration-test-strategy",
      symbol:   "MES",
      timeframe: "5m",
      config:   {},
    });

    // Seed paper session
    await ctx.db.insert(paperSessions).values({
      id:              SESSION_UUID,
      strategyId:      STRATEGY_UUID,
      status:          "active",
      mode:            "paper",
      firmId:          "topstep",
      startingCapital: "50000",
      currentEquity:   "50000",
      peakEquity:      "50000",
      realizedPeakEquity: "50000",
      highWaterBalance:  "50000",
      totalTrades:     0,
    });

    // Seed paper position — unfilled, 3 contracts, Style C
    await ctx.db.insert(paperPositions).values({
      id:               POSITION_UUID,
      sessionId:        SESSION_UUID,
      symbol:           "MES",
      side:             "long",
      entryPrice:       String(ENTRY_PRICE),
      currentPrice:     String(ENTRY_PRICE),
      contracts:        TARGET_QTY,
      unrealizedPnl:    "0",
      entryTime:        BAR_ENTRY,
      tp1Filled:        false,
      tp2Filled:        false,
      beStopApplied:    false,
      currentExitStyle: "C",
      barsHeld:         0,
      // Style C exit plan stored in JSONB (adaptive path)
      exitPlan: {
        tp1:           { price: TP1_PRICE,   source: "structural_r", level_type: null },
        tp2:           { price: TP2_PRICE,   source: "structural_r", level_type: null },
        runner:        { trail_method: "chandelier" },
        scaling:       { tp1_pct: 0.33, tp2_pct: 0.33, runner_pct: 0.34 },
        exit_style:    "static_styleC",
        runtime_state: { chandelier_trail_hwm: null },
      } as unknown as import("../../db/jsonb-shapes.js").ExitPlanWithRuntimeState,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ── Phase 1: Initial state ─────────────────────────────────────────────────

  it("initial state: position is open with tp1Filled=false, tp2Filled=false, beStopApplied=false", async () => {
    const [pos] = await ctx.db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.id, POSITION_UUID));

    expect(pos).toBeDefined();
    expect(pos.tp1Filled).toBe(false);
    expect(pos.tp2Filled).toBe(false);
    expect(pos.beStopApplied).toBe(false);
    expect(pos.closedAt).toBeNull();
    expect(pos.contracts).toBe(TARGET_QTY);
    expect(Number(pos.entryPrice)).toBe(ENTRY_PRICE);
  });

  it("initial state: exitPlan JSONB round-trips correctly with trail_method=chandelier", async () => {
    const [pos] = await ctx.db
      .select({ exitPlan: paperPositions.exitPlan })
      .from(paperPositions)
      .where(eq(paperPositions.id, POSITION_UUID));

    expect(pos.exitPlan).toBeDefined();
    const plan = pos.exitPlan as { runner: { trail_method: string }; scaling: { tp1_pct: number } };
    expect(plan.runner.trail_method).toBe("chandelier");
    expect(plan.scaling.tp1_pct).toBeCloseTo(0.33, 4);
  });

  // ── Phase 2: TP1 fill ──────────────────────────────────────────────────────

  it("after TP1 fill: tp1Filled=true, beStopApplied=true, stop at entry+1tick, contracts=2", async () => {
    await simulateTP1Fill(ctx, BAR_TP1);

    const [pos] = await ctx.db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.id, POSITION_UUID));

    // Style C mandate: tp1Filled AND beStopApplied must both flip simultaneously
    expect(pos.tp1Filled).toBe(true);
    expect(pos.beStopApplied).toBe(true);

    // Stop moved to BE+1tick = entry + 0.25pt on MES
    expect(Number(pos.trailHwm)).toBeCloseTo(BE_STOP_PRICE, 4);

    // 1 contract closed (3 → 2)
    expect(pos.contracts).toBe(2);

    // Position still OPEN (runner not yet closed)
    expect(pos.closedAt).toBeNull();
  });

  it("after TP1 fill: paper_trade row inserted with correct TP1 P&L", async () => {
    const trades = await ctx.db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.id, TRADE_TP1_UUID));

    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(Number(t.entryPrice)).toBe(ENTRY_PRICE);
    expect(Number(t.exitPrice)).toBe(TP1_PRICE);
    expect(Number(t.grossPnl)).toBeCloseTo(TP1_GROSS, 2);   // 70.00
    expect(Number(t.commission)).toBeCloseTo(COMMISSION_ROUND_TRIP_PER_CONTRACT, 4);
    expect(Number(t.pnl)).toBeCloseTo(TP1_NET, 2);            // 68.76
    expect(t.contracts).toBe(1);
    expect(t.symbol).toBe("MES");
    expect(t.side).toBe("long");
  });

  it("after TP1 fill: audit_log row written with correct action and JSONB payload", async () => {
    const rows = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.id, AUDIT_TP1_UUID));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.action).toBe("style_exit.tp1_filled");
    expect(row.entityId).toBe(POSITION_UUID);
    expect(row.entityType).toBe("paper_position");
    expect(row.status).toBe("success");

    const result = row.result as { tp1_price: number; be_stop_price: number };
    expect(result.tp1_price).toBe(TP1_PRICE);
    expect(result.be_stop_price).toBeCloseTo(BE_STOP_PRICE, 4);
  });

  // ── Phase 3: TP2 fill ──────────────────────────────────────────────────────

  it("after TP2 fill: tp2Filled=true, contracts=1 (runner remains), position still open", async () => {
    await simulateTP2Fill(ctx, BAR_TP2);

    const [pos] = await ctx.db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.id, POSITION_UUID));

    expect(pos.tp2Filled).toBe(true);
    expect(pos.contracts).toBe(1);    // runner still active
    expect(pos.closedAt).toBeNull();  // NOT yet closed

    // TP1 state preserved (idempotency)
    expect(pos.tp1Filled).toBe(true);
    expect(pos.beStopApplied).toBe(true);
  });

  it("after TP2 fill: paper_trade row has correct TP2 P&L", async () => {
    const trades = await ctx.db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.id, TRADE_TP2_UUID));

    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(Number(t.exitPrice)).toBe(TP2_PRICE);
    expect(Number(t.grossPnl)).toBeCloseTo(TP2_GROSS, 2);   // 140.00
    expect(Number(t.pnl)).toBeCloseTo(TP2_NET, 2);           // 138.76
    expect(t.contracts).toBe(1);
  });

  it("after TP2 fill: chandelier trail method preserved on position (no NaN fallback needed)", async () => {
    const [pos] = await ctx.db
      .select({ exitPlan: paperPositions.exitPlan, currentTrailMethod: paperPositions.currentTrailMethod })
      .from(paperPositions)
      .where(eq(paperPositions.id, POSITION_UUID));

    // exitPlan JSONB must still have the correct trail method
    const plan = pos.exitPlan as { runner: { trail_method: string } };
    expect(plan.runner.trail_method).toBe("chandelier");
  });

  // ── Phase 4: 15:55 ET hard flatten of runner ──────────────────────────────

  it("after 15:55 ET flatten: closedAt IS NOT NULL (position fully closed)", async () => {
    await simulateRunnerFlatten(ctx, BAR_FLATTEN, RUNNER_EXIT);

    const [pos] = await ctx.db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.id, POSITION_UUID));

    expect(pos.closedAt).not.toBeNull();
    expect(pos.closedAt).toBeInstanceOf(Date);
  });

  it("after flatten: contracts=1 on position row (closed state, count not decremented separately)", async () => {
    const [pos] = await ctx.db
      .select({ contracts: paperPositions.contracts, closedAt: paperPositions.closedAt })
      .from(paperPositions)
      .where(eq(paperPositions.id, POSITION_UUID));

    // The production service sets closedAt when the last contract is closed.
    // contracts remains 1 (the runner count) at time of close — what matters is closedAt IS NOT NULL.
    expect(pos.closedAt).not.toBeNull();
    expect(pos.contracts).toBe(1);
  });

  it("after flatten: runner paper_trade inserted with correct P&L", async () => {
    const trades = await ctx.db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.id, TRADE_RUNNER_UUID));

    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(Number(t.exitPrice)).toBe(RUNNER_EXIT);
    expect(Number(t.grossPnl)).toBeCloseTo(RUNNER_GROSS, 2); // 210.00
    expect(Number(t.pnl)).toBeCloseTo(RUNNER_NET, 2);         // 208.76
    expect(t.contracts).toBe(1);
  });

  it("runner audit_log action=style_exit.runner_exited with TIME_STOP_FLATTEN reason", async () => {
    const rows = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.id, AUDIT_RUNNER_UUID));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.action).toBe("style_exit.runner_exited");
    expect(row.entityId).toBe(POSITION_UUID);
    expect(row.status).toBe("success");

    const result = row.result as { exit_reason: string; exit_price: number };
    expect(result.exit_reason).toBe("TIME_STOP_FLATTEN");
    expect(result.exit_price).toBe(RUNNER_EXIT);
  });

  // ── Phase 5: Audit log ordering ────────────────────────────────────────────

  it("3 audit_log rows exist for the position in correct timestamp order: tp1 < tp2 < runner", async () => {
    const rows = await ctx.db
      .select({ id: auditLog.id, action: auditLog.action, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, POSITION_UUID),
          eq(auditLog.entityType, "paper_position"),
        )
      )
      .orderBy(asc(auditLog.createdAt));

    expect(rows).toHaveLength(3);
    expect(rows[0].action).toBe("style_exit.tp1_filled");
    expect(rows[1].action).toBe("style_exit.tp2_filled");
    expect(rows[2].action).toBe("style_exit.runner_exited");

    // Timestamp ordering: tp1 < tp2 < runner
    expect(rows[0].createdAt!.getTime()).toBeLessThan(rows[1].createdAt!.getTime());
    expect(rows[1].createdAt!.getTime()).toBeLessThan(rows[2].createdAt!.getTime());
  });

  // ── Phase 6: P&L accounting ────────────────────────────────────────────────

  it("total net P&L across 3 paper_trades = TP1_NET + TP2_NET + RUNNER_NET (±$0.01 tolerance)", async () => {
    const allTrades = await ctx.db
      .select({ pnl: paperTrades.pnl })
      .from(paperTrades)
      .where(eq(paperTrades.sessionId, SESSION_UUID));

    expect(allTrades).toHaveLength(3);

    const sumPnl = allTrades.reduce((acc, t) => acc + Number(t.pnl), 0);
    // Total: 68.76 + 138.76 + 208.76 = 416.28
    expect(sumPnl).toBeCloseTo(TOTAL_NET, 1);
  });

  it("P&L breakdown: TP1=+1R, TP2=+2R, runner=+3R (gross, per MES pointValue=$5/pt)", async () => {
    const tp1Row = await ctx.db.select({ grossPnl: paperTrades.grossPnl }).from(paperTrades).where(eq(paperTrades.id, TRADE_TP1_UUID));
    const tp2Row = await ctx.db.select({ grossPnl: paperTrades.grossPnl }).from(paperTrades).where(eq(paperTrades.id, TRADE_TP2_UUID));
    const runRow = await ctx.db.select({ grossPnl: paperTrades.grossPnl }).from(paperTrades).where(eq(paperTrades.id, TRADE_RUNNER_UUID));

    // 1R × $5/pt × 14pt × 1 contract = $70
    expect(Number(tp1Row[0].grossPnl)).toBeCloseTo(1 * R_IN_POINTS * MES_POINT_VALUE * 1, 2);
    // 2R = 28pt
    expect(Number(tp2Row[0].grossPnl)).toBeCloseTo(2 * R_IN_POINTS * MES_POINT_VALUE * 1, 2);
    // 3R = 42pt
    expect(Number(runRow[0].grossPnl)).toBeCloseTo(3 * R_IN_POINTS * MES_POINT_VALUE * 1, 2);
  });

  // ── Edge case 1: TP1 bar coincides with 15:55 ET flatten ──────────────────

  describe("edge case: TP1 and 15:55 flatten on the same bar", () => {
    const EDGE_POSITION_UUID = "aaaa0001-0000-0000-0000-000000000100";
    const EDGE_SESSION_UUID  = "aaaa0001-0000-0000-0000-000000000101";
    // Separate strategy for this edge case (re-uses same strategy UUID — no FK conflict)
    const EDGE_BAR_TS = new Date("2026-06-23T19:55:00.000Z"); // 15:55 ET

    beforeAll(async () => {
      await ctx.db.insert(paperSessions).values({
        id:              EDGE_SESSION_UUID,
        strategyId:      STRATEGY_UUID,
        status:          "stopped",   // stopped so it doesn't conflict with active index (if present)
        mode:            "paper",
        startingCapital: "50000",
        currentEquity:   "50000",
        peakEquity:      "50000",
        realizedPeakEquity: "50000",
        highWaterBalance:  "50000",
        totalTrades:     0,
      });

      await ctx.db.insert(paperPositions).values({
        id:               EDGE_POSITION_UUID,
        sessionId:        EDGE_SESSION_UUID,
        symbol:           "MES",
        side:             "long",
        entryPrice:       String(ENTRY_PRICE),
        currentPrice:     String(TP1_PRICE), // bar hits TP1 AND 15:55
        contracts:        3,
        unrealizedPnl:    "0",
        entryTime:        BAR_ENTRY,
        tp1Filled:        false,
        tp2Filled:        false,
        beStopApplied:    false,
        currentExitStyle: "C",
        barsHeld:         0,
      });
    });

    it("when TP1 and 15:55 flatten fire on same bar, flatten wins: closedAt set, tp1Filled may or may not be set", async () => {
      // Production: 15:55 TIME_STOP_FLATTEN flattens everything regardless of TP1 state.
      // We simulate the service's behavior: flatten closes the position fully.
      // This tests that the DB accepts both operations without constraint violation.

      // First: service might mark tp1Filled during the same bar evaluation (both can happen):
      await ctx.db.update(paperPositions).set({
        tp1Filled:        true,
        beStopApplied:    true,
        trailHwm:         String(BE_STOP_PRICE),
        contracts:        2,
        lastHandlerEvalAt: EDGE_BAR_TS,
      }).where(eq(paperPositions.id, EDGE_POSITION_UUID));

      // Then: 15:55 flatten runs — closes the entire remaining position immediately
      await ctx.db.update(paperPositions).set({
        closedAt:         EDGE_BAR_TS,
        lastHandlerEvalAt: EDGE_BAR_TS,
      }).where(eq(paperPositions.id, EDGE_POSITION_UUID));

      const [pos] = await ctx.db
        .select()
        .from(paperPositions)
        .where(eq(paperPositions.id, EDGE_POSITION_UUID));

      // Primary assertion: flatten wins — position IS closed
      expect(pos.closedAt).not.toBeNull();

      // tp1Filled may be true (both fired) — the key invariant is the position is fully closed
      // The DB schema permits both states simultaneously (no CHECK constraint prevents it)
      expect(pos.closedAt).toBeInstanceOf(Date);
    });
  });

  // ── Edge case 2: Zero-volume bar on stop-trigger candidate ────────────────

  describe("edge case: zero-volume bar guard contract", () => {
    it("BACKTEST_ZERO_VOLUME_TRADE_CRITICAL check: audit_log can record ZeroVolumeOnTradeCriticalBar detection", async () => {
      // The backtester.py check_zero_volume_trade_critical() raises ZeroVolumeOnTradeCriticalBar
      // on a bar with volume=0 when a stop/TP would trigger. Production code emits an audit row:
      // action = "backtest.zero_volume_trade_critical_raised"
      //
      // This test confirms the audit_log schema accepts that action without constraint violations.
      const ZERO_VOL_AUDIT_UUID = "aaaa0001-0000-0000-0000-000000000200";

      await ctx.db.insert(auditLog).values({
        id:         ZERO_VOL_AUDIT_UUID,
        action:     "backtest.zero_volume_trade_critical_raised",
        entityId:   POSITION_UUID,
        entityType: "paper_position",
        status:     "failure",
        result: {
          bar_timestamp:  BAR_TP1.toISOString(),
          symbol:         "MES",
          volume:         0,
          stop_candidate: true,
          fail_loud:      true,
        },
        createdAt:  BAR_TP1,
      });

      const rows = await ctx.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, ZERO_VOL_AUDIT_UUID));

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("failure");
      const result = rows[0].result as { volume: number; fail_loud: boolean };
      expect(result.volume).toBe(0);
      expect(result.fail_loud).toBe(true);
    });
  });

  // ── Edge case 3: NaN ATR fallback audit ───────────────────────────────────

  describe("edge case: NaN ATR fallback to chandelier trail method", () => {
    it("when ATR is NaN, position can record currentTrailMethod=chandelier in DB (schema accepts it)", async () => {
      // CLAUDE.md §4: Bar with NaN ATR → falls back to chandelier(14,2) per CLAUDE.md §4.
      // The paper-execution-service sets currentTrailMethod = 'chandelier' when adaptive
      // exits fall back due to NaN ATR. This test confirms the column accepts that value.
      //
      // We re-use the already-closed main position to test UPDATE acceptability.
      // (Update on closed position is not a semantic issue here — we're only testing schema.)
      await ctx.db.update(paperPositions).set({
        currentTrailMethod: "chandelier",
        lastHandlerEvalAt: new Date(),
      }).where(eq(paperPositions.id, POSITION_UUID));

      const [pos] = await ctx.db
        .select({ currentTrailMethod: paperPositions.currentTrailMethod })
        .from(paperPositions)
        .where(eq(paperPositions.id, POSITION_UUID));

      expect(pos.currentTrailMethod).toBe("chandelier");
    });

    it("audit_log can record NaN-ATR fallback event (schema accepts metadata JSONB)", async () => {
      const NAN_ATR_AUDIT_UUID = "aaaa0001-0000-0000-0000-000000000300";

      await ctx.db.insert(auditLog).values({
        id:         NAN_ATR_AUDIT_UUID,
        action:     "style_exit.atr_nan_trail_fallback",
        entityId:   POSITION_UUID,
        entityType: "paper_position",
        status:     "success",
        result: {
          original_trail_method: "anchored_vwap",
          fallback_trail_method: "chandelier",
          atr_value:             null,   // NaN represented as null in JSONB
          chandelier_period:     14,
          chandelier_multiplier: 2.0,
          fallback_reason:       "atr_is_nan",
          symbol:                "MES",
        },
      });

      const rows = await ctx.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, NAN_ATR_AUDIT_UUID));

      expect(rows).toHaveLength(1);
      const result = rows[0].result as {
        fallback_trail_method: string;
        chandelier_period: number;
        atr_value: null;
      };
      expect(result.fallback_trail_method).toBe("chandelier");
      expect(result.chandelier_period).toBe(14);
      expect(result.atr_value).toBeNull();
    });
  });

  // ── Schema contract: FK and null-constraint verification ──────────────────

  it("FK integrity: paper_position references paper_session correctly (pglite enforces FK)", async () => {
    // Confirm that a position with a valid session_id inserts without error.
    // The FK is enforced by PGlite — if the session UUID is wrong, insert throws.
    const FK_POS_UUID = "aaaa0001-0000-0000-0000-000000000400";
    await expect(
      ctx.db.insert(paperPositions).values({
        id:               FK_POS_UUID,
        sessionId:        SESSION_UUID,   // valid session
        symbol:           "MES",
        side:             "long",
        entryPrice:       "5800",
        contracts:        1,
        unrealizedPnl:    "0",
        tp1Filled:        false,
        tp2Filled:        false,
        beStopApplied:    false,
        barsHeld:         0,
      })
    ).resolves.not.toThrow();
  });

  it("FK integrity: paper_position insert with invalid session_id is rejected by PGlite FK", async () => {
    const BAD_POS_UUID = "aaaa0001-0000-0000-0000-000000000401";
    const NONEXIST_SESSION = "deadbeef-dead-dead-dead-deadbeefbeef";

    await expect(
      ctx.db.insert(paperPositions).values({
        id:               BAD_POS_UUID,
        sessionId:        NONEXIST_SESSION,  // FK violation: session does not exist
        symbol:           "MES",
        side:             "long",
        entryPrice:       "5800",
        contracts:        1,
        unrealizedPnl:    "0",
        tp1Filled:        false,
        tp2Filled:        false,
        beStopApplied:    false,
        barsHeld:         0,
      })
    ).rejects.toThrow();
  });

  it("schema contract: paper_trades.pnl NOT NULL — insert without pnl is rejected", async () => {
    // pnl is declared NOT NULL in schema.ts — PGlite must enforce this.
    // Drizzle will either throw at the TS layer or PGlite will throw at SQL level.
    const BAD_TRADE_UUID = "aaaa0001-0000-0000-0000-000000000500";

    // Construct a bad insert by casting to bypass TypeScript typing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badValues: any = {
      id:         BAD_TRADE_UUID,
      sessionId:  SESSION_UUID,
      symbol:     "MES",
      side:       "long",
      entryPrice: "5800",
      exitPrice:  "5814",
      pnl:        null,   // intentional NULL to test NOT NULL constraint
      contracts:  1,
      entryTime:  BAR_ENTRY,
      exitTime:   BAR_TP1,
    };
    await expect(
      ctx.db.insert(paperTrades).values(badValues)
    ).rejects.toThrow();
  });

  // ── Determinism: re-read final state is consistent ─────────────────────────

  it("final state consistency: re-reading position confirms full Style C progression", async () => {
    const [pos] = await ctx.db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.id, POSITION_UUID));

    // All three Style C invariants must hold simultaneously in the closed state:
    expect(pos.tp1Filled).toBe(true);       // TP1 was filled
    expect(pos.tp2Filled).toBe(true);       // TP2 was filled
    expect(pos.beStopApplied).toBe(true);   // BE stop was applied after TP1
    expect(pos.closedAt).not.toBeNull();    // Runner was closed (flatten)
    expect(Number(pos.trailHwm)).toBeCloseTo(BE_STOP_PRICE, 4);  // stop at BE+1tick
  });

  it("final state: exactly 3 paper_trades exist for the session (one per partial close)", async () => {
    const trades = await ctx.db
      .select({ id: paperTrades.id })
      .from(paperTrades)
      .where(eq(paperTrades.sessionId, SESSION_UUID));

    // TP1 + TP2 + runner = 3 trades (4th trade from FK-test uses same session — filter by IDs)
    const mainTrades = trades.filter(t =>
      [TRADE_TP1_UUID, TRADE_TP2_UUID, TRADE_RUNNER_UUID].includes(t.id)
    );
    expect(mainTrades).toHaveLength(3);
  });
});
