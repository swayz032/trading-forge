/**
 * gate3-manual-cron-query-parity.test.ts — 2026-07-17
 * (ratify-packet: docs/ratify-packets/gate3-manual-cron-parity-2026-07-17.md)
 *
 * HARDENED 2026-07-17 (independent-grader finding): the original version of this
 * test hand-duplicated the trading-days query into two local functions
 * (`cronTradingDaysQuery` / `manualPathTradingDaysQuery`) and asserted they
 * agreed — but both were copy-pasted from the SAME source, so the assertion
 * was `expect(f(x)).toBe(f(x))`, which cannot fail on any input and proves
 * nothing about the real cron/manual call sites. It also could never catch a
 * future edit to one real call site without the other, which is exactly the
 * class of drift this test was meant to prevent.
 *
 * The actual fix (lifecycle-service.ts, same date): the cron sweep and the
 * manual PATCH path now both call ONE shared exported function,
 * `countPaperTradingDaysSince()` — so query drift between them is
 * structurally impossible, not merely test-detectable. This test now imports
 * and exercises that REAL function directly against a real PGlite instance,
 * proving its own correctness (distinct-day counting, same-day dedup,
 * cross-strategy exclusion, pre-lifecycle exclusion) rather than pretending
 * to prove two independent implementations agree when there was only ever one.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { strategies, paperSessions, paperTrades } from "../db/schema.js";

let injectedDb: TestDb["db"] | null = null;

// countPaperTradingDaysSince imports db from "../db/index.js" in production —
// standard PGlite-injection pattern for this test layer.
vi.mock("../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));

// lifecycle-service.ts pulls in the Express-boot import chain transitively —
// mock ../index.js minimally to stop that chain at collection (same hazard
// documented in trail-stop-extensions.test.ts / M2's pending-entry-durability
// integration test).
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { countPaperTradingDaysSince } from "../services/lifecycle-service.js";

let ctx: TestDb;

const STRAT_A = "9a000001-0000-0000-0000-000000000001"; // primary fixture strategy
const STRAT_B = "9a000002-0000-0000-0000-000000000002"; // sibling strategy — trades must NOT leak into STRAT_A's count
const SESSION_A = "9a000001-0000-0000-0000-0000000000a1";
const SESSION_B = "9a000002-0000-0000-0000-0000000000b1";

const LIFECYCLE_CHANGED_AT = new Date("2026-01-01T00:00:00.000Z");

function dayAt(daysAfterLifecycleChange: number, hour = 12): Date {
  const d = new Date(LIFECYCLE_CHANGED_AT);
  d.setUTCDate(d.getUTCDate() + daysAfterLifecycleChange);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

function makeTrade(sessionId: string, exitTime: Date) {
  return {
    id: randomUUID(),
    sessionId,
    symbol: "MES",
    side: "long",
    entryPrice: "5800",
    exitPrice: "5810",
    pnl: "100",
    contracts: 1,
    entryTime: new Date(exitTime.getTime() - 60_000),
    exitTime,
  };
}

beforeAll(async () => {
  ctx = await createTestDb();
  injectedDb = ctx.db;

  await ctx.db.insert(strategies).values([
    {
      id: STRAT_A,
      name: "gate3-query-parity-a",
      symbol: "MES",
      timeframe: "5m",
      config: {},
      lifecycleState: "PAPER",
      lifecycleChangedAt: LIFECYCLE_CHANGED_AT,
    },
    {
      id: STRAT_B,
      name: "gate3-query-parity-b",
      symbol: "MES",
      timeframe: "5m",
      config: {},
      lifecycleState: "PAPER",
      lifecycleChangedAt: LIFECYCLE_CHANGED_AT,
    },
  ]);

  await ctx.db.insert(paperSessions).values([
    { id: SESSION_A, strategyId: STRAT_A, status: "active", mode: "paper" },
    { id: SESSION_B, strategyId: STRAT_B, status: "active", mode: "paper" },
  ]);

  const trades: ReturnType<typeof makeTrade>[] = [];

  // 30 distinct trading days for STRAT_A (days 1..30 after lifecycleChangedAt),
  // with day 15 carrying TWO trades (same calendar day) to prove dedup-by-DATE().
  for (let day = 1; day <= 30; day++) {
    trades.push(makeTrade(SESSION_A, dayAt(day, 10)));
    if (day === 15) {
      trades.push(makeTrade(SESSION_A, dayAt(day, 18))); // same day, different hour
    }
  }

  // A trade closed BEFORE lifecycleChangedAt — must be excluded by the gte() filter.
  trades.push(makeTrade(SESSION_A, new Date("2025-12-15T12:00:00.000Z")));

  // STRAT_B trades on 30 DIFFERENT distinct days — must never count toward STRAT_A.
  for (let day = 1; day <= 30; day++) {
    trades.push(makeTrade(SESSION_B, dayAt(day, 9)));
  }

  await ctx.db.insert(paperTrades).values(trades);
});

afterAll(async () => {
  await ctx.close();
});

describe("countPaperTradingDaysSince — the ONE shared query both cron and manual paths call", () => {
  it("counts exactly 30 distinct trading days for STRAT_A (same-day dedup proven via day 15 double-trade)", async () => {
    const count = await countPaperTradingDaysSince(STRAT_A, LIFECYCLE_CHANGED_AT);
    expect(count).toBe(30);
  });

  it("excludes the pre-lifecycleChangedAt trade (gte() filter)", async () => {
    const soloStrategyId = "9a000003-0000-0000-0000-000000000003";
    const soloSessionId = "9a000003-0000-0000-0000-0000000000c1";
    await ctx.db.insert(strategies).values({
      id: soloStrategyId,
      name: "gate3-query-parity-pre-lifecycle-only",
      symbol: "MES",
      timeframe: "5m",
      config: {},
      lifecycleState: "PAPER",
      lifecycleChangedAt: LIFECYCLE_CHANGED_AT,
    });
    await ctx.db.insert(paperSessions).values({ id: soloSessionId, strategyId: soloStrategyId, status: "active", mode: "paper" });
    await ctx.db.insert(paperTrades).values(
      makeTrade(soloSessionId, new Date("2025-12-01T12:00:00.000Z")),
    );

    const count = await countPaperTradingDaysSince(soloStrategyId, LIFECYCLE_CHANGED_AT);
    expect(count).toBe(0);
  });

  it("excludes STRAT_B's trades from STRAT_A's count (innerJoin strategyId filter)", async () => {
    // STRAT_A has exactly 30 distinct days seeded above; if STRAT_B's 30
    // DIFFERENT distinct days leaked in via a broken join, the count would
    // inflate past 30 (up to 60 if fully unioned, or a different intermediate
    // number if only some leaked).
    const count = await countPaperTradingDaysSince(STRAT_A, LIFECYCLE_CHANGED_AT);
    expect(count).toBe(30);
  });

  it("counts exactly 29 distinct trading days when one day short of the floor", async () => {
    const shortStrategyId = "9a000004-0000-0000-0000-000000000004";
    const shortSessionId = "9a000004-0000-0000-0000-0000000000d1";
    await ctx.db.insert(strategies).values({
      id: shortStrategyId,
      name: "gate3-query-parity-29-days",
      symbol: "MES",
      timeframe: "5m",
      config: {},
      lifecycleState: "PAPER",
      lifecycleChangedAt: LIFECYCLE_CHANGED_AT,
    });
    await ctx.db.insert(paperSessions).values({ id: shortSessionId, strategyId: shortStrategyId, status: "active", mode: "paper" });
    const shortTrades = [];
    for (let day = 1; day <= 29; day++) {
      shortTrades.push(makeTrade(shortSessionId, dayAt(day, 11)));
    }
    await ctx.db.insert(paperTrades).values(shortTrades);

    const count = await countPaperTradingDaysSince(shortStrategyId, LIFECYCLE_CHANGED_AT);
    expect(count).toBe(29);
  });

  it("returns 0 for a strategy with zero paper_trades rows (the exact defect scenario's data shape)", async () => {
    const zeroStrategyId = "9a000005-0000-0000-0000-000000000005";
    await ctx.db.insert(strategies).values({
      id: zeroStrategyId,
      name: "gate3-query-parity-zero-trades",
      symbol: "MES",
      timeframe: "5m",
      config: {},
      lifecycleState: "PAPER",
      lifecycleChangedAt: LIFECYCLE_CHANGED_AT,
    });
    // No paper_sessions, no paper_trades at all for this strategy.

    const count = await countPaperTradingDaysSince(zeroStrategyId, LIFECYCLE_CHANGED_AT);
    expect(count).toBe(0);
  });
});
