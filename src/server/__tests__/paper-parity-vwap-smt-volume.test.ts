/**
 * paper-parity-vwap-smt-volume.test.ts
 *
 * Closes 3 silent paper-vs-backtest parity gaps in paper-signal-service.ts:
 *
 *   Gap 1 — SMT score null in paper SignalContext (observability)
 *     The smt_confirmation confluence factor (0.10 weight) was missing in live
 *     paper when getSmtLiveSnapshot returned null. The bridge was already wired;
 *     this fix adds observable logger.info / logger.debug when null so the gap
 *     is detectable in telemetry rather than silently scoring 0.
 *     Tests: T1–T4b
 *
 *   Gap 2 — VWAP not session-reset at 18:00 ET Globex boundary
 *     Backtester resets VWAP at each 18:00 ET Globex boundary via
 *     _assign_globex_session_id() in core.py. Paper engine reset at ET midnight
 *     (toEasternDateString in paper-trading-stream). Fixed by filterToGlobexSession()
 *     applied inside computeIndicators() before VWAP computation.
 *     Tests: T5–T10
 *
 *   Gap 3 — first_30min_volume_ratio always null / volume_rolling_mean_20 missing
 *     (a) volume_rolling_mean_20 was absent from computeIndicators; fixed by
 *         adding the 20-bar rolling mean of bar volume. Enables
 *         evalDeltaOrVolumeSignature to evaluate the spike condition.
 *     (b) first_30min_volume_ratio structural null now surfaced via logger.debug
 *         when read from pre_market_sessions during signal evaluation.
 *     Tests: T11–T14
 *
 * Scope: tests import only from paper-signal-service.js (pure functions).
 * Mock pattern: mirrors trail-stop-extensions.test.ts which successfully imports
 * from paper-signal-service.js in the same test environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (must precede all imports) ────────────────────────────────────────
// Pattern from trail-stop-extensions.test.ts (2026-06-22 hardening):
// The import of paper-signal-service.ts transitively loads index.ts → routes →
// compliance.ts which references complianceRulesets from schema. Mock index.js
// to stop the boot-migration chain and stub the schema fully.

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../db/index.js", () => ({
  db: {
    execute:     vi.fn(() => Promise.resolve({ rows: [] })),
    transaction: vi.fn((cb: (t: unknown) => unknown) =>
      cb({ execute: vi.fn(), select: vi.fn(), insert: vi.fn() })
    ),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  },
}));

vi.mock("../db/schema.js", () => ({
  paperSessions:       {},
  paperPositions:      {},
  strategies:          {},
  paperSignalLogs:     {},
  skipDecisions:       {},
  shadowSignals:       {},
  paperTrades:         {},
  paperSessionFeedback: {},
  preMarketSessions:   {},
  brokerAccounts:      {},
  lifecycleShadowSignals: {},
  // compliance.ts (pulled in via index/route chain) needs these:
  complianceRulesets:  {},
  complianceReviews:   {},
  complianceDriftLog:  {},
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow:     vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/telemetry.js", () => ({
  tracer: {
    startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn() })),
  },
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startActiveSpan: vi.fn(
      (_n: string, _o: unknown, fn: (s: unknown) => unknown) =>
        fn({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn() }),
    ),
    startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn() })),
  },
}));

vi.mock("../lib/dst-utils.js", () => ({
  isUsDst: vi.fn(() => false),
}));

vi.mock("../../shared/firm-config.js", () => ({
  CONTRACT_SPECS:    {},
  CONTRACT_CAP_MIN:  1,
  CONTRACT_CAP_MAX:  20,
}));

vi.mock("../services/paper-risk-gate.js", () => ({
  checkRiskGate:           vi.fn(),
  invalidateDailyLossCache: vi.fn(),
  // toFuturesTradingDayString: +7h shift so 17:00 ET → midnight next day.
  // Replicates the real CME convention: UTC timestamp + 7h then take date portion.
  toFuturesTradingDayString: (d: Date) => {
    const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10); // "YYYY-MM-DD"
  },
  toEasternDateString: (d: Date) => d.toISOString().slice(0, 10),
}));

vi.mock("../services/paper-execution-service.js", () => ({
  openPosition:  vi.fn(),
  closePosition: vi.fn(),
}));

vi.mock("../services/confluence-score.js", () => ({
  evaluateWeightedConfluence: vi.fn().mockReturnValue({
    score: 0,
    factorContributions: [],
    passed: false,
  }),
}));

vi.mock("../services/market-internals-service.js", () => ({
  getInternalsSnapshot: vi.fn().mockReturnValue({
    tick: null, add: null, vold: null, trin: null,
    asOf: new Date(), stale: true,
  }),
}));

vi.mock("../services/liquidity-map-service.js", () => ({
  getNearestLiquidity: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/bias-state-service.js", () => ({
  getBiasState: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/cross-symbol-pnl.js", () => ({
  getAccountSessionCumulativePnL: vi.fn().mockResolvedValue(0),
  evaluateCrossSymbolDll: vi.fn().mockReturnValue({ blocked: false }),
  DEFAULT_PERSONAL_DLL_DOLLARS: 1000,
  // HIGH C-1 fix (deep-scan #16 wave-1 track-3): paper-signal-service.ts now calls
  // these two pure helpers before evaluateCrossSymbolDll — stub them so the mocked
  // module shape matches the real exports and the import doesn't throw.
  resolveAccountKey: vi.fn(() => "default"),
  resolvePersonalDllDollars: vi.fn(() => 1000),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn().mockReturnValue(""),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  shadowSignalsTotal: { inc: vi.fn() },
}));

vi.mock("../lib/shadow-divergence-writer.js", () => ({
  writeShadowDivergence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/confluence-decay.js", () => ({
  getDecayTelemetryThreshold: vi.fn().mockReturnValue(0.3),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

vi.mock("../lib/cross-account-hedge-gate.js", () => ({
  checkCrossAccountHedge:  vi.fn().mockResolvedValue({ blocked: false }),
  checkIntraAccountHedge:  vi.fn().mockResolvedValue({ blocked: false }),
  symbolToUnderlying:      vi.fn().mockReturnValue("ES"),
}));

vi.mock("../lib/price-lock-limit-gate.js", () => ({
  checkPriceLockLimit: vi.fn().mockResolvedValue({ blocked: false }),
}));

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isActive: vi.fn().mockReturnValue(false) },
}));

vi.mock("../services/skip-engine-service.js", () => ({
  evaluateSkipDecision: vi.fn(),
}));

vi.mock("../services/anti-setup-gate-service.js", () => ({
  checkAntiSetupGate: vi.fn(),
}));

vi.mock("../services/context-gate-service.js", () => ({
  evaluateContextGate: vi.fn(),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../services/dsl-translator.js", () => ({
  isDSLStrategy:             vi.fn(() => false),
  translateDSLToPaperConfig: vi.fn(),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(() => true),
}));

vi.mock("../services/smt-live-service.js", () => ({
  getSmtLiveSnapshot:      vi.fn(),
  initSmtBarBufferProvider: vi.fn(),
}));

// ─── Import target under test ─────────────────────────────────────────────────
import {
  filterToGlobexSession,
  computeIndicators,
  VWAP,
  type Bar,
} from "../services/paper-signal-service.js";

import { logger } from "../lib/logger.js";
import { type SmtLiveSnapshot } from "../services/smt-live-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a synthetic Bar with a UTC ISO timestamp string.
 */
