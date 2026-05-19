/**
 * Tests for prop-firm-survival-service.ts — B14 Pass 2A pure-math layer.
 *
 * Coverage areas:
 *   - Math correctness on canonical Topstep / MFFU priors loaded
 *     directly from the Pass 1 seed JSON (single source of truth).
 *   - Strategy modulators (monthly payout band, payout-request frequency,
 *     automation usage with Topstep attenuator).
 *   - Edge cases (zero priors → p_365d = 1, all-one priors → p_30d ≈ 0,
 *     empty health checks, usesAutomation=false skips VPN modulator).
 *   - Determinism: computeSurvivalProbability is pure; simulateSurvivalCurve
 *     is reproducible when seeded.
 *   - Survival curve monotonicity (p_30d ≥ p_90d ≥ p_180d ≥ p_365d).
 *
 * SUPPORTED FIRMS: MFFU + Topstep ONLY. Legacy firm tests removed 2026-05-10 (migration 0097).
 * No DB. No mocks (the service has no external dependencies).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  computeSurvivalProbability,
  simulateSurvivalCurve,
  fitFirmPriorsFromHealthChecks,
  deriveStrategyProfile,
  applyModulators,
  SURVIVAL_MODULATORS,
  type AdversarialPriors,
  type StrategyProfile,
  type SurvivalCurve,
} from "../services/prop-firm-survival-service.js";

// ─── Seed JSON loader (canonical priors, single source of truth) ───────────

const SEED_PATH = resolve(
  process.cwd(),
  "src/server/db/seeds/firm_adversarial_priors_seed.json",
);

interface SeedRow {
  firmId: string;
  eventType:
    | "account_suspension"
    | "payout_denial"
    | "fund_freeze"
    | "profitable_trader_ban"
    | "vpn_detection";
  baseRate: number;
  evidenceWeight: number;
}

interface SeedFile {
  rows: SeedRow[];
}

const SEED: SeedFile = JSON.parse(readFileSync(SEED_PATH, "utf8")) as SeedFile;

// Per-firm automation friendliness — MFFU + Topstep ONLY (legacy firms removed 2026-05-10).
const AUTOMATION_FRIENDLY: Record<string, number> = {
  topstep: 1.0,
  mffu: 0.95,
};

/**
 * Translate seed JSON rows for a firm into the AdversarialPriors shape the
 * survival service expects. Mirrors what Pass 2B's
 * `firm-adversarial-event-service.ts` will do at runtime.
 *
 * Time-semantic conventions (per W20 plan + seed _metadata):
 *   - account_suspension      → P_suspension_30d        (seed is 30-day; passes through)
 *   - payout_denial           → P_payout_denial          (per-request approximation)
 *   - fund_freeze             → P_fund_freeze_year       (compound 30d → annual)
 *   - profitable_trader_ban   → P_profitable_trader_ban_year (compound 30d → annual)
 *   - vpn_detection           → P_vpn_detection          (seed is 30-day; passes through)
 *
 * Missing event types default to 0 (no observed evidence).
 */
function buildPriorsFromSeed(firmId: string): AdversarialPriors {
  const rows = SEED.rows.filter((r) => r.firmId === firmId);
  const byType = new Map<string, SeedRow>();
  for (const r of rows) byType.set(r.eventType, r);

  const annualFromMonthly = (p30: number): number =>
    Math.max(0, Math.min(1, 1 - Math.pow(1 - p30, 12)));

  const evidenceWeight = rows.reduce(
    (acc, r) => acc + (Number.isFinite(r.evidenceWeight) ? r.evidenceWeight : 0),
    0,
  );

  return {
    P_suspension_30d: byType.get("account_suspension")?.baseRate ?? 0,
    P_payout_denial: byType.get("payout_denial")?.baseRate ?? 0,
    P_fund_freeze_year: annualFromMonthly(
      byType.get("fund_freeze")?.baseRate ?? 0,
    ),
    P_profitable_trader_ban_year: annualFromMonthly(
      byType.get("profitable_trader_ban")?.baseRate ?? 0,
    ),
    P_vpn_detection: byType.get("vpn_detection")?.baseRate ?? 0,
    automation_friendly: AUTOMATION_FRIENDLY[firmId] ?? 0.5,
    evidence_weight: evidenceWeight,
  };
}

