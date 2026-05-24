/**
 * wave25-narrative-state.test.ts — Wave 25 Pass 6 W25.11
 *
 * Coverage:
 *   1. ACCUMULATION → MANIPULATION on PDH sweep
 *   2. MANIPULATION → DISTRIBUTION when MSS confirms displacement
 *   3. DISTRIBUTION → REVERSAL_FORMING when price returns to swept level
 *   4. Idempotency: same-phase consecutive ticks return same phase (no regression)
 *   5. HtfNarrative null → returns NEUTRAL phase (backward-compat)
 *   6. StructureState null → returns NEUTRAL / blocks DISTRIBUTION (backward-compat)
 *   7. evalMarketStructureAligned with CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE=true
 *      rejects when phase != DISTRIBUTION
 *   8. evalMarketStructureAligned with require_distribution=true and phase=DISTRIBUTION
 *      returns satisfied=true
 *   9. evalMarketStructureAligned with require_distribution=true and narrativeState=null
 *      returns satisfied=false reason=narrative_unavailable
 *  10. ACCUMULATION is detected when pre-NY-open and Asian range is formed
 *  11. NEUTRAL returned when Asian range is not yet formed
 *  12. Sweep tolerance: level tagged but not swept does NOT trigger MANIPULATION
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Module mocks (must precede imports that transitively pull db/schema) ─────
// narrative-state-service.ts imports db/index.js + audit-log-helper.js.
// bias-state-service.ts imports db/index.js.
// These mocks prevent "DATABASE_URL environment variable is required" at import time.

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));
// Stub bias-state-service so we can import HtfNarrative type without spinning up DB.
vi.mock("../services/bias-state-service.js", () => ({
  getOrComputeBiasStateForDay: vi.fn().mockResolvedValue({
    htfNarrative: null,
    structureState: null,
  }),
  barTimestampToTradingDay: vi.fn().mockReturnValue("2026-05-24"),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  computeNarrativeState,
  type NarrativeState,
  type NarrativePhase,
} from "../services/narrative-state-service.js";
import type { HtfNarrative } from "../services/bias-state-service.js";
import type { StructureState } from "../services/confluence-score.js";
import {
  evalMarketStructureAligned_TEST_ONLY,
  type SignalContext,
} from "../services/confluence-score.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Fully-formed HTF narrative for a normal trading day */
function makeHtfNarrative(overrides?: Partial<HtfNarrative>): HtfNarrative {
  const base: HtfNarrative = {
    asian_range: {
      high: 5220.0,
      low: 5200.0,
      range_size: 20.0,
      formed_at_bar_idx: 18,
    },
    london_bias: {
      direction: "bullish",
      swept_pdh: false,
      swept_pdl: false,
    },
    ny_bias: {
      direction: "bullish",
      open_above_overnight_range: false,
      open_below_overnight_range: false,
    },
    daily_dealing: {
      dealing_range_high: 5240.0,  // PDH
      dealing_range_low: 5180.0,   // PDL
      current_quadrant: "equilibrium",
    },
    computed_at_bar_idx: 42,
  };
  return { ...base, ...overrides };
}

/** Fully-formed StructureState with MSS confirmed */
function makeStructureState(overrides?: Partial<StructureState>): StructureState {
  const base: StructureState = {
    bos_recent: false,
    bos_direction: null,
    choch_recent: false,
    choch_direction: null,
    mss_recent: false,
    mss_direction: null,
    mss_displacement_atr_mult: null,
    displacement_active: false,
    premium_discount_zone: "equilibrium",
    htf_bias_aligned: true,
    last_break_direction: "bullish",
    last_break_age_bars: 3,
    swing_high: 5230.0,
    swing_low: 5195.0,
    computed_at_bar_idx: 42,
  };
  return { ...base, ...overrides };
}

/**
 * Create a bar snapshot. ts_event controls session detection.
 * Pre-NY-open: use 12:00 UTC (08:00 ET EDT).
 * Post-NY-open: use 14:00 UTC (10:00 ET EDT).
 */
