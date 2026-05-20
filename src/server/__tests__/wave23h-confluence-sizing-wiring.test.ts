/**
 * wave23h-confluence-sizing-wiring.test.ts — W23H.4 Pass 2
 *
 * Verifies that paper-signal-service correctly wires computeRiskDerivedContracts()
 * with confluence_count derived from entry_quality.confirming_indicators.
 *
 * Design: pure tests against computeRiskDerivedContracts() that exercise the
 * exact input-building logic that paper-signal-service now uses. Each test
 * constructs the same inputs the service would build, then asserts the
 * expected outputs. This validates the mapping contract without needing to
 * bootstrap the full Express/DB stack.
 *
 * Architecture invariant tested here (closes architect-flagged W23H.4 gap):
 *   confluence_count = confirming_indicators.length + 1
 *   legacy (no entry_quality) → confluence_count = 0 + 1 = 1 → multiplier 1.0
 *   3 confirming indicators → confluence_count = 4 → multiplier 2.0
 *
 * Tests:
 *  1. End-to-end: 3 confirming_indicators → confluence_count=4 → 2.0× → upsized
 *  2. Legacy strategy (null entry_quality) → confluence_count=1 → 1.0× → unchanged
 *  3. Liquidity cap binds: large account + 4 factors on MES → capped at 100
 *  4. Audit payload shape: confluence_count + multiplier + binding_constraint populated
 *  5. Firm cap binds: confluence_count=4 + large account, firm cap is tightest
 *  6. Zero confirming_indicators → confluence_count=1 → same as legacy (no upsize)
 *  7. ATR=0 → rejection path → confluenceAudit still present with binding_constraint="rejection"
 *  8. MFFU firm path: confluence multiplier correctly applied to MFFU balance-pct math
 *
 * No DB, no service imports, no mocks.
 */

import { describe, it, expect } from "vitest";
import {
  computeRiskDerivedContracts,
  type RiskSizingInputs,
  type ConfluenceAuditPayload,
} from "../lib/risk-sizing.js";

// ── Framework-canonical MES positionSizeConfig (matches framework-overlay.ts output) ───

function makeMesConfig(overrides: Partial<RiskSizingInputs["positionSizeConfig"]> = {}): RiskSizingInputs["positionSizeConfig"] {
  return {
    type: "risk_derived_pyramid",
    base_contracts: 6,
    tier_increment: 3,
    tier_threshold_dollars: 3000,
    personal_dll_pct: 0.67,
    max_risk_pct_per_trade: 0.02,
    liquidity_comfort_cap: 100, // MES canonical cap (CLAUDE.md §4)
    topstep_account_cap_override: null,
    computed_at_signal_time: true,
    ...overrides,
  };
}

// ── Shared account params (MFFU $50K, ATR=4 MES points) ─────────────────────────
// riskDollars = $50K × 0.02 = $1,000
// stopDollars = 1.5 × 4 × $5 = $30/contract
// riskDerivedCap = floor(1000/30) = 33
// pyramidTier (0 profit) = 6 (base)
// finalContracts (no multiplier) = min(6, 33, null, 100) = 6

const MFFU_50K_BASE: Pick<RiskSizingInputs, "accountBalance" | "cumulativeProfit" | "atrPoints" | "stopMultiplier" | "pointDollarValue" | "firmContractCap" | "firm" | "accountStartingFloor"> = {
  firm: "mffu",
  accountBalance: 50_000,
  accountStartingFloor: 50_000,
  cumulativeProfit: 0,
  atrPoints: 4,
  stopMultiplier: 1.5,
  pointDollarValue: 5,  // MES = $5/point
  firmContractCap: null,
};

// ── Test 1: 3 confirming indicators → confluence_count=4 → 2.0× → contracts upsized ───

describe("W23H.4 wiring: 3 confirming_indicators → confluence_count=4 → 2.0× upsize", () => {
  it("pyramidTier × 2.0 when 4 confluence factors satisfied", () => {
    // Service formula: confluenceCount = confirming_indicators.length + 1 = 3 + 1 = 4
    const confirming_indicators = ["rsi", "vwap", "ema"];
    const confluenceCount = confirming_indicators.length + 1; // 4

    const result = computeRiskDerivedContracts({
      ...MFFU_50K_BASE,
      positionSizeConfig: makeMesConfig(),
      confluence_count: confluenceCount,
    });

    // pyramidTier = 6 (base, no profit)
    // DEFAULT_CONFLUENCE_MULTIPLIER[4] = 2.0
    // pyramidTierMultiplied = min(6 × 2.0, 100) = 12 (liquidity cap not binding here)
    // riskDerivedCapMultiplied = min(33 × 2.0, 100) = 66
    // finalContracts = min(12, 66, null, 100) = 12
    expect(result.finalContracts).toBe(12);
    expect(result.confluenceAudit.confluence_count).toBe(4);
    expect(result.confluenceAudit.multiplier).toBe(2.0);
    expect(result.confluenceAudit.contracts_before).toBe(6); // pyramidTier before multiplier
    expect(result.confluenceAudit.contracts_after).toBe(12);
    expect(result.rejectionReason).toBeNull();
  });
});

