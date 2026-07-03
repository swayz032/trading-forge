import { describe, it, expect } from "vitest";
import {
  classifyStrategyForBackfill,
  normalizeStrategyNamePy,
  normalizeRegistryEntry,
  type StrategyRowForBackfill,
} from "../playbook-registration-backfill.js";

describe("playbook-registration-backfill — normalization (mirrors apply_eligibility_gate exactly)", () => {
  it("normalizeStrategyNamePy strips 'strategy' substring, trims, strips underscores", () => {
    expect(normalizeStrategyNamePy("silver_bullet")).toBe("silverbullet");
    expect(normalizeStrategyNamePy("SilverBulletStrategy")).toBe("silverbullet");
    expect(normalizeStrategyNamePy("  breaker_strategy_v2  ")).toBe("breakerv2");
  });

  it("normalizeRegistryEntry only strips underscores (no 'strategy' stripping — asymmetric by design, matches the real gate)", () => {
    expect(normalizeRegistryEntry("ict_swing")).toBe("ictswing");
    expect(normalizeRegistryEntry("breaker")).toBe("breaker");
  });
});

describe("playbook-registration-backfill — classifyStrategyForBackfill", () => {
  const registered = new Set(["ote", "ict_swing", "propulsion", "breaker", "eqhl_raid"]);

  it("classifies a registered strategy as 'registered'", () => {
    const row: StrategyRowForBackfill = {
      id: "1",
      name: "ict_swing",
      symbol: "MES",
      source: "graduated_bucket",
      lifecycleState: "DEPLOYED",
      config: {},
    };
    const result = classifyStrategyForBackfill(row, registered);
    expect(result.status).toBe("registered");
  });

  it("classifies a graduated strategy with a market+timeframe suffixed name as 'unregistered' (the core finding)", () => {
    // This is the actual shape of ~100 pre-existing graduated strategies:
    // concept_market_timeframe, which never normalized-matches a bare
    // ALL_STRATS entry like "breaker" or "ote".
    const row: StrategyRowForBackfill = {
      id: "2",
      name: "orb_mnq_15m",
      symbol: "MNQ",
      source: "graduated_bucket",
      lifecycleState: "PAPER",
      config: {},
    };
    const result = classifyStrategyForBackfill(row, registered);
    expect(result.status).toBe("unregistered");
    expect(result.proposedCategory).toBe("CONTINUATION_STRATS"); // no archetype -> documented default
  });

  it("derives archetypeKey from config.strategy.entry_indicator = 'archetype:X' and proposes the matching category", () => {
    const row: StrategyRowForBackfill = {
      id: "3",
      name: "breaker_block_mes_5m",
      symbol: "MES",
      source: "graduated_bucket",
      lifecycleState: "TESTING",
      config: { strategy: { entry_indicator: "archetype:ict_breaker" } },
    };
    const result = classifyStrategyForBackfill(row, registered);
    expect(result.status).toBe("unregistered");
    expect(result.archetypeKey).toBe("ict_breaker");
    expect(result.proposedCategory).toBe("REVERSAL_STRATS");
  });

  it("derives archetypeKey from config.strategy.indicators[0].type when entry_indicator is absent", () => {
    const row: StrategyRowForBackfill = {
      id: "4",
      name: "midnight_open_mcl_1h",
      symbol: "MCL",
      source: "graduated_bucket",
      lifecycleState: "PAPER",
      config: { strategy: { indicators: [{ type: "archetype:ict_midnight_open" }] } },
    };
    const result = classifyStrategyForBackfill(row, registered);
    expect(result.archetypeKey).toBe("ict_midnight_open");
    expect(result.proposedCategory).toBe("MEAN_REV_STRATS");
  });

  it("classifies an empty/missing name as 'unresolvable' (never silently registered or skipped)", () => {
    const row: StrategyRowForBackfill = {
      id: "5",
      name: "",
      symbol: "MES",
      source: "graduated_bucket",
      lifecycleState: "CANDIDATE",
      config: {},
    };
    const result = classifyStrategyForBackfill(row, registered);
    expect(result.status).toBe("unresolvable");
    expect(result.reason).toBe("empty_or_missing_name");
    expect(result.proposedCategory).toBeNull();
  });

  it("never throws on a null/malformed config", () => {
    const row: StrategyRowForBackfill = {
      id: "6",
      name: "some_strategy_mes_5m",
      symbol: "MES",
      source: "manual",
      lifecycleState: "CANDIDATE",
      config: null,
    };
    expect(() => classifyStrategyForBackfill(row, registered)).not.toThrow();
    const result = classifyStrategyForBackfill(row, registered);
    expect(result.status).toBe("unregistered");
    expect(result.archetypeKey).toBeNull();
  });

  it("preserves id/symbol/source/lifecycleState pass-through for the report", () => {
    const row: StrategyRowForBackfill = {
      id: "7",
      name: "test_strategy_mnq_1h",
      symbol: "MNQ",
      source: "spec_onboarding",
      lifecycleState: "NEEDS_ARCHETYPE",
      config: {},
    };
    const result = classifyStrategyForBackfill(row, registered);
    expect(result.id).toBe("7");
    expect(result.symbol).toBe("MNQ");
    expect(result.source).toBe("spec_onboarding");
    expect(result.lifecycleState).toBe("NEEDS_ARCHETYPE");
  });
});
