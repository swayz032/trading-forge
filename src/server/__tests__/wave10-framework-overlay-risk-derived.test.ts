/**
 * Wave 10 Task 2 — framework-overlay.ts risk_derived_pyramid tests
 *
 * Verifies the overlay writes risk_derived_pyramid, never writes max_contracts,
 * and correctly transforms profit_tier_pyramid configs.
 */

import { describe, it, expect } from "vitest";
import { applyFrameworkOverlay } from "../services/framework-overlay.js";

function makeMinimalConfig(positionSize?: Record<string, unknown>): Record<string, unknown> {
  return {
    strategy: {
      name: "test_strategy",
      stop_loss: { type: "atr", multiplier: 1.5 },
      ...(positionSize ? { position_size: positionSize } : {}),
    },
    exit_type: "trailing_stop",
    direction: "long",
    entry_type: "limit",
  };
}

describe("Wave 10 Task 2: framework-overlay risk_derived_pyramid", () => {

  describe("New strategy (no position_size)", () => {
    it("inserts risk_derived_pyramid with all required fields", () => {
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig() as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MES",
      });
      const ps = result.config.strategy?.position_size as Record<string, unknown>;
      expect(ps.type).toBe("risk_derived_pyramid");
      expect(ps.base_contracts).toBe(6);
      expect(ps.tier_increment).toBe(3);
      expect(ps.tier_threshold_dollars).toBe(3000);
      expect(ps.personal_dll_pct).toBe(0.67);
      expect(ps.max_risk_pct_per_trade).toBe(0.02);
      expect(ps.liquidity_comfort_cap).toBe(100);
      expect(ps.computed_at_signal_time).toBe(true);
    });

    it("NEVER writes max_contracts", () => {
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig() as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MES",
      });
      const ps = result.config.strategy?.position_size as Record<string, unknown>;
      expect("max_contracts" in ps).toBe(false);
    });

    it("NEVER writes target_risk_dollars", () => {
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig() as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MES",
      });
      const ps = result.config.strategy?.position_size as Record<string, unknown>;
      expect("target_risk_dollars" in ps).toBe(false);
    });

    it("MNQ uses base_contracts=6 per framework", () => {
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig() as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MNQ",
      });
      const ps = result.config.strategy?.position_size as Record<string, unknown>;
      expect(ps.base_contracts).toBe(6);
    });
  });

  describe("Existing profit_tier_pyramid → transform", () => {
    it("transforms profit_tier_pyramid to risk_derived_pyramid", () => {
      const existing = {
        type: "profit_tier_pyramid",
        base_contracts: 4,
        tier_increment: 2,
        tier_threshold_dollars: 3000,
        max_contracts: 6,  // the bug — must be removed
        personal_dll_pct: 0.67,
        target_risk_dollars: 500,  // placeholder — must be removed
      };
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig(existing) as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MES",
      });
      const ps = result.config.strategy?.position_size as Record<string, unknown>;
      expect(ps.type).toBe("risk_derived_pyramid");
    });

    it("removes max_contracts from existing profit_tier_pyramid", () => {
      const existing = {
        type: "profit_tier_pyramid",
        max_contracts: 6,
        base_contracts: 4,
        tier_increment: 2,
        tier_threshold_dollars: 3000,
        personal_dll_pct: 0.67,
      };
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig(existing) as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MES",
      });
      const ps = result.config.strategy?.position_size as Record<string, unknown>;
      expect("max_contracts" in ps).toBe(false);
    });

    it("removes target_risk_dollars from existing config", () => {
      const existing = {
        type: "profit_tier_pyramid",
        max_contracts: 30,
        target_risk_dollars: 500,
      };
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig(existing) as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MES",
      });
      const ps = result.config.strategy?.position_size as Record<string, unknown>;
      expect("target_risk_dollars" in ps).toBe(false);
    });

    it("overrides base_contracts + tier_increment with framework-canonical values (W23F.N — sizing is framework-authoritative)", () => {
      const existing = {
        type: "profit_tier_pyramid",
        base_contracts: 6,
        tier_increment: 4,
        tier_threshold_dollars: 5000,
        max_contracts: 30,
      };
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig(existing) as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MES",
      });
      const ps = result.config.strategy?.position_size as Record<string, unknown>;
      expect(ps.base_contracts).toBe(6);  // framework canonical MES=6
      expect(ps.tier_increment).toBe(3);  // framework canonical increment=3
      expect(ps.tier_threshold_dollars).toBe(3000);  // framework canonical threshold=3000
    });
  });

  describe("Already risk_derived_pyramid (idempotent)", () => {
    it("existing risk_derived_pyramid with no max_contracts → no-op on type", () => {
      const existing = {
        type: "risk_derived_pyramid",
        base_contracts: 4,
        tier_increment: 2,
        tier_threshold_dollars: 3000,
        personal_dll_pct: 0.67,
        max_risk_pct_per_trade: 0.02,
        liquidity_comfort_cap: 100,
        topstep_account_cap_override: null,
        computed_at_signal_time: true,
      };
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig(existing) as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MES",
      });
      const ps = result.config.strategy?.position_size as Record<string, unknown>;
      expect(ps.type).toBe("risk_derived_pyramid");
      expect("max_contracts" in ps).toBe(false);
    });

    it("existing risk_derived_pyramid that somehow still has max_contracts → removes it", () => {
      const existing = {
        type: "risk_derived_pyramid",
        base_contracts: 4,
        max_contracts: 30,  // regression — overlay must purge this
      };
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig(existing) as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MES",
      });
      const ps = result.config.strategy?.position_size as Record<string, unknown>;
      expect("max_contracts" in ps).toBe(false);
    });
  });

  describe("appliedRules audit trail", () => {
    it("reports max_contracts removal in appliedRules", () => {
      const existing = {
        type: "profit_tier_pyramid",
        max_contracts: 6,
        base_contracts: 4,
      };
      const result = applyFrameworkOverlay({
        compiled: makeMinimalConfig(existing) as Parameters<typeof applyFrameworkOverlay>[0]["compiled"],
        source: "graduated_bucket",
        symbol: "MES",
      });
      const removal = result.appliedRules.some(r => r.includes("max_contracts") && r.includes("REMOVED"));
      expect(removal).toBe(true);
    });
  });
});
