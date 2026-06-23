import { describe, it, expect, afterEach } from "vitest";
import { checkPriceLockLimit, PRICE_LOCK_PROXIMITY_PCT } from "../lib/price-lock-limit-gate.js";

describe("price-lock-limit-gate (Topstep Prohibited Conduct — within 2% of price limit)", () => {
  const origEnv = { ...process.env };
  afterEach(() => { process.env = { ...origEnv }; });

  // ES settlement 5000 → ±7% limits = 5350 (up) / 4650 (down).
  it("BLOCKS when within 2% of the up-limit (price 5300 near 5350)", () => {
    const r = checkPriceLockLimit("ES", 5300, 5000);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("near_up_limit");
  });

  it("BLOCKS when within 2% of the down-limit (price 4700 near 4650)", () => {
    const r = checkPriceLockLimit("ES", 4700, 5000);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("near_down_limit");
  });

  it("ALLOWS mid-range price (5000, nowhere near ±7%)", () => {
    const r = checkPriceLockLimit("ES", 5000, 5000);
    expect(r.blocked).toBe(false);
  });

  it("ALLOWS a normal intraday move (5100, ~2% up, far from the 5350 limit)", () => {
    expect(checkPriceLockLimit("ES", 5100, 5000).blocked).toBe(false);
  });

  it("FAIL-OPEN when reference settlement is missing/invalid", () => {
    expect(checkPriceLockLimit("ES", 5300, null).blocked).toBe(false);
    expect(checkPriceLockLimit("ES", 5300, null).reason).toBe("no_reference");
    expect(checkPriceLockLimit("ES", 5300, 0).blocked).toBe(false);
  });

  it("env override of the limit pct widens/narrows the band", () => {
    process.env.PRICE_LOCK_LIMIT_PCT_ES = "0.10"; // ±10% → up-limit 5500
    // price 5300 is now >2% from 5500 → allowed
    expect(checkPriceLockLimit("ES", 5300, 5000).blocked).toBe(false);
    // price 5450 is within 2% of 5500 → blocked
    expect(checkPriceLockLimit("ES", 5450, 5000).blocked).toBe(true);
  });

  it("proximity constant is 2%", () => {
    expect(PRICE_LOCK_PROXIMITY_PCT).toBe(0.02);
  });
});
