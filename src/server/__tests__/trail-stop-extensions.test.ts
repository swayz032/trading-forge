/**
 * Trail Stop Extensions — Tier 5.1 (W5b)
 *
 * Tests for:
 *   - break_even_at_r: move SL to entry+1 tick at 1R profit
 *   - time_decay_minutes: tighten trail from 2x → 1.5x ATR after N minutes
 *
 * Backwards-compat: both fields null/undefined → existing ATR trail behavior unchanged.
 *
 * Note: paper-signal-service.ts imports DB — mocked here so pure functions
 * can be tested without a real Postgres connection.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Mocks (must come before service import) ─────────────────────────────────
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  },
}));
vi.mock("../db/schema.js", () => ({
  paperSessions: {},
  paperPositions: {},
  strategies: {},
  paperSignalLogs: {},
  skipDecisions: {},
  shadowSignals: {},
  paperTrades: {},
  paperSessionFeedback: {},
}));
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));
vi.mock("../services/paper-execution-service.js", () => ({
  openPosition: vi.fn(),
  closePosition: vi.fn(),
}));
vi.mock("../services/paper-risk-gate.js", () => ({
  checkRiskGate: vi.fn(),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/telemetry.js", () => ({
  tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn() })) },
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
vi.mock("../lib/tracing.js", () => ({
  tracer: { startActiveSpan: vi.fn((_n: string, _o: unknown, fn: (s: unknown) => unknown) => fn({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn() })), startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn() })) },
}));
vi.mock("../services/dsl-translator.js", () => ({
  isDSLStrategy: vi.fn(() => false),
  translateDSLToPaperConfig: vi.fn(),
}));
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(() => true),
}));
vi.mock("../lib/dst-utils.js", () => ({
  isUsDst: vi.fn(() => false),
}));
vi.mock("../../shared/firm-config.js", () => ({
  CONTRACT_SPECS: {},
  CONTRACT_CAP_MIN: 1,
  CONTRACT_CAP_MAX: 20,
}));

import {
  checkTrailStopExtended,
  type TrailStopConfig,
  type TrailStopExtendedInput,
  TICK_SIZES,
} from "../services/paper-signal-service.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

// NQ scenario: entry 18000, hard SL 17986 (14 pts = initial risk)
// ATR = 10 pts, atr_multiple = 2.0
// break_even_at_r = 1.0 → fires when profit ≥ 14 pts → HWM ≥ 18014
// time_decay_minutes = 20, time_decay_multiplier = 0.75 → 2.0 * 0.75 = 1.5

const BASE_CONFIG: TrailStopConfig = {
  atr_multiple: 2.0,
  atr_period: 14,
};

const BE_CONFIG: TrailStopConfig = {
  atr_multiple: 2.0,
  atr_period: 14,
  break_even_at_r: 1.0,
  time_decay_minutes: 20,
  time_decay_multiplier: 0.75,
};

function makeInput(overrides: Partial<TrailStopExtendedInput> = {}): TrailStopExtendedInput {
  return {
    positionId: "pos-001",
    side: "long",
    entryPrice: 18000,
    initialRiskPoints: 14,
    atrValue: 10,
    currentHigh: 18010,
    currentLow: 17990,
    minutesOpen: 5,
    currentHWM: null,
    symbol: "MNQ",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TrailStopConfig — backwards compat (no W5b fields)", () => {
  it("trail fires when low falls below ATR trail level", () => {
    // HWM=18030, trail=18030-20=18010, low=17990 → hit
    const input = makeInput({ currentHigh: 18030, currentLow: 17990, currentHWM: 18030 });
    const result = checkTrailStopExtended(BASE_CONFIG, input);
    expect(result.stopPrice).toBeCloseTo(18010, 1);
    expect(result.hit).toBe(true);
    expect(result.breakEvenActive).toBe(false);
    expect(result.timeDecayActive).toBe(false);
  });

  it("trail does NOT fire when low is above ATR trail level", () => {
    // HWM=18020, trail=18020-20=18000, low=18005 → no hit
    const input = makeInput({ currentHigh: 18020, currentLow: 18005, currentHWM: 18020 });
    const result = checkTrailStopExtended(BASE_CONFIG, input);
    expect(result.stopPrice).toBeCloseTo(18000, 1);
    expect(result.hit).toBe(false);
  });

  it("correctly initialises HWM from bar.high when currentHWM is null", () => {
    const input = makeInput({ currentHigh: 18015, currentLow: 18005, currentHWM: null });
    const result = checkTrailStopExtended(BASE_CONFIG, input);
    expect(result.newHWM).toBe(18015);
    expect(result.stopPrice).toBeCloseTo(18015 - 20, 1);
  });
});

describe("Tier 5.1 — break_even_at_r (longs)", () => {
  it("fires break-even when profit >= 1R (HWM at exactly 18014)", () => {
    // 1R = 14 pts → HWM=18014 → profit=14 → BE fires → SL = 18000.25
    const input = makeInput({ currentHigh: 18014, currentLow: 18005, currentHWM: 18014 });
    const result = checkTrailStopExtended(BE_CONFIG, input);
    expect(result.breakEvenActive).toBe(true);
    // BE level = 18000.25; ATR trail = 18014-20 = 17994 → max = 18000.25
    expect(result.stopPrice).toBeCloseTo(18000.25, 2);
    expect(result.hit).toBe(false); // low=18005 > 18000.25
  });

  it("does NOT fire break-even when profit < 1R (HWM at 18013)", () => {
    // profit = 13 < 14 → no BE
    const input = makeInput({ currentHigh: 18013, currentLow: 18005, currentHWM: 18013 });
    const result = checkTrailStopExtended(BE_CONFIG, input);
    expect(result.breakEvenActive).toBe(false);
    // Trail only: 18013 - 20 = 17993
    expect(result.stopPrice).toBeCloseTo(17993, 1);
  });

  it("fires break-even exactly at 1R boundary (HWM = entry + 1R)", () => {
    const input = makeInput({ currentHigh: 18014, currentLow: 18008, currentHWM: null });
    const result = checkTrailStopExtended(BE_CONFIG, input);
    expect(result.breakEvenActive).toBe(true);
  });
});

describe("Tier 5.1 — break_even_at_r (shorts)", () => {
  it("fires break-even for short when profit >= 1R", () => {
    // Short: entry=18000, initial risk=14pts → 1R at price 17986
    // HWM (lowest low) = 17986 → profit = 18000-17986 = 14 ≥ 14 → BE fires
    const input = makeInput({
      side: "short",
      entryPrice: 18000,
      initialRiskPoints: 14,
      currentHigh: 17990,
      currentLow: 17986,
      currentHWM: 17986,
    });
    const result = checkTrailStopExtended(BE_CONFIG, input);
    expect(result.breakEvenActive).toBe(true);
    // BE level for short = entry - 1 tick = 17999.75
    // ATR trail = 17986 + 20 = 18006 → min(18006, 17999.75) = 17999.75
    expect(result.stopPrice).toBeCloseTo(17999.75, 2);
    expect(result.hit).toBe(false); // high=17990 < 17999.75
  });

  it("does NOT fire break-even for short when profit < 1R", () => {
    const input = makeInput({
      side: "short",
      entryPrice: 18000,
      initialRiskPoints: 14,
      currentHigh: 17990,
      currentLow: 17987,
      currentHWM: 17987,
    });
    const result = checkTrailStopExtended(BE_CONFIG, input);
    expect(result.breakEvenActive).toBe(false);
  });
});

describe("Tier 5.1 — time_decay_minutes", () => {
  it("tightens atr_multiple after time_decay_minutes", () => {
    // After 21 min: effective multiple = 2.0 * 0.75 = 1.5
    // HWM=18030, tightened trail = 18030 - 1.5*10 = 18015
    const input = makeInput({ currentHigh: 18030, currentLow: 18010, currentHWM: 18030, minutesOpen: 21 });
    const result = checkTrailStopExtended(BE_CONFIG, input);
    expect(result.timeDecayActive).toBe(true);
    expect(result.effectiveMultiple).toBeCloseTo(1.5, 2);
    expect(result.stopPrice).toBeCloseTo(18015, 1);
    // low=18010 < 18015 → hit
    expect(result.hit).toBe(true);
  });

  it("does NOT tighten before time_decay_minutes", () => {
    // At 19 min: normal 2.0 → trail = 18030 - 20 = 18010
    const input = makeInput({ currentHigh: 18030, currentLow: 18012, currentHWM: 18030, minutesOpen: 19 });
    const result = checkTrailStopExtended(BE_CONFIG, input);
    expect(result.timeDecayActive).toBe(false);
    expect(result.effectiveMultiple).toBeCloseTo(2.0, 2);
    expect(result.stopPrice).toBeCloseTo(18010, 1);
    // low=18012 > 18010 → no hit
    expect(result.hit).toBe(false);
  });

  it("tightens exactly at time_decay_minutes boundary (minutesOpen === time_decay_minutes)", () => {
    const input = makeInput({ currentHigh: 18030, currentLow: 18010, currentHWM: 18030, minutesOpen: 20 });
    const result = checkTrailStopExtended(BE_CONFIG, input);
    expect(result.timeDecayActive).toBe(true);
    expect(result.effectiveMultiple).toBeCloseTo(1.5, 2);
  });

  it("handles zero time_decay_multiplier (trail collapses to HWM)", () => {
    const zeroDecayConfig: TrailStopConfig = { ...BE_CONFIG, time_decay_multiplier: 0.0 };
    const input = makeInput({ currentHigh: 18030, currentLow: 18010, currentHWM: 18030, minutesOpen: 25 });
    const result = checkTrailStopExtended(zeroDecayConfig, input);
    expect(result.timeDecayActive).toBe(true);
    expect(result.effectiveMultiple).toBeCloseTo(0, 2);
    // Trail = HWM - 0*ATR = 18030; any bar with low < HWM hits
    expect(result.hit).toBe(true);
  });
});

describe("Tier 5.1 — Integration: NQ trade full replay", () => {
  /**
   * entry=18000, hard SL=17986 (14 pts), ATR=10, atr_multiple=2.0
   * break_even_at_r=1.0, time_decay_minutes=20, time_decay_multiplier=0.75
   *
   * Step 1 (min 5): high→18010 → profit=10 < 14 → no BE. Trail=17990. No hit.
   * Step 2 (min 8): high→18014 → profit=14 ≥ 14 → BE fires. Trail=max(17994,18000.25)=18000.25. No hit.
   * Step 3 (min 10): high→18030 → profit=30 ≥ 14 → BE active. Trail=max(18010,18000.25)=18010. No hit.
   * Step 4 (min 21): high still 18030, low=18016 → time-decay. Trail=18030-15=18015. 18016>18015 → No hit.
   * Step 5 (min 22): high=18030, low=18014 → Trail=18015. 18014<18015 → HIT.
   */

  it("Step 1: no break-even below 1R, trail at 2x ATR", () => {
    const r = checkTrailStopExtended(BE_CONFIG, makeInput({
      currentHigh: 18010, currentLow: 18005, currentHWM: null, minutesOpen: 5,
    }));
    expect(r.breakEvenActive).toBe(false);
    expect(r.timeDecayActive).toBe(false);
    expect(r.stopPrice).toBeCloseTo(17990, 1);
    expect(r.hit).toBe(false);
  });

  it("Step 2: break-even fires at 18014", () => {
    const r = checkTrailStopExtended(BE_CONFIG, makeInput({
      currentHigh: 18014, currentLow: 18005, currentHWM: 18010, minutesOpen: 8,
    }));
    expect(r.breakEvenActive).toBe(true);
    expect(r.stopPrice).toBeCloseTo(18000.25, 2);
    expect(r.hit).toBe(false);
  });

  it("Step 3: HWM=18030, ATR trail=18010 > BE level, no time-decay", () => {
    const r = checkTrailStopExtended(BE_CONFIG, makeInput({
      currentHigh: 18030, currentLow: 18015, currentHWM: 18014, minutesOpen: 10,
    }));
    expect(r.stopPrice).toBeCloseTo(18010, 1);
    expect(r.breakEvenActive).toBe(true);
    expect(r.timeDecayActive).toBe(false);
    expect(r.hit).toBe(false);
  });

  it("Step 4: time-decay fires at min 21, trail=18015, low=18016 → no hit", () => {
    const r = checkTrailStopExtended(BE_CONFIG, makeInput({
      currentHigh: 18030, currentLow: 18016, currentHWM: 18030, minutesOpen: 21,
    }));
    expect(r.timeDecayActive).toBe(true);
    expect(r.stopPrice).toBeCloseTo(18015, 1);
    expect(r.hit).toBe(false);
  });

  it("Step 5: low=18014 < 18015 → TRAIL HIT after time-decay", () => {
    const r = checkTrailStopExtended(BE_CONFIG, makeInput({
      currentHigh: 18030, currentLow: 18014, currentHWM: 18030, minutesOpen: 22,
    }));
    expect(r.timeDecayActive).toBe(true);
    expect(r.stopPrice).toBeCloseTo(18015, 1);
    expect(r.hit).toBe(true);
  });
});

describe("TICK_SIZES export", () => {
  it("has tick size for MNQ (0.25)", () => {
    expect(TICK_SIZES["MNQ"]).toBe(0.25);
  });
  it("has tick size for MES (0.25)", () => {
    expect(TICK_SIZES["MES"]).toBe(0.25);
  });
  it("has tick size for MCL (0.01)", () => {
    expect(TICK_SIZES["MCL"]).toBe(0.01);
  });
  it("unknown symbol defaults to 0.25 via ?? operator", () => {
    expect(TICK_SIZES["XYZ"] ?? 0.25).toBe(0.25);
  });
});
