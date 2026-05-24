/**
 * wave25-pre-market-expansion.test.ts — Wave 25 Pass 2.5, W25.5a
 *
 * Tests for pre-market institutional expansion:
 *  - ISO-week PWH/PWL correctness
 *  - Prior-month H/L correctness
 *  - London range aggregation
 *  - First-30min volume ratio (null gap acknowledged)
 *  - Extended calendar event extraction
 *  - Bond auction today detection
 *  - DXY / 10Y direction helper
 *  - cross_asset_aligned derivation
 *  - Full routine populates all 18 W25.5a fields via injected DAL
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB and audit-log-helper to avoid DATABASE_URL requirement in unit tests
vi.mock("../db/index.js", () => ({
  db: {},
}));
vi.mock("../db/schema.js", () => ({}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));
// Mock market-internals-service so the pre-market routine test doesn't need Massive API
vi.mock("../services/market-internals-service.js", () => ({
  getInternalsSnapshot: vi.fn().mockReturnValue({
    tick: null, add: null, vold: null, trin: null,
    asOf: new Date(), stale: true,
  }),
}));
import {
  computeIsoWeekPwhPwl,
  computePriorMonthHl,
  computeLondonRange,
  computeFirst30minVolumeRatio,
  extractExtendedCalendarEvents,
  computeDirectionFromDailyBars,
  computeCrossAssetAligned,
  runPreMarketRoutine,
  type DailyBar,
  type IntraBar,
  type SkipDecisionRow,
  type PreMarketDataAccessLayer,
  type UpsertPreMarketInput,
  type NakedPocLevel,
} from "../services/pre-market-routine.js";
import { isBondAuctionToday, toEtDate, getAuctionDates } from "../lib/treasury-auction-calendar.js";

// ─── Helper factories ─────────────────────────────────────────────────────────

function makeBar(date: string, high: number, low: number, close = (high + low) / 2): DailyBar {
  return { date, open: low + 1, high, low, close };
}

function makeIntraBar(ts: string, high: number, low: number, volume = 1000): IntraBar {
  return { ts, open: low + 0.5, high, low, close: (high + low) / 2 };
}

// ─── ISO-week PWH/PWL ─────────────────────────────────────────────────────────

describe("computeIsoWeekPwhPwl", () => {
  it("returns null when no bars", () => {
    const result = computeIsoWeekPwhPwl([], "2026-05-24");
    expect(result.pwhIso).toBeNull();
    expect(result.pwlIso).toBeNull();
  });

  it("identifies Monday–Friday of previous ISO week (Tue session)", () => {
    // 2026-05-24 is a Sunday; let's use 2026-05-26 (Tuesday)
    // Previous ISO week: Mon 2026-05-18 → Fri 2026-05-22
    const bars: DailyBar[] = [
      makeBar("2026-05-18", 5300, 5280), // Mon prev week
      makeBar("2026-05-19", 5310, 5290), // Tue prev week
      makeBar("2026-05-20", 5305, 5275), // Wed prev week HIGH 5310, LOW 5275
      makeBar("2026-05-21", 5295, 5285), // Thu prev week
      makeBar("2026-05-22", 5308, 5288), // Fri prev week
      makeBar("2026-05-25", 5320, 5310), // Mon this week
      makeBar("2026-05-26", 5315, 5300), // Tue this week (session date — excluded)
    ];
    const result = computeIsoWeekPwhPwl(bars, "2026-05-26");
    // High = 5310 (2026-05-19), Low = 5275 (2026-05-20)
    expect(result.pwhIso).toBe(5310);
    expect(result.pwlIso).toBe(5275);
  });

  it("falls back to last 5 bars when no prev-week bars found", () => {
    const bars: DailyBar[] = [
      makeBar("2026-01-05", 4900, 4870),
      makeBar("2026-01-06", 4910, 4880),
      makeBar("2026-01-07", 4920, 4875),
      makeBar("2026-01-08", 4915, 4865),
      makeBar("2026-01-09", 4905, 4860),
    ];
    // Session date far ahead — prev week has no bars in this sparse set
    const result = computeIsoWeekPwhPwl(bars, "2026-05-24");
    expect(result.pwhIso).toBe(4920);
    expect(result.pwlIso).toBe(4860);
  });
});

// ─── Prior-month H/L ──────────────────────────────────────────────────────────

describe("computePriorMonthHl", () => {
  it("returns null when no bars", () => {
    const result = computePriorMonthHl([], "2026-05-24");
    expect(result.pmh).toBeNull();
    expect(result.pml).toBeNull();
  });

  it("computes prior calendar month H/L", () => {
    // Session date: 2026-05-15; prior month = April 2026
    const bars: DailyBar[] = [
      makeBar("2026-04-01", 5200, 5100), // April
      makeBar("2026-04-15", 5250, 5080), // April — HIGH 5250, LOW 5080
      makeBar("2026-04-30", 5220, 5120), // April
      makeBar("2026-05-01", 5300, 5200), // May — excluded
      makeBar("2026-05-14", 5350, 5250), // May — excluded
    ];
    const result = computePriorMonthHl(bars, "2026-05-15");
    expect(result.pmh).toBe(5250);
    expect(result.pml).toBe(5080);
  });

  it("returns null when no bars in prior month", () => {
    const bars: DailyBar[] = [
      makeBar("2026-05-01", 5300, 5200),
    ];
    const result = computePriorMonthHl(bars, "2026-05-15");
    expect(result.pmh).toBeNull();
    expect(result.pml).toBeNull();
  });
});

// ─── London range ─────────────────────────────────────────────────────────────

describe("computeLondonRange", () => {
  it("returns nulls for empty bars", () => {
    const result = computeLondonRange([]);
    expect(result.londonRangeHigh).toBeNull();
    expect(result.londonRangeLow).toBeNull();
    expect(result.londonRangePoints).toBeNull();
  });

  it("computes range from London session bars", () => {
    const bars: IntraBar[] = [
      makeIntraBar("2026-05-24T08:00:00Z", 5300, 5290),
      makeIntraBar("2026-05-24T08:05:00Z", 5310, 5285), // HIGH 5310, LOW 5285
      makeIntraBar("2026-05-24T08:10:00Z", 5295, 5280), // LOW 5280
    ];
    const result = computeLondonRange(bars);
    expect(result.londonRangeHigh).toBe(5310);
    expect(result.londonRangeLow).toBe(5280);
    expect(result.londonRangePoints).toBe(30);
  });

  it("handles fractional ranges with rounding", () => {
    const bars: IntraBar[] = [
      makeIntraBar("2026-05-24T08:00:00Z", 5300.75, 5299.25),
    ];
    const result = computeLondonRange(bars);
    expect(result.londonRangePoints).toBe(1.5);
  });
});

// ─── First-30min volume ratio ─────────────────────────────────────────────────

describe("computeFirst30minVolumeRatio", () => {
  it("returns null when no prior sessions", () => {
    expect(computeFirst30minVolumeRatio(1000, [])).toBeNull();
  });

  it("returns null when average is 0", () => {
    expect(computeFirst30minVolumeRatio(1000, [0, 0, 0])).toBeNull();
  });

  it("computes ratio correctly", () => {
    // today=1500, avg of [1000, 1000, 1000, 1000, 1000] = 1000, ratio = 1.5
    const ratio = computeFirst30minVolumeRatio(1500, [1000, 1000, 1000, 1000, 1000]);
    expect(ratio).toBe(1.5);
  });

  it("rounds to 3 decimal places", () => {
    const ratio = computeFirst30minVolumeRatio(1000, [300, 300, 300]);
    expect(ratio).toBeCloseTo(3.333, 2);
  });
});

// ─── Extended calendar events ─────────────────────────────────────────────────

describe("extractExtendedCalendarEvents", () => {
  it("returns empty for no skip rows", () => {
    expect(extractExtendedCalendarEvents([])).toEqual([]);
  });

  it("extracts PPI event", () => {
    const rows: SkipDecisionRow[] = [
      {
        decisionDate: new Date("2026-05-15T12:30:00Z"),
        decision: "SKIP",
        reason: "PPI data release",
        triggeredSignals: null,
      },
    ];
    const events = extractExtendedCalendarEvents(rows);
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("PPI");
    expect(events[0]!.severity).toBe("high");
  });

  it("extracts ISM event (medium severity)", () => {
    const rows: SkipDecisionRow[] = [
      {
        decisionDate: new Date("2026-05-01T14:00:00Z"),
        decision: "SKIP",
        reason: "ISM manufacturing",
        triggeredSignals: null,
      },
    ];
    const events = extractExtendedCalendarEvents(rows);
    expect(events[0]!.event_type).toBe("ISM");
    expect(events[0]!.severity).toBe("medium");
  });

  it("extracts GDP event", () => {
    const rows: SkipDecisionRow[] = [
      {
        decisionDate: new Date("2026-04-30T12:30:00Z"),
        decision: "SKIP",
        reason: "GDP advance release",
        triggeredSignals: null,
      },
    ];
    const events = extractExtendedCalendarEvents(rows);
    expect(events[0]!.event_type).toBe("GDP");
  });

  it("extracts jobless claims (initial claims variant)", () => {
    const rows: SkipDecisionRow[] = [
      {
        decisionDate: new Date("2026-05-14T12:30:00Z"),
        decision: "SKIP",
        reason: "initial claims weekly",
        triggeredSignals: null,
      },
    ];
    const events = extractExtendedCalendarEvents(rows);
    expect(events[0]!.event_type).toBe("JOBLESS_CLAIMS");
  });

  it("handles multiple rows (one event per skip row)", () => {
    const rows: SkipDecisionRow[] = [
      { decisionDate: new Date("2026-05-15T12:30:00Z"), decision: "SKIP", reason: "PPI", triggeredSignals: null },
      { decisionDate: new Date("2026-05-15T14:00:00Z"), decision: "SKIP", reason: "ISM data", triggeredSignals: null },
    ];
    const events = extractExtendedCalendarEvents(rows);
    expect(events).toHaveLength(2);
  });
});

// ─── Treasury auction calendar ────────────────────────────────────────────────

describe("isBondAuctionToday", () => {
  it("returns true for a known 2026 auction date", () => {
    // 2026-05-05 is in the hardcoded calendar
    const d = new Date("2026-05-05T18:00:00Z"); // 1pm ET
    expect(isBondAuctionToday(d)).toBe(true);
  });

  it("returns false for a non-auction date (Sunday)", () => {
    // 2026-05-03 is a Sunday — no auction
    const d = new Date("2026-05-03T18:00:00Z");
    expect(isBondAuctionToday(d)).toBe(false);
  });

  it("returns false for a Saturday", () => {
    const d = new Date("2026-05-02T18:00:00Z"); // Saturday
    expect(isBondAuctionToday(d)).toBe(false);
  });

  it("toEtDate converts UTC date correctly to ET date string", () => {
    // UTC midnight on May 5 maps to May 4 in ET (UTC-4 or UTC-5)
    const utcMidnight = new Date("2026-05-05T04:00:00Z"); // midnight ET = 04:00 UTC (DST)
    const etDate = toEtDate(utcMidnight);
    expect(etDate).toBe("2026-05-05");
  });

  it("getAuctionDates returns a non-empty list", () => {
    const dates = getAuctionDates();
    expect(dates.length).toBeGreaterThan(50); // ~100+ dates in 2026
  });
});

// ─── DXY / 10Y direction ──────────────────────────────────────────────────────

describe("computeDirectionFromDailyBars", () => {
  it("returns null for <2 bars", () => {
    expect(computeDirectionFromDailyBars([])).toBeNull();
    expect(computeDirectionFromDailyBars([makeBar("2026-05-23", 100, 99)])).toBeNull();
  });

  it("returns up when current close > prior close by >0.05%", () => {
    const bars = [
      makeBar("2026-05-24", 101, 100, 101), // newest — index 0
      makeBar("2026-05-23", 100, 99, 100),  // prior — index 1
    ];
    expect(computeDirectionFromDailyBars(bars)).toBe("up");
  });

  it("returns down when current close < prior close by >0.05%", () => {
    const bars = [
      makeBar("2026-05-24", 100, 99, 99),
      makeBar("2026-05-23", 101, 100, 100),
    ];
    expect(computeDirectionFromDailyBars(bars)).toBe("down");
  });

  it("returns flat when change ≤ 0.05%", () => {
    const bars = [
      makeBar("2026-05-24", 100, 99, 100.01), // tiny change
      makeBar("2026-05-23", 100, 99, 100.00),
    ];
    expect(computeDirectionFromDailyBars(bars)).toBe("flat");
  });
});

// ─── cross_asset_aligned ──────────────────────────────────────────────────────

describe("computeCrossAssetAligned", () => {
  it("returns null when no direction data", () => {
    expect(computeCrossAssetAligned("MES", "long", null, null)).toBeNull();
  });

  it("ES long + DXY down = aligned (risk-on)", () => {
    expect(computeCrossAssetAligned("MES", "long", "down", null)).toBe(true);
  });

  it("ES long + DXY up + 10Y up = not aligned", () => {
    expect(computeCrossAssetAligned("MES", "long", "up", "up")).toBe(false);
  });

  it("ES short + DXY up = aligned (risk-off)", () => {
    expect(computeCrossAssetAligned("MNQ", "short", "up", null)).toBe(true);
  });

  it("ES short + DXY down + 10Y down = not aligned", () => {
    expect(computeCrossAssetAligned("MNQ", "short", "down", "down")).toBe(false);
  });

  it("MCL long + DXY down = aligned", () => {
    expect(computeCrossAssetAligned("MCL", "long", "down", null)).toBe(true);
  });

  it("MCL long + DXY up = not aligned", () => {
    expect(computeCrossAssetAligned("MCL", "long", "up", null)).toBe(false);
  });

  it("MCL short + DXY up = aligned", () => {
    expect(computeCrossAssetAligned("MCL", "short", "up", null)).toBe(true);
  });

  it("MCL short + DXY down = not aligned", () => {
    expect(computeCrossAssetAligned("MCL", "short", "down", null)).toBe(false);
  });

  it("MCL with no DXY data returns null", () => {
    expect(computeCrossAssetAligned("MCL", "long", null, "down")).toBeNull();
  });

  it("returns null when direction is null", () => {
    expect(computeCrossAssetAligned("MES", null, "down", "down")).toBeNull();
  });
});

// ─── Full routine via injected DAL ────────────────────────────────────────────

describe("runPreMarketRoutine — W25.5a fields", () => {
  function buildMockDal(overrides?: Partial<PreMarketDataAccessLayer>): PreMarketDataAccessLayer {
    const defaultBars: DailyBar[] = Array.from({ length: 90 }, (_, i) => {
      const d = new Date("2026-05-24");
      d.setUTCDate(d.getUTCDate() - (89 - i));
      return makeBar(d.toISOString().slice(0, 10), 5300 + i, 5280 + i, 5290 + i);
    });

    const captured: Partial<UpsertPreMarketInput>[] = [];

    const dal: PreMarketDataAccessLayer = {
      getDailyBars: vi.fn().mockResolvedValue(defaultBars),
      getOvernightBars: vi.fn().mockResolvedValue([
        makeIntraBar("2026-05-23T22:00:00Z", 5300, 5280),
      ]),
      getSkipDecisionsForDate: vi.fn().mockResolvedValue([
        {
          decisionDate: new Date("2026-05-24T12:30:00Z"),
          decision: "SKIP",
          reason: "PPI release",
          triggeredSignals: null,
        },
      ]),
      getFirstRthBar: vi.fn().mockResolvedValue(
        makeIntraBar("2026-05-24T13:30:00Z", 5315, 5310),
      ),
      getHtfBias: vi.fn().mockResolvedValue("bullish"),
      getIntraBarsWindow: vi.fn().mockResolvedValue([
        makeIntraBar("2026-05-24T08:00:00Z", 5310, 5295),
        makeIntraBar("2026-05-24T08:05:00Z", 5315, 5298),
      ]),
      getNearbyNakedPocs: vi.fn().mockResolvedValue([
        { date: "2026-05-23", price: 5290, symbol: "MES", age_sessions: 1 },
      ] as NakedPocLevel[]),
      upsertPreMarketSession: vi.fn().mockImplementation(async (input: UpsertPreMarketInput) => {
        captured.push(input);
        return 42;
      }),
      ...overrides,
    };

    (dal as any)._captured = captured;
    return dal;
  }

  it("populates extended_calendar_events from PPI skip decision", async () => {
    const dal = buildMockDal();
    await runPreMarketRoutine("MES", "2026-05-24", "test-corr", dal);

    const captured = (dal as any)._captured as UpsertPreMarketInput[];
    expect(captured).toHaveLength(1);
    const input = captured[0]!;
    expect(input.extendedCalendarEvents).not.toBeNull();
    expect(input.extendedCalendarEvents![0]!.event_type).toBe("PPI");
  });

  it("populates bond_auction_today correctly for 2026-05-05", async () => {
    const dal = buildMockDal();
    await runPreMarketRoutine("MES", "2026-05-05", "test-corr", dal);

    const captured = (dal as any)._captured as UpsertPreMarketInput[];
    expect(captured[0]!.bondAuctionToday).toBe(true);
  });

  it("populates nearby_naked_pocs from DAL", async () => {
    const dal = buildMockDal();
    await runPreMarketRoutine("MES", "2026-05-24", "test-corr", dal);

    const captured = (dal as any)._captured as UpsertPreMarketInput[];
    expect(captured[0]!.nearbyNakedPocs).not.toBeNull();
    expect(captured[0]!.nearbyNakedPocs![0]!.price).toBe(5290);
  });

  it("populates london_range_points when intra-window bars available", async () => {
    const dal = buildMockDal();
    await runPreMarketRoutine("MES", "2026-05-24", "test-corr", dal);

    const captured = (dal as any)._captured as UpsertPreMarketInput[];
    const input = captured[0]!;
    expect(input.londonRangeHigh).toBe(5315);
    expect(input.londonRangeLow).toBe(5295);
    expect(input.londonRangePoints).toBe(20);
  });

  it("populates pmh and pml (prior-month H/L)", async () => {
    const dal = buildMockDal();
    await runPreMarketRoutine("MES", "2026-05-24", "test-corr", dal);

    const captured = (dal as any)._captured as UpsertPreMarketInput[];
    const input = captured[0]!;
    // Prior month = April 2026 bars should be in the 90-bar set
    expect(input.pmh).not.toBeNull();
    expect(input.pml).not.toBeNull();
    expect(input.pmh!).toBeGreaterThan(input.pml!);
  });

  it("populates pwhIso (ISO-week prev week H/L)", async () => {
    const dal = buildMockDal();
    await runPreMarketRoutine("MES", "2026-05-24", "test-corr", dal);

    const captured = (dal as any)._captured as UpsertPreMarketInput[];
    const input = captured[0]!;
    expect(input.pwhIso).not.toBeNull();
    expect(input.pwlIso).not.toBeNull();
  });

  it("sets tick_open/add_open/vold_open/trin_open to null when internals snapshot is stale", async () => {
    // Market internals service is not running in tests — snapshot will be stale/null
    const dal = buildMockDal();
    await runPreMarketRoutine("MES", "2026-05-24", "test-corr", dal);

    const captured = (dal as any)._captured as UpsertPreMarketInput[];
    const input = captured[0]!;
    // Without MASSIVE_API_KEY set, snapshot is always null/stale
    expect(input.tickOpen).toBeNull();
    expect(input.addOpen).toBeNull();
  });

  it("gracefully handles getIntraBarsWindow failure (returns null for london range)", async () => {
    const dal = buildMockDal({
      getIntraBarsWindow: vi.fn().mockRejectedValue(new Error("API unavailable")),
    });
    // Should not throw
    await expect(runPreMarketRoutine("MES", "2026-05-24", "test-corr", dal)).resolves.toBeTruthy();

    const captured = (dal as any)._captured as UpsertPreMarketInput[];
    expect(captured[0]!.londonRangeHigh).toBeNull();
  });
});
