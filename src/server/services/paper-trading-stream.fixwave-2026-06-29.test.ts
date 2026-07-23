/**
 * Fix-wave 2026-06-29: paper-trading-stream.ts parity tests
 *
 * F3 — medianAtr14 high-low proxy drops overnight gap
 *   Verifies that computeMedianTrueRangeFromWindow uses Wilder's true-range
 *   formula (max of H-L, |H-prevClose|, |L-prevClose|) so overnight gaps are
 *   captured rather than silently zeroed.
 *
 * F12 — per-bar getDevelopingSessionPoc DB query
 *   Verifies that the module-level cache prevents redundant DB hits for the
 *   same symbol + bar timestamp, even when buildExitBarContext is called
 *   multiple times within the same bar (e.g. multiple sessions on one symbol).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused"; });

// ─── Mocks (must come before imports that pull the module under test) ─────────

const mockGetDevelopingSessionPoc = vi.fn().mockResolvedValue(4150.25);

vi.mock("./volume-profile-service.js", () => ({
  getDevelopingSessionPoc: (...args: unknown[]) => mockGetDevelopingSessionPoc(...args),
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./paper-execution-service.js", () => ({
  updatePositionPrices: vi.fn().mockResolvedValue(undefined),
  PAPER_EXIT_EVENTS: {},
}));
vi.mock("./paper-signal-service.js", () => ({
  evaluateSignals: vi.fn().mockResolvedValue(undefined),
  updateStateOnly: vi.fn().mockResolvedValue(undefined),
  ATR: vi.fn().mockReturnValue(2.5),
}));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: (d: Date) => d.toISOString().split("T")[0],
}));
vi.mock("../../data/fetchers/massive.js", () => ({
  createMassiveFetcher: vi.fn().mockReturnValue({
    createWebSocket: vi.fn().mockReturnValue({ close: vi.fn() }),
  }),
}));
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: { getOrCreate: vi.fn().mockReturnValue({ execute: vi.fn((fn: () => unknown) => fn()) }) },
}));
vi.mock("./smt-live-service.js", () => ({
  initSmtBarBufferProvider: vi.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  computeMedianTrueRangeFromWindow,
  buildExitBarContext,
  _testClearPocCache,
  _testGetPocCacheSize,
  _testGetPocCacheValue,
  _testSetBarBuffer,
  type Bar,
} from "./paper-trading-stream.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeBar(overrides: Partial<Bar> = {}): Bar {
  return {
    symbol: "MES",
    timestamp: "2026-06-29T14:00:00.000Z",
    open: 5500,
    high: 5510,
    low: 5495,
    close: 5505,
    volume: 1200,
    ...overrides,
  };
}

function makeBars(count: number, symbol = "MES"): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(Date.UTC(2026, 5, 29, 14, i)).toISOString();
    bars.push({
      symbol,
      timestamp: ts,
      open: 5500 + i,
      high: 5510 + i,
      low: 5490 + i,
      close: 5505 + i,
      volume: 1000 + i * 10,
    });
  }
  return bars;
}

// ─── F3: medianAtr14 true-range overnight-gap fix ────────────────────────────

describe("F3 — computeMedianTrueRangeFromWindow: Wilder true-range vs H-L proxy", () => {
  it("returns H-L when there is no overnight gap (result matches prior proxy)", () => {
    // All bars are continuous — prevClose ≈ open of next bar, so |H-prevClose| ≤ H-L
    const window = [
      { high: 5510, low: 5490, close: 5505 },
      { high: 5520, low: 5500, close: 5515 },
      { high: 5515, low: 5495, close: 5510 },
    ];
    const medianTr = computeMedianTrueRangeFromWindow(window);
    // H-L values: 20, 20, 20  → median = 20
    expect(medianTr).toBe(20);
  });

  it("F3 core: overnight gap causes true-range to exceed H-L proxy", () => {
    // Bar 0: close = 5500  (pre-overnight last bar)
    // Bar 1: high = 5480, low = 5460, close = 5465  (opens 20pts BELOW prior close)
    //   H-L = 20
    //   |H - prevClose| = |5480 - 5500| = 20
    //   |L - prevClose| = |5460 - 5500| = 40  ← overnight gap dominates
    //   True range = 40 > H-L = 20
    const window = [
      { high: 5510, low: 5490, close: 5500 }, // pre-gap bar
      { high: 5480, low: 5460, close: 5465 }, // gap-down bar (overnight drop)
    ];
    const medianTr = computeMedianTrueRangeFromWindow(window);
    // TR[0] = 20 (first bar, H-L only)
    // TR[1] = max(20, 20, 40) = 40
    // median of [20, 40] = 30
    expect(medianTr).toBe(30);

    // Old proxy would have given median([20, 20]) = 20 — the gap is invisible
    const hlProxy = [window[0], window[1]].map(b => b.high - b.low);
    hlProxy.sort((a, b) => a - b);
    const hlMedian = (hlProxy[0] + hlProxy[1]) / 2;
    expect(medianTr).toBeGreaterThan(hlMedian);
  });

  it("gap-up scenario: opening above prior close captures the gap", () => {
    // Bar 0: close = 5500
    // Bar 1: opens 30pts above — low = 5515, high = 5535, close = 5525
    //   H-L = 20;  |H-prevClose| = 35;  |L-prevClose| = 15
    //   True range = 35
    const window = [
      { high: 5510, low: 5490, close: 5500 },
      { high: 5535, low: 5515, close: 5525 },
    ];
    const medianTr = computeMedianTrueRangeFromWindow(window);
    // TR[0] = 20, TR[1] = max(20, 35, 15) = 35
    // median([20, 35]) = 27.5
    expect(medianTr).toBe(27.5);
  });

  it("first bar falls back to H-L (no prevClose) matching prior behavior", () => {
    const singleBar = [{ high: 5510, low: 5490, close: 5500 }];
    expect(computeMedianTrueRangeFromWindow(singleBar)).toBe(20);
  });

  it("returns undefined when all bars have zero range", () => {
    const flatBars = [
      { high: 5500, low: 5500, close: 5500 },
      { high: 5500, low: 5500, close: 5500 },
    ];
    expect(computeMedianTrueRangeFromWindow(flatBars)).toBeUndefined();
  });

  it("returns undefined for empty window", () => {
    expect(computeMedianTrueRangeFromWindow([])).toBeUndefined();
  });

  it("handles 100-bar window: gap bar true range (TR=45) captured even though it doesn't shift median by itself", () => {
    // Build 3 normal bars then 1 gap bar — TR[0..2]=20 each, TR[3]=45.
    // With 4 bars, sorted=[20,20,20,45], median = (20+20)/2 = 20.
    // NOTE: 1 gap in 100 bars won't move the MEDIAN (majority dominates), but the gap
    // bar's true range is captured correctly in the sorted values.
    // This test proves the formula doesn't IGNORE the gap — it's present in the distribution.
    const window = [
      { high: 5510, low: 5490, close: 5500 }, // TR=20
      { high: 5510, low: 5490, close: 5500 }, // TR=20
      { high: 5510, low: 5490, close: 5500 }, // TR=20 (prevClose=5500)
      { high: 5480, low: 5460, close: 5470 }, // gap: TR=max(20,20,40)=40
    ];
    const result = computeMedianTrueRangeFromWindow(window);
    // [20,20,20,40] → median = (20+20)/2 = 20
    // Not 20 strictly: median of even list = avg of mid two → (20+20)/2 = 20
    // Pure H-L of gap bar = 20; true range of gap bar = 40 — different internal repr
    expect(result).toBeDefined();
    expect(result).toBe(20); // median of [20,20,20,40] — gap is present in distribution

    // To confirm gap IS captured (not silently collapsed to H-L):
    // Build a window where >50% bars have overnight gaps, so median reflects them
    const gapDominatedWindow = [
      { high: 5510, low: 5490, close: 5500 }, // TR=20 (first bar, no prevClose)
      { high: 5460, low: 5440, close: 5450 }, // gap-down: TR=max(20,40,60)=60
      { high: 5410, low: 5390, close: 5400 }, // gap-down: TR=max(20,50,70)=70
    ];
    const gapResult = computeMedianTrueRangeFromWindow(gapDominatedWindow);
    // TRs: [20, 60, 70] → sorted=[20,60,70] → median=60
    expect(gapResult).toBe(60);
    // H-L proxy would give [20,20,20] → median=20 — proof the fix changes results
    expect(gapResult!).toBeGreaterThan(20);
  });
});

// ─── F12: POC cache — second same-bar call hits cache ─────────────────────────

describe("F12 — POC cache: getDevelopingSessionPoc called once per bar per symbol", () => {
  beforeEach(() => {
    _testClearPocCache();
    mockGetDevelopingSessionPoc.mockClear();
    mockGetDevelopingSessionPoc.mockResolvedValue(4150.25);
  });

  it("first call populates the cache for the symbol+timestamp key", async () => {
    const bar = makeBar({ symbol: "MES", timestamp: "2026-06-29T14:00:00.000Z" });
    // Provide a 14-bar buffer so ATR warmup passes
    _testSetBarBuffer("MES", makeBars(20, "MES"));

    await buildExitBarContext(bar);

    expect(mockGetDevelopingSessionPoc).toHaveBeenCalledOnce();
    const cached = _testGetPocCacheValue("MES", "2026-06-29T14:00:00.000Z");
    expect(cached).toBe(4150.25);
  });

  it("F12 core: second call with same bar timestamp does NOT hit the DB loader again", async () => {
    const bar = makeBar({ symbol: "MES", timestamp: "2026-06-29T14:00:00.000Z" });
    _testSetBarBuffer("MES", makeBars(20, "MES"));

    await buildExitBarContext(bar);
    await buildExitBarContext(bar); // same timestamp — must hit cache

    // getDevelopingSessionPoc should have been called exactly once, not twice
    expect(mockGetDevelopingSessionPoc).toHaveBeenCalledTimes(1);
  });

  it("different bar timestamp evicts old key and queries DB again", async () => {
    const bar1 = makeBar({ timestamp: "2026-06-29T14:00:00.000Z" });
    const bar2 = makeBar({ timestamp: "2026-06-29T14:05:00.000Z" });
    _testSetBarBuffer("MES", makeBars(20, "MES"));

    await buildExitBarContext(bar1);
    await buildExitBarContext(bar2); // different timestamp → new cache entry

    expect(mockGetDevelopingSessionPoc).toHaveBeenCalledTimes(2);
  });

  it("loader failure is cached as null (fail-soft preserved)", async () => {
    mockGetDevelopingSessionPoc.mockRejectedValueOnce(new Error("DB unavailable"));
    const bar = makeBar({ timestamp: "2026-06-29T15:00:00.000Z" });
    _testSetBarBuffer("MES", makeBars(20, "MES"));

    await buildExitBarContext(bar);
    // After failure the cache stores null — a second call still returns null without retrying
    const cached = _testGetPocCacheValue("MES", "2026-06-29T15:00:00.000Z");
    expect(cached).toBeNull();

    // Second call for same bar uses cached null — loader is NOT called again
    await buildExitBarContext(bar);
    expect(mockGetDevelopingSessionPoc).toHaveBeenCalledTimes(1);
  });

  it("cache size remains bounded (evicts on overflow)", async () => {
    _testSetBarBuffer("MES", makeBars(20, "MES"));
    // Populate 51 distinct bar timestamps — cache should auto-evict
    for (let i = 0; i < 51; i++) {
      const ts = new Date(Date.UTC(2026, 5, 29, 10, i)).toISOString();
      const bar = makeBar({ timestamp: ts });
      await buildExitBarContext(bar);
    }
    expect(_testGetPocCacheSize()).toBeLessThanOrEqual(50);
  });
});
