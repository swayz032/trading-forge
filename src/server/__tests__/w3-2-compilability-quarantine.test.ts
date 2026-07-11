/**
 * W3.2 — Fail-Closed Extraction Quarantine + Deterministic Identity
 *
 * Tests cover four requirements:
 *
 * 1. COLLISION FIX: Two different videos with concept_name "extracted_strategy"
 *    → DIFFERENT quarantine fingerprints (the shared-bucket collision is dead).
 *
 * 2. COVERAGE_FAILED → quarantined (checkCompilabilityGate + extraction.quarantined path).
 *
 * 3. Real compilable + covered extraction → passes compilability gate.
 *
 * 4. Null entry signal (missing entry_indicator + archetype) → quarantined.
 *
 * All tests are pure-function / deterministic. No DB. No network. No LLM.
 */

import { describe, it, expect } from "vitest";
import {
  checkCompilabilityGate,
  PLACEHOLDER_CONCEPT_NAMES,
  type CompilabilityInput,
} from "../lib/extraction-quality-gate.js";
import {
  computeQuarantineFingerprintHash,
  computeConceptFingerprintHash,
  extractVideoId,
} from "../services/strategy-fingerprint.js";

// ─── 1. Collision fix — two failed videos → different fingerprints ───────────

describe("computeQuarantineFingerprintHash — collision fix", () => {
  const FAILED_CONCEPT = "extracted_strategy";

  it("two different YouTube videos with placeholder concept_name → DIFFERENT fingerprints", () => {
    // This is the exact collision that was occurring in production:
    // gemma4:e2b fails to name a strategy → defaults to "extracted_strategy"
    // → all failures shared sha256("extracted") → same bucket c25828a8
    //
    // With quarantine fingerprint, each video gets a unique hash.
    const hashVideoA = computeQuarantineFingerprintHash({
      concept_name: FAILED_CONCEPT,
      source_url: "https://www.youtube.com/watch?v=SY2jXlW9bt4",
    });
    const hashVideoB = computeQuarantineFingerprintHash({
      concept_name: FAILED_CONCEPT,
      source_url: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
    });

    expect(hashVideoA).not.toBe(hashVideoB);
    expect(hashVideoA).toHaveLength(32); // 128-bit SHA-256 hex slice
    expect(hashVideoB).toHaveLength(32);
  });

  it("same video + same concept → same fingerprint (deterministic)", () => {
    const h1 = computeQuarantineFingerprintHash({
      concept_name: FAILED_CONCEPT,
      source_url: "https://www.youtube.com/watch?v=SY2jXlW9bt4",
    });
    const h2 = computeQuarantineFingerprintHash({
      concept_name: FAILED_CONCEPT,
      source_url: "https://www.youtube.com/watch?v=SY2jXlW9bt4",
    });
    expect(h1).toBe(h2);
  });

  it("real named concept keeps using computeConceptFingerprintHash (cross-source convergence preserved)", () => {
    // Real strategies must still converge across sources.
    // "Opening Range Breakout" from YouTube and from a web article → same bucket.
    const hashFromYT = computeConceptFingerprintHash({
      market: "MES",
      concept_name: "Opening Range Breakout",
    });
    const hashFromWeb = computeConceptFingerprintHash({
      market: "MES",
      concept_name: "orb_opening_range_breakout_strategy",
    });
    // canonicalConceptName expands ORB abbrev + strips stopwords → same canonical
    expect(hashFromYT).toBe(hashFromWeb);
    expect(hashFromYT).toHaveLength(32);
  });

  it("quarantine fingerprint is NOT equal to concept fingerprint for same name", () => {
    // The quarantine namespace 'quarantine:' ensures no overlap with production bucket hashes.
    const quarantineHash = computeQuarantineFingerprintHash({
      concept_name: "extracted_strategy",
      source_url: "https://www.youtube.com/watch?v=SY2jXlW9bt4",
    });
    const bucketHash = computeConceptFingerprintHash({
      market: "MES",
      concept_name: "extracted_strategy",
    });
    expect(quarantineHash).not.toBe(bucketHash);
  });

  it("extracts YouTube video_id correctly from standard URLs", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=SY2jXlW9bt4")).toBe("SY2jXlW9bt4");
    expect(extractVideoId("https://youtu.be/SY2jXlW9bt4")).toBe("SY2jXlW9bt4");
    expect(extractVideoId("https://www.youtube.com/embed/SY2jXlW9bt4")).toBe("SY2jXlW9bt4");
    expect(extractVideoId("https://example.com/article")).toBeNull();
    expect(extractVideoId(null)).toBeNull();
  });
});

