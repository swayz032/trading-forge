import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  feedBar,
  _testResetAllAggregatorState,
  type AggregatorBar,
  type OhlcvBar,
} from "./timeframe-bar-aggregator.js";

/**
 * REAL-DATA parity acceptance gate (M1c, 2026-07-17) — per the campaign's
 * Wiring-Verification Protocol, this is the gate that decides whether the
 * aggregator is genuinely correct, not merely internally self-consistent.
 * Unit tests with hand-built fixtures cannot prove the bucket-anchor
 * convention actually matches the backtest's real consolidated Parquet data —
 * only replaying a REAL 1-minute tape through the aggregator and diffing
 * against the REAL corresponding N-minute bars can prove that.
 *
 * Fixture provenance: `__fixtures__/timeframe-bar-aggregator/es-1min-5min-2026-02-02.json`
 * was extracted directly from `data_cache/ES/ratio_adj/{1min,5min}.parquet`
 * (the local mirror of the real `s3://.../futures/ES/consolidated/` bucket),
 * a real 2-trading-day window (2026-02-02 through 2026-02-03), 2760 1-minute
 * bars and their 552 corresponding real 5-minute consolidated bars. See the
 * fixture's own `provenance` field.
 *
 * This is intentionally scoped to bar-boundary + OHLCV correctness — NOT to
 * indicator-value or entry-firing-bar parity against the Python engine's own
 * indicator math, which is a separate, pre-existing, unchanged code path
 * (`computeIndicators()` in paper-signal-service.ts). Once this test proves
 * the aggregator's OUTPUT bars are bit-identical to the real backtest-parity
 * bars, "indicator values match" and "entry-firing bars match" (the packet's
 * §5 verification clause) follow as a direct logical consequence: identical
 * bars in -> identical (unchanged) computeIndicators output -> identical
 * (unchanged) entry-condition evaluation. This test is what proves the "identical
 * bars in" premise on real data, which is the only new code M1c introduces.
 */

interface Fixture {
  provenance: Record<string, string>;
  bars_1min: OhlcvBar[];
  [realBarsKey: string]: OhlcvBar[] | Record<string, string>;
}

function loadFixture(filename: string): Fixture {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "__fixtures__", "timeframe-bar-aggregator", filename);
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Replay a real 1-minute tape through feedBar(), keyed by bucket-start instant
 * (not position), so gaps in the raw tape (weekend, the 17:00-18:00 ET Globex
 * maintenance halt) — which shift 1-minute-bar-count vs N-minute-bucket-count
 * out of lockstep — never produce a false mismatch.
 */
function replayToClosedBarsByInstant(bars1min: OhlcvBar[], timeframeMinutes: number): Map<number, AggregatorBar> {
  const byInstant = new Map<number, AggregatorBar>();
  for (const raw of bars1min) {
    const result = feedBar("ES", timeframeMinutes, raw);
    if (result.isBucketClose) {
      const closed = result.aggregatedBuffer[result.aggregatedBuffer.length - 1];
      byInstant.set(new Date(closed.timestamp).getTime(), closed);
    }
  }
  // Force-flush the final in-progress bucket with a synthetic sentinel bar just
  // past the tape's last real bar (the sentinel's own OHLCV is discarded — it
  // exists only to trigger the close of the real final bucket).
  const lastReal = bars1min[bars1min.length - 1];
  const sentinelTs = new Date(new Date(lastReal.timestamp).getTime() + timeframeMinutes * 60_000).toISOString();
  const finalResult = feedBar("ES", timeframeMinutes, { timestamp: sentinelTs, open: 0, high: 0, low: 0, close: 0, volume: 0 });
  if (finalResult.isBucketClose) {
    const closed = finalResult.aggregatedBuffer[finalResult.aggregatedBuffer.length - 1];
    byInstant.set(new Date(closed.timestamp).getTime(), closed);
  }
  return byInstant;
}

function assertRealBarsMatch(realBars: OhlcvBar[], byInstant: Map<number, AggregatorBar>): void {
  expect(realBars.length).toBeGreaterThan(0);
  for (const real of realBars) {
    const instant = new Date(real.timestamp).getTime();
    const mine = byInstant.get(instant);
    expect(mine, `no aggregated bucket found for real bar at ${real.timestamp}`).toBeDefined();
    expect(mine!.open).toBeCloseTo(real.open, 9);
    expect(mine!.high).toBeCloseTo(real.high, 9);
    expect(mine!.low).toBeCloseTo(real.low, 9);
    expect(mine!.close).toBeCloseTo(real.close, 9);
    expect(mine!.volume).toBeCloseTo(real.volume, 9);
  }
}

describe("timeframe-bar-aggregator — REAL-DATA parity (ES 5-minute, 2026-02-02..03)", () => {
  beforeEach(() => {
    _testResetAllAggregatorState();
  });

  it("replaying the real 1-minute tape through feedBar() reproduces the real 5-minute consolidated bars bit-for-bit", () => {
    const fixture = loadFixture("es-1min-5min-2026-02-02.json");
    const bars5minReal = fixture.bars_5min_real as OhlcvBar[];
    // Sanity: this fixture window is exactly bucket-aligned (no partial buckets at
    // either edge) so every real 5-minute bar has a directly comparable aggregator output.
    expect(fixture.bars_1min.length).toBe(bars5minReal.length * 5);
    const byInstant = replayToClosedBarsByInstant(fixture.bars_1min, 5);
    assertRealBarsMatch(bars5minReal, byInstant);
  });
});

describe("timeframe-bar-aggregator — REAL-DATA parity, ANCHOR-DISAMBIGUATING case (ES 4-hour, 2026-02-02..06)", () => {
  beforeEach(() => {
    _testResetAllAggregatorState();
  });

  // 4-hour is the ONLY one of the 6 timeframes the strategy pool actually uses
  // (1m/5m/15m/30m/1h/4h) whose bucket boundaries can distinguish a plain-UTC-
  // epoch anchor from an 18:00-ET-session-open anchor: 18 hours is an exact
  // integer multiple of 5/15/30/60 minutes, so a wrongly-anchored aggregator
  // would produce IDENTICAL output to the correct one at those timeframes and
  // a real-data test there alone cannot catch an anchor mutation (confirmed
  // empirically during this wave's RED-proof — see AGENT-LOGS). This test is
  // what makes the RED-proof genuine, on real production data, not just a
  // hand-computed unit-test value.
  it("replaying the real 1-minute tape through feedBar() reproduces the real 4-hour consolidated bars bit-for-bit", () => {
    const fixture = loadFixture("es-1min-4hour-2026-02-02.json");
    const bars4hourReal = fixture.bars_4hour_real as OhlcvBar[];
    const byInstant = replayToClosedBarsByInstant(fixture.bars_1min, 240);
    assertRealBarsMatch(bars4hourReal, byInstant);
  });
});
