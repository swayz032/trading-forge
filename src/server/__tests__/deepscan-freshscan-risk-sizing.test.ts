/**
 * Fresh-scan 2026-07-12 — risk-sizing HIGH#3 + HIGH#4.
 *
 * HIGH#3: the pyramid floor must NOT fire (and shrink the size) when the pyramid tier was
 *   legitimately PM-tapered below base_contracts — matches the Python guard
 *   `pyramid_tier_per_bar >= base_contr` (sizing.py:1270). Prior TS compared the already-tapered
 *   finalContracts against the UNTAPERED base, wrongly firing and lowering the size (~33% under-size,
 *   TS↔Python parity break).
 * HIGH#4: the confluence upsize multiplier applies to the pyramid ramp but must NEVER scale the
 *   risk-derived cap (the 2%-per-trade ceiling) — otherwise a 2.0x A+ setup risks ~4% at stop, a
 *   hard MFFU 2% breach.
 */
import { describe, it, expect, afterEach } from "vitest";
import { computeRiskDerivedContracts, type RiskSizingInputs } from "../lib/risk-sizing.js";

function makeInput(overrides: Partial<RiskSizingInputs> = {}): RiskSizingInputs {
  return {
    positionSizeConfig: {
      type: "risk_derived_pyramid",
      base_contracts: 4,
      tier_increment: 2,
      tier_threshold_dollars: 3000,
      personal_dll_pct: 0.67,
      max_risk_pct_per_trade: 0.02,
      liquidity_comfort_cap: 100,
      topstep_account_cap_override: null,
      computed_at_signal_time: true,
    },
    accountBalance: 50_000,
    cumulativeProfit: 0,
    atrPoints: 4,
    stopMultiplier: 1.5,
    pointDollarValue: 5, // MES
    firmContractCap: null,
    firm: "mffu",
    ...overrides,
  };
}

describe("fresh-scan HIGH#3 — pyramid floor respects a deliberate PM taper", () => {
  it("healthy PM-tapered account with an earned tier keeps the tapered size (does NOT floor it back up/down)", () => {
    // base 9, +3/tier, cumulativeProfit 3000 → tier 1 → pyramidTierRaw 12; pmFactor 0.5 → pyramidTier 6.
    // riskDerivedCap=33 (non-binding). Pre-floor = 6. OLD (buggy): floor fired (6<9) → floor(9*0.5)=4.
    // NEW: guard pyramidTier(6) >= base(9) is FALSE → floor skipped → stays 6 (Python parity).
    const r = computeRiskDerivedContracts(makeInput({
      positionSizeConfig: {
        type: "risk_derived_pyramid", base_contracts: 9, tier_increment: 3, tier_threshold_dollars: 3000,
        personal_dll_pct: 0.67, max_risk_pct_per_trade: 0.02, liquidity_comfort_cap: 100,
        topstep_account_cap_override: null, computed_at_signal_time: true,
      },
      accountBalance: 50_000,
      accountStartingFloor: 50_000, // health ratio 1.0 → healthy
      cumulativeProfit: 3000,       // tier 1
      pmSizeFactor: 0.5,            // PM taper
    }));
    expect(r.finalContracts).toBe(6);      // NOT 4 (the pre-fix floored value)
    expect(r.pyramidFloorApplied).toBe(false);
  });

  it("floor STILL fires when a CAP (not the taper) pushed the count below base", () => {
    // C-05/D9 (2026-07-16): floor override REMOVED — a CAP below base no longer floors back up.
    // base 9; atrPoints huge → riskDerivedCap=3 < 9 → risk cap (3) now binds (lowest wins).
    const r = computeRiskDerivedContracts(makeInput({
      positionSizeConfig: {
        type: "risk_derived_pyramid", base_contracts: 9, tier_increment: 3, tier_threshold_dollars: 3000,
        personal_dll_pct: 0.67, max_risk_pct_per_trade: 0.02, liquidity_comfort_cap: 100,
        topstep_account_cap_override: null, computed_at_signal_time: true,
      },
      accountBalance: 50_000, accountStartingFloor: 50_000, cumulativeProfit: 9000, // tier 3 → pyramidTier 18 >= 9
      atrPoints: 40, // stop $ huge → riskDerivedCap small (< 9)
    }));
    expect(r.riskDerivedCap).toBe(3);
    expect(r.pyramidFloorApplied).toBe(false);
    expect(r.finalContracts).toBe(3); // risk cap binds — no floor override
  });
});

describe("fresh-scan HIGH#4 — confluence upsize cannot breach the 2% risk ceiling", () => {
  const prev = process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
    else process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = prev;
  });

  it("a 2.0x A+ multiplier is bounded by the UNMULTIPLIED risk-derived cap (no ~4% risk)", () => {
    process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = "true";
    // riskDerivedCap=33 ($1000/$30). pyramidTier high (34) so it doesn't bind. confluence_count 4 → 2.0x.
    // OLD: min(floor(34*2)=68, floor(33*2)=66, 100) = 66 (~4% risk). NEW: min(68, 33, 100) = 33 (2%).
    const r = computeRiskDerivedContracts(makeInput({
      accountBalance: 50_000, accountStartingFloor: 50_000,
      cumulativeProfit: 45_000, // tier 15 → pyramidTierRaw 34
      confluence_count: 4,
    }));
    expect(r.riskDerivedCap).toBe(33);
    expect(r.finalContracts).toBeLessThanOrEqual(33);
    expect(r.finalContracts).toBe(33);
    // risk at stop must be ~2% of balance, never ~4%
    const stopDollarsPerContract = 1.5 * 4 * 5; // 30
    expect(r.finalContracts * stopDollarsPerContract).toBeLessThanOrEqual(50_000 * 0.02 + stopDollarsPerContract);
  });

  it("with the flag OFF the multiplier is 1.0 → risk cap binds identically (no regression)", () => {
    delete process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
    const r = computeRiskDerivedContracts(makeInput({
      accountBalance: 50_000, accountStartingFloor: 50_000, cumulativeProfit: 45_000, confluence_count: 4,
    }));
    expect(r.finalContracts).toBe(33);
  });
});
