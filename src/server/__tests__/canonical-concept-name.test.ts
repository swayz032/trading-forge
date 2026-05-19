/**
 * Canonical Concept Name Tests — Pass 20 Track M
 *
 * Tests canonicalConceptName() from strategy-fingerprint.ts.
 * Pure function — no DB, no network.
 *
 * Core correctness goal: the 4 organic ORB bucket variants that fragmented
 * in 5R execution 21995 all produce the identical canonical string, so
 * 5P/5Q YouTube/Reddit mentions converge with 5R web mentions for graduation.
 *
 * 14 tests:
 *  1.  ORB 4-variant collapse (the bug this track fixes)
 *  2.  Abbreviation expansion: orb → opening_range_breakout tokens
 *  3.  Abbreviation expansion: open → opening (open_range_breakout synonymous)
 *  4.  Abbreviation expansion: fvg → fair_value_gap
 *  5.  Abbreviation expansion: sma → simple_moving_average
 *  6.  Abbreviation expansion: ema → exponential_moving_average
 *  7.  Abbreviation expansion: bb → bollinger_band
 *  8.  Stopword suffix strip: _strategy, _setup, _pattern, _system, _method
 *  9.  Stopword prefix strip: the_, a_, an_
 *  10. Token-sort + dedupe: identical tokens after expansion collapsed
 *  11. VWAP is idempotent (no expansion, no disruption)
 *  12. 60-char cap: long names truncated at token boundary
 *  13. Empty string → empty string
 *  14. computeConceptFingerprintHash: same bucket_hash for all 4 ORB variants
 */

import { describe, it, expect } from "vitest";
import {
  canonicalConceptName,
  computeConceptFingerprintHash,
} from "../services/strategy-fingerprint.js";

// ─── Test 1: The primary bug — 4 ORB variants must all collapse ───────────────

describe("canonicalConceptName — ORB 4-variant collapse (Track M primary fix)", () => {
  it("all 4 organic ORB variants produce identical canonical string", () => {
    const v1 = canonicalConceptName("opening_range_breakout");
    const v2 = canonicalConceptName("opening_range_breakout_orb");
    const v3 = canonicalConceptName("orb_open_range_breakout");
    const v4 = canonicalConceptName("opening_range_breakout_orb_strategy");

    // All must be the same value
    expect(v1).toBe(v2);
    expect(v2).toBe(v3);
    expect(v3).toBe(v4);

    // And the specific canonical form is token-sorted
    expect(v1).toBe("breakout_opening_range");
  });

  it("canonical form is breakout_opening_range (tokens sorted alphabetically)", () => {
    expect(canonicalConceptName("opening_range_breakout")).toBe("breakout_opening_range");
  });
});

// ─── Test 2-3: Abbreviation expansion ────────────────────────────────────────

describe("canonicalConceptName — abbreviation expansion", () => {
  it("orb expands to opening_range_breakout tokens", () => {
    expect(canonicalConceptName("orb")).toBe("breakout_opening_range");
  });

  it("open maps to opening so open_range_breakout synonymous with opening_range_breakout", () => {
    const a = canonicalConceptName("open_range_breakout");
    const b = canonicalConceptName("opening_range_breakout");
    expect(a).toBe(b);
    expect(a).toBe("breakout_opening_range");
  });

  it("fvg expands to fair_value_gap tokens", () => {
    expect(canonicalConceptName("fvg")).toBe("fair_gap_value");
  });

  it("ICT FVG and ict_fair_value_gap converge", () => {
    const a = canonicalConceptName("ict_fvg");
    const b = canonicalConceptName("ict_fair_value_gap");
    expect(a).toBe(b);
  });

  it("sma expands to simple_moving_average tokens", () => {
    expect(canonicalConceptName("sma")).toBe("average_moving_simple");
  });

  it("ema expands to exponential_moving_average tokens", () => {
    expect(canonicalConceptName("ema")).toBe("average_exponential_moving");
  });

  it("bb expands to bollinger_band tokens", () => {
    expect(canonicalConceptName("bb")).toBe("band_bollinger");
  });
});

// ─── Test 4: Stopword stripping ───────────────────────────────────────────────

describe("canonicalConceptName — stopword suffix/prefix stripping", () => {
  it("strips _strategy suffix", () => {
    const withSuffix    = canonicalConceptName("opening_range_breakout_strategy");
    const withoutSuffix = canonicalConceptName("opening_range_breakout");
    expect(withSuffix).toBe(withoutSuffix);
  });

  it("strips _setup suffix", () => {
    const a = canonicalConceptName("vwap_reversal_setup");
    const b = canonicalConceptName("vwap_reversal");
    expect(a).toBe(b);
  });

  it("strips _pattern suffix", () => {
    const a = canonicalConceptName("ict_fvg_pattern");
    const b = canonicalConceptName("ict_fvg");
    expect(a).toBe(b);
  });

  it("strips _system, _method, _approach, _technique, _play suffixes", () => {
    const base = canonicalConceptName("vwap_reversal");
    expect(canonicalConceptName("vwap_reversal_system")).toBe(base);
    expect(canonicalConceptName("vwap_reversal_method")).toBe(base);
    expect(canonicalConceptName("vwap_reversal_approach")).toBe(base);
    expect(canonicalConceptName("vwap_reversal_technique")).toBe(base);
    expect(canonicalConceptName("vwap_reversal_play")).toBe(base);
  });

  it("strips the_ prefix", () => {
    const a = canonicalConceptName("the_opening_range_breakout");
    const b = canonicalConceptName("opening_range_breakout");
    expect(a).toBe(b);
  });

  it("strips a_ and an_ prefixes", () => {
    const base = canonicalConceptName("opening_range_breakout");
    expect(canonicalConceptName("a_opening_range_breakout")).toBe(base);
    expect(canonicalConceptName("an_opening_range_breakout")).toBe(base);
  });
});