// ─── Helper: canonical strategy profile for survival math sanity ──────────

const baselineProfile = (overrides: Partial<StrategyProfile> = {}): StrategyProfile => ({
  monthlyPayoutDollars: 5000,
  payoutRequestFrequency: 12,
  usesAutomation: true,
  averagePosition: "rth_only",
  ...overrides,
});

// ─── 1. Math correctness — canonical firms ─────────────────────────────────

describe("B14 survival math: canonical firm priors from seed JSON", () => {
  it("Topstep: low priors + automation_friendly=1.0 → p_180d ≥ 0.85", () => {
    const priors = buildPriorsFromSeed("topstep");
    const p180 = computeSurvivalProbability(priors, baselineProfile(), 180);
    expect(p180).toBeGreaterThanOrEqual(0.85);
  });

  it("MFFU: fund-freeze priors → p_180d strictly less than Topstep", () => {
    const topstep = computeSurvivalProbability(
      buildPriorsFromSeed("topstep"),
      baselineProfile(),
      180,
    );
    const mffu = computeSurvivalProbability(
      buildPriorsFromSeed("mffu"),
      baselineProfile(),
      180,
    );
    expect(mffu).toBeLessThan(topstep);
  });

  it("high-ban priors (synthetic) at $20k monthly → p_180d strictly lower than $5k baseline", () => {
    // Synthetic high-risk priors to test the ban modulator without legacy firm data
    const highRiskPriors: AdversarialPriors = {
      P_suspension_30d: 0.01,
      P_payout_denial: 0.02,
      P_fund_freeze_year: 0.05,
      P_profitable_trader_ban_year: 0.46,
      P_vpn_detection: 0.04,
      automation_friendly: 0.3,
      evidence_weight: 4,
    };
    const baseline = computeSurvivalProbability(
      highRiskPriors,
      baselineProfile({ monthlyPayoutDollars: 5000, usesAutomation: true }),
      180,
    );
    const elevated = computeSurvivalProbability(
      highRiskPriors,
      baselineProfile({ monthlyPayoutDollars: 20000, usesAutomation: true }),
      180,
    );
    expect(elevated).toBeLessThan(baseline);
    // The escalation should be non-trivial (more than a few basis points).
    expect(baseline - elevated).toBeGreaterThan(0.02);
  });

  it("survival curve is monotone non-increasing across horizons (MFFU)", () => {
    const priors = buildPriorsFromSeed("mffu");
    const curve = simulateSurvivalCurve(priors, baselineProfile(), {
      numTrials: 5000,
      seed: 12345,
    } as any);
    expect(curve.p_30d).toBeGreaterThanOrEqual(curve.p_90d);
    expect(curve.p_90d).toBeGreaterThanOrEqual(curve.p_180d);
    expect(curve.p_180d).toBeGreaterThanOrEqual(curve.p_365d);
  });

  it("survival curve is monotone non-increasing across horizons (Topstep)", () => {
    const priors = buildPriorsFromSeed("topstep");
    const curve = simulateSurvivalCurve(priors, baselineProfile(), {
      numTrials: 5000,
      seed: 12345,
    } as any);
    expect(curve.p_30d).toBeGreaterThanOrEqual(curve.p_90d);
    expect(curve.p_90d).toBeGreaterThanOrEqual(curve.p_180d);
    expect(curve.p_180d).toBeGreaterThanOrEqual(curve.p_365d);
  });

  it("simulated p_180d roughly matches analytical p_180d (Topstep, small tolerance)", () => {
    const priors = buildPriorsFromSeed("topstep");
    const profile = baselineProfile();
    const analytical = computeSurvivalProbability(priors, profile, 180);
    const simulated = simulateSurvivalCurve(priors, profile, {
      numTrials: 5000,
      seed: 99,
    } as any).p_180d;
    expect(Math.abs(analytical - simulated)).toBeLessThan(0.05);
  });
});

// ─── 2. Edge cases ─────────────────────────────────────────────────────────

