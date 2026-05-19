/**
 * Concept Fingerprint Tests — Pass 20
 *
 * Tests normalizeConceptName() and computeConceptFingerprintHash() from
 * strategy-fingerprint.ts. Pure functions — no DB, no network.
 *
 * 6 tests:
 *  1. Normalization: spaces/case/punctuation stripped correctly
 *  2. Normalization: numbers preserved
 *  3. Same concept (different casing/punctuation) → same hash
 *  4. Different concepts → different hash (no collision)
 *  5. Market separation: same concept, different market → different hash
 *  6. Hash output is exactly 32 hex characters
 *
 * Also verifies backward-compat: computeFingerprintHash() still works.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeConceptName,
  computeConceptFingerprintHash,
  computeFingerprintHash,
} from "../services/strategy-fingerprint.js";

// ─── normalizeConceptName ─────────────────────────────────────────────────────

describe("normalizeConceptName", () => {
  it("strips spaces and lowercases", () => {
    expect(normalizeConceptName("Opening Range Breakout")).toBe("openingrangebreakout");
  });

  it("strips hyphens, underscores, and punctuation", () => {
    expect(normalizeConceptName("VWAP_Pullback")).toBe("vwappullback");
    expect(normalizeConceptName("ICT-Silver-Bullet")).toBe("ictsilverbullet");
    expect(normalizeConceptName("1-min ORB")).toBe("1minorb");
    expect(normalizeConceptName("15-min ORB")).toBe("15minorb");
    expect(normalizeConceptName("Mean Reversion (VWAP)")).toBe("meanreversionvwap");
    expect(normalizeConceptName("Fibonacci/Retracement")).toBe("fibonacciretracement");
  });

  it("preserves numbers", () => {
    expect(normalizeConceptName("EMA Cross 50/200")).toBe("emacross50200");
    expect(normalizeConceptName("RSI(14) Momentum")).toBe("rsi14momentum");
  });

  it("handles empty string", () => {
    expect(normalizeConceptName("")).toBe("");
  });

  it("handles already-normalized input (idempotent)", () => {
    const normalized = "openingrangebreakout";
    expect(normalizeConceptName(normalized)).toBe(normalized);
  });
});

// ─── computeConceptFingerprintHash ────────────────────────────────────────────

describe("computeConceptFingerprintHash", () => {
  it("same concept with different spacing/casing/punctuation → same hash", () => {
    const a = computeConceptFingerprintHash({ market: "MES", concept_name: "Opening Range Breakout" });
    const b = computeConceptFingerprintHash({ market: "MES", concept_name: "opening range breakout" });
    const c = computeConceptFingerprintHash({ market: "MES", concept_name: "Opening-Range-Breakout" });
    const d = computeConceptFingerprintHash({ market: "MES", concept_name: "Opening_Range_Breakout" });
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(d);
  });

  it("different concept names → different hashes", () => {
    const orb  = computeConceptFingerprintHash({ market: "MES", concept_name: "Opening Range Breakout" });
    const vwap = computeConceptFingerprintHash({ market: "MES", concept_name: "VWAP Pullback" });
    expect(orb).not.toBe(vwap);
  });

  it("1-min ORB vs 15-min ORB → different hashes (key design goal)", () => {
    const orb1  = computeConceptFingerprintHash({ market: "MES", concept_name: "1-min ORB" });
    const orb15 = computeConceptFingerprintHash({ market: "MES", concept_name: "15-min ORB" });
    expect(orb1).not.toBe(orb15);
  });

  // W23F.C: market dropped from fingerprint input — same concept on different
  // symbols must now converge to ONE bucket for cross-symbol validation.
  it("same concept, different market → IDENTICAL hash (W23F.C cross-symbol convergence)", () => {
    const mes = computeConceptFingerprintHash({ market: "MES", concept_name: "Opening Range Breakout" });
    const mnq = computeConceptFingerprintHash({ market: "MNQ", concept_name: "Opening Range Breakout" });
    const mcl = computeConceptFingerprintHash({ market: "MCL", concept_name: "Opening Range Breakout" });
    expect(mes).toBe(mnq);
    expect(mnq).toBe(mcl);
    expect(mes).toBe(mcl);
  });

  it("hash is exactly 32 hex characters", () => {
    const h = computeConceptFingerprintHash({ market: "MES", concept_name: "VWAP Pullback" });
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it("deterministic: same inputs always produce same output", () => {
    const input = { market: "MNQ", concept_name: "ICT Silver Bullet" };
    const a = computeConceptFingerprintHash(input);
    const b = computeConceptFingerprintHash(input);
    const c = computeConceptFingerprintHash(input);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

// ─── Backward-compat: computeFingerprintHash still works ─────────────────────

describe("computeFingerprintHash (Pass 18 backward compat)", () => {
  it("still returns 32 hex chars", () => {
    const h = computeFingerprintHash({ market: "MES", entry_archetype: "breakout", exit_type: "atr_multiple" });
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it("still distinguishes markets", () => {
    const mes = computeFingerprintHash({ market: "MES", entry_archetype: "breakout", exit_type: "atr_multiple" });
    const mnq = computeFingerprintHash({ market: "MNQ", entry_archetype: "breakout", exit_type: "atr_multiple" });
    expect(mes).not.toBe(mnq);
  });

  it("concept-based and archetype-based hashes differ for same market+concept", () => {
    // This confirms the two schemes produce different hash spaces (no accidental aliasing)
    const conceptHash    = computeConceptFingerprintHash({ market: "MES", concept_name: "breakout" });
    const archetypeHash  = computeFingerprintHash({ market: "MES", entry_archetype: "breakout", exit_type: "unknown" });
    expect(conceptHash).not.toBe(archetypeHash);
  });
});
