/**
 * paper-signal-service-vwap-bands-live-wiring.test.ts
 *
 * post-m3-paper-execution-lifecycle wave (2026-07-17), HIGH — re-verified against current
 * (post-M3) code and confirmed STILL PRESENT: paper-signal-service.ts's live computeIndicators()
 * never emitted any vwap_band_ or anchored_vwap_ key, so confluence-score.ts's evalVwapAlignment()
 * "1-sigma band reject" and "anchored VWAP retest" branches were permanently unreachable in live
 * paper trading — even though wave25-vwap-smt-wiring.test.ts already proves the CONSUMER-side
 * logic works correctly when hand-fed the right indicator keys, nothing in the live pipeline ever
 * produced them (confirmed by direct grep: zero assignment sites for vwap_band_, anchored_vwap_,
 * or a bare "atr" key anywhere in paper-signal-service.ts pre-fix).
 *
 * THE FIX: a new computeVwapWithBands() pure function (bit-for-bit port of
 * src/engine/indicators/core.py::compute_vwap_with_bands()'s running-population-variance formula)
 * wired into computeIndicators(), which now emits vwap_band_1s_upper/lower, vwap_band_2s_upper/lower,
 * a session-anchored anchored_vwap_<iso> key (the session VWAP IS, by definition, a VWAP anchored
 * at the session's own open bar), and a bare "atr" alias (=atr_14) so evalVwapAlignment's ATR-gated
 * anchored-retest check can also actually run (it independently needed a plain "atr" key that
 * computeIndicators() had also never emitted — a companion dead-code cause of the same symptom).
 *
 * This suite proves the PRODUCER side end-to-end — computeIndicators() run over a real bar buffer,
 * fed straight into evaluateWeightedConfluence() (no hand-injected indicator keys), reaching the
 * "band_1s_reject" / "anchored_vwap_retest" reason strings that were provably unreachable before.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));
vi.mock("../services/market-internals-service.js", () => ({
  getInternalsSnapshot: vi.fn().mockReturnValue({
    tick: null, add: null, vold: null, trin: null, asOf: new Date(), stale: true,
  }),
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })) },
}));
vi.mock("../lib/telemetry.js", () => ({ tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn() })) } }));
vi.mock("../lib/tracing.js", () => ({ tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn() })) } }));

import {
  computeIndicators,
  computeVwapWithBands,
  filterToGlobexSession,
  type Bar,
} from "../services/paper-signal-service.js";

import {
  evaluateWeightedConfluence,
  FACTOR_VWAP_ALIGNMENT,
  type ScoringStrategy,
  type SignalContext,
} from "../services/confluence-score.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBar(timestampIso: string, overrides: Partial<Bar> = {}): Bar {
  return {
    symbol: "MES", timestamp: timestampIso,
    open: 5000, high: 5005, low: 4995, close: 5000, volume: 100,
    ...overrides,
  };
}

function makeTs(year: number, month: number, day: number, hourUtc: number, minUtc = 0): string {
  return new Date(Date.UTC(year, month - 1, day, hourUtc, minUtc, 0)).toISOString();
}

function makeStrategy(overrides: Partial<ScoringStrategy> = {}): ScoringStrategy {
  return {
    id: "strat-vwap-live-wiring", symbol: "MES",
    confluence_score_weights: null, confluence_score_threshold: null, entry_quality: null,
    ...overrides,
  };
}

// ─── computeVwapWithBands() — pure-function correctness vs hand-computed values ──

describe("computeVwapWithBands() — running-population-variance parity with core.py::compute_vwap_with_bands()", () => {
  it("hand-computed 3-bar sequence: vwap/sigma match the running formula exactly", () => {
    // Bars: tp = (high+low+close)/3. Chosen so tp is a round number.
    //   bar1: tp=100, vol=10 -> cumPv=1000, cumV=10, vwap1=100, dev1=(100-100)^2*10=0
    //   bar2: tp=110, vol=10 -> cumPv=2100, cumV=20, vwap2=105, dev2=(110-105)^2*10=250
    //   bar3: tp=90,  vol=20 -> cumPv=3900, cumV=40, vwap3=97.5, dev3=(90-97.5)^2*20=1125
    //   cumPv2 = 0 + 250 + 1125 = 1375 (each dev term uses the RUNNING vwap at that bar,
    //   per core.py's cum_sum().over("session_id") on (tp-vwap)^2*vol where vwap is the
    //   per-row running vwap column, not the final vwap)
    //   sigma = sqrt(1375/40) = sqrt(34.375) ≈ 5.86302...
    const bars: Bar[] = [
      makeBar(makeTs(2026, 6, 2, 14, 0), { high: 100, low: 100, close: 100, volume: 10 }),
      makeBar(makeTs(2026, 6, 2, 14, 1), { high: 110, low: 110, close: 110, volume: 10 }),
      makeBar(makeTs(2026, 6, 2, 14, 2), { high: 90, low: 90, close: 90, volume: 20 }),
    ];
    const result = computeVwapWithBands(bars);
    expect(result.vwap).toBeCloseTo(97.5, 10);
    const expectedSigma = Math.sqrt(1375 / 40);
    expect(result.band1sUpper).toBeCloseTo(97.5 + expectedSigma, 10);
    expect(result.band1sLower).toBeCloseTo(97.5 - expectedSigma, 10);
    expect(result.band2sUpper).toBeCloseTo(97.5 + 2 * expectedSigma, 10);
    expect(result.band2sLower).toBeCloseTo(97.5 - 2 * expectedSigma, 10);
  });

  it("single bar: zero variance -> bands collapse onto vwap", () => {
    const bars: Bar[] = [makeBar(makeTs(2026, 6, 2, 14, 0), { high: 100, low: 100, close: 100, volume: 10 })];
    const result = computeVwapWithBands(bars);
    expect(result.vwap).toBeCloseTo(100, 10);
    expect(result.band1sUpper).toBeCloseTo(100, 10);
    expect(result.band1sLower).toBeCloseTo(100, 10);
  });

  it("empty bars -> all NaN (fail-open, matches VWAP()'s own empty-input contract)", () => {
    const result = computeVwapWithBands([]);
    expect(result.vwap).toBeNaN();
    expect(result.band1sUpper).toBeNaN();
    expect(result.band1sLower).toBeNaN();
  });

  it("zero cumulative volume -> NaN (never divides by zero / propagates Infinity)", () => {
    const bars: Bar[] = [
      makeBar(makeTs(2026, 6, 2, 14, 0), { volume: 0 }),
      makeBar(makeTs(2026, 6, 2, 14, 1), { volume: 0 }),
    ];
    const result = computeVwapWithBands(bars);
    expect(result.vwap).toBeNaN();
    expect(Number.isFinite(result.band1sUpper)).toBe(false);
  });

  it("wider price dispersion produces a wider sigma band (sanity: bands actually respond to volatility)", () => {
    const tight: Bar[] = [
      makeBar(makeTs(2026, 6, 2, 14, 0), { high: 5001, low: 4999, close: 5000, volume: 100 }),
      makeBar(makeTs(2026, 6, 2, 14, 1), { high: 5002, low: 4998, close: 5001, volume: 100 }),
    ];
    const wide: Bar[] = [
      makeBar(makeTs(2026, 6, 2, 14, 0), { high: 5100, low: 4900, close: 5000, volume: 100 }),
      makeBar(makeTs(2026, 6, 2, 14, 1), { high: 5200, low: 4800, close: 5100, volume: 100 }),
    ];
    const tightResult = computeVwapWithBands(tight);
    const wideResult = computeVwapWithBands(wide);
    const tightSigma = tightResult.band1sUpper - tightResult.vwap;
    const wideSigma = wideResult.band1sUpper - wideResult.vwap;
    expect(wideSigma).toBeGreaterThan(tightSigma);
  });
});

// ─── computeIndicators() — the actual producer-side wiring fix ──────────────────

describe("computeIndicators() now emits vwap_band_*/anchored_vwap_*/atr keys (were ALL absent pre-fix)", () => {
  it("populates vwap_band_1s_upper/lower and vwap_band_2s_upper/lower alongside vwap", () => {
    const bars: Bar[] = Array.from({ length: 10 }, (_, i) =>
      makeBar(makeTs(2026, 6, 2, 14 + i, 0), {
        high: 5000 + i * 3, low: 4990 + i * 2, close: 4995 + i * 2.5, volume: 100 + i * 10,
      }),
    );
    const indicators = computeIndicators(bars);

    expect(indicators["vwap"]).toBeDefined();
    expect(Number.isFinite(indicators["vwap"])).toBe(true);
    for (const key of ["vwap_band_1s_upper", "vwap_band_1s_lower", "vwap_band_2s_upper", "vwap_band_2s_lower"]) {
      expect(indicators[key]).toBeDefined();
      expect(Number.isFinite(indicators[key])).toBe(true);
    }
    // Band ordering invariant: 2s bands must be strictly wider than 1s bands (both centered on vwap).
    expect(indicators["vwap_band_2s_upper"]).toBeGreaterThanOrEqual(indicators["vwap_band_1s_upper"]);
    expect(indicators["vwap_band_2s_lower"]).toBeLessThanOrEqual(indicators["vwap_band_1s_lower"]);
  });

  it("populates a session-anchored anchored_vwap_<iso> key equal to the session VWAP", () => {
    const bars: Bar[] = Array.from({ length: 6 }, (_, i) =>
      makeBar(makeTs(2026, 6, 2, 14 + i, 0), { close: 5000 + i, volume: 100 }),
    );
    const indicators = computeIndicators(bars);
    const anchoredKeys = Object.keys(indicators).filter((k) => k.startsWith("anchored_vwap_"));
    expect(anchoredKeys.length).toBeGreaterThanOrEqual(1);
    // Session-anchor semantics: the session's own VWAP IS the VWAP anchored at session open
    // (sessionBarsForVwap already starts at the session's first bar) — must equal vals["vwap"].
    expect(indicators[anchoredKeys[0]]).toBeCloseTo(indicators["vwap"], 10);
  });

  it("populates a bare 'atr' key equal to atr_14 (companion fix for the retest ATR gate)", () => {
    const bars: Bar[] = Array.from({ length: 20 }, (_, i) =>
      makeBar(makeTs(2026, 6, 2, 14 + i, 0), {
        high: 5010 + i, low: 4990 + i, close: 5000 + i, volume: 100,
      }),
    );
    const indicators = computeIndicators(bars);
    expect(indicators["atr"]).toBeDefined();
    expect(indicators["atr"]).toBe(indicators["atr_14"]);
  });

  it("Globex-session-filtered bands (parity with the existing VWAP session-reset fix): a prior session's extreme prices do not leak into today's bands", () => {
    const prevSession: Bar[] = Array.from({ length: 3 }, (_, i) =>
      makeBar(makeTs(2026, 6, 1, 14 + i, 0), { close: 4000, high: 4005, low: 3995, volume: 500 }),
    );
    const currSession: Bar[] = Array.from({ length: 5 }, (_, i) =>
      makeBar(makeTs(2026, 6, 1, 23 + i, 0), { close: 5100, high: 5105, low: 5095, volume: 100 }),
    );
    const buffer = [...prevSession, ...currSession];
    const indicators = computeIndicators(buffer);
    const sessionOnly = computeVwapWithBands(filterToGlobexSession(buffer));

    expect(indicators["vwap_band_1s_upper"]).toBeCloseTo(sessionOnly.band1sUpper, 8);
    expect(indicators["vwap_band_1s_lower"]).toBeCloseTo(sessionOnly.band1sLower, 8);
    // Sanity: nowhere near the prior session's 4000-range prices.
    expect(indicators["vwap_band_1s_lower"]).toBeGreaterThan(4500);
  });
});