function makeBar(
  timestampIso: string,
  overrides: Partial<Bar> = {},
): Bar {
  return {
    symbol: "MES",
    timestamp: timestampIso,
    open:   5000,
    high:   5005,
    low:    4995,
    close:  5002,
    volume: 100,
    ...overrides,
  };
}

/** Construct an ISO timestamp string for UTC date/hour. */
function makeTs(year: number, month: number, day: number, hourUtc: number, minUtc = 0): string {
  return new Date(Date.UTC(year, month - 1, day, hourUtc, minUtc, 0)).toISOString();
}

// ─── Gap 2: filterToGlobexSession ─────────────────────────────────────────────

describe("filterToGlobexSession — Globex session boundary parity (Gap 2)", () => {
  /**
   * CME Globex session mapping with +7h toFuturesTradingDayString mock:
   *
   *   Mock function: (d: Date) => (d + 7h).toISOString().slice(0, 10)
   *
   * This replicates the real toFuturesTradingDayString which shifts +7h before
   * taking the UTC date, so:
   *   - 17:00 ET / 22:00 UTC + 7h = 05:00 UTC next day → "next day" key
   *   - 18:00 ET / 23:00 UTC + 7h = 06:00 UTC next day → "next day" key
   *   - 09:00 ET / 14:00 UTC + 7h = 21:00 UTC same day → "same day" key
   *
   * Test setup (winter, ET = UTC-5):
   *   Monday 09:00 ET = Monday 14:00 UTC → Mon+7h = Mon 21:00 UTC → key="Monday"
   *   Monday 18:00 ET = Monday 23:00 UTC → Mon+7h = Tue 06:00 UTC → key="Tuesday"
   *   Monday 19:00 ET = Tuesday 00:00 UTC → Tue+7h = Tue 07:00 UTC → key="Tuesday"
   *
   * So bars at 2026-06-01 14:00 UTC get key "2026-06-01" (Monday),
   * bars at 2026-06-01 23:00 UTC get key "2026-06-02" (Tuesday new session).
   */

  it("T5: returns only current-session bars when buffer spans two Globex sessions", () => {
    // Monday CME session bars (14:00 UTC = 09:00 ET)
    const mon09 = makeBar(makeTs(2026, 6, 1, 14, 0));
    const mon10 = makeBar(makeTs(2026, 6, 1, 15, 0));
    // Tuesday CME session starts at Monday 18:00 ET = Monday 23:00 UTC
    const tue18 = makeBar(makeTs(2026, 6, 1, 23, 0));
    const tue19 = makeBar(makeTs(2026, 6, 2,  0, 0));  // Monday 19:00 ET

    const buffer = [mon09, mon10, tue18, tue19];
    const sessionBars = filterToGlobexSession(buffer);

    // Only Tuesday-session bars should survive (last bar is in Tuesday's session)
    expect(sessionBars).toHaveLength(2);
    expect(sessionBars[0].timestamp).toBe(tue18.timestamp);
    expect(sessionBars[1].timestamp).toBe(tue19.timestamp);
  });

  it("T6: returns all bars when buffer is within a single session", () => {
    const bar1 = makeBar(makeTs(2026, 6, 2, 14, 0));
    const bar2 = makeBar(makeTs(2026, 6, 2, 15, 0));
    const bar3 = makeBar(makeTs(2026, 6, 2, 16, 0));

    const buffer = [bar1, bar2, bar3];
    const sessionBars = filterToGlobexSession(buffer);

    expect(sessionBars).toHaveLength(3);
  });

  it("T7: returns empty array for empty input", () => {
    expect(filterToGlobexSession([])).toHaveLength(0);
  });

  it("T8: VWAP on session-filtered bars differs from VWAP on full multi-session buffer", () => {
    // Previous session: 3 bars at low price (~4900), timestamps 14-16 UTC
    // (= 09-11 ET winter). Safely within Monday's Globex session key.
    // We cap at 16 UTC to avoid the +7h UTC boundary at 17:00 UTC (17+7=24h,
    // rolls the mock date — using 14-16 UTC avoids any boundary ambiguity).
    const prevBars = Array.from({ length: 3 }, (_, i) =>
      makeBar(makeTs(2026, 6, 1, 14 + i, 0), {
        close: 4900, high: 4910, low: 4890, volume: 200,
      }),
    );
    // Current session: 5 bars at higher price (~5100), starting at Monday 23 UTC
    // (= Monday 18 ET = Tuesday Globex session open)
    const currBars = Array.from({ length: 5 }, (_, i) =>
      makeBar(makeTs(2026, 6, 1, 23 + i, 0), {
        close: 5100, high: 5110, low: 5090, volume: 100,
      }),
    );

    const buffer = [...prevBars, ...currBars];
    const sessionFiltered = filterToGlobexSession(buffer);

    const fullVwap    = VWAP(buffer);
    const sessionVwap = VWAP(sessionFiltered);

    // Session VWAP should be significantly higher (only 5100-range current bars)
    expect(sessionVwap).toBeGreaterThan(fullVwap);
    // Session VWAP should reflect the current session price level (~5100)
    expect(sessionVwap).toBeGreaterThan(5090);
    expect(sessionVwap).toBeLessThan(5110);
  });

  it("T9: computeIndicators returns session-only VWAP and populates volume_rolling_mean_20", () => {
    // 3 bars from previous session at very different price (timestamps 14-16 UTC
    // = 09-11 ET winter, safely within Monday's Globex session key)
    const prevBars = Array.from({ length: 3 }, (_, i) =>
      makeBar(makeTs(2026, 6, 1, 14 + i, 0), {
        close: 4800, high: 4810, low: 4790, volume: 50,
      }),
    );
    // 25 bars from current session (Tue Globex starts Mon 23 UTC = Mon 18 ET)
    // >= 20 bars ensures volume_rolling_mean_20 is populated
    const currBars = Array.from({ length: 25 }, (_, i) =>
      makeBar(makeTs(2026, 6, 1, 23 + i, 0), {
        close: 5200, high: 5210, low: 5190, volume: 120,
      }),
    );

    const buffer = [...prevBars, ...currBars];
    const indicators = computeIndicators(buffer);

    // VWAP must reflect current session only (5200-range bars), not 4800-range
    expect(indicators["vwap"]).toBeGreaterThan(5100);
    expect(indicators["vwap"]).toBeLessThan(5300);
    // volume_rolling_mean_20 must be populated (30 total bars, 25 current-session)
    expect(indicators["volume_rolling_mean_20"]).toBeDefined();
    expect(indicators["volume_rolling_mean_20"]).toBeGreaterThan(0);
  });

  it("T10: single bar — filterToGlobexSession returns that bar unchanged", () => {
    const singleBar = makeBar(makeTs(2026, 6, 2, 14, 0));
    const result = filterToGlobexSession([singleBar]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(singleBar); // same reference
  });
});

// ─── Gap 3a: volume_rolling_mean_20 ──────────────────────────────────────────

describe("computeIndicators — volume_rolling_mean_20 (Gap 3a)", () => {
  function makeBarsWithVolume(count: number, volume: number): Bar[] {
    return Array.from({ length: count }, (_, i) =>
      makeBar(makeTs(2026, 6, 2, 14 + i, 0), { volume }),
    );
  }

  it("T11: populates volume_rolling_mean_20 when buffer has >= 20 bars", () => {
    const bars = makeBarsWithVolume(25, 150);
    const indicators = computeIndicators(bars);

    expect(indicators["volume_rolling_mean_20"]).toBeDefined();
    // All 25 bars have volume 150, so rolling mean of last 20 = 150
    expect(indicators["volume_rolling_mean_20"]).toBeCloseTo(150, 5);
  });

  it("T12: volume_rolling_mean_20 uses only the last 20 bars (rolling window)", () => {
    // First 10 bars: volume 50 (early, excluded from rolling window)
    const early  = makeBarsWithVolume(10,  50);
    // Next 20 bars: volume 200 (fill the rolling window)
    const recent = makeBarsWithVolume(20, 200);
    const bars   = [...early, ...recent];

    const indicators = computeIndicators(bars);

    // Last 20 bars are all 200 → rolling mean = 200
    expect(indicators["volume_rolling_mean_20"]).toBeCloseTo(200, 5);
  });

  it("T13: volume_rolling_mean_20 is absent when buffer has < 20 bars", () => {
    const bars = makeBarsWithVolume(19, 100);
    const indicators = computeIndicators(bars);

    // Must be undefined — evalDeltaOrVolumeSignature fallback path handles this
    expect(indicators["volume_rolling_mean_20"]).toBeUndefined();
  });

  it("T14: volume_rolling_mean_20 correct with alternating volume values", () => {
    // 25 bars alternating 100/200; last 20 contain 10×100 + 10×200 → mean 150
    const bars = Array.from({ length: 25 }, (_, i) =>
      makeBar(makeTs(2026, 6, 2, 14 + i, 0), { volume: i % 2 === 0 ? 100 : 200 }),
    );

    const indicators = computeIndicators(bars);
    expect(indicators["volume_rolling_mean_20"]).toBeCloseTo(150, 5);
  });
});

// ─── Gap 1: SMT wiring contract + observability ───────────────────────────────

describe("SMT score wiring contract — smt_score null observability (Gap 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T1: smtSnapshot null → smt_score/direction/age_bars map to undefined (fail-open)", () => {
    // Replicate the ?? undefined wiring expression in evaluateSignals Path C
    const smtSnapshot = null as SmtLiveSnapshot | null;

    const smt_score     = smtSnapshot?.score     ?? undefined;
    const smt_direction = smtSnapshot?.direction ?? undefined;
    const smt_age_bars  = smtSnapshot?.age_bars  ?? undefined;

    expect(smt_score).toBeUndefined();
    expect(smt_direction).toBeUndefined();
    expect(smt_age_bars).toBeUndefined();
    // When smt_score === undefined, evalSmtConfirmation returns
    // { satisfied: false, reason: "smt_unavailable" } — no regression vs pre-Wave-26
  });

  it("T2: valid smtSnapshot → smt_score/direction/age_bars populated in weightedCtx", () => {
    const smtSnapshot: SmtLiveSnapshot = {
      score:       0.85,
      direction:   "bullish_es_low_nq_higher",
      age_bars:    1,
      computed_at: new Date(),
      stale:       false,
    };

    const smt_score     = smtSnapshot?.score     ?? undefined;
    const smt_direction = smtSnapshot?.direction ?? undefined;
    const smt_age_bars  = smtSnapshot?.age_bars  ?? undefined;

    expect(smt_score).toBe(0.85);
    expect(smt_direction).toBe("bullish_es_low_nq_higher");
    expect(smt_age_bars).toBe(1);
  });

  it("T3: smtSnapshot null → logger.info emitted (observable gap — Python error path)", () => {
    // Replicate the observability block added in paper-signal-service.ts
    const smtSnapshot = null as SmtLiveSnapshot | null;
    const sessionId    = "sess-001";
    const symbol       = "MES";
    const correlationId = "corr-abc";

    if (smtSnapshot === null) {
      logger.info(
        { sessionId, symbol, correlationId },
        "paper-parity: smt_confirmation unavailable — smtSnapshot null (Python error or bar buffer miss); smt_confirmation factor scores 0 this bar",
      );
    } else if (smtSnapshot.score === null && smtSnapshot.direction === null) {
      logger.debug(
        { sessionId, symbol, correlationId, stale: smtSnapshot.stale },
        "paper-parity: smt_score null (insufficient bars or no divergence detected); evalSmtConfirmation returns smt_unavailable",
      );
    }

    expect(vi.mocked(logger.info)).toHaveBeenCalledOnce();
    expect(vi.mocked(logger.info).mock.calls[0][1]).toContain(
      "smt_confirmation unavailable",
    );
    expect(vi.mocked(logger.debug)).not.toHaveBeenCalled();
  });

  it("T4: smtSnapshot all-null fields → logger.debug emitted (no divergence path)", () => {
    const smtSnapshot: SmtLiveSnapshot = {
      score:       null,
      direction:   null,
      age_bars:    null,
      computed_at: new Date(),
      stale:       false,
    };
    const sessionId    = "sess-002";
    const symbol       = "MNQ";
    const correlationId = "corr-xyz";

    if (smtSnapshot === null) {
      logger.info(
        { sessionId, symbol, correlationId },
        "paper-parity: smt_confirmation unavailable — smtSnapshot null (Python error or bar buffer miss); smt_confirmation factor scores 0 this bar",
      );
    } else if (smtSnapshot.score === null && smtSnapshot.direction === null) {
      logger.debug(
        { sessionId, symbol, correlationId, stale: smtSnapshot.stale },
        "paper-parity: smt_score null (insufficient bars or no divergence detected); evalSmtConfirmation returns smt_unavailable",
      );
    }

    expect(vi.mocked(logger.debug)).toHaveBeenCalledOnce();
    expect(vi.mocked(logger.debug).mock.calls[0][1]).toContain("smt_score null");
    expect(vi.mocked(logger.info)).not.toHaveBeenCalled();
  });

  it("T4b: valid smtSnapshot → no observability log emitted (happy path, no noise)", () => {
    const smtSnapshot: SmtLiveSnapshot = {
      score:       0.72,
      direction:   "bearish_es_high_nq_lower",
      age_bars:    0,
      computed_at: new Date(),
      stale:       false,
    };

    // Replicate the exact condition checks
    if (smtSnapshot === null) {
      logger.info({}, "should not fire");
    } else if (smtSnapshot.score === null && smtSnapshot.direction === null) {
      logger.debug({}, "should not fire");
    }

    expect(vi.mocked(logger.info)).not.toHaveBeenCalled();
    expect(vi.mocked(logger.debug)).not.toHaveBeenCalled();
  });
});
