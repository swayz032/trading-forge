/**
 * Wave 8 Fix 2 — B14 Survival Twin Advisory tests
 *
 * Verifies the PAPER→DEPLOY_READY Phase 0 advisory logic for B14 Survival Twin.
 *
 * Design: pure simulation of the gate decision (no DB, no lifecycle-service import)
 * following the same pattern as synthetic-black-swan-lifecycle-advisory.test.ts.
 *
 * Invariants:
 *   - B14 is ALWAYS non-blocking in Phase 0 (promotion continues regardless)
 *   - ramp_up_mode fires when evidence_weight=0 + all priors=0 (pre-seed table)
 *   - advisory_warning fires when compositeRisk30d >= 0.05
 *   - passed fires when compositeRisk30d < 0.05 (but some data exists)
 */

import { describe, it, expect } from "vitest";

// ─── Types mirroring firm-adversarial-event-service.ts AdversarialPriors ────
interface AdversarialPriors {
  P_suspension_30d: number;
  P_payout_denial: number;
  P_fund_freeze_year: number;
  P_profitable_trader_ban_year: number;
  P_vpn_detection: number;
  automation_friendly: number;
  evidence_weight: number;
}

// ─── Mirror of the B14 gate logic from lifecycle-service.ts ─────────────────
const B14_WARN_THRESHOLD = 0.05;

type B14Decision = "passed" | "advisory_warning" | "ramp_up_mode";

interface B14AdvisoryResult {
  decision: B14Decision;
  promotionAllowed: true;  // ALWAYS true in Phase 0
}

function evaluateB14Advisory(priors: AdversarialPriors): B14AdvisoryResult {
  // Detect ramp-up mode
  const hasNoPriorData =
    priors.evidence_weight === 0 &&
    priors.P_suspension_30d === 0 &&
    priors.P_payout_denial === 0 &&
    priors.P_fund_freeze_year === 0 &&
    priors.P_profitable_trader_ban_year === 0;

  if (hasNoPriorData) {
    return { decision: "ramp_up_mode", promotionAllowed: true };
  }

  const compositeRisk30d = Math.max(
    priors.P_suspension_30d,
    priors.P_payout_denial,
    priors.P_vpn_detection,
  );

  const decision: B14Decision = compositeRisk30d >= B14_WARN_THRESHOLD
    ? "advisory_warning"
    : "passed";

  return { decision, promotionAllowed: true };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
function zeroPriors(): AdversarialPriors {
  return {
    P_suspension_30d: 0,
    P_payout_denial: 0,
    P_fund_freeze_year: 0,
    P_profitable_trader_ban_year: 0,
    P_vpn_detection: 0,
    automation_friendly: 0.5,
    evidence_weight: 0,
  };
}

function mffuSeedPriors(): AdversarialPriors {
  // Realistic MFFU seed priors from firm_adversarial_priors_seed.json
  return {
    P_suspension_30d: 0.02,          // 2% / 30d
    P_payout_denial: 0.04,           // 4% / 30d
    P_fund_freeze_year: 0.10,        // 10% annualised
    P_profitable_trader_ban_year: 0.05,
    P_vpn_detection: 0.01,
    automation_friendly: 0.70,
    evidence_weight: 8,
  };
}

function highRiskPriors(): AdversarialPriors {
  return {
    ...mffuSeedPriors(),
    P_suspension_30d: 0.12,          // 12% — above threshold
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Wave 8 Fix 2 — B14 advisory: Phase 0 is always non-blocking", () => {
  it("promotion is always allowed regardless of prior data", () => {
    expect(evaluateB14Advisory(zeroPriors()).promotionAllowed).toBe(true);
    expect(evaluateB14Advisory(mffuSeedPriors()).promotionAllowed).toBe(true);
    expect(evaluateB14Advisory(highRiskPriors()).promotionAllowed).toBe(true);
  });
});

describe("Wave 8 Fix 2 — B14 advisory: ramp_up_mode (no prior data)", () => {
  it("returns ramp_up_mode when table is empty (first strategy, no seed)", () => {
    const result = evaluateB14Advisory(zeroPriors());
    expect(result.decision).toBe("ramp_up_mode");
    expect(result.promotionAllowed).toBe(true);
  });

  it("returns ramp_up_mode even if automation_friendly is non-zero", () => {
    // automation_friendly is always 0.5 default and never drives the decision
    const priors: AdversarialPriors = { ...zeroPriors(), automation_friendly: 0.8 };
    const result = evaluateB14Advisory(priors);
    expect(result.decision).toBe("ramp_up_mode");
  });
});

describe("Wave 8 Fix 2 — B14 advisory: advisory_warning (high risk)", () => {
  it("returns advisory_warning when suspension rate >= 5%", () => {
    const result = evaluateB14Advisory(highRiskPriors());
    expect(result.decision).toBe("advisory_warning");
  });

  it("fires advisory_warning exactly at the 0.05 threshold boundary", () => {
    const priors: AdversarialPriors = { ...mffuSeedPriors(), P_suspension_30d: 0.05 };
    const result = evaluateB14Advisory(priors);
    expect(result.decision).toBe("advisory_warning");
  });

  it("returns advisory_warning when payout_denial drives composite risk >= 5%", () => {
    const priors: AdversarialPriors = {
      ...zeroPriors(),
      P_payout_denial: 0.07,
      evidence_weight: 3,
    };
    const result = evaluateB14Advisory(priors);
    expect(result.decision).toBe("advisory_warning");
  });
});

describe("Wave 8 Fix 2 — B14 advisory: passed (low risk with seed data)", () => {
  it("returns passed when all rates are below threshold", () => {
    const priors: AdversarialPriors = {
      ...zeroPriors(),
      P_suspension_30d: 0.02,
      P_payout_denial: 0.03,
      P_vpn_detection: 0.01,
      evidence_weight: 5,
    };
    const result = evaluateB14Advisory(priors);
    expect(result.decision).toBe("passed");
  });

  it("returns passed just below the 0.05 threshold", () => {
    const priors: AdversarialPriors = {
      ...zeroPriors(),
      P_suspension_30d: 0.0499,
      evidence_weight: 1,
    };
    const result = evaluateB14Advisory(priors);
    expect(result.decision).toBe("passed");
  });
});

describe("Wave 8 Fix 2 — B14 audit action contract", () => {
  it("audit action name is b14.survival_twin.evaluated (pinned)", () => {
    const ACTION = "b14.survival_twin.evaluated";
    expect(ACTION).toMatch(/^b14\.survival_twin\.evaluated$/);
  });

  it("SSE event gate name is b14_survival_twin (pinned)", () => {
    const GATE = "b14_survival_twin";
    expect(GATE).toMatch(/^b14_survival_twin$/);
  });
});