describe("B14 survival math: edge cases", () => {
  it("all-zero priors → p_365d = 1.0 (no hazards)", () => {
    const zero: AdversarialPriors = {
      P_suspension_30d: 0,
      P_payout_denial: 0,
      P_fund_freeze_year: 0,
      P_profitable_trader_ban_year: 0,
      P_vpn_detection: 0,
      automation_friendly: 1.0,
      evidence_weight: 0,
    };
    expect(computeSurvivalProbability(zero, baselineProfile(), 365)).toBe(1.0);
    expect(computeSurvivalProbability(zero, baselineProfile(), 30)).toBe(1.0);
    const curve = simulateSurvivalCurve(zero, baselineProfile(), {
      numTrials: 100,
      seed: 1,
    } as any);
    expect(curve.p_30d).toBe(1.0);
    expect(curve.p_365d).toBe(1.0);
  });

  it("all-one priors → p_30d ≤ 0.10 (catastrophic given daily-hazard composition)", () => {
    // Note: even with all-one base rates, daily hazards are bounded by the
    // time-semantic conversions (P_year/365 ≈ 0.003, P_30d/30 ≈ 0.033). The
    // combined daily survival ≈ 0.90 → p_30d ≈ 0.04. That's still a 96%
    // probability of catastrophic outcome inside the first month, which is
    // the operationally relevant signal for the survival twin.
    const allOne: AdversarialPriors = {
      P_suspension_30d: 1.0,
      P_payout_denial: 1.0,
      P_fund_freeze_year: 1.0,
      P_profitable_trader_ban_year: 1.0,
      P_vpn_detection: 1.0,
      automation_friendly: 0.3,
      evidence_weight: 0,
    };
    expect(computeSurvivalProbability(allOne, baselineProfile(), 30)).toBeLessThanOrEqual(0.10);
    // And p_365d should be effectively zero.
    expect(computeSurvivalProbability(allOne, baselineProfile(), 365)).toBeLessThan(1e-10);
  });

  it("usesAutomation=false → VPN modulator does NOT fire", () => {
    // Use synthetic priors with non-zero VPN detection to exercise the modulator
    const priors: AdversarialPriors = {
      P_suspension_30d: 0,
      P_payout_denial: 0,
      P_fund_freeze_year: 0,
      P_profitable_trader_ban_year: 0,
      P_vpn_detection: 0.04,
      automation_friendly: 0.3,
      evidence_weight: 3,
    };
    const withAuto = computeSurvivalProbability(
      priors,
      baselineProfile({ usesAutomation: true }),
      180,
    );
    const withoutAuto = computeSurvivalProbability(
      priors,
      baselineProfile({ usesAutomation: false }),
      180,
    );
    // Without automation, no VPN hazard → strictly higher survival.
    expect(withoutAuto).toBeGreaterThan(withAuto);
  });

  it("computeSurvivalProbability tolerates NaN priors (clamps to 0)", () => {
    const garbage: AdversarialPriors = {
      P_suspension_30d: NaN as any,
      P_payout_denial: NaN as any,
      P_fund_freeze_year: NaN as any,
      P_profitable_trader_ban_year: NaN as any,
      P_vpn_detection: NaN as any,
      automation_friendly: NaN as any,
      evidence_weight: NaN as any,
    };
    const result = computeSurvivalProbability(garbage, baselineProfile(), 180);
    expect(Number.isFinite(result)).toBe(true);
    // NaN priors clamp to zero → no hazards → survival = 1.0
    expect(result).toBe(1.0);
  });

  it("computeSurvivalProbability handles horizonDays=0 → 1.0", () => {
    const priors = buildPriorsFromSeed("topstep");
    expect(computeSurvivalProbability(priors, baselineProfile(), 0)).toBe(1.0);
  });

  it("computeSurvivalProbability handles negative horizon → 1.0 (no-op)", () => {
    const priors = buildPriorsFromSeed("topstep");
    expect(computeSurvivalProbability(priors, baselineProfile(), -10)).toBe(1.0);
  });

  it("simulateSurvivalCurve clamps numTrials to ≥ 1", () => {
    const priors = buildPriorsFromSeed("topstep");
    const curve = simulateSurvivalCurve(priors, baselineProfile(), 0);
    expect(Number.isFinite(curve.p_30d)).toBe(true);
    expect(curve.p_30d).toBeGreaterThanOrEqual(0);
    expect(curve.p_30d).toBeLessThanOrEqual(1);
  });
});

// ─── 3. Health-check fitter ─────────────────────────────────────────────────