// ─── 2. coverage_failed → quarantined ────────────────────────────────────────

describe("checkCompilabilityGate — coverage_failed path", () => {
  it("coverage_failed → compilable=false, missing includes 'coverage_failed'", () => {
    const input: CompilabilityInput = {
      entry_indicator: "ema_crossover",
      archetype: null,
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "long",
      timeframe: "5m",
      confluence_factors: ["ema_cross_above", "volume_spike"],
      coverage_verdict: { verdict: "coverage_failed" },
    };
    const result = checkCompilabilityGate(input, "ema_crossover_setup");

    expect(result.compilable).toBe(false);
    expect(result.missing).toContain("coverage_failed");
    expect(result.reason).not.toBeNull();
  });

  it("coverage pass → does not add 'coverage_failed' to missing", () => {
    const input: CompilabilityInput = {
      entry_indicator: "ema_crossover",
      archetype: null,
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "long",
      timeframe: "5m",
      confluence_factors: ["ema_cross_above", "volume_spike"],
      coverage_verdict: { verdict: "pass" },
    };
    const result = checkCompilabilityGate(input, "ema_crossover_setup");

    expect(result.missing).not.toContain("coverage_failed");
  });

  it("null coverage_verdict → does not quarantine on coverage (gate not run)", () => {
    const input: CompilabilityInput = {
      entry_indicator: "ema_crossover",
      archetype: null,
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "long",
      timeframe: "5m",
      confluence_factors: ["ema_cross_above"],
      coverage_verdict: null,
    };
    const result = checkCompilabilityGate(input, "ema_crossover_setup");

    expect(result.missing).not.toContain("coverage_failed");
    expect(result.compilable).toBe(true);
  });
});

// ─── 3. Real compilable extraction → passes gate ──────────────────────────────

