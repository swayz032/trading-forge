/**
 * feed-gap-classifier.test.ts — Wave M1b (2026-07-17)
 *
 * Pure-function tests for the feed gap classifier. No DB, no WS, no mocks
 * needed — classifyFeedGap / isEntireGapWindowMarketClosed / isCmeGlobexClosedAt
 * are all pure and take explicit Date inputs.
 *
 * Reference dates used throughout (verified day-of-week in America/New_York):
 *   2026-07-17 = Friday
 *   2026-07-18 = Saturday
 *   2026-07-19 = Sunday
 *   2026-07-20 = Monday
 *   2026-07-21 = Tuesday
 * All dates fall in EDT (UTC-4) — no DST-transition edge case is exercised
 * here (that's a separate, unclaimed follow-up; see report).
 */

import { describe, it, expect } from "vitest";
import {
  classifyFeedGap,
  isCmeGlobexClosedAt,
  isEntireGapWindowMarketClosed,
  GAP_THRESHOLD_MINUTES,
  FAIL_SAFE_CEILING_MINUTES,
  DAILY_HALT_START_ET_MINUTES,
  DAILY_HALT_END_ET_MINUTES,
} from "../feed-gap-classifier.js";

describe("isCmeGlobexClosedAt — weekly-cycle calendar", () => {
  it("Friday 16:59 ET is OPEN (before the daily halt begins)", () => {
    expect(isCmeGlobexClosedAt(new Date("2026-07-17T20:59:00.000Z"))).toBe(false);
  });

  it("Friday 17:00 ET is CLOSED (weekend begins — daily halt never reopens same-day)", () => {
    expect(isCmeGlobexClosedAt(new Date("2026-07-17T21:00:00.000Z"))).toBe(true);
  });

  it("Saturday (any time) is CLOSED", () => {
    expect(isCmeGlobexClosedAt(new Date("2026-07-18T15:00:00.000Z"))).toBe(true);
  });

  it("Sunday 17:59 ET is CLOSED (still weekend)", () => {
    expect(isCmeGlobexClosedAt(new Date("2026-07-19T21:59:00.000Z"))).toBe(true);
  });

  it("Sunday 18:00 ET is OPEN (Globex reopens)", () => {
    expect(isCmeGlobexClosedAt(new Date("2026-07-19T22:00:00.000Z"))).toBe(false);
  });

  it("Tuesday 12:00 ET (RTH) is OPEN", () => {
    expect(isCmeGlobexClosedAt(new Date("2026-07-21T16:00:00.000Z"))).toBe(false);
  });

  it("Tuesday 17:30 ET (daily maintenance halt) is CLOSED", () => {
    expect(isCmeGlobexClosedAt(new Date("2026-07-21T21:30:00.000Z"))).toBe(true);
  });

  it("Tuesday 18:00 ET (daily halt just ended) is OPEN", () => {
    expect(isCmeGlobexClosedAt(new Date("2026-07-21T22:00:00.000Z"))).toBe(false);
  });
});

describe("isEntireGapWindowMarketClosed", () => {
  it("weekend gap (Fri 17:00 ET -> Sun 18:00 ET) is fully closed", () => {
    const prev = new Date("2026-07-17T21:00:00.000Z"); // Fri 17:00 ET
    const curr = new Date("2026-07-19T22:00:00.000Z"); // Sun 18:00 ET
    expect(isEntireGapWindowMarketClosed(prev, curr)).toBe(true);
  });

  it("daily-halt gap (Tue 17:00 ET -> Tue 18:00 ET) is fully closed", () => {
    const prev = new Date("2026-07-21T21:00:00.000Z"); // Tue 17:00 ET
    const curr = new Date("2026-07-21T22:00:00.000Z"); // Tue 18:00 ET
    expect(isEntireGapWindowMarketClosed(prev, curr)).toBe(true);
  });

  it("RED-PROOF: a gap that spans the reopen with genuine open time in between is NOT fully closed", () => {
    // Fri 17:00 ET -> Sun 18:30 ET: the last 30 min (18:00-18:30 Sun) are OPEN,
    // so the window is NOT entirely market-closed — must not false-positive.
    const prev = new Date("2026-07-17T21:00:00.000Z"); // Fri 17:00 ET
    const curr = new Date("2026-07-19T22:30:00.000Z"); // Sun 18:30 ET
    expect(isEntireGapWindowMarketClosed(prev, curr)).toBe(false);
  });

  it("a gap entirely during RTH is NOT market-closed", () => {
    const prev = new Date("2026-07-21T14:00:00.000Z"); // Tue 10:00 ET
    const curr = new Date("2026-07-21T14:05:00.000Z"); // Tue 10:05 ET
    expect(isEntireGapWindowMarketClosed(prev, curr)).toBe(false);
  });

  it("a gap larger than the MAX_SCAN_MINUTES safety cap returns false (cannot verify — conservative)", () => {
    const prev = new Date("2026-07-17T21:00:00.000Z");
    const curr = new Date(prev.getTime() + 8 * 24 * 60 * 60_000); // 8 days later
    expect(isEntireGapWindowMarketClosed(prev, curr)).toBe(false);
  });

  it("non-positive or invalid window returns false", () => {
    const t = new Date("2026-07-21T14:00:00.000Z");
    expect(isEntireGapWindowMarketClosed(t, t)).toBe(false);
    expect(isEntireGapWindowMarketClosed(t, new Date(t.getTime() - 1000))).toBe(false);
  });
});