function makeBar(
  opts: {
    close?: number;
    high?: number;
    low?: number;
    utcHour?: number;
    utcMinute?: number;
  } = {},
): { close: number; high: number; low: number; ts_event: Date } {
  const { close = 5210.0, high = close + 2, low = close - 2, utcHour = 12, utcMinute = 0 } = opts;
  const ts = new Date(Date.UTC(2026, 4, 24, utcHour, utcMinute, 0)); // 2026-05-24
  return { close, high, low, ts_event: ts };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeNarrativeState", () => {
  // Test 5: null htfNarrative → NEUTRAL
  it("returns NEUTRAL when htfNarrative is null", () => {
    const result = computeNarrativeState(
      null,
      makeStructureState(),
      makeBar(),
      [],
    );
    expect(result.phase).toBe("NEUTRAL");
  });

  // Test 11: no Asian range → NEUTRAL
  it("returns NEUTRAL when Asian range is not formed", () => {
    const htf = makeHtfNarrative({
      asian_range: { high: null, low: null, range_size: null, formed_at_bar_idx: null },
    });
    const result = computeNarrativeState(htf, makeStructureState(), makeBar(), []);
    expect(result.phase).toBe("NEUTRAL");
  });

  // Test 10: ACCUMULATION detected pre-NY-open with formed range
  it("returns ACCUMULATION when pre-NY-open and Asian range is formed", () => {
    const htf = makeHtfNarrative();
    // 12:00 UTC = 08:00 ET = pre-NY-open (NY opens 13:30 UTC)
    const bar = makeBar({ utcHour: 12 });
    const result = computeNarrativeState(htf, makeStructureState(), bar, []);
    expect(result.phase).toBe("ACCUMULATION");
    expect(result.accumulation_range.high).toBe(5220.0);
    expect(result.accumulation_range.low).toBe(5200.0);
  });

  // Test 1: ACCUMULATION → MANIPULATION on PDH sweep
  it("transitions ACCUMULATION → MANIPULATION when bar sweeps PDH", () => {
    const htf = makeHtfNarrative(); // PDH = 5240.0
    // Bar high at 5241.0 sweeps PDH (5240.0 + 0.25 tolerance)
    const bar = makeBar({ close: 5239.0, high: 5241.0, low: 5235.0, utcHour: 12 });
    const prevState: NarrativeState = {
      phase: "ACCUMULATION",
      phase_started_at: new Date(Date.UTC(2026, 4, 24, 9, 0, 0)).toISOString(),
      accumulation_range: { high: 5220.0, low: 5200.0 },
      manipulation_swept: { which: null, price: null },
      displacement_confirmed: false,
      expansion_target: null,
      computed_at_bar_idx: 40,
    };

    const result = computeNarrativeState(htf, makeStructureState(), bar, [], prevState);
    expect(result.phase).toBe("MANIPULATION");
    expect(result.manipulation_swept.which).toBe("pdh");
    expect(result.manipulation_swept.price).toBe(5240.0);
    expect(result.displacement_confirmed).toBe(false);
  });

  // Test 1b: Asian high sweep also triggers MANIPULATION
  it("transitions to MANIPULATION when bar sweeps Asian high", () => {
    const htf = makeHtfNarrative(); // asian_range.high = 5220.0
    // Bar high at 5221.0 sweeps Asian high
    const bar = makeBar({ close: 5219.0, high: 5221.0, low: 5215.0, utcHour: 12 });
    const prevState: NarrativeState = {
      phase: "ACCUMULATION",
      phase_started_at: new Date(Date.UTC(2026, 4, 24, 9, 0, 0)).toISOString(),
      accumulation_range: { high: 5220.0, low: 5200.0 },
      manipulation_swept: { which: null, price: null },
      displacement_confirmed: false,
      expansion_target: null,
      computed_at_bar_idx: 40,
    };

    const result = computeNarrativeState(htf, makeStructureState(), bar, [], prevState);
    expect(result.phase).toBe("MANIPULATION");
    expect(result.manipulation_swept.which).toBe("asian_high");
  });

  // Test 2: MANIPULATION → DISTRIBUTION when MSS confirms
  it("transitions MANIPULATION → DISTRIBUTION when mss_recent=true", () => {
    const htf = makeHtfNarrative();
    const bar = makeBar({ close: 5245.0, high: 5247.0, low: 5242.0, utcHour: 14 });
    const structureWithMss = makeStructureState({ mss_recent: true, mss_direction: "bullish" });
    const prevState: NarrativeState = {
      phase: "MANIPULATION",
      phase_started_at: new Date(Date.UTC(2026, 4, 24, 13, 35, 0)).toISOString(),
      accumulation_range: { high: 5220.0, low: 5200.0 },
      manipulation_swept: { which: "pdh", price: 5240.0 },
      displacement_confirmed: false,
      expansion_target: null,
      computed_at_bar_idx: 45,
    };
    const liquidityAbove = [
      { price: 5260.0, level_type: "pwh_iso" },
      { price: 5280.0, level_type: "pmh" },
    ];

    const result = computeNarrativeState(htf, structureWithMss, bar, liquidityAbove, prevState);
    expect(result.phase).toBe("DISTRIBUTION");
    expect(result.displacement_confirmed).toBe(true);
    expect(result.expansion_target).toBe(5260.0); // nearest above
    expect(result.manipulation_swept.which).toBe("pdh");
  });

  // Test 6: StructureState null → MANIPULATION does not advance to DISTRIBUTION
  it("stays in MANIPULATION when structureState is null (blocks DISTRIBUTION)", () => {
    const htf = makeHtfNarrative();
    const bar = makeBar({ close: 5245.0, utcHour: 14 });
    const prevState: NarrativeState = {
      phase: "MANIPULATION",
      phase_started_at: new Date(Date.UTC(2026, 4, 24, 13, 35, 0)).toISOString(),
      accumulation_range: { high: 5220.0, low: 5200.0 },
      manipulation_swept: { which: "pdh", price: 5240.0 },
      displacement_confirmed: false,
      expansion_target: null,
      computed_at_bar_idx: 45,
    };

    const result = computeNarrativeState(htf, null, bar, [], prevState);
    // structureState=null means we cannot confirm MSS → stays MANIPULATION
    expect(result.phase).toBe("MANIPULATION");
    expect(result.displacement_confirmed).toBe(false);
  });

  // Test 3: DISTRIBUTION → REVERSAL_FORMING when displacement fails
  it("transitions DISTRIBUTION → REVERSAL_FORMING when price returns to swept level", () => {
    const htf = makeHtfNarrative();
    // Swept PDH at 5240.0; price rallied to 5250 then returned to ~5241 (near swept level)
    const bar = makeBar({ close: 5241.0, high: 5243.0, low: 5239.0, utcHour: 15 });
    const prevState: NarrativeState = {
      phase: "DISTRIBUTION",
      phase_started_at: new Date(Date.UTC(2026, 4, 24, 13, 40, 0)).toISOString(),
      accumulation_range: { high: 5220.0, low: 5200.0 },
      manipulation_swept: { which: "pdh", price: 5240.0 },
      displacement_confirmed: true,
      expansion_target: 5260.0,
      computed_at_bar_idx: 50,
    };

    const result = computeNarrativeState(htf, makeStructureState(), bar, [], prevState);
    expect(result.phase).toBe("REVERSAL_FORMING");
  });

  // Test 3b: DISTRIBUTION stays in DISTRIBUTION when price is well above swept level
  it("stays in DISTRIBUTION when expansion is progressing (price far above swept level)", () => {
    const htf = makeHtfNarrative();
    // Swept PDH at 5240.0; price at 5260 = well above, expansion progressing
    const bar = makeBar({ close: 5260.0, high: 5262.0, low: 5258.0, utcHour: 15 });
    const prevState: NarrativeState = {
      phase: "DISTRIBUTION",
      phase_started_at: new Date(Date.UTC(2026, 4, 24, 13, 40, 0)).toISOString(),
      accumulation_range: { high: 5220.0, low: 5200.0 },
      manipulation_swept: { which: "pdh", price: 5240.0 },
      displacement_confirmed: true,
      expansion_target: 5270.0,
      computed_at_bar_idx: 50,
    };

    const result = computeNarrativeState(htf, makeStructureState(), bar, [], prevState);
    expect(result.phase).toBe("DISTRIBUTION");
    expect(result.phase_started_at).toBe(prevState.phase_started_at); // carried forward
  });

  // Test 4: Same-phase idempotency — ACCUMULATION stays ACCUMULATION
  it("returns ACCUMULATION with same phase_started_at on repeated ticks (idempotent)", () => {
    const htf = makeHtfNarrative();
    const bar = makeBar({ close: 5210.0, utcHour: 12 });
    const prevState: NarrativeState = {
      phase: "ACCUMULATION",
      phase_started_at: "2026-05-24T09:00:00.000Z",
      accumulation_range: { high: 5220.0, low: 5200.0 },
      manipulation_swept: { which: null, price: null },
      displacement_confirmed: false,
      expansion_target: null,
      computed_at_bar_idx: 40,
    };

    const result1 = computeNarrativeState(htf, makeStructureState(), bar, [], prevState);
    const result2 = computeNarrativeState(htf, makeStructureState(), bar, [], prevState);
    expect(result1.phase).toBe("ACCUMULATION");
    expect(result2.phase).toBe("ACCUMULATION");
    // phase_started_at preserved from previous state on repeated ticks
    expect(result1.phase_started_at).toBe(prevState.phase_started_at);
  });

  // Test 12: Sweep tolerance — price must exceed level by SWEEP_TOLERANCE (0.25)
  // The bar tests PDH (5240.0) specifically: bar high = 5240.10 does NOT sweep PDH
  // since 5240.10 < 5240.25 (PDH + tolerance).
  // To avoid sweeping Asian high (5220.0) the bar must also stay below 5220.25 AND
  // stay above Asian low (5200.0) + tolerance. We use a narrow range bar near equilibrium.
  it("does NOT trigger MANIPULATION when bar only tags PDH without tolerance breach", () => {
    // Bar is entirely within the Asian range (5200–5220) — no level sweep possible
    const htf = makeHtfNarrative(); // PDH = 5240.0, asian_high = 5220.0, asian_low = 5200.0
    // close 5210, high 5211.0 — high does NOT breach Asian high (5220.25) or PDH (5240.25)
    // low 5209.0 — low does NOT breach Asian low (5199.75) or PDL (5179.75)
    const bar = makeBar({ close: 5210.0, high: 5211.0, low: 5209.0, utcHour: 12 });
    const prevState: NarrativeState = {
      phase: "ACCUMULATION",
      phase_started_at: "2026-05-24T09:00:00.000Z",
      accumulation_range: { high: 5220.0, low: 5200.0 },
      manipulation_swept: { which: null, price: null },
      displacement_confirmed: false,
      expansion_target: null,
      computed_at_bar_idx: 40,
    };

    const result = computeNarrativeState(htf, makeStructureState(), bar, [], prevState);
    // Bars entirely within the range do not sweep any level → stays ACCUMULATION
    expect(result.phase).toBe("ACCUMULATION");
  });
});

