/**
 * Parity tests for paper-trading-stream.ts — Gap 3.10
 *
 * Verifies that the bar buffer session boundary detection uses Eastern Time
 * (ET) date change, not UTC date change.  For futures, Globex sessions reset
 * at 6 PM ET — the ET calendar date change is the correct boundary.
 *
 * These tests exercise toEasternDateString() directly (it is exported from
 * paper-risk-gate.ts and used in the pushBar function) to verify the mapping
 * from UTC timestamps to ET dates that determines VWAP reset boundaries.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Mock all DB/infrastructure dependencies ─────────────────────────────────
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    and: vi.fn(),
    isNull: vi.fn(),
  },
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), end: vi.fn() }),
  },
}));
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn(),
  getTightestDrawdown: vi.fn(),
}));

import { toEasternDateString, toFuturesTradingDayString } from "./paper-risk-gate.js";

// ─── Gap 3.10: ET date boundary tests ────────────────────────────────────────
//
// The key parity invariant:
//   - A bar at 23:30 UTC on 2026-03-27 in winter (EST = UTC-5) is 18:30 ET
//     on the same calendar date → ET date = "2026-03-27"
//   - A bar at 00:30 UTC on 2026-03-28 in winter is 19:30 ET on 2026-03-27
//     → ET date is STILL "2026-03-27" (Globex session has not reset yet)
//   - The UTC date change from 2026-03-27 to 2026-03-28 happens at 00:00 UTC
//     but the ET date does not change until 05:00 UTC (midnight ET in winter)
//
// Prior bug: the code used `bar.timestamp.split("T")[0]` which gives UTC date.
// A bar at 00:30 UTC on 2026-03-28 would have UTC date "2026-03-28" and trigger
// a VWAP reset mid-session, discarding valid session context.

describe("toEasternDateString — ET date conversion correctness", () => {
  it("returns EST date (UTC-5) for a winter UTC timestamp at 18:30 UTC", () => {
    // 2026-01-15 18:30 UTC = 2026-01-15 13:30 ET (EST, UTC-5)
    const date = new Date("2026-01-15T18:30:00.000Z");
    expect(toEasternDateString(date)).toBe("2026-01-15");
  });

  it("UTC midnight belongs to the PREVIOUS ET day in winter", () => {
    // 2026-01-16 00:00 UTC = 2026-01-15 19:00 ET (EST, UTC-5)
    // ET date is still 2026-01-15 — no VWAP reset should fire
    const date = new Date("2026-01-16T00:00:00.000Z");
    expect(toEasternDateString(date)).toBe("2026-01-15");
  });

  it("ET midnight (05:00 UTC in winter) is the correct reset point", () => {
    // 2026-01-16 05:00 UTC = 2026-01-16 00:00 ET (EST, UTC-5)
    // This is when the ET date advances — the correct VWAP reset boundary
    const date = new Date("2026-01-16T05:00:00.000Z");
    expect(toEasternDateString(date)).toBe("2026-01-16");
  });

  it("returns EDT date (UTC-4) for a summer UTC timestamp at 18:30 UTC", () => {
    // 2026-06-15 18:30 UTC = 2026-06-15 14:30 ET (EDT, UTC-4)
    const date = new Date("2026-06-15T18:30:00.000Z");
    expect(toEasternDateString(date)).toBe("2026-06-15");
  });

  it("UTC midnight belongs to the PREVIOUS ET day in summer", () => {
    // 2026-06-16 00:00 UTC = 2026-06-15 20:00 ET (EDT, UTC-4)
    const date = new Date("2026-06-16T00:00:00.000Z");
    expect(toEasternDateString(date)).toBe("2026-06-15");
  });

  it("ET midnight (04:00 UTC in summer) is the correct reset point", () => {
    // 2026-06-16 04:00 UTC = 2026-06-16 00:00 ET (EDT, UTC-4)
    const date = new Date("2026-06-16T04:00:00.000Z");
    expect(toEasternDateString(date)).toBe("2026-06-16");
  });

  it("UTC date change does NOT advance ET date in winter (parity regression)", () => {
    // This test documents the prior bug: using UTC split("T")[0] would return
    // "2026-03-28" here, causing a false VWAP reset at 00:01 UTC (7 PM ET).
    // The correct ET date is still "2026-03-27".
    const justAfterUtcMidnight = new Date("2026-03-28T00:01:00.000Z");
    const etDate = toEasternDateString(justAfterUtcMidnight);
    // In winter (DST starts 2026-03-08): 00:01 UTC = 19:01 ET on 2026-03-27
    expect(etDate).toBe("2026-03-27");
  });

  it("UTC date matches ET date only at/after ET midnight transition", () => {
    // The two dates should agree only once ET midnight has passed.
    // 2026-01-15 05:30 UTC = 2026-01-15 00:30 ET → both agree on "2026-01-15"
    const afterEtMidnight = new Date("2026-01-15T05:30:00.000Z");
    const utcDate = afterEtMidnight.toISOString().split("T")[0];
    const etDate = toEasternDateString(afterEtMidnight);
    expect(etDate).toBe(utcDate); // Both "2026-01-15" — they agree here
  });
});

// ─── W12 Bug #1 fix: CME 5pm ET trading-day boundary ─────────────────────────
//
// toFuturesTradingDayString applies a +7h shift before ET date conversion.
// This aligns the 17:00 ET CME cutoff with the ET calendar midnight so that:
//   - Trades closed before 17:00 ET → attributed to the CURRENT trading day.
//   - Trades closed at or after 17:00 ET → attributed to the NEXT trading day.
//
// Parity invariant: the key written to dailyPnlBreakdown JSONB by
// checkConsistencyRule must match the key read by the kill-switch and
// global-daily-loss gate. All three now call toFuturesTradingDayString.

describe("toFuturesTradingDayString — CME 5pm ET trading-day boundary", () => {
  it("trade at 16:59 ET (winter) stays on same trading day", () => {
    // 2026-05-02 16:59 ET (EDT, UTC-4) = 20:59 UTC
    // 20:59 UTC + 7h = 03:59 UTC 2026-05-03 = 23:59 ET 2026-05-02 → "2026-05-02"
    // DST in effect (EDT), so 20:59 UTC = 16:59 ET
    const date = new Date("2026-05-02T20:59:00.000Z");
    expect(toFuturesTradingDayString(date)).toBe("2026-05-02");
  });

  it("trade at exactly 17:00 ET (summer/EDT) rolls to next trading day", () => {
    // 2026-05-02 17:00 ET (EDT, UTC-4) = 21:00 UTC
    // 21:00 UTC + 7h = 04:00 UTC 2026-05-03 = 00:00 ET 2026-05-03 → "2026-05-03"
    const date = new Date("2026-05-02T21:00:00.000Z");
    expect(toFuturesTradingDayString(date)).toBe("2026-05-03");
  });

  it("trade at 17:00:01 ET (summer) attributes to next CME day", () => {
    // This is the W12 bug case: a trade closed at 17:00:01 ET on 2026-05-02
    // must attribute to the 2026-05-03 trading day (per CME convention).
    const date = new Date("2026-05-02T21:00:01.000Z"); // 17:00:01 EDT
    expect(toFuturesTradingDayString(date)).toBe("2026-05-03");
  });

  it("trade at 23:59 ET (summer) still attributes to next CME day", () => {
    // 2026-05-02 23:59 ET (EDT) = 03:59 UTC 2026-05-03
    // 03:59 UTC + 7h = 10:59 UTC 2026-05-03 = 06:59 ET 2026-05-03 → "2026-05-03"
    const date = new Date("2026-05-03T03:59:00.000Z");
    expect(toFuturesTradingDayString(date)).toBe("2026-05-03");
  });

  it("trade at 09:00 ET (RTH core) stays on same calendar day", () => {
    // 2026-05-02 09:00 ET (EDT) = 13:00 UTC
    // 13:00 UTC + 7h = 20:00 UTC = 16:00 ET → "2026-05-02"
    const date = new Date("2026-05-02T13:00:00.000Z");
    expect(toFuturesTradingDayString(date)).toBe("2026-05-02");
  });

  it("trade at 16:59 ET (winter/EST) stays on same trading day", () => {
    // 2026-01-15 16:59 ET (EST, UTC-5) = 21:59 UTC
    // 21:59 UTC + 7h = 04:59 UTC 2026-01-16 = 23:59 ET 2026-01-15 → "2026-01-15"
    const date = new Date("2026-01-15T21:59:00.000Z");
    expect(toFuturesTradingDayString(date)).toBe("2026-01-15");
  });

  it("trade at 17:00 ET (winter/EST) rolls to next trading day", () => {
    // 2026-01-15 17:00 ET (EST, UTC-5) = 22:00 UTC
    // 22:00 UTC + 7h = 05:00 UTC 2026-01-16 = 00:00 ET 2026-01-16 → "2026-01-16"
    const date = new Date("2026-01-15T22:00:00.000Z");
    expect(toFuturesTradingDayString(date)).toBe("2026-01-16");
  });

  it("Sunday 18:00 ET Globex reopen still maps to Monday trading day", () => {
    // CME Globex reopens Sunday 18:00 ET. A trade at 18:30 ET Sunday
    // should attribute to Monday's trading day.
    // 2026-05-03 (Sun) 18:30 ET (EDT) = 22:30 UTC 2026-05-03
    // 22:30 UTC + 7h = 05:30 UTC 2026-05-04 = 01:30 ET 2026-05-04 (Mon) → "2026-05-04"
    const date = new Date("2026-05-03T22:30:00.000Z"); // Sun 18:30 EDT
    expect(toFuturesTradingDayString(date)).toBe("2026-05-04");
  });

  it("toFuturesTradingDayString differs from toEasternDateString only in 17:00-23:59 ET window", () => {
    // At 10:00 ET (well before 17:00), both functions return the same date
    const date = new Date("2026-05-02T14:00:00.000Z"); // 10:00 EDT
    expect(toFuturesTradingDayString(date)).toBe(toEasternDateString(date));
  });

  it("at 17:00 ET boundary, futures day is AHEAD of calendar ET date", () => {
    // At exactly 17:00 ET, toFuturesTradingDayString returns tomorrow, toEasternDateString returns today
    const date = new Date("2026-05-02T21:00:00.000Z"); // 17:00 EDT
    expect(toFuturesTradingDayString(date)).toBe("2026-05-03");
    expect(toEasternDateString(date)).toBe("2026-05-02");
  });
});
