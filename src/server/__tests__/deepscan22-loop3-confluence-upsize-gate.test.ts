import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  computeRiskDerivedContracts,
  resolveConfluenceMultiplier,
  isConfluenceSizeUpsizeEnabled,
  type RiskSizingInputs,
} from "../lib/risk-sizing.js";
import { deriveEvidenceBackedConfluenceCount } from "../lib/confluence-provenance.js";

/**
 * Deep-scan #22 loop-3 (2026-07-09) — CONFLUENCE_SIZE_UPSIZE_ENABLED gate.
 *
 * The ds22 FIX F-1 fix (confluence-provenance.ts::deriveEvidenceBackedConfluenceCount,
 * commit 8bffa1b) correctly switched the sizing confluence_count derivation to read
 * evidence-backed confluence_factors instead of the type-mismatched confirming_indicators
 * field. That fix is correct — but landing it alone would have a SIDE EFFECT: because
 * confluence_factors is near-universally populated by the graduator (unlike the old buggy
 * read, which was usually empty), the previously-DEAD confluence-weighted upsize
 * (1.0x -> 1.5x/2.0x) would silently ACTIVATE for the common strategy shape — a
 * risk-direction size-INCREASE shipping without a conscious operator decision.
 *
 * This suite proves:
 *   1. Default (flag unset/false) -> resolveConfluenceMultiplier / computeRiskDerivedContracts
 *      produce a size NO-OP: multiplier pinned to 1.0 even with a high evidence-backed count
 *      AND a configured confluence_size_multiplier_map that would otherwise upsize.
 *   2. Flag ON -> the (F-1-fixed) evidence-backed count drives the upsize as W23H.4 intended,
 *      with auto_floor factors still correctly excluded from the count (F-1 correctness
 *      preserved under the flag, not just when the flag is off).
 *   3. Fail-safe: any non-exact-"true" env value (missing, "1", "TRUE", "yes", "") resolves
 *      to disabled — the safe default is always "no size change."
 */

const _PRIOR_UPSIZE_ENV = process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
afterAll(() => {
  if (_PRIOR_UPSIZE_ENV === undefined) delete process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
  else process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = _PRIOR_UPSIZE_ENV;
});
beforeEach(() => {
  // Ensure a clean default (unset) state before every test unless the test itself sets it.
  delete process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED;
});

// ── Shared MFFU $50K healthy account params (matches wave23h-confluence-sizing.test.ts) ──
// riskDollars = $50K × 0.02 = $1,000; stopDollars = 1.5 × 4 × $5 = $30; riskDerivedCap = 33
// pyramidTier (0 profit) = 6 (base); final (no multiplier) = min(6, 33, 100) = 6
const MFFU_50K_CFG: RiskSizingInputs["positionSizeConfig"] = {
  type: "risk_derived_pyramid",
  base_contracts: 6,
  tier_increment: 3,
  tier_threshold_dollars: 3000,
  personal_dll_pct: 0.67,
  max_risk_pct_per_trade: 0.02,
  liquidity_comfort_cap: 100,
  topstep_account_cap_override: null,
  computed_at_signal_time: true,
};
const MFFU_50K_INPUTS: Omit<RiskSizingInputs, "confluence_count" | "confluence_size_multiplier_map"> = {
  positionSizeConfig: MFFU_50K_CFG,
  firm: "mffu",
  accountBalance: 50_000,
  accountStartingFloor: 50_000,
  cumulativeProfit: 0,
  atrPoints: 4,
  stopMultiplier: 1.5,
  pointDollarValue: 5,
  firmContractCap: null,
};

describe("ds22 loop-3: default-OFF preserves historical (no-upsize) sizing", () => {
  it("isConfluenceSizeUpsizeEnabled() is false when the env var is unset", () => {
    expect(isConfluenceSizeUpsizeEnabled()).toBe(false);
  });

  it("resolveConfluenceMultiplier returns 1.0 for count=4 when flag is unset (default)", () => {
    expect(resolveConfluenceMultiplier(4)).toBe(1.0);
  });

  it("resolveConfluenceMultiplier returns 1.0 for count=3 even with a custom upsizing map, flag unset", () => {
    const customMap = { 1: 1.0, 2: 1.0, 3: 1.5, 4: 2.0 };
    expect(resolveConfluenceMultiplier(3, customMap)).toBe(1.0);
  });

  it("computeRiskDerivedContracts: genuine evidence-backed confluence_count=4 + configured multiplier map still yields the SAME finalContracts as confluence_count=1 (size no-op)", () => {
    const customMap = { 1: 1.0, 2: 1.0, 3: 1.5, 4: 2.0 };
    const baseline = computeRiskDerivedContracts({
      ...MFFU_50K_INPUTS,
      confluence_count: 1,
    } as RiskSizingInputs);
    const withGenuineConfluence = computeRiskDerivedContracts({
      ...MFFU_50K_INPUTS,
      confluence_count: 4,
      confluence_size_multiplier_map: customMap,
    } as RiskSizingInputs);

    // Historical (pre-ds22) effective behavior: multiplier always 1.0 regardless of count.
    expect(withGenuineConfluence.confluenceAudit.multiplier).toBe(1.0);
    expect(withGenuineConfluence.finalContracts).toBe(baseline.finalContracts);
    expect(withGenuineConfluence.finalContracts).toBe(6); // pyramidTier=6, unmultiplied
  });

  it("F-1 count correctness is unaffected by the gate: auto_floor-only factors still derive count=1 even with flag unset", () => {
    // The gate only affects whether the multiplier ACTIVATES — the count derivation
    // (F-1's actual fix) is unconditional and always correct.
    const count = deriveEvidenceBackedConfluenceCount({
      confluence_factors: ["regime_match", "structural_setup"],
    });
    expect(count).toBe(1);
    expect(resolveConfluenceMultiplier(count)).toBe(1.0);
  });

  it("fail-safe: near-miss env values do NOT enable the upsize", () => {
    for (const badValue of ["1", "TRUE", "True", "yes", "on", "  true", "true ", ""]) {
      process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = badValue;
      expect(isConfluenceSizeUpsizeEnabled()).toBe(false);
      expect(resolveConfluenceMultiplier(4)).toBe(1.0);
    }
  });
});

