import { describe, it, expect, beforeEach } from "vitest";
import {
  feedBar,
  parseTimeframeMinutes,
  bucketStartMs,
  resetAggregatorForSymbol,
  _testResetAllAggregatorState,
  _testGetAggregatorState,
  type OhlcvBar,
} from "./timeframe-bar-aggregator.js";

function bar(tsIso: string, o: number, h: number, l: number, c: number, v: number): OhlcvBar {
  return { timestamp: tsIso, open: o, high: h, low: l, close: c, volume: v };
}

describe("parseTimeframeMinutes", () => {
  it("parses minute and hour timeframes", () => {
    expect(parseTimeframeMinutes("1m")).toBe(1);
    expect(parseTimeframeMinutes("5m")).toBe(5);
    expect(parseTimeframeMinutes("15m")).toBe(15);
    expect(parseTimeframeMinutes("30m")).toBe(30);
    expect(parseTimeframeMinutes("1h")).toBe(60);
    expect(parseTimeframeMinutes("4h")).toBe(240);
  });

  it("returns null for unparseable timeframes — never fabricates a default period", () => {
    expect(parseTimeframeMinutes("")).toBeNull();
    expect(parseTimeframeMinutes("daily")).toBeNull();
    expect(parseTimeframeMinutes("1d")).toBeNull(); // no strategy uses daily; not a supported unit here
    expect(parseTimeframeMinutes("garbage")).toBeNull();
  });
});

describe("bucketStartMs — the empirically-verified UTC-epoch anchor", () => {
  it("truncates to plain epoch boundaries, matching the real 4-hour consolidated-bar evidence (UTC 00/04/08/12/16/20)", () => {
    // 2026-02-02T13:37:00Z -> floor to the 4-hour boundary at 12:00Z
    const ms = Date.parse("2026-02-02T13:37:00.000Z");
    const bucket = bucketStartMs(ms, 240);
    expect(new Date(bucket).toISOString()).toBe("2026-02-02T12:00:00.000Z");
  });

  it("is NOT session/RTH-open anchored — a 5-minute bucket lands on a plain :00/:05/:10 boundary", () => {
    const ms = Date.parse("2026-02-02T14:03:00.000Z");
    const bucket = bucketStartMs(ms, 5);
    expect(new Date(bucket).toISOString()).toBe("2026-02-02T14:00:00.000Z");
  });
});

