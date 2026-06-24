import { describe, it, expect, afterEach, vi } from "vitest";
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

  it("proximity constant default is 2% (no env set)", () => {
    expect(PRICE_LOCK_PROXIMITY_PCT).toBe(0.02);
  });
});

describe("price-lock-limit-gate — PRICE_LOCK_PROXIMITY_PCT env override (L2)", () => {
  const origEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...origEnv };
    vi.resetModules();
  });

  async function loadConst(): Promise<number> {
    vi.resetModules();
    const mod = await import("../lib/price-lock-limit-gate.js");
    return mod.PRICE_LOCK_PROXIMITY_PCT;
  }

  it("default is 0.02 when env unset", async () => {
    delete process.env.PRICE_LOCK_PROXIMITY_PCT;
    expect(await loadConst()).toBe(0.02);
  });

  it("honors a valid (0,1) override", async () => {
    process.env.PRICE_LOCK_PROXIMITY_PCT = "0.03";
    expect(await loadConst()).toBe(0.03);
  });

  it("falls back to default on NaN", async () => {
    process.env.PRICE_LOCK_PROXIMITY_PCT = "not-a-number";
    expect(await loadConst()).toBe(0.02);
  });

  it("falls back to default on ≤0", async () => {
    process.env.PRICE_LOCK_PROXIMITY_PCT = "0";
    expect(await loadConst()).toBe(0.02);
    process.env.PRICE_LOCK_PROXIMITY_PCT = "-0.5";
    expect(await loadConst()).toBe(0.02);
  });

  it("falls back to default on ≥1 (out of fraction range)", async () => {
    process.env.PRICE_LOCK_PROXIMITY_PCT = "1.5";
    expect(await loadConst()).toBe(0.02);
  });

  it("a wider override actually widens the live block band", async () => {
    process.env.PRICE_LOCK_PROXIMITY_PCT = "0.05";
    vi.resetModules();
    const { checkPriceLockLimit: check } = await import("../lib/price-lock-limit-gate.js");
    // ES settlement 5000 → up-limit 5350. Price 5180 is 3.3% below 5350:
    // within the 5% band → blocked (would NOT block at the 2% default).
    expect(check("ES", 5180, 5000).blocked).toBe(true);
  });
});
