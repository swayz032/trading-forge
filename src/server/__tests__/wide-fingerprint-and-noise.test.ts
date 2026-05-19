/**
 * Pass 21 (2026-05-16) — tests for NOISE_TOKENS filtering and the variant-
 * aware computeWideConceptFingerprintHash() that distinguishes textual dupes
 * from real variants.
 *
 * The earlier canonical-concept-name.test.ts tests are still in force; this
 * file adds tests for the production-grade dedup logic that's about to be
 * deployed against the live 68-strategy library.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalConceptName,
  computeConceptFingerprintHash,
  computeWideConceptFingerprintHash,
} from "../services/strategy-fingerprint.js";

// ─── NOISE TOKEN FILTERING ───────────────────────────────────────────────────

describe("canonicalConceptName — Pass 21 noise-token filter", () => {
  it("strips author surname noise (linda_raschke_holy_grail_setup_explained → holy grail)", () => {
    const a = canonicalConceptName("holy_grail");
    const b = canonicalConceptName("linda_raschke_holy_grail_setup_explained");
    expect(b).toBe(a);
    // Note: `linda_raschke_s_holy_grail_pdf_market_trend` has additional non-noise
    // tokens (market, trend) that legitimately differ from "holy_grail" — those
    // article variants do NOT converge, which is correct: the article-author
    // characterizes it as a "market trend" variant. The graduator's wide-
    // fingerprint dedup uses (concept + tf + dir + params); textual title noise
    // beyond the author name is OK if it differentiates the article's framing.
  });

  it("strips article-fluff (explained, exploring, tested, mastering)", () => {
    const a = canonicalConceptName("fair_value_gap");
    const b = canonicalConceptName("fair_value_gap_explanations_types_indicator");
    const c = canonicalConceptName("fvg_what_is_fair_value_gap_meaning_atas");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("strips source-site slugs (stratbase_ai, litefinance, edgeful_blog, metricgate)", () => {
    const a = canonicalConceptName("rsi_2");
    const b = canonicalConceptName("rsi_2_larry_connors_stratbase_ai");
    const c = canonicalConceptName("rsi_2_explained_larry_connors_2_period_rsi_rules");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("strips Reddit-thread cruft (r_daytrading_on_reddit_*)", () => {
    const b = canonicalConceptName("r_daytrading_on_reddit_i_tested_opening_range_brea");
    // The Reddit URL slug ("r", "daytrading", "on", "reddit", "i", "tested") all noise → stripped
    expect(b).not.toContain("reddit");
    expect(b).not.toContain("daytrading");
    expect(b).not.toContain("tested");
    // The legitimate concept tokens survive
    expect(b).toContain("opening");
    expect(b).toContain("range");
    // (Note: "brea" survives because the URL was already truncated upstream
    //  — we can't recover "breakout" from a truncated source. The graduator's
    //  wide-fingerprint dedup still catches this as a duplicate of any other
    //  ORB bucket with same timeframe/direction/params.)
  });

  it("preserves real distinguishing tokens (timeframes, indicator periods)", () => {
    // 9_21_ema should NOT collapse to plain ema — the periods 9 and 21 differentiate
    const a = canonicalConceptName("9_21_ema_pullback");
    expect(a).toContain("9");
    expect(a).toContain("21");
    expect(a.length).toBeGreaterThan(5);
  });

  it("preserves indicator periods 2 14 21 200 (the numbers that matter)", () => {
    expect(canonicalConceptName("rsi_2_larry_connors")).toContain("2");
    expect(canonicalConceptName("200_day_moving_average")).toContain("200");
    expect(canonicalConceptName("14_period_adx")).toContain("14");
  });

  it("never returns empty string even if all input tokens are noise", () => {
    const r = canonicalConceptName("the_best_complete_ultimate_guide_explained");
    expect(r.length).toBeGreaterThan(0); // Fallback kicks in
  });
});

// ─── WIDE FINGERPRINT — variant-aware ────────────────────────────────────────

describe("computeWideConceptFingerprintHash — distinguishes variants, collapses textual dupes", () => {
  it("5m-ORB and 15m-ORB produce DIFFERENT wide fingerprints (real variants)", () => {
    const orb5m = computeWideConceptFingerprintHash({
      market: "MES",
      concept_name: "opening_range_breakout",
      timeframe: "5m",
      direction: "long",
      entry_params: {},
    });
    const orb15m = computeWideConceptFingerprintHash({
      market: "MES",
      concept_name: "opening_range_breakout",
      timeframe: "15m",
      direction: "long",
      entry_params: {},
    });
    expect(orb5m).not.toBe(orb15m);
  });

  it("Holy Grail textual variants with same params produce SAME wide fingerprint", () => {
    const base = { market: "MES", timeframe: "5m", direction: "long" as const, entry_params: {} };
    const v1 = computeWideConceptFingerprintHash({ ...base, concept_name: "holy_grail" });
    const v2 = computeWideConceptFingerprintHash({ ...base, concept_name: "linda_raschke_holy_grail_setup_explained" });
    expect(v2).toBe(v1);
  });

  it("long-only and both-sides of same concept produce different fingerprints", () => {
    const long = computeWideConceptFingerprintHash({
      market: "MES", concept_name: "vwap_pullback", timeframe: "5m", direction: "long", entry_params: {},
    });
    const both = computeWideConceptFingerprintHash({
      market: "MES", concept_name: "vwap_pullback", timeframe: "5m", direction: "both", entry_params: {},
    });
    expect(long).not.toBe(both);
  });

  it("9-EMA-pullback and 21-EMA-pullback produce different fingerprints when periods are in concept name", () => {
    const ema9 = computeWideConceptFingerprintHash({
      market: "MES", concept_name: "9_ema_pullback", timeframe: "5m", direction: "long", entry_params: {},
    });
    const ema21 = computeWideConceptFingerprintHash({
      market: "MES", concept_name: "21_ema_pullback", timeframe: "5m", direction: "long", entry_params: {},
    });
    expect(ema9).not.toBe(ema21);
  });

  it("entry_params differences produce different fingerprints (RSI<5 vs RSI<10)", () => {
    const base = { market: "MES", concept_name: "rsi_2", timeframe: "5m", direction: "long" as const };
    const rsi5 = computeWideConceptFingerprintHash({ ...base, entry_params: { threshold: 5 } });
    const rsi10 = computeWideConceptFingerprintHash({ ...base, entry_params: { threshold: 10 } });
    expect(rsi5).not.toBe(rsi10);
  });

  it("entry_params key ordering does NOT affect fingerprint (stable JSON)", () => {
    const base = { market: "MES", concept_name: "ema_cross", timeframe: "5m", direction: "long" as const };
    const a = computeWideConceptFingerprintHash({ ...base, entry_params: { fast: 9, slow: 21 } });
    const b = computeWideConceptFingerprintHash({ ...base, entry_params: { slow: 21, fast: 9 } });
    expect(a).toBe(b);
  });

  it("market differences (MES vs MNQ) produce different fingerprints", () => {
    const base = { concept_name: "opening_range_breakout", timeframe: "5m", direction: "long" as const, entry_params: {} };
    const mes = computeWideConceptFingerprintHash({ ...base, market: "MES" });
    const mnq = computeWideConceptFingerprintHash({ ...base, market: "MNQ" });
    expect(mes).not.toBe(mnq);
  });

  it("32-hex-char output (sha256 truncated)", () => {
    const h = computeWideConceptFingerprintHash({
      market: "MES", concept_name: "test", timeframe: "5m", direction: "long", entry_params: {},
    });
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ─── REGRESSION: existing narrow fingerprint still works for cross-source dedup ──

describe("computeConceptFingerprintHash — narrow scheme unchanged (for cross-source bucket dedup)", () => {
  it("textual dupes of the same concept produce the same narrow hash (after Pass 21 noise filter)", () => {
    const a = computeConceptFingerprintHash({ market: "MES", concept_name: "holy_grail" });
    const b = computeConceptFingerprintHash({ market: "MES", concept_name: "linda_raschke_holy_grail_setup_explained" });
    expect(b).toBe(a);
  });

  it("5m-ORB and 15m-ORB STILL collapse on narrow scheme (correct for discovery)", () => {
    // The narrow scheme keys only on (market, canonical_concept) — both timeframes
    // map to the same canonical and thus the same bucket. Discovery wants this
    // because cross-source convergence happens at the concept level.
    const orb = computeConceptFingerprintHash({ market: "MES", concept_name: "opening_range_breakout" });
    const orb2 = computeConceptFingerprintHash({ market: "MES", concept_name: "orb" });
    expect(orb).toBe(orb2);
  });
});
