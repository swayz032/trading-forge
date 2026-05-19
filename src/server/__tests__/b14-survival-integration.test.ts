/**
 * B14 Pass 2 merge-gate integration smoke test.
 *
 * Verifies that Pass 2B's `getCurrentPriors` (DB-backed) and Pass 2A's
 * `simulateSurvivalCurve` (pure math) integrate cleanly with correct
 * time-semantic compounding for `fund_freeze` and `profitable_trader_ban`.
 *
 * Hits the live Railway DB (seed JSON loaded by Pass 1 migration).
 */

import { describe, it, expect } from "vitest";
import {
  simulateSurvivalCurve,
  computeSurvivalProbability,
} from "../services/prop-firm-survival-service.js";

// Live-DB only — gates the dynamic import so module-load DATABASE_URL guard
// doesn't fail unit-test CI runs without a database.
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

let getCurrentPriors: typeof import("../services/firm-adversarial-event-service.js").getCurrentPriors;
if (hasDb) {
  ({ getCurrentPriors } = await import("../services/firm-adversarial-event-service.js"));
}

const baselineProfile = () => ({
  monthlyPayoutDollars: 5000,
  payoutRequestFrequency: 12,
  usesAutomation: true,
  averagePosition: "rth_only" as const,
});

describeIfDb("B14 Pass 2 merge gate: Pass 2B priors → Pass 2A math (live DB)", () => {
  it("Topstep priors from DB → p_180d ≥ 0.85 (matches Pass 2A canonical)", async () => {
    const priors = await getCurrentPriors("topstep");
    const p180 = computeSurvivalProbability(priors, baselineProfile(), 180);
    expect(p180).toBeGreaterThanOrEqual(0.85);
  });

  it("MFFU priors from DB → p_180d strictly less than Topstep (fund_freeze risk)", async () => {
    const [topstep, mffu] = await Promise.all([
      getCurrentPriors("topstep"),
      getCurrentPriors("mffu"),
    ]);
    const profile = baselineProfile();
    const ts = computeSurvivalProbability(topstep, profile, 180);
    const mf = computeSurvivalProbability(mffu, profile, 180);
    expect(mf).toBeLessThan(ts);
    // Both in valid range
    expect(ts).toBeGreaterThanOrEqual(0.85);
    expect(mf).toBeGreaterThanOrEqual(0);
    expect(mf).toBeLessThanOrEqual(1);
  });

  it("MFFU P_fund_freeze_year is annualised (compounded), not raw 30-day rate", async () => {
    const priors = await getCurrentPriors("mffu");
    // MFFU seed has fund_freeze base_rate ≈ 0.015 (30-day).
    // Annualised: 1 - (1 - 0.015)^12 ≈ 0.1668.
    // Raw passthrough would yield 0.015. Compounded must be ≥ 0.10.
    expect(priors.P_fund_freeze_year).toBeGreaterThanOrEqual(0.1);
    expect(priors.P_fund_freeze_year).toBeLessThanOrEqual(0.3);
  });

  it("Topstep P_profitable_trader_ban_year is annualised (compounded), not raw 30-day rate", async () => {
    const priors = await getCurrentPriors("topstep");
    // Topstep seed has profitable_trader_ban base_rate ≈ 0.001 (30-day).
    // Annualised: 1 - (1 - 0.001)^12 ≈ 0.01194.
    // Raw passthrough would yield 0.001. Compounded must be ≥ 0.005.
    expect(priors.P_profitable_trader_ban_year).toBeGreaterThanOrEqual(0.005);
    expect(priors.P_profitable_trader_ban_year).toBeLessThanOrEqual(0.05);
  });

  it("MC simulation matches analytical computation within 0.05 (Topstep DB priors)", async () => {
    const priors = await getCurrentPriors("topstep");
    const profile = baselineProfile();
    const analytical = computeSurvivalProbability(priors, profile, 180);
    const simulated = simulateSurvivalCurve(priors, profile, {
      numTrials: 5000,
      seed: 42,
    } as any).p_180d;
    expect(Math.abs(analytical - simulated)).toBeLessThan(0.05);
  });

  it("survival curve monotone non-increasing across horizons (MFFU + Topstep from DB)", async () => {
    // Only MFFU + Topstep supported. Legacy firms removed 2026-05-10 (migration 0097).
    const firms = ["topstep", "mffu"];
    for (const firmId of firms) {
      const priors = await getCurrentPriors(firmId);
      const curve = simulateSurvivalCurve(priors, baselineProfile(), {
        numTrials: 2000,
        seed: 42,
      } as any);
      expect(curve.p_30d).toBeGreaterThanOrEqual(curve.p_90d);
      expect(curve.p_90d).toBeGreaterThanOrEqual(curve.p_180d);
      expect(curve.p_180d).toBeGreaterThanOrEqual(curve.p_365d);
      // All in [0, 1]
      for (const v of [curve.p_30d, curve.p_90d, curve.p_180d, curve.p_365d]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("nonexistent firm → zero priors → p_365d = 1.0 (no hazards)", async () => {
    const priors = await getCurrentPriors("nonexistent_firm_xyz");
    expect(priors.P_suspension_30d).toBe(0);
    expect(priors.P_fund_freeze_year).toBe(0);
    expect(priors.P_profitable_trader_ban_year).toBe(0);
    const p365 = computeSurvivalProbability(priors, baselineProfile(), 365);
    expect(p365).toBe(1.0);
  });
});
