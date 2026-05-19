/**
 * W23F.C — Cross-symbol fingerprint convergence tests
 *
 * Verifies that computeConceptFingerprintHash() no longer includes the market
 * in its hash input, so the same concept discovered on different symbols (e.g.
 * MES on web + MNQ on YouTube) lands in the SAME pending bucket.
 *
 * Strategy rows carry `symbols: string[]` for per-symbol routing downstream;
 * the bucket fingerprint is purely for cross-source concept convergence at
 * scout-time. Pre-W23F.C buckets do not converge with post-W23F.C buckets —
 * this is intentional; graveyard sweep handles legacy.
 */
import { describe, it, expect } from "vitest";
import { computeConceptFingerprintHash } from "../services/strategy-fingerprint.js";

describe("W23F.C cross-symbol fingerprint convergence", () => {
  it("collapses market — same concept on MES and MNQ converges to identical fingerprint", () => {
    const a = computeConceptFingerprintHash({ market: "MES", concept_name: "ema_9_21_pullback" });
    const b = computeConceptFingerprintHash({ market: "MNQ", concept_name: "ema_9_21_pullback" });
    expect(a).toBe(b);
  });

  it("different concepts produce different fingerprints", () => {
    const a = computeConceptFingerprintHash({ market: "MES", concept_name: "ema_9_21_pullback" });
    const b = computeConceptFingerprintHash({ market: "MES", concept_name: "orb_15m" });
    expect(a).not.toBe(b);
  });

  it("normalization preserved — case + whitespace ignored", () => {
    const a = computeConceptFingerprintHash({ market: "MES", concept_name: "EMA 9 21 Pullback" });
    const b = computeConceptFingerprintHash({ market: "MES", concept_name: "ema_9_21_pullback" });
    expect(a).toBe(b);
  });
});