// ─── End-to-end: real computeIndicators() output reaches the dead-code branches ──

describe("End-to-end: computeIndicators() -> evaluateWeightedConfluence() reaches band_1s_reject / anchored_vwap_retest (the branches the finding says were permanently unreachable)", () => {
  it("a real bar buffer whose last bar sits at/below the COMPUTED vwap_band_1s_lower reaches reason='band_1s_reject' — RED pre-fix (computeIndicators produced no such key, so this factor could only ever reach the plain close-vs-vwap branch)", () => {
    // Build a volatile session so a real 1-sigma band exists, then price the LAST bar exactly
    // at the computed band_1s_lower (a genuine "band touch", not fabricated).
    const priorBars: Bar[] = Array.from({ length: 8 }, (_, i) =>
      // All bars kept within hour 14 UTC (minute-spaced) — same convention as the sibling
      // T8/T9 tests' "cap at 16 UTC to avoid the +7h Globex boundary" comment: the +7h shift
      // only rolls bars at UTC hour >= 17 into the next session, so an all-hour-14 buffer is
      // unambiguously a single Globex session for both this setup computation AND for
      // computeIndicators()'s own internal filterToGlobexSession() call below.
      makeBar(makeTs(2026, 6, 2, 14, i * 2), {
        high: 5300 + (i % 2 === 0 ? 40 : -10),
        low: 4700 + (i % 2 === 0 ? 10 : -40),
        close: 5000 + (i % 2 === 0 ? 150 : -150),
        volume: 200,
      }),
    );
    const bandsSoFar = computeVwapWithBands(priorBars);
    expect(Number.isFinite(bandsSoFar.band1sLower)).toBe(true);

    // Deliberately tiny volume on the touch bar itself (1 vs ~1600 accumulated across
    // priorBars) so its own contribution to the cumulative vwap/sigma is negligible — but
    // still non-zero, so a small safety margin (a few points below bandsSoFar.band1sLower,
    // rather than exact equality) is needed to stay below the band actually reported by
    // computeIndicators() (which includes the touch bar itself in its own cumulative calc,
    // shifting the true band slightly from the priorBars-only bandsSoFar reference value —
    // this margin absorbs that shift regardless of direction). Same hour-14 session window
    // as priorBars above (no Globex-boundary ambiguity).
    const bandTouchMargin = 5;
    const touchClose = bandsSoFar.band1sLower - bandTouchMargin;
    const touchBar = makeBar(makeTs(2026, 6, 2, 14, 20), {
      close: touchClose,
      high: touchClose + 1,
      low: touchClose - 1,
      volume: 1,
    });
    const buffer = [...priorBars, touchBar];
    const indicators = computeIndicators(buffer);

    // Sanity: the fix actually produced a band, and the touch bar's close is at/below it.
    expect(Number.isFinite(indicators["vwap_band_1s_lower"])).toBe(true);
    expect(indicators["close"]).toBeLessThanOrEqual(indicators["vwap_band_1s_lower"]!);

    const ctx: SignalContext = {
      strategyId: "strat-vwap-live-wiring",
      bar: { open: touchBar.open, high: touchBar.high, low: touchBar.low, close: touchBar.close, volume: touchBar.volume },
      indicators: indicators as Record<string, number | undefined>,
      direction: "long",
      symbol: "MES",
      bias_active_strategy_id: null,
      structureState: null,
      calendarBlocked: false,
      timestampUTC: new Date(touchBar.timestamp),
    };
    const result = evaluateWeightedConfluence(makeStrategy(), ctx);
    const vwapFc = result.factorContributions.find((fc) => fc.factor === FACTOR_VWAP_ALIGNMENT);
    expect(vwapFc).toBeDefined();
    expect(vwapFc!.satisfied).toBe(true);
    expect(vwapFc!.reason).toBe("band_1s_reject");
  });

  it("a real bar buffer priced within 0.5x the live 'atr' key of the session anchor reaches reason='anchored_vwap_retest' — RED pre-fix (no anchored_vwap_* key AND no bare 'atr' key existed)", () => {
    const bars: Bar[] = Array.from({ length: 20 }, (_, i) =>
      makeBar(makeTs(2026, 6, 2, 14 + i, 0), {
        high: 5010 + i, low: 4990 + i, close: 5000 + i, volume: 100,
      }),
    );
    const indicators = computeIndicators(bars);
    const anchoredKey = Object.keys(indicators).find((k) => k.startsWith("anchored_vwap_"))!;
    expect(anchoredKey).toBeDefined();
    expect(Number.isFinite(indicators["atr"])).toBe(true);

    // Price the signal bar's close EXACTLY at the anchored VWAP value — guarantees a retest
    // (distance 0 <= 0.5*atr for any positive atr) using the real, computed anchor value.
    const lastBar = bars[bars.length - 1];
    const ctx: SignalContext = {
      strategyId: "strat-vwap-live-wiring",
      bar: { open: lastBar.open, high: lastBar.high, low: lastBar.low, close: indicators[anchoredKey], volume: lastBar.volume },
      indicators: indicators as Record<string, number | undefined>,
      direction: "long",
      symbol: "MES",
      bias_active_strategy_id: null,
      structureState: null,
      calendarBlocked: false,
      timestampUTC: new Date(lastBar.timestamp),
    };
    const result = evaluateWeightedConfluence(makeStrategy(), ctx);
    const vwapFc = result.factorContributions.find((fc) => fc.factor === FACTOR_VWAP_ALIGNMENT);
    expect(vwapFc).toBeDefined();
    expect(vwapFc!.satisfied).toBe(true);
    expect(vwapFc!.reason).toBe("anchored_vwap_retest");
  });
});
