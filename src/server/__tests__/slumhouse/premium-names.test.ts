import { describe, it, expect } from "vitest";
import { familyKeyFor, resolvePremiumName } from "../../lib/slumhouse/premium-names.js";

const base = { name: "orb_15m", symbols: ["MES"], timeframe: "15m", config: { entry_indicator: "archetype:opening_range_breakout" } };

describe("familyKeyFor", () => {
  it("prefers the archetype from config.entry_indicator, stripped + normalized", () => {
    expect(familyKeyFor(base)).toBe("opening_range_breakout");
  });
  it("falls back to the raw name with timeframe/symbol/session suffixes stripped", () => {
    expect(familyKeyFor({ name: "connors_rsi2_mes_15m", symbols: ["MES"], timeframe: "15m", config: {} })).toBe("connors_rsi2");
  });
});

describe("resolvePremiumName", () => {
  it("maps a known family to its premium name", () => {
    const r = resolvePremiumName(base);
    expect(r.premiumName).toBe("Opening Heist");
    expect(r.family).toBe("opening_range_breakout");
    expect(r.variantTag).toBe("15m · MES");
  });
  it("adds a session to the variant tag when present in the raw name", () => {
    const r = resolvePremiumName({ name: "ict_silver_bullet_ny_am", symbols: ["MNQ"], timeframe: "15m", config: { entry_indicator: "archetype:silver_bullet" } });
    expect(r.premiumName).toBe("Silver Bullet");
    expect(r.variantTag).toBe("15m · MNQ · NY AM");
  });
  it("never returns blank — falls back to Title-Cased raw name", () => {
    const r = resolvePremiumName({ name: "weird_new_thing_9000", symbols: ["MES"], timeframe: "5m", config: {} });
    expect(r.premiumName).toBe("Weird New Thing 9000");
    expect(r.family).toBe("weird_new_thing_9000");
  });
});