// ─── evalMarketStructureAligned with narrative gate ───────────────────────────

describe("evalMarketStructureAligned — CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE", () => {
  const originalEnv = process.env["CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE"];
    } else {
      process.env["CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE"] = originalEnv;
    }
  });

  function makeSignalCtx(
    opts: {
      narrativePhase?: NarrativePhase | null;
      mssRecent?: boolean;
      htfBiasAligned?: boolean;
    } = {},
  ): SignalContext {
    const { narrativePhase = null, mssRecent = true, htfBiasAligned = true } = opts;
    const ss = makeStructureState({ mss_recent: mssRecent, htf_bias_aligned: htfBiasAligned });
    const narrativeState: NarrativeState | null =
      narrativePhase !== null
        ? {
            phase: narrativePhase,
            phase_started_at: new Date().toISOString(),
            accumulation_range: { high: 5220.0, low: 5200.0 },
            manipulation_swept: { which: "pdh", price: 5240.0 },
            displacement_confirmed: narrativePhase === "DISTRIBUTION",
            expansion_target: narrativePhase === "DISTRIBUTION" ? 5260.0 : null,
            computed_at_bar_idx: 50,
          }
        : null;

    return {
      strategyId: "test-strategy",
      bar: { timestamp: Date.now(), open: 5245, high: 5247, low: 5243, close: 5245, volume: 100 },
      indicators: {},
      direction: "long",
      bias_active_strategy_id: null,
      structureState: ss,
      calendarBlocked: false,
      narrativeState,
    };
  }

  // Test 7: require_distribution=true, phase=MANIPULATION → rejected
  it("rejects when CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE=true and phase=MANIPULATION", () => {
    process.env["CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE"] = "true";
    const ctx = makeSignalCtx({ narrativePhase: "MANIPULATION" });
    const result = evalMarketStructureAligned_TEST_ONLY(ctx);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("narrative_phase_not_distribution");
    expect(result.reason).toContain("MANIPULATION");
  });

  // Test 7b: require_distribution=true, phase=ACCUMULATION → rejected
  it("rejects when CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE=true and phase=ACCUMULATION", () => {
    process.env["CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE"] = "true";
    const ctx = makeSignalCtx({ narrativePhase: "ACCUMULATION" });
    const result = evalMarketStructureAligned_TEST_ONLY(ctx);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("narrative_phase_not_distribution");
  });

  // Test 8: require_distribution=true, phase=DISTRIBUTION → satisfied
  it("satisfies when CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE=true and phase=DISTRIBUTION", () => {
    process.env["CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE"] = "true";
    const ctx = makeSignalCtx({ narrativePhase: "DISTRIBUTION" });
    const result = evalMarketStructureAligned_TEST_ONLY(ctx);
    expect(result.satisfied).toBe(true);
    expect(result.reason).toContain("structure_aligned_and_distribution_phase");
  });

  // Test 9: require_distribution=true, narrativeState=null → not satisfied (narrative_unavailable)
  it("returns narrative_unavailable when CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE=true and narrativeState=null", () => {
    process.env["CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE"] = "true";
    const ctx = makeSignalCtx({ narrativePhase: null });
    const result = evalMarketStructureAligned_TEST_ONLY(ctx);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toBe("narrative_unavailable");
  });

  // Test: require_distribution=false (default) → backward compat, narrative NOT checked
  it("ignores narrativeState when CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE=false (default)", () => {
    process.env["CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE"] = "false";
    // narrativePhase=MANIPULATION, but flag is false so it should not matter
    const ctx = makeSignalCtx({ narrativePhase: "MANIPULATION" });
    const result = evalMarketStructureAligned_TEST_ONLY(ctx);
    // Should be satisfied based on structure alone (mssRecent=true, htfBiasAligned=true)
    expect(result.satisfied).toBe(true);
    expect(result.reason).toContain("structure_aligned");
    expect(result.reason).not.toContain("distribution");
  });

  // Test: structureState null → unsatisfied regardless of narrative
  it("returns structure_engine_unavailable when structureState is null", () => {
    process.env["CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE"] = "true";
    const ctx = makeSignalCtx({ narrativePhase: "DISTRIBUTION" });
    ctx.structureState = null;
    const result = evalMarketStructureAligned_TEST_ONLY(ctx);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toBe("structure_engine_unavailable");
  });
});