describe("B14 fitFirmPriorsFromHealthChecks", () => {
  it("empty rows → P_suspension_30d = 0", () => {
    const result = fitFirmPriorsFromHealthChecks("mffu", []);
    expect(result.P_suspension_30d).toBe(0);
    // Other fields intentionally undefined — caller merges with seed.
    expect(result.P_payout_denial).toBeUndefined();
    expect(result.P_fund_freeze_year).toBeUndefined();
  });

  it("all-healthy rows → P_suspension_30d = 0", () => {
    const now = Date.now();
    const rows = [
      { status: "healthy", createdAt: new Date(now - 30 * 86400_000) },
      { status: "healthy", createdAt: new Date(now - 15 * 86400_000) },
      { status: "healthy", createdAt: new Date(now) },
    ];
    const result = fitFirmPriorsFromHealthChecks("topstep", rows);
    expect(result.P_suspension_30d).toBe(0);
  });

  it("counts suspended + auth_failure as suspension events", () => {
    const now = Date.now();
    const rows = [
      { status: "healthy", createdAt: new Date(now - 60 * 86400_000) },
      { status: "suspended", createdAt: new Date(now - 30 * 86400_000) },
      { status: "auth_failure", createdAt: new Date(now - 15 * 86400_000) },
      { status: "healthy", createdAt: new Date(now) },
    ];
    const result = fitFirmPriorsFromHealthChecks("mffu", rows);
    expect(result.P_suspension_30d).toBeGreaterThan(0);
    expect(result.P_suspension_30d).toBeLessThanOrEqual(1);
    // 2 events / ~60 days * 30 = ~1.0 probability per 30-day window.
  });

  it("string-coerced createdAt is accepted", () => {
    const rows = [
      { status: "suspended", createdAt: "2025-01-01T00:00:00Z" },
      { status: "healthy", createdAt: "2025-04-01T00:00:00Z" },
    ];
    const result = fitFirmPriorsFromHealthChecks("mffu", rows);
    expect(result.P_suspension_30d).toBeGreaterThan(0);
  });

  it("returns probability in [0, 1] under stress (many short-window suspensions)", () => {
    const now = Date.now();
    const rows = Array.from({ length: 50 }, (_, i) => ({
      status: "suspended" as const,
      createdAt: new Date(now - i * 86400_000),
    }));
    const result = fitFirmPriorsFromHealthChecks("topstep", rows);
    expect(result.P_suspension_30d).toBeGreaterThanOrEqual(0);
    expect(result.P_suspension_30d).toBeLessThanOrEqual(1);
  });
});

// ─── 4. Determinism ─────────────────────────────────────────────────────────

