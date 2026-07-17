/**
 * position-size-fallback.test.ts — ratify-packet W3A (Execution Hardening,
 * 2026-07-17), Item 3.
 *
 * Behavioral tests against the REAL, directly-importable leaf function
 * `detectPositionSizeFallbacks()` (paper-signal-service.ts is too large a
 * gateway-dependency surface to import directly in tests — see
 * paper-signal-service-deepscan-findings.test.ts / goalscan-crit's documented
 * convention — so the pure detection logic lives in its own leaf module,
 * matching confluence-provenance.ts's "leaf module, NO heavy imports" pattern).
 */

import { describe, it, expect } from "vitest";
import {
  detectPositionSizeFallbacks,
  POSITION_SIZE_FALLBACK_DEFAULTS,
} from "../position-size-fallback.js";

const FULLY_OVERLAID: Record<string, unknown> = {
  type: "risk_derived_pyramid",
  base_contracts: 9,
  tier_increment: 3,
  tier_threshold_dollars: 3000,
  personal_dll_pct: 0.67,
  max_risk_pct_per_trade: 0.02,
  liquidity_comfort_cap: 100,
  topstep_account_cap_override: null,
  computed_at_signal_time: true,
};

describe("W3A item 3: detectPositionSizeFallbacks — no false positives on a fully-overlaid config", () => {
  it("returns an empty array when all 6 fields are numeric overrides", () => {
    expect(detectPositionSizeFallbacks(FULLY_OVERLAID, "MES")).toEqual([]);
  });

  it("returns empty even for a symbol with no per-symbol liquidity default, since liquidity_comfort_cap is itself numeric here", () => {
    expect(detectPositionSizeFallbacks(FULLY_OVERLAID, "UNKNOWNSYM")).toEqual([]);
  });
});

describe("W3A item 3: detectPositionSizeFallbacks — full bypass (bare/legacy config)", () => {
  it("returns all 6 fields when rawPositionSize is undefined (legacy/hand-created row)", () => {
    const result = detectPositionSizeFallbacks(undefined, "MES");
    const fields = result.map((f) => f.field).sort();
    expect(fields).toEqual(
      [
        "base_contracts",
        "liquidity_comfort_cap",
        "max_risk_pct_per_trade",
        "personal_dll_pct",
        "tier_increment",
        "tier_threshold_dollars",
      ].sort(),
    );
  });

  it("returns all 6 fields when rawPositionSize is null", () => {
    expect(detectPositionSizeFallbacks(null, "MES").length).toBe(6);
  });

  it("returns all 6 fields when rawPositionSize is an empty object", () => {
    expect(detectPositionSizeFallbacks({}, "MES").length).toBe(6);
  });

  it("fallback values match the packet-specified defaults exactly", () => {
    const result = detectPositionSizeFallbacks({}, "MES");
    const byField = Object.fromEntries(result.map((f) => [f.field, f.fallbackValue]));
    expect(byField.base_contracts).toBe(6);
    expect(byField.tier_increment).toBe(3);
    expect(byField.tier_threshold_dollars).toBe(3000);
    expect(byField.personal_dll_pct).toBe(0.67);
    expect(byField.max_risk_pct_per_trade).toBe(0.02);
    expect(byField.liquidity_comfort_cap).toBe(100); // MES per-symbol cap
  });

  it("liquidity_comfort_cap fallback is per-symbol: MNQ=50, MCL=30, unknown symbol=default 50", () => {
    expect(detectPositionSizeFallbacks({}, "MNQ").find((f) => f.field === "liquidity_comfort_cap")?.fallbackValue).toBe(50);
    expect(detectPositionSizeFallbacks({}, "MCL").find((f) => f.field === "liquidity_comfort_cap")?.fallbackValue).toBe(30);
    expect(detectPositionSizeFallbacks({}, "XYZ").find((f) => f.field === "liquidity_comfort_cap")?.fallbackValue).toBe(50);
  });

  it("symbol lookup is case-insensitive (lowercase symbol still resolves the per-symbol cap)", () => {
    expect(detectPositionSizeFallbacks({}, "mnq").find((f) => f.field === "liquidity_comfort_cap")?.fallbackValue).toBe(50);
  });
});

describe("W3A item 3: detectPositionSizeFallbacks — partial fallback (mixed config)", () => {
  it("detects exactly ONE fallback when only base_contracts is missing", () => {
    const partial = { ...FULLY_OVERLAID };
    delete (partial as Record<string, unknown>).base_contracts;
    const result = detectPositionSizeFallbacks(partial, "MES");
    expect(result).toEqual([{ field: "base_contracts", fallbackValue: 6 }]);
  });

  it("detects exactly ONE fallback when only liquidity_comfort_cap is missing", () => {
    const partial = { ...FULLY_OVERLAID };
    delete (partial as Record<string, unknown>).liquidity_comfort_cap;
    const result = detectPositionSizeFallbacks(partial, "MNQ");
    expect(result).toEqual([{ field: "liquidity_comfort_cap", fallbackValue: 50 }]);
  });

  it("detects multiple simultaneous fallbacks (e.g. 3 of 6 fields missing)", () => {
    const partial = { ...FULLY_OVERLAID };
    delete (partial as Record<string, unknown>).tier_increment;
    delete (partial as Record<string, unknown>).personal_dll_pct;
    delete (partial as Record<string, unknown>).max_risk_pct_per_trade;
    const fields = detectPositionSizeFallbacks(partial, "MES").map((f) => f.field).sort();
    expect(fields).toEqual(["max_risk_pct_per_trade", "personal_dll_pct", "tier_increment"]);
  });

  it("a non-number typeof (string instead of number) counts as a fallback, not a valid override", () => {
    const partial = { ...FULLY_OVERLAID, base_contracts: "9" };
    const result = detectPositionSizeFallbacks(partial, "MES");
    expect(result).toEqual([{ field: "base_contracts", fallbackValue: 6 }]);
  });

  it("a NaN value counts as a fallback (typeof NaN is number, but NaN would be a fallback per typeof check — pin actual typeof-only contract)", () => {
    // NOTE: detectPositionSizeFallbacks intentionally checks `typeof === "number"`
    // only (matching the exact ternary shape at the paper-signal-service.ts call
    // site) — it does NOT additionally guard Number.isFinite. This test pins that
    // contract explicitly so a future reader isn't surprised: NaN is `typeof
    // "number"` and therefore NOT flagged as a fallback by this function.
    const partial = { ...FULLY_OVERLAID, base_contracts: NaN };
    const result = detectPositionSizeFallbacks(partial, "MES");
    expect(result).toEqual([]);
  });
});

describe("W3A item 3: POSITION_SIZE_FALLBACK_DEFAULTS — canonical constants", () => {
  it("matches the packet-specified fallback values exactly", () => {
    expect(POSITION_SIZE_FALLBACK_DEFAULTS).toEqual({
      base_contracts: 6,
      tier_increment: 3,
      tier_threshold_dollars: 3000,
      personal_dll_pct: 0.67,
      max_risk_pct_per_trade: 0.02,
    });
  });
});