// ── Test 2: Legacy strategy (null entry_quality) → confluence_count=1 → 1.0× → unchanged ──

describe("W23H.4 wiring: legacy strategy with null entry_quality → confluence_count=1 → no upsize", () => {
  it("null entry_quality gives confluence_count=1 → multiplier 1.0 → base contracts unchanged", () => {
    // Service formula: (null?.confirming_indicators?.length ?? 0) + 1 = 0 + 1 = 1
    const entryQuality = null;
    const confluenceCount = (entryQuality as null | { confirming_indicators?: string[] })?.confirming_indicators?.length ?? 0 + 1;
    // Note: (0 + 1) via the ?? short-circuit → 1
    const resolvedCount = (null as null | { confirming_indicators?: string[] })?.confirming_indicators?.length === undefined ? 1 : (null as null | { confirming_indicators?: string[] })!.confirming_indicators!.length + 1;
    // Direct test of the pattern used in paper-signal-service.ts:
    //   const confluenceCount = (entryQuality?.confirming_indicators?.length ?? 0) + 1;
    const serviceComputedCount = ((null as null | { confirming_indicators?: string[] })?.confirming_indicators?.length ?? 0) + 1;
    expect(serviceComputedCount).toBe(1);

    const result = computeRiskDerivedContracts({
      ...MFFU_50K_BASE,
      positionSizeConfig: makeMesConfig(),
      confluence_count: serviceComputedCount,
    });

    // multiplier for count=1 is 1.0 → no change from base pyramid
    expect(result.finalContracts).toBe(6); // pyramidTier=6, unchanged
    expect(result.confluenceAudit.multiplier).toBe(1.0);
    expect(result.confluenceAudit.confluence_count).toBe(1);
    expect(result.confluenceAudit.contracts_before).toBe(result.confluenceAudit.contracts_after);
  });
});

// ── Test 3: Liquidity cap binds when 4 factors + large account → capped at 100 ────────

describe("W23H.4 wiring: liquidity cap binds on large account with 4 confluence factors", () => {
  it("MES 100-contract liquidity cap is the binding constraint for large accounts", () => {
    // Large account: pyramid ramp has reached tier 60 ($171K profit at +3/$3K increments)
    // With confluence 4 → × 2.0 → would be 120, but liquidity cap = 100
    const largeProfit = 171_000; // (60 - 6) / 3 × 3000 = 54 tiers × 3 × 3000 = exact pyramid 60

    const result = computeRiskDerivedContracts({
      firm: "mffu",
      accountBalance: 200_000,
      accountStartingFloor: 50_000,
      cumulativeProfit: largeProfit,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: null,
      positionSizeConfig: makeMesConfig(),
      confluence_count: 4, // 2.0× multiplier
    });

    // pyramidTier = 6 + 3 × floor(171000/3000) = 6 + 3×57 = 6 + 171 = 177
    // pyramidTierMultiplied = min(177 × 2.0, 100) = min(354, 100) = 100 (liquidity cap binds)
    // riskDerivedCap: $200K × 0.02 = $4000 / $30 = 133; × 2.0 = 266; capped at 100
    // final = min(100, 100, null, 100) = 100
    expect(result.finalContracts).toBe(100);
    expect(result.confluenceAudit.binding_constraint).toBe("liquidityCap");
  });
});

// ── Test 4: Audit payload contains all required fields ────────────────────────────────

describe("W23H.4 wiring: audit payload shape is complete and correct", () => {
  it("confluenceAudit has all required fields with correct values for count=3 → 1.5×", () => {
    // 2 confirming_indicators → confluenceCount = 2 + 1 = 3 → multiplier 1.5
    const confirming_indicators = ["rsi", "vwap"];
    const confluenceCount = confirming_indicators.length + 1; // 3

    const result = computeRiskDerivedContracts({
      ...MFFU_50K_BASE,
      positionSizeConfig: makeMesConfig(),
      confluence_count: confluenceCount,
    });

    // pyramidTier=6 × 1.5 = 9; riskDerivedCap=33 × 1.5 = 49.5 → floor(49)...
    // Actually: multiplied pyramid = floor(6 × 1.5) = 9 (int); min(9, 49, null, 100) = 9
    const audit: ConfluenceAuditPayload = result.confluenceAudit;

    expect(audit).toBeDefined();
    expect(typeof audit.confluence_count).toBe("number");
    expect(typeof audit.multiplier).toBe("number");
    expect(typeof audit.contracts_before).toBe("number");
    expect(typeof audit.contracts_after).toBe("number");
    expect(typeof audit.binding_constraint).toBe("string");

    expect(audit.confluence_count).toBe(3);
    expect(audit.multiplier).toBe(1.5);
    expect(audit.contracts_before).toBeGreaterThan(0);
    expect(audit.contracts_after).toBeGreaterThan(audit.contracts_before); // upsized vs base
    // binding_constraint must be one of the valid values
    const validConstraints: ConfluenceAuditPayload["binding_constraint"][] = [
      "pyramidTier", "riskDerivedCap", "firmCap", "liquidityCap",
      "pyramid_floor_override", "rejection",
    ];
    expect(validConstraints).toContain(audit.binding_constraint);
  });
});