describe("feedBar", () => {
  beforeEach(() => {
    _testResetAllAggregatorState();
  });

  it("never emits a partial/in-progress bucket — isBucketClose is false until the NEXT bucket's first bar arrives", () => {
    const tf = 5;
    let r = feedBar("MES", tf, bar("2026-02-02T14:00:00.000Z", 100, 101, 99, 100.5, 10));
    expect(r.isBucketClose).toBe(false);
    expect(r.aggregatedBuffer).toEqual([]);

    r = feedBar("MES", tf, bar("2026-02-02T14:01:00.000Z", 100.5, 102, 100, 101, 12));
    expect(r.isBucketClose).toBe(false);
    expect(r.aggregatedBuffer).toEqual([]);

    r = feedBar("MES", tf, bar("2026-02-02T14:02:00.000Z", 101, 101.5, 98, 99, 8));
    expect(r.isBucketClose).toBe(false);

    r = feedBar("MES", tf, bar("2026-02-02T14:03:00.000Z", 99, 100, 98.5, 99.5, 9));
    expect(r.isBucketClose).toBe(false);

    r = feedBar("MES", tf, bar("2026-02-02T14:04:00.000Z", 99.5, 100.2, 99, 100, 11));
    // Still the 5th (last) bar of the 14:00-14:05 bucket — bucket is COMPLETE in reality
    // but this module correctly does not know that until the NEXT bar starts a new bucket.
    expect(r.isBucketClose).toBe(false);
    expect(r.aggregatedBuffer).toEqual([]);

    // First bar of the NEXT bucket (14:05) — NOW the 14:00 bucket closes.
    r = feedBar("MES", tf, bar("2026-02-02T14:05:00.000Z", 100, 100.1, 99.9, 100, 5));
    expect(r.isBucketClose).toBe(true);
    expect(r.aggregatedBuffer).toHaveLength(1);
    expect(r.aggregatedBuffer[0]).toEqual({
      symbol: "MES",
      timestamp: "2026-02-02T14:00:00.000Z",
      open: 100,
      high: 102,     // max across the 5 sub-bars
      low: 98,       // min across the 5 sub-bars
      close: 100,    // close of the LAST sub-bar in the bucket (14:04)
      volume: 10 + 12 + 8 + 9 + 11, // sum
    });
  });

  it("volume-sum correctness across a full bucket", () => {
    const tf = 15;
    for (let i = 0; i < 15; i++) {
      const minute = String(i).padStart(2, "0");
      feedBar("MNQ", tf, bar(`2026-02-02T18:${minute}:00.000Z`, 100, 100, 100, 100, 100));
    }
    // Force-flush by feeding the first bar of the next bucket.
    const r = feedBar("MNQ", tf, bar("2026-02-02T18:15:00.000Z", 100, 100, 100, 100, 1));
    expect(r.isBucketClose).toBe(true);
    expect(r.aggregatedBuffer[0].volume).toBe(15 * 100);
  });

  it("multi-session-same-symbol-different-timeframe independence: two timeframes on the same symbol maintain fully separate buckets", () => {
    const b1 = bar("2026-02-02T14:00:00.000Z", 100, 100, 100, 100, 1);
    const b2 = bar("2026-02-02T14:01:00.000Z", 100, 100, 100, 100, 1);
    const r5 = feedBar("ES", 5, b1);
    const r15 = feedBar("ES", 15, b1);
    expect(r5.aggregatedBuffer).toEqual(r15.aggregatedBuffer); // both empty, but independently tracked
    feedBar("ES", 5, b2);
    feedBar("ES", 15, b2);
    // 5m and 15m state must be independent objects even for the same symbol
    const state5 = _testGetAggregatorState("ES", 5);
    const state15 = _testGetAggregatorState("ES", 15);
    expect(state5).not.toBe(state15);
    expect(state5?.current?.bucketStartMs).toBe(state15?.current?.bucketStartMs); // same window right now
    expect(state5?.current?.volume).toBe(2);
    expect(state15?.current?.volume).toBe(2);
  });

  it("out-of-order bars are ignored defensively, never corrupting the in-progress bucket", () => {
    const tf = 5;
    feedBar("CL", tf, bar("2026-02-02T14:02:00.000Z", 50, 50, 50, 50, 1));
    const before = _testGetAggregatorState("CL", tf);
    // A bar from an EARLIER bucket arriving late (should never happen on the live WS
    // path, but must not corrupt state if it somehow does).
    const r = feedBar("CL", tf, bar("2026-02-02T13:58:00.000Z", 999, 999, 999, 999, 999));
    expect(r.isBucketClose).toBe(false);
    const after = _testGetAggregatorState("CL", tf);
    expect(after?.current).toEqual(before?.current); // unchanged
  });

  it("1-minute timeframe: every raw bar is its own complete bucket (regression-anchor shape, even though the live wiring bypasses this module entirely for 1m sessions)", () => {
    const tf = 1;
    let r = feedBar("MES", tf, bar("2026-02-02T14:00:00.000Z", 100, 101, 99, 100.5, 10));
    expect(r.isBucketClose).toBe(false); // bootstrap — nothing closed yet
    r = feedBar("MES", tf, bar("2026-02-02T14:01:00.000Z", 100.5, 102, 100, 101, 12));
    expect(r.isBucketClose).toBe(true);
    expect(r.aggregatedBuffer).toEqual([
      { symbol: "MES", timestamp: "2026-02-02T14:00:00.000Z", open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
    ]);
  });

  it("resetAggregatorForSymbol clears all timeframe keys for that symbol only", () => {
    feedBar("MES", 5, bar("2026-02-02T14:00:00.000Z", 100, 100, 100, 100, 1));
    feedBar("MES", 15, bar("2026-02-02T14:00:00.000Z", 100, 100, 100, 100, 1));
    feedBar("MNQ", 5, bar("2026-02-02T14:00:00.000Z", 100, 100, 100, 100, 1));
    resetAggregatorForSymbol("MES");
    expect(_testGetAggregatorState("MES", 5)).toBeUndefined();
    expect(_testGetAggregatorState("MES", 15)).toBeUndefined();
    expect(_testGetAggregatorState("MNQ", 5)).toBeDefined(); // untouched
  });

  it("caps the completed-bar history at 200 entries (bounded memory, matching the raw barBuffer's own 200-bar cap)", () => {
    const tf = 1;
    // Feed 202 bars -> 201 completed closes (last bar stays in-progress).
    for (let i = 0; i < 202; i++) {
      const ts = new Date(Date.parse("2026-02-02T00:00:00.000Z") + i * 60_000).toISOString();
      feedBar("ES", tf, bar(ts, 100, 100, 100, 100, 1));
    }
    const finalState = _testGetAggregatorState("ES", tf);
    expect(finalState?.completed.length).toBe(200);
  });
});
