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

import { toEasternDateString } from "./paper-risk-gate.js";

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