describe("B14 determinism", () => {
  it("computeSurvivalProbability is deterministic (no randomness)", () => {
    const priors = buildPriorsFromSeed("mffu");
    const profile = baselineProfile({ monthlyPayoutDollars: 12000 });
    const a = computeSurvivalProbability(priors, profile, 180);
    const b = computeSurvivalProbability(priors, profile, 180);
    const c = computeSurvivalProbability(priors, profile, 180);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("simulateSurvivalCurve with same seed produces identical curves", () => {
    const priors = buildPriorsFromSeed("mffu");
    const profile = baselineProfile();
    const a = simulateSurvivalCurve(priors, profile, {
      numTrials: 1000,
      seed: 42,
    } as any);
    const b = simulateSurvivalCurve(priors, profile, {
      numTrials: 1000,
      seed: 42,
    } as any);
    expect(a).toEqual(b);
  });

  it("simulateSurvivalCurve with different seeds produces different curves", () => {
    const priors = buildPriorsFromSeed("mffu");
    const profile = baselineProfile();
    const a = simulateSurvivalCurve(priors, profile, {
      numTrials: 1000,
      seed: 1,
    } as any);
    const b = simulateSurvivalCurve(priors, profile, {
      numTrials: 1000,
      seed: 999,
    } as any);
    // Two different seeds should produce numerically different curves
    // (extremely unlikely they collide on all 4 horizons).
    const identicalAll =
      a.p_30d === b.p_30d &&
      a.p_90d === b.p_90d &&
      a.p_180d === b.p_180d &&
      a.p_365d === b.p_365d;
    expect(identicalAll).toBe(false);
  });
});

// ─── 5. Modulator math ─────────────────────────────────────────────────────

describe("B14 strategy modulators", () => {
  it("Topstep (automation_friendly=1.0) + $20k monthly → ban modulator does NOT explode survival down", () => {
    const priors = buildPriorsFromSeed("topstep");
    const baseline = computeSurvivalProbability(
      priors,
      baselineProfile({ monthlyPayoutDollars: 5000 }),
      180,
    );
    const elevated = computeSurvivalProbability(
      priors,
      baselineProfile({ monthlyPayoutDollars: 20000 }),
      180,
    );
    // Topstep attenuator should null out the boost. Survival should be near-equal.
    expect(Math.abs(baseline - elevated)).toBeLessThan(0.01);
  });

  it("low automation_friendly + $20k monthly + automation → significant survival drop vs $5k baseline", () => {
    // Synthetic high-risk priors (equivalent to former apex-like characteristics)
    const priors: AdversarialPriors = {
      P_suspension_30d: 0.01,
      P_payout_denial: 0.02,
      P_fund_freeze_year: 0.0,
      P_profitable_trader_ban_year: 0.46,
      P_vpn_detection: 0.04,
      automation_friendly: 0.3,
      evidence_weight: 4,
    };
    const baseline = computeSurvivalProbability(
      priors,
      baselineProfile({ monthlyPayoutDollars: 5000, usesAutomation: true }),
      180,
    );
    const elevated = computeSurvivalProbability(
      priors,
      baselineProfile({ monthlyPayoutDollars: 20000, usesAutomation: true }),
      180,
    );
    expect(baseline - elevated).toBeGreaterThan(0.05); // at least a 5pt drop
  });

  it("payout-frequency modulator: high frequency increases denial multiplier (capped at 2x)", () => {
    // Use synthetic priors to isolate the modulator math
    const priors: AdversarialPriors = {
      P_suspension_30d: 0,
      P_payout_denial: 0.02,
      P_fund_freeze_year: 0,
      P_profitable_trader_ban_year: 0,
      P_vpn_detection: 0,
      automation_friendly: 0.5,
      evidence_weight: 3,
    };
    // Build a scenario where payout-denial is the dominant hazard so the modulator is visible.
    const lowFreq = applyModulators(
      priors,
      baselineProfile({ payoutRequestFrequency: 1 }),
    );
    const midFreq = applyModulators(
      priors,
      baselineProfile({ payoutRequestFrequency: 30 }),
    );
    const highFreq = applyModulators(
      priors,
      baselineProfile({ payoutRequestFrequency: 200 }),
    );
    expect(midFreq.P_payout_denial).toBeGreaterThan(lowFreq.P_payout_denial);
    expect(highFreq.P_payout_denial).toBeGreaterThanOrEqual(midFreq.P_payout_denial);
    // Cap: modulator should never exceed 2x the base rate (with clamping at P=1.0).
    const cappedMax = Math.min(
      1.0,
      lowFreq.P_payout_denial * SURVIVAL_MODULATORS.DENIAL_FREQ_CAP_MULT,
    );
    expect(highFreq.P_payout_denial).toBeLessThanOrEqual(cappedMax + 1e-9);
  });

  it("VPN modulator: scales with (1 - automation_friendly) when usesAutomation=true", () => {
    const apexLike: AdversarialPriors = {
      P_suspension_30d: 0,
      P_payout_denial: 0,
      P_fund_freeze_year: 0,
      P_profitable_trader_ban_year: 0,
      P_vpn_detection: 0.04,
      automation_friendly: 0.3,
      evidence_weight: 0,
    };
    const topstepLike: AdversarialPriors = {
      ...apexLike,
      automation_friendly: 1.0,
    };
    const apexResult = applyModulators(
      apexLike,
      baselineProfile({ usesAutomation: true }),
    );
    const topstepResult = applyModulators(
      topstepLike,
      baselineProfile({ usesAutomation: true }),
    );
    expect(apexResult.P_vpn_detection).toBeGreaterThan(topstepResult.P_vpn_detection);
    // Topstep at automation_friendly=1.0 → VPN multiplier is 1.0 → no boost.
    expect(topstepResult.P_vpn_detection).toBeCloseTo(0.04, 6);
    // Apex at automation_friendly=0.3 → VPN multiplier is 1 + 0.7 * 1.5 = 2.05.
    expect(apexResult.P_vpn_detection).toBeCloseTo(0.04 * 2.05, 5);
  });

  it("ban modulator does NOT engage when monthlyPayoutDollars is below threshold", () => {
    const priors: AdversarialPriors = {
      P_suspension_30d: 0,
      P_payout_denial: 0,
      P_fund_freeze_year: 0,
      P_profitable_trader_ban_year: 0.10,
      P_vpn_detection: 0,
      automation_friendly: 0.3,
      evidence_weight: 0,
    };
    const lowResult = applyModulators(priors, baselineProfile({ monthlyPayoutDollars: 5000 }));
    expect(lowResult.P_profitable_trader_ban_year).toBeCloseTo(0.10, 6);
  });

  it("ban modulator engages at HIGH band ($8k < monthly < $15k)", () => {
    const priors: AdversarialPriors = {
      P_suspension_30d: 0,
      P_payout_denial: 0,
      P_fund_freeze_year: 0,
      P_profitable_trader_ban_year: 0.10,
      P_vpn_detection: 0,
      automation_friendly: 0.3, // Apex — minimal attenuation
      evidence_weight: 0,
    };
    const result = applyModulators(priors, baselineProfile({ monthlyPayoutDollars: 10000 }));
    // banExcess = (1.5 - 1) * (1 - 0.3) = 0.35 → effective = 1.35
    expect(result.P_profitable_trader_ban_year).toBeCloseTo(0.10 * 1.35, 5);
  });

  it("ban modulator escalates at EXTREME band (> $15k monthly)", () => {
    const priors: AdversarialPriors = {
      P_suspension_30d: 0,
      P_payout_denial: 0,
      P_fund_freeze_year: 0,
      P_profitable_trader_ban_year: 0.10,
      P_vpn_detection: 0,
      automation_friendly: 0.3,
      evidence_weight: 0,
    };
    const result = applyModulators(priors, baselineProfile({ monthlyPayoutDollars: 20000 }));
    // banExcess = (2.5 - 1) * (1 - 0.3) = 1.05 → effective = 2.05
    expect(result.P_profitable_trader_ban_year).toBeCloseTo(0.10 * 2.05, 5);
  });

  it("Topstep ban attenuator: at automation_friendly=1.0, ban modulator is fully attenuated", () => {
    const priors: AdversarialPriors = {
      P_suspension_30d: 0,
      P_payout_denial: 0,
      P_fund_freeze_year: 0,
      P_profitable_trader_ban_year: 0.10,
      P_vpn_detection: 0,
      automation_friendly: 1.0, // Topstep — full attenuation
      evidence_weight: 0,
    };
    const result = applyModulators(priors, baselineProfile({ monthlyPayoutDollars: 20000 }));
    // banExcess = (2.5 - 1) * (1 - 1.0) = 0 → effective = 1.0 (unchanged)
    expect(result.P_profitable_trader_ban_year).toBeCloseTo(0.10, 6);
  });
});

// ─── 6. deriveStrategyProfile helper ────────────────────────────────────────

describe("B14 deriveStrategyProfile", () => {
  it("uses backtest avg_monthly_pnl * 0.8 when available", () => {
    const profile = deriveStrategyProfile(
      { dsl: { session_filter: "rth_only" } },
      { avg_monthly_pnl: 10000 },
    );
    expect(profile.monthlyPayoutDollars).toBeCloseTo(8000, 6);
    expect(profile.usesAutomation).toBe(true);
    expect(profile.payoutRequestFrequency).toBe(12);
    expect(profile.averagePosition).toBe("rth_only");
  });

  it("falls back to daily_target_dollars * 20 * 0.8 when no backtest", () => {
    const profile = deriveStrategyProfile({
      dsl: { session_filter: "rth_only" },
      daily_target_dollars: 500,
    });
    // 500 * 20 * 0.8 = 8000
    expect(profile.monthlyPayoutDollars).toBeCloseTo(8000, 6);
  });

  it("defaults to $5000/mo when no signal available", () => {
    const profile = deriveStrategyProfile({});
    expect(profile.monthlyPayoutDollars).toBe(5000);
  });

  it("reads averagePosition='overnight' from session_filter", () => {
    const profile = deriveStrategyProfile({ dsl: { session_filter: "overnight" } });
    expect(profile.averagePosition).toBe("overnight");
  });

  it("defaults averagePosition to 'rth_only' on unknown / missing session_filter", () => {
    expect(deriveStrategyProfile({}).averagePosition).toBe("rth_only");
    expect(deriveStrategyProfile({ dsl: { session_filter: "unknown" } }).averagePosition).toBe(
      "rth_only",
    );
  });

  it("ignores zero or negative avg_monthly_pnl from backtest", () => {
    const profile = deriveStrategyProfile(
      { dsl: { session_filter: "rth_only" } },
      { avg_monthly_pnl: 0 },
    );
    expect(profile.monthlyPayoutDollars).toBe(5000); // fallback default
  });

  it("accepts string-coerced backtest fields", () => {
    const profile = deriveStrategyProfile(
      { dsl: { session_filter: "rth_only" } },
      { avg_monthly_pnl: "12500" },
    );
    expect(profile.monthlyPayoutDollars).toBeCloseTo(10000, 6);
  });

  it("handles camelCase fields (avgMonthlyPnl, dailyTargetDollars)", () => {
    const profile = deriveStrategyProfile(
      { dsl: { session_filter: "rth_only" }, dailyTargetDollars: 250 },
      { avgMonthlyPnl: 8000 },
    );
    expect(profile.monthlyPayoutDollars).toBeCloseTo(6400, 6);
  });
});

// ─── 7. Smoke: end-to-end priors + simulate sanity ─────────────────────────

describe("B14 end-to-end sanity", () => {
  it("Topstep p_180d sanity: ≥ 0.85 (advisory headline)", () => {
    const curve = simulateSurvivalCurve(
      buildPriorsFromSeed("topstep"),
      baselineProfile(),
      { numTrials: 5000, seed: 7 } as any,
    );
    expect(curve.p_180d).toBeGreaterThanOrEqual(0.85);
  });

  it("MFFU p_180d at $5k monthly: lower than Topstep (fund-freeze risk)", () => {
    const mffuCurve = simulateSurvivalCurve(
      buildPriorsFromSeed("mffu"),
      baselineProfile({ monthlyPayoutDollars: 5000 }),
      { numTrials: 5000, seed: 7 } as any,
    );
    const topstepCurve = simulateSurvivalCurve(
      buildPriorsFromSeed("topstep"),
      baselineProfile({ monthlyPayoutDollars: 5000 }),
      { numTrials: 5000, seed: 7 } as any,
    );
    expect(mffuCurve.p_180d).toBeLessThan(topstepCurve.p_180d);
  });

  it("high-risk synthetic priors at $20k: p_180d lower than $5k baseline", () => {
    const highRisk: AdversarialPriors = {
      P_suspension_30d: 0.01,
      P_payout_denial: 0.02,
      P_fund_freeze_year: 0.0,
      P_profitable_trader_ban_year: 0.46,
      P_vpn_detection: 0.04,
      automation_friendly: 0.3,
      evidence_weight: 4,
    };
    const baseline = simulateSurvivalCurve(
      highRisk,
      baselineProfile({ monthlyPayoutDollars: 5000, usesAutomation: true }),
      { numTrials: 5000, seed: 7 } as any,
    );
    const elevated = simulateSurvivalCurve(
      highRisk,
      baselineProfile({ monthlyPayoutDollars: 20000, usesAutomation: true }),
      { numTrials: 5000, seed: 7 } as any,
    );
    expect(elevated.p_180d).toBeLessThan(baseline.p_180d);
  });

  it("survival values are always in [0, 1] across supported firms × 4 horizons", () => {
    // MFFU + Topstep only — legacy firms removed 2026-05-10 (migration 0097)
    const firms = Object.keys(AUTOMATION_FRIENDLY);
    for (const firm of firms) {
      const priors = buildPriorsFromSeed(firm);
      const curve: SurvivalCurve = simulateSurvivalCurve(
        priors,
        baselineProfile(),
        { numTrials: 500, seed: 11 } as any,
      );
      for (const v of [curve.p_30d, curve.p_90d, curve.p_180d, curve.p_365d]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
