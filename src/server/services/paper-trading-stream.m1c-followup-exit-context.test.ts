/**
 * M1c follow-up (2026-07-17, post-landing accuracy-validator finding)
 *
 * The M1c wave (docs/ratify-packets/m1b-multi-tf-aggregation-parity-2026-07-17.md)
 * rerouted entry-side `indicators` to the real-timeframe aggregated buffer for
 * non-1m sessions, but `buildExitBarContext()`'s atr14/medianAtr14/last2barSwingLow/
 * High — INDICATOR-MAGNITUDE fields feeding exit slippage scaling + Chandelier/
 * adaptive trail distance — were left on the raw 1-minute buffer. The backtest
 * computes these from its own N-minute-bar frame (it has no other granularity),
 * so a non-1m session's exit-side ATR was understated by roughly sqrt(N)x vs
 * what the backtest assumes, silently biasing simulated slippage + trail sizing.
 *
 * This file proves buildExitBarContext now sources those fields from
 * `mtfContext.aggregatedBuffer` when provided, and stays byte-identical to
 * pre-fix behavior when mtfContext is absent (the 1m regression anchor).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused"; });

// ─── Mocks (must come before imports that pull the module under test) ─────────

const mockGetDevelopingSessionPoc = vi.fn().mockResolvedValue(null);
const mockATR = vi.fn().mockReturnValue(2.5);

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
  getSessionTimeframe: vi.fn().mockResolvedValue("1m"),
  ATR: (...args: unknown[]) => mockATR(...args),
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
  buildExitBarContext,
  _testSetBarBuffer,
  type Bar,
} from "./paper-trading-stream.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeBars(count: number, symbol: string, opts: { startVolume?: number } = {}): Bar[] {
  const bars: Bar[] = [];
  const startVolume = opts.startVolume ?? 1000;
  for (let i = 0; i < count; i++) {
    const ts = new Date(Date.UTC(2026, 5, 29, 14, i)).toISOString();
    bars.push({
      symbol,
      timestamp: ts,
      open: 5500 + i,
      high: 5510 + i,
      low: 5490 + i,
      close: 5505 + i,
      volume: startVolume + i * 10,
    });
  }
  return bars;
}

// Aggregated (5m) bars — deliberately DIFFERENT high/low/volume magnitude than
// the raw 1m buffer so a test reading the wrong buffer produces a different,
// detectable result.
function makeAggregatedBars(count: number, symbol: string): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(Date.UTC(2026, 5, 29, 13, i * 5)).toISOString();
    bars.push({
      symbol,
      timestamp: ts,
      open: 6000 + i * 5,
      high: 6050 + i * 5, // much wider range than the 1m bars above
      low: 5950 + i * 5,
      close: 6010 + i * 5,
      volume: 9000 + i * 50, // ~9x a single 1m bar's volume (5x bars summed)
    });
  }
  return bars;
}

const currentBar = (symbol: string): Bar => ({
  symbol,
  timestamp: "2026-06-29T14:30:00.000Z",
  open: 5600,
  high: 5610,
  low: 5590,
  close: 5605,
  volume: 1500,
});

beforeEach(() => {
  mockATR.mockClear();
  mockATR.mockReturnValue(2.5);
  mockGetDevelopingSessionPoc.mockClear();
});

describe("M1c follow-up — buildExitBarContext sources atr14 from the aggregated buffer when mtfContext is present", () => {
  it("passes mtfContext.aggregatedBuffer to ATR(), not the raw 1-minute barBuffer", async () => {
    const symbol = "MES-M1C-1";
    const rawBars = makeBars(20, symbol);
    _testSetBarBuffer(symbol, rawBars);
    const aggregatedBuffer = makeAggregatedBars(10, symbol);

    await buildExitBarContext(currentBar(symbol), { isBucketClose: true, aggregatedBuffer });

    expect(mockATR).toHaveBeenCalledTimes(1);
    const [bufArg] = mockATR.mock.calls[0];
    expect(bufArg).toBe(aggregatedBuffer);
    expect(bufArg).not.toBe(rawBars);
  });

  it("REGRESSION ANCHOR — falls back to the raw barBuffer when mtfContext is absent (1m sessions, byte-identical to pre-fix)", async () => {
    const symbol = "MES-M1C-2";
    const rawBars = makeBars(20, symbol);
    _testSetBarBuffer(symbol, rawBars);

    await buildExitBarContext(currentBar(symbol));

    expect(mockATR).toHaveBeenCalledTimes(1);
    const [bufArg] = mockATR.mock.calls[0];
    expect(bufArg).toBe(rawBars);
  });
});

describe("M1c follow-up — medianAtr14 (rolling median true range) sources from the aggregated buffer", () => {
  it("computes a materially different medianAtr14 from the aggregated buffer vs the raw buffer for the same bar", async () => {
    const symbol = "MES-M1C-3";
    // Raw 1m bars: narrow ~20pt true ranges.
    _testSetBarBuffer(symbol, makeBars(20, symbol));
    // Aggregated 5m bars: much wider ~100pt true ranges (5x the constituent range).
    const aggregatedBuffer = makeAggregatedBars(20, symbol);

    const ctxAggregated = await buildExitBarContext(currentBar(symbol), { isBucketClose: true, aggregatedBuffer });
    const ctxRaw = await buildExitBarContext(currentBar(symbol)); // mtfContext absent → raw buffer

    expect(ctxAggregated?.medianAtr14?.[symbol]).toBeDefined();
    expect(ctxRaw?.medianAtr14?.[symbol]).toBeDefined();
    // The aggregated (5m) median true range must be meaningfully larger than the
    // raw (1m) median true range for the identical bar — proves the source buffer
    // actually changed the computed magnitude, not just which array was touched.
    expect(ctxAggregated!.medianAtr14![symbol]).toBeGreaterThan(ctxRaw!.medianAtr14![symbol] * 2);
  });
});

describe("M1c follow-up — last2barSwingLow/High indexing differs correctly between raw and aggregated buffers", () => {
  it("aggregated buffer (no partial/current bucket) uses the last 2 COMPLETED bars — buf[len-1] and buf[len-2]", async () => {
    const symbol = "MES-M1C-4";
    _testSetBarBuffer(symbol, makeBars(20, symbol));
    const aggregatedBuffer = makeAggregatedBars(5, symbol);
    const lastAgg = aggregatedBuffer[aggregatedBuffer.length - 1];
    const secondLastAgg = aggregatedBuffer[aggregatedBuffer.length - 2];

    const ctx = await buildExitBarContext(currentBar(symbol), { isBucketClose: true, aggregatedBuffer });

    expect(ctx?.last2barSwingLow?.[symbol]).toBe(Math.min(lastAgg.low, secondLastAgg.low));
    expect(ctx?.last2barSwingHigh?.[symbol]).toBe(Math.max(lastAgg.high, secondLastAgg.high));
  });

  it("raw buffer (current bar already pushed) uses buf[len-2] and buf[len-3], skipping the current bar", async () => {
    const symbol = "MES-M1C-5";
    const rawBars = makeBars(20, symbol);
    _testSetBarBuffer(symbol, rawBars);
    const prevBar1 = rawBars[rawBars.length - 2];
    const prevBar2 = rawBars[rawBars.length - 3];

    const ctx = await buildExitBarContext(currentBar(symbol)); // mtfContext absent

    expect(ctx?.last2barSwingLow?.[symbol]).toBe(Math.min(prevBar1.low, prevBar2.low));
    expect(ctx?.last2barSwingHigh?.[symbol]).toBe(Math.max(prevBar1.high, prevBar2.high));
  });
});

describe("M1c follow-up — currentBarHigh/currentBarLow/barVol stay on the RAW current bar regardless of mtfContext (deliberate — touch detection, not magnitude)", () => {
  it("currentBarHigh/Low reflect the raw current bar even when mtfContext is present", async () => {
    const symbol = "MES-M1C-6";
    _testSetBarBuffer(symbol, makeBars(20, symbol));
    const bar = currentBar(symbol);
    const aggregatedBuffer = makeAggregatedBars(5, symbol);

    const ctx = await buildExitBarContext(bar, { isBucketClose: true, aggregatedBuffer });

    expect(ctx?.currentBarHigh?.[symbol]).toBe(bar.high);
    expect(ctx?.currentBarLow?.[symbol]).toBe(bar.low);
  });
});
