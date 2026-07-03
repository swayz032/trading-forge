import { describe, it, expect } from "vitest";
import { groupIntoFamilies, LIFECYCLE_ORDER } from "../../lib/slumhouse/strategy-families.js";

const mk = (over: any) => ({ id: over.id, name: over.name, symbols: over.symbols ?? ["MES"], timeframe: over.timeframe ?? "15m", lifecycleState: over.lifecycleState, forgeScore: over.forgeScore ?? 0, config: over.config ?? { entry_indicator: "archetype:orb" } });

describe("groupIntoFamilies", () => {
  it("groups variants under one family and picks the furthest-along champion", () => {
    const rows = [
      mk({ id: "a", name: "orb_15m", timeframe: "15m", lifecycleState: "PAPER", forgeScore: 7 }),
      mk({ id: "b", name: "orb_30m", timeframe: "30m", lifecycleState: "TESTING", forgeScore: 9 }),
      mk({ id: "c", name: "orb_5m", timeframe: "5m", lifecycleState: "PAPER", forgeScore: 8 }),
    ];
    const fams = groupIntoFamilies(rows);
    expect(fams.length).toBe(1);
    expect(fams[0].premiumName).toBe("Opening Heist");
    expect(fams[0].variants.length).toBe(3);
    expect(fams[0].champion.id).toBe("c");
  });
  it("keeps distinct archetypes in separate families", () => {
    const rows = [ mk({ id: "a", name: "orb_15m", lifecycleState: "TESTING", config: { entry_indicator: "archetype:orb" } }),
                   mk({ id: "b", name: "silver_bullet", lifecycleState: "TESTING", config: { entry_indicator: "archetype:silver_bullet" } }) ];
    expect(groupIntoFamilies(rows).length).toBe(2);
  });
});

describe("LIFECYCLE_ORDER", () => {
  it("ranks DEPLOYED above PAPER above TESTING", () => {
    expect(LIFECYCLE_ORDER.DEPLOYED).toBeGreaterThan(LIFECYCLE_ORDER.PAPER);
    expect(LIFECYCLE_ORDER.PAPER).toBeGreaterThan(LIFECYCLE_ORDER.TESTING);
  });
});