describe("ds22 loop-3: flag ON activates the (F-1-fixed) evidence-backed upsize", () => {
  it("isConfluenceSizeUpsizeEnabled() is true when the env var is exactly \"true\"", () => {
    process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = "true";
    expect(isConfluenceSizeUpsizeEnabled()).toBe(true);
  });

  it("resolveConfluenceMultiplier honors the canonical map when ON: count=3 -> 1.5, count=4 -> 2.0", () => {
    process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = "true";
    expect(resolveConfluenceMultiplier(3)).toBe(1.5);
    expect(resolveConfluenceMultiplier(4)).toBe(2.0);
  });

  it("computeRiskDerivedContracts: genuine 4-factor evidence-backed confluence upsizes pyramidTier 6 -> 12 when ON", () => {
    process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = "true";
    // Simulate the real pipeline: entry_quality with 3 genuine (non-auto_floor) factors.
    const entryQuality = {
      confluence_factors: ["vwap_alignment", "smt_confirmation", "liquidity_target_clear"],
    };
    const confluenceCount = deriveEvidenceBackedConfluenceCount(entryQuality);
    expect(confluenceCount).toBe(4); // 3 evidence-backed + 1 primary

    const result = computeRiskDerivedContracts({
      ...MFFU_50K_INPUTS,
      confluence_count: confluenceCount,
    } as RiskSizingInputs);

    // pyramidTierMultiplied = floor(6 × 2.0) = 12; riskDerivedCapMultiplied = floor(33×2.0)=66
    // min(12, 66, 100) = 12
    expect(result.confluenceAudit.multiplier).toBe(2.0);
    expect(result.finalContracts).toBe(12);
  });

  it("F-1 correctness holds even with the flag ON: auto_floor-only factors still yield count=1 -> multiplier 1.0 (no upsize on TF overlay padding)", () => {
    process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = "true";
    const entryQuality = {
      confluence_factors: ["regime_match", "structural_setup"],
    };
    const confluenceCount = deriveEvidenceBackedConfluenceCount(entryQuality);
    expect(confluenceCount).toBe(1);

    const result = computeRiskDerivedContracts({
      ...MFFU_50K_INPUTS,
      confluence_count: confluenceCount,
    } as RiskSizingInputs);

    expect(result.confluenceAudit.multiplier).toBe(1.0);
    expect(result.finalContracts).toBe(6); // unmultiplied pyramidTier, no upsize
  });

  it("F-1 correctness holds with the flag ON: mixed evidence-backed + auto_floor factors upsize only on the evidence-backed portion", () => {
    process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = "true";
    // 2 evidence-backed + 1 auto_floor = evidence-backed count 2, +1 primary = 3 -> 1.5x
    const entryQuality = {
      confluence_factors: ["vwap_alignment", "smt_confirmation", "regime_match"],
    };
    const confluenceCount = deriveEvidenceBackedConfluenceCount(entryQuality);
    expect(confluenceCount).toBe(3);

    const result = computeRiskDerivedContracts({
      ...MFFU_50K_INPUTS,
      confluence_count: confluenceCount,
    } as RiskSizingInputs);

    expect(result.confluenceAudit.multiplier).toBe(1.5);
    expect(result.finalContracts).toBe(9); // floor(6 × 1.5) = 9
  });
});

describe("ds22 loop-3: explicit upsizeEnabled parameter overrides env (direct-call testability)", () => {
  it("explicit upsizeEnabled=true param activates upsize even if env is unset", () => {
    // env deliberately left unset by beforeEach
    expect(resolveConfluenceMultiplier(4, undefined, true)).toBe(2.0);
  });

  it("explicit upsizeEnabled=false param disables upsize even if env is \"true\"", () => {
    process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED = "true";
    expect(resolveConfluenceMultiplier(4, undefined, false)).toBe(1.0);
  });
});