describe("classifyFeedGap — full decision table", () => {
  it("gap at or below threshold is NOT classified", () => {
    const prev = new Date("2026-07-21T14:00:00.000Z");
    const curr = new Date(prev.getTime() + GAP_THRESHOLD_MINUTES * 60_000); // exactly at threshold
    const result = classifyFeedGap({ previousBarTimestamp: prev, currentBarTimestamp: curr, continuouslyConnected: true });
    expect(result.classified).toBe(false);
    expect(result.classification).toBeNull();
    expect(result.reason).toBe("within_expected_cadence");
  });

  it("weekend gap -> MARKET_CLOSED regardless of connection state", () => {
    const prev = new Date("2026-07-17T21:00:00.000Z"); // Fri 17:00 ET
    const curr = new Date("2026-07-19T22:00:00.000Z"); // Sun 18:00 ET
    const connectedResult = classifyFeedGap({ previousBarTimestamp: prev, currentBarTimestamp: curr, continuouslyConnected: true });
    const disconnectedResult = classifyFeedGap({ previousBarTimestamp: prev, currentBarTimestamp: curr, continuouslyConnected: false });
    expect(connectedResult.classification).toBe("MARKET_CLOSED");
    expect(connectedResult.classified).toBe(true);
    expect(disconnectedResult.classification).toBe("MARKET_CLOSED");
  });

  it("daily-halt-window gap -> MARKET_CLOSED", () => {
    const prev = new Date("2026-07-21T21:00:00.000Z"); // Tue 17:00 ET
    const curr = new Date("2026-07-21T22:00:00.000Z"); // Tue 18:00 ET
    const result = classifyFeedGap({ previousBarTimestamp: prev, currentBarTimestamp: curr, continuouslyConnected: true });
    expect(result.classification).toBe("MARKET_CLOSED");
  });

  it("RTH gap with continuous connection, under fail-safe ceiling -> EXPECTED_NO_TRADE", () => {
    const prev = new Date("2026-07-21T14:00:00.000Z"); // Tue 10:00 ET
    const curr = new Date("2026-07-21T14:05:00.000Z"); // Tue 10:05 ET (5 min gap)
    const result = classifyFeedGap({ previousBarTimestamp: prev, currentBarTimestamp: curr, continuouslyConnected: true });
    expect(result.classified).toBe(true);
    expect(result.classification).toBe("EXPECTED_NO_TRADE");
    expect(result.reason).toBe("market_open_connected_zero_volume_inference");
  });

  it("RTH gap with a disconnected/reconnecting event recorded in the window -> PROVIDER_GAP", () => {
    const prev = new Date("2026-07-21T14:00:00.000Z"); // Tue 10:00 ET
    const curr = new Date("2026-07-21T14:05:00.000Z"); // Tue 10:05 ET
    const result = classifyFeedGap({ previousBarTimestamp: prev, currentBarTimestamp: curr, continuouslyConnected: false });
    expect(result.classification).toBe("PROVIDER_GAP");
    expect(result.reason).toBe("ws_connection_not_continuous_during_gap");
  });

  it("gap exceeding the fail-safe ceiling -> PROVIDER_GAP even though nominally connected", () => {
    const prev = new Date("2026-07-21T14:00:00.000Z"); // Tue 10:00 ET
    const curr = new Date(prev.getTime() + (FAIL_SAFE_CEILING_MINUTES + 5) * 60_000); // 20 min gap
    const result = classifyFeedGap({ previousBarTimestamp: prev, currentBarTimestamp: curr, continuouslyConnected: true });
    expect(result.classification).toBe("PROVIDER_GAP");
    expect(result.reason).toContain("fail_safe_ceiling");
  });

  it("gap just at the fail-safe ceiling boundary (not exceeding) stays EXPECTED_NO_TRADE when connected", () => {
    const prev = new Date("2026-07-21T14:00:00.000Z");
    const curr = new Date(prev.getTime() + FAIL_SAFE_CEILING_MINUTES * 60_000); // exactly 15 min
    const result = classifyFeedGap({ previousBarTimestamp: prev, currentBarTimestamp: curr, continuouslyConnected: true });
    expect(result.classification).toBe("EXPECTED_NO_TRADE");
  });

  it("supports threshold/ceiling overrides for test injection", () => {
    const prev = new Date("2026-07-21T14:00:00.000Z");
    const curr = new Date(prev.getTime() + 3 * 60_000); // 3 min gap
    const result = classifyFeedGap({
      previousBarTimestamp: prev,
      currentBarTimestamp: curr,
      continuouslyConnected: true,
      gapThresholdMinutes: 10, // 3 min gap is now BELOW this override threshold
    });
    expect(result.classified).toBe(false);
  });

  it("documents the daily halt window constants as 17:00-18:00 ET (1020-1080 minutes)", () => {
    expect(DAILY_HALT_START_ET_MINUTES).toBe(17 * 60);
    expect(DAILY_HALT_END_ET_MINUTES).toBe(18 * 60);
  });
});