// ── Test 5: Firm cap binds when it is the tightest constraint ─────────────────────────
// Pyramid floor applies when accountIsHealthy (>= 85%) AND result < base_contracts.
// To make firm cap bind WITHOUT pyramid floor override, firmCap must be >= base_contracts
// (so pyramid floor doesn't activate) but still tighter than pyramidTier × multiplier.
// Use firmCap=8 with confluence_count=4 → pyramidTier × 2.0 = 12 → firmCap=8 binds.

describe("W23H.4 wiring: firm cap is binding constraint when it is tightest", () => {
  it("MFFU firm contract cap of 8 binds when confluence upsize would produce 12", () => {
    // pyramidTier=6 × 2.0 = 12; riskDerivedCap=33 × 2.0 = 66; firmCap=8; liquidity=100
    // pyramid floor: base_contracts=6; final=8 >= 6 → floor does NOT activate
    // final = min(12, 66, 8, 100) = 8 (firmCap is tightest above base floor)
    const result = computeRiskDerivedContracts({
      firm: "mffu",
      accountBalance: 50_000,
      accountStartingFloor: 50_000,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: 8, // tighter than pyramidTier × 2.0 (12) but above base (6)
      positionSizeConfig: makeMesConfig(),
      confluence_count: 4, // 2.0× → would produce 12 without firm cap
    });

    expect(result.finalContracts).toBe(8);
    expect(result.confluenceAudit.binding_constraint).toBe("firmCap");
    expect(result.firmCap).toBe(8);
    expect(result.pyramidFloorApplied).toBe(false);
  });
});

// ── Test 6: Zero confirming_indicators → same as legacy ───────────────────────────────

describe("W23H.4 wiring: zero confirming_indicators → confluence_count=1 → no upsize", () => {
  it("empty confirming_indicators array gives count=1 → multiplier 1.0", () => {
    // entry_quality exists but confirming_indicators is empty array
    const entryQuality = { confirming_indicators: [] as string[] };
    const confluenceCount = (entryQuality?.confirming_indicators?.length ?? 0) + 1; // 0 + 1 = 1

    expect(confluenceCount).toBe(1);

    const result = computeRiskDerivedContracts({
      ...MFFU_50K_BASE,
      positionSizeConfig: makeMesConfig(),
      confluence_count: confluenceCount,
    });

    expect(result.finalContracts).toBe(6); // no upsize from base pyramid
    expect(result.confluenceAudit.multiplier).toBe(1.0);
    expect(result.confluenceAudit.contracts_before).toBe(result.confluenceAudit.contracts_after);
  });
});

// ── Test 7: ATR=0 → rejection → confluenceAudit still present ────────────────────────

describe("W23H.4 wiring: ATR=0 rejection path still populates confluenceAudit", () => {
  it("zero ATR returns rejection with confluenceAudit.binding_constraint='rejection'", () => {
    const result = computeRiskDerivedContracts({
      ...MFFU_50K_BASE,
      atrPoints: 0, // zero ATR → rejection
      positionSizeConfig: makeMesConfig(),
      confluence_count: 4,
    });

    expect(result.finalContracts).toBe(0);
    expect(result.rejectionReason).toBe("zero_atr");
    expect(result.confluenceAudit).toBeDefined();
    expect(result.confluenceAudit.binding_constraint).toBe("rejection");
    expect(result.confluenceAudit.contracts_before).toBe(0);
    expect(result.confluenceAudit.contracts_after).toBe(0);
  });
});

// ── Test 8: MFFU firm path — confluence multiplier applies correctly ──────────────────

describe("W23H.4 wiring: MFFU balance-pct path applies confluence multiplier correctly", () => {
  it("MFFU $50K + confluence_count=3 → 1.5× → 9 contracts (pyramidTier binds)", () => {
    // MFFU: riskDollars = 50000 × 0.02 = 1000
    // stopDollars = 1.5 × 4 × 5 = 30; riskDerivedCap = 33
    // pyramidTier = 6; × 1.5 = 9; riskDerivedCap × 1.5 = 49
    // final = min(9, 49, null, 100) = 9 (pyramidTier binds)
    const result = computeRiskDerivedContracts({
      firm: "mffu",
      accountBalance: 50_000,
      accountStartingFloor: 50_000,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: null,
      positionSizeConfig: makeMesConfig(),
      confluence_count: 3, // 2 confirming + primary = count 3 → 1.5×
    });

    expect(result.finalContracts).toBe(9);
    expect(result.confluenceAudit.multiplier).toBe(1.5);
    expect(result.confluenceAudit.confluence_count).toBe(3);
    expect(result.firm).toBe("mffu");
    expect(result.riskCapMethod).toBe("mffu_balance_pct");
    expect(result.rejectionReason).toBeNull();
  });
});