// ─── Test 5: VWAP idempotency ─────────────────────────────────────────────────

describe("canonicalConceptName — canonical abbreviations are idempotent", () => {
  it("vwap is already canonical — no expansion, tokens just sorted", () => {
    // "vwap_pullback" → tokens [vwap, pullback] → sorted [pullback, vwap]
    expect(canonicalConceptName("vwap_pullback")).toBe("pullback_vwap");
    // Calling again on the canonical form is idempotent
    expect(canonicalConceptName("pullback_vwap")).toBe("pullback_vwap");
  });

  it("rsi is already canonical", () => {
    expect(canonicalConceptName("rsi_momentum")).toBe("momentum_rsi");
  });

  it("macd is already canonical", () => {
    expect(canonicalConceptName("macd_crossover")).toBe("crossover_macd");
  });
});

// ─── Test 6: 60-char cap ──────────────────────────────────────────────────────

describe("canonicalConceptName — 60-char cap", () => {
  it("long names are capped at 60 chars at a token boundary", () => {
    const longName = "sma_ema_vwap_rsi_macd_atr_ict_fvg_ob_orb_poc_val_vah_rth_eth";
    const result = canonicalConceptName(longName);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).not.toContain(" ");
    // Must not end with underscore (clean token boundary)
    expect(result).not.toMatch(/_$/);
  });

  it("names under 60 chars are not truncated", () => {
    const name = "opening_range_breakout";
    const result = canonicalConceptName(name);
    expect(result.length).toBeLessThan(60);
    expect(result).toBe("breakout_opening_range");
  });
});

// ─── Test 7: Edge cases ───────────────────────────────────────────────────────

describe("canonicalConceptName — edge cases", () => {
  it("empty string → empty string", () => {
    expect(canonicalConceptName("")).toBe("");
  });

  it("mixed case and punctuation normalized before abbreviation expansion", () => {
    expect(canonicalConceptName("ORB-Strategy")).toBe("breakout_opening_range");
  });

  it("spaces treated same as underscores", () => {
    const a = canonicalConceptName("opening range breakout");
    const b = canonicalConceptName("opening_range_breakout");
    expect(a).toBe(b);
  });
});

// ─── Test 8: computeConceptFingerprintHash uses canonical form ────────────────

describe("computeConceptFingerprintHash — canonical bucket convergence", () => {
  it("all 4 ORB variants produce same fingerprint hash (graduation-critical)", () => {
    const h1 = computeConceptFingerprintHash({ market: "MES", concept_name: "opening_range_breakout" });
    const h2 = computeConceptFingerprintHash({ market: "MES", concept_name: "opening_range_breakout_orb" });
    const h3 = computeConceptFingerprintHash({ market: "MES", concept_name: "orb_open_range_breakout" });
    const h4 = computeConceptFingerprintHash({ market: "MES", concept_name: "opening_range_breakout_orb_strategy" });

    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
    expect(h3).toBe(h4);
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
  });

  it("different concept families still produce different hashes", () => {
    const orb  = computeConceptFingerprintHash({ market: "MES", concept_name: "opening_range_breakout" });
    const vwap = computeConceptFingerprintHash({ market: "MES", concept_name: "vwap_pullback" });
    const fvg  = computeConceptFingerprintHash({ market: "MES", concept_name: "ict_fvg" });
    expect(orb).not.toBe(vwap);
    expect(vwap).not.toBe(fvg);
    expect(orb).not.toBe(fvg);
  });

  // W23F.C: market intentionally dropped from fingerprint input (cross-symbol convergence).
  // Same concept on MES and MNQ now produces the SAME hash — that is the correct behavior.
  // Pre-W23F.C buckets do not converge with post-W23F.C buckets; graveyard sweep handles legacy.
  it("same concept on different markets produces the same hash (W23F.C: market-agnostic)", () => {
    const mes = computeConceptFingerprintHash({ market: "MES", concept_name: "opening_range_breakout" });
    const mnq = computeConceptFingerprintHash({ market: "MNQ", concept_name: "opening_range_breakout" });
    // Both resolve to the same canonical concept — cross-symbol convergence is the goal.
    expect(mes).toBe(mnq);
    expect(mes).toMatch(/^[0-9a-f]{32}$/);
  });

  it("hash is deterministic across repeated calls", () => {
    const input = { market: "MES", concept_name: "orb_strategy" };
    expect(computeConceptFingerprintHash(input)).toBe(computeConceptFingerprintHash(input));
    expect(computeConceptFingerprintHash(input)).toBe(computeConceptFingerprintHash(input));
  });
});