describe("checkCompilabilityGate — real compilable extraction", () => {
  it("fully populated extraction with archetype → compilable=true", () => {
    const input: CompilabilityInput = {
      entry_indicator: null,
      archetype: "ict_silver_bullet_ny_am",
      entry_params: { killzone_start: 10, killzone_end: 11 },
      direction: "both",
      timeframe: "1m",
      confluence_factors: ["fvg_present", "mss_confirmed", "htf_bias_bullish"],
      coverage_verdict: { verdict: "pass" },
    };
    const result = checkCompilabilityGate(input, "silver_bullet_ny_am_ict");

    expect(result.compilable).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.reason).toBeNull();
  });

  it("fully populated parametric extraction → compilable=true", () => {
    const input: CompilabilityInput = {
      entry_indicator: "rsi_reversal",
      archetype: null,
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      direction: "long",
      timeframe: "15m",
      confluence_factors: ["rsi_oversold", "price_at_support"],
      coverage_verdict: { verdict: "pass" },
    };
    const result = checkCompilabilityGate(input, "rsi_reversal_bounce");

    expect(result.compilable).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("passes even with single confluence factor (≥1 is enough)", () => {
    const input: CompilabilityInput = {
      entry_indicator: "bollinger_breakout",
      archetype: null,
      entry_params: { period: 20, std_dev: 2.0 },
      direction: "short",
      timeframe: "5m",
      confluence_factors: ["price_above_bb_upper"],
      coverage_verdict: { verdict: "pass" },
    };
    const result = checkCompilabilityGate(input, "bollinger_breakout_short");

    expect(result.compilable).toBe(true);
  });
});

// ─── 4. Null / missing entry signal → quarantined ─────────────────────────────

describe("checkCompilabilityGate — null entry signal", () => {
  it("both entry_indicator and archetype null → quarantined", () => {
    const input: CompilabilityInput = {
      entry_indicator: null,
      archetype: null,
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "long",
      timeframe: "5m",
      confluence_factors: ["volume_spike"],
      coverage_verdict: { verdict: "pass" },
    };
    const result = checkCompilabilityGate(input, "some_concept");

    expect(result.compilable).toBe(false);
    expect(result.missing).toContain("missing_entry_indicator_or_archetype");
  });

  it("both entry_indicator and archetype empty strings → quarantined", () => {
    const input: CompilabilityInput = {
      entry_indicator: "",
      archetype: "  ",
      entry_params: { period: 14 },
      direction: "long",
      timeframe: "5m",
      confluence_factors: ["some_factor"],
      coverage_verdict: null,
    };
    const result = checkCompilabilityGate(input, "some_concept");

    expect(result.compilable).toBe(false);
    expect(result.missing).toContain("missing_entry_indicator_or_archetype");
  });

  // 2026-06-24 Layer 1: a PARAMETRIC indicator (ema_crossover ∉ archetype registry) with no
  // params and no condition carries no deterministic trigger → null_entry_trigger. (Replaces the
  // pre-FIX-7 "empty_entry_params" code — same condition, unified code.)
  it("parametric indicator + empty entry_params (no condition) → quarantined (params_required)", () => {
    const input: CompilabilityInput = {
      entry_indicator: "ema_crossover",
      archetype: null,
      entry_params: {},
      direction: "long",
      timeframe: "5m",
      confluence_factors: ["ema_cross_above"],
      coverage_verdict: null,
    };
    const result = checkCompilabilityGate(input, "ema_concept");

    expect(result.compilable).toBe(false);
    expect(result.missing).toContain("params_required"); // parametric indicator, no params
  });

  it("parametric indicator + null entry_params (no condition) → quarantined (params_required)", () => {
    const input: CompilabilityInput = {
      entry_indicator: "ema_crossover",
      archetype: null,
      entry_params: null,
      direction: "long",
      timeframe: "5m",
      confluence_factors: ["ema_cross_above"],
      coverage_verdict: null,
    };
    const result = checkCompilabilityGate(input, "ema_concept");

    expect(result.compilable).toBe(false);
    expect(result.missing).toContain("params_required");
  });

  // ─── 2026-06-24 Layer 1/2 — the blind-reconstruction finding, locked as tests ───────
  // The exact production hole: a concept-name ECHO entry_indicator that resolves to NO engine
  // archetype, shipping with null entry_condition/type + empty params, was passing compilable=true.
  // In production the caller passes resolved_entry_indicator = "uncatalogued:<echo>" → the gate
  // emits the precise reason `uncatalogued_indicator` (Layer 2 reason enum for Layer 3 histograms).
  it("CONCEPT-ECHO resolving to uncatalogued + null trigger fields → uncatalogued_indicator (the SY2/iU8/gdd/W7nln hole)", () => {
    for (const echo of [
      "impulse_range_sweep_4h_5m",
      "overnight_high_low_retest_5m",
      "4h_candle_box_continuation",
      "moving_average_trend_following_20_200",
    ]) {
      const input: CompilabilityInput = {
        entry_indicator: echo,
        archetype: null,
        entry_params: {},
        entry_condition: null,
        entry_type: null,
        resolved_entry_indicator: `uncatalogued:${echo}`,
        direction: "both",
        timeframe: "5m",
        confluence_factors: ["market_structure_aligned"],
        coverage_verdict: { verdict: "pass" },
      };
      const result = checkCompilabilityGate(input, echo);
      expect(result.compilable, `${echo} must NOT be compilable`).toBe(false);
      expect(result.missing, `${echo} must report uncatalogued_indicator`).toContain("uncatalogued_indicator");
    }
  });

  it("REAL registered archetype + empty params → compilable (FIX 7's legit case preserved)", () => {
    const input: CompilabilityInput = {
      entry_indicator: "order_block",
      archetype: null,
      entry_params: {},
      entry_condition: null,
      direction: "both",
      timeframe: "5m",
      confluence_factors: ["fvg_present"],
      coverage_verdict: { verdict: "pass" },
    };
    const result = checkCompilabilityGate(input, "order_block_retest");
    expect(result.compilable).toBe(true);
    expect(result.missing).not.toContain("params_required");
    expect(result.missing).not.toContain("uncatalogued_indicator");
    expect(result.missing).not.toContain("no_trigger");
  });

  it("archetype:-prefixed registered archetype + empty params → compilable", () => {
    const input: CompilabilityInput = {
      entry_indicator: "archetype:gann_box_4h_continuation",
      archetype: null,
      entry_params: {},
      direction: "both",
      timeframe: "4h",
      confluence_factors: ["fib_zone"],
      coverage_verdict: { verdict: "pass" },
    };
    const result = checkCompilabilityGate(input, "gann_box_4h_continuation");
    expect(result.compilable).toBe(true);
  });

  it("concept-echo + explicit entry_condition (no archetype/params) → compilable", () => {
    const input: CompilabilityInput = {
      entry_indicator: "overnight_high_low_retest_5m",
      archetype: null,
      entry_params: {},
      entry_condition: "close > overnight_high AND retest_holds",
      direction: "long",
      timeframe: "5m",
      confluence_factors: ["volume_spike"],
      coverage_verdict: { verdict: "pass" },
    };
    const result = checkCompilabilityGate(input, "overnight_retest");
    expect(result.compilable).toBe(true);
  });

  it("missing direction → quarantined", () => {
    const input: CompilabilityInput = {
      entry_indicator: "rsi_reversal",
      archetype: null,
      entry_params: { period: 14 },
      direction: null,
      timeframe: "15m",
      confluence_factors: ["rsi_oversold"],
      coverage_verdict: null,
    };
    const result = checkCompilabilityGate(input, "rsi_bounce");

    expect(result.compilable).toBe(false);
    expect(result.missing).toContain("missing_direction");
  });

  it("missing timeframe → quarantined", () => {
    const input: CompilabilityInput = {
      entry_indicator: "rsi_reversal",
      archetype: null,
      entry_params: { period: 14 },
      direction: "long",
      timeframe: null,
      confluence_factors: ["rsi_oversold"],
      coverage_verdict: null,
    };
    const result = checkCompilabilityGate(input, "rsi_bounce");

    expect(result.compilable).toBe(false);
    expect(result.missing).toContain("missing_timeframe");
  });

  it("no confluence factors → quarantined", () => {
    const input: CompilabilityInput = {
      entry_indicator: "rsi_reversal",
      archetype: null,
      entry_params: { period: 14 },
      direction: "long",
      timeframe: "15m",
      confluence_factors: [],
      coverage_verdict: null,
    };
    const result = checkCompilabilityGate(input, "rsi_bounce");

    expect(result.compilable).toBe(false);
    expect(result.missing).toContain("no_real_confluence_factors");
  });

  it("null confluence_factors → quarantined", () => {
    const input: CompilabilityInput = {
      entry_indicator: "rsi_reversal",
      archetype: null,
      entry_params: { period: 14 },
      direction: "long",
      timeframe: "15m",
      confluence_factors: null,
      coverage_verdict: null,
    };
    const result = checkCompilabilityGate(input, "rsi_bounce");

    expect(result.compilable).toBe(false);
    expect(result.missing).toContain("no_real_confluence_factors");
  });
});

// ─── 5. Placeholder concept_name → quarantined ───────────────────────────────

describe("checkCompilabilityGate — placeholder concept_name sentinel", () => {
  const GOOD_INPUT: CompilabilityInput = {
    entry_indicator: "ema_crossover",
    archetype: null,
    entry_params: { fast_period: 9, slow_period: 21 },
    direction: "long",
    timeframe: "5m",
    confluence_factors: ["ema_cross", "volume"],
    coverage_verdict: { verdict: "pass" },
  };

  it.each([...PLACEHOLDER_CONCEPT_NAMES])(
    "concept_name '%s' → quarantined (placeholder_concept_name)",
    (placeholder) => {
      const result = checkCompilabilityGate(GOOD_INPUT, placeholder);
      expect(result.compilable).toBe(false);
      expect(result.missing).toContain("placeholder_concept_name");
    },
  );

  it("real concept_name → not quarantined on placeholder gate", () => {
    const result = checkCompilabilityGate(GOOD_INPUT, "ema_crossover_9_21_pullback");
    expect(result.missing).not.toContain("placeholder_concept_name");
  });

  it("multiple failures accumulated — all reported in missing[]", () => {
    // Worst-case: gemma totally failed — placeholder name + no indicator + no params
    const input: CompilabilityInput = {
      entry_indicator: null,
      archetype: null,
      entry_params: null,
      direction: null,
      timeframe: null,
      confluence_factors: null,
      coverage_verdict: { verdict: "coverage_failed" },
    };
    const result = checkCompilabilityGate(input, "extracted_strategy");

    expect(result.compilable).toBe(false);
    expect(result.missing).toContain("placeholder_concept_name");
    expect(result.missing).toContain("missing_entry_indicator_or_archetype");
    expect(result.missing).toContain("no_trigger"); // nothing resolves: no indicator/archetype/params/condition
    expect(result.missing).toContain("missing_direction");
    expect(result.missing).toContain("missing_timeframe");
    expect(result.missing).toContain("no_real_confluence_factors");
    expect(result.missing).toContain("coverage_failed");
    expect(result.missing).toHaveLength(7);
  });
});
