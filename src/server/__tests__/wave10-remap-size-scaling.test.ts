/**
 * Wave 10 Task 1 — remapMarket() size scaling tests
 *
 * Verifies that ES→MES / NQ→MNQ / CL→MCL contract counts are scaled 10×,
 * already-micro symbols are 1×, and unsupported symbols return null.
 *
 * Design: mirrors the logic in src/server/routes/agent.ts without importing
 * the route module directly (to avoid Express/DB bootstrap in tests).
 */

import { describe, it, expect } from "vitest";

// ── Mirror of MARKET_REMAP + MARKET_SIZE_MULTIPLIER from agent.ts ────────────
const MARKET_REMAP: Record<string, "MES" | "MNQ" | "MCL"> = {
  MES: "MES", MNQ: "MNQ", MCL: "MCL",
  ES: "MES", NQ: "MNQ", CL: "MCL",
  "/ES": "MES", "/NQ": "MNQ", "/CL": "MCL",
  "ES1!": "MES", "NQ1!": "MNQ", "CL1!": "MCL",
  EMINI_SP: "MES", EMINI_NQ: "MNQ",
  SPY: "MES",
  QQQ: "MNQ",
};
const MARKET_SIZE_MULTIPLIER: Record<string, number> = {
  ES: 10, NQ: 10, CL: 10,
  "/ES": 10, "/NQ": 10, "/CL": 10,
  "ES1!": 10, "NQ1!": 10, "CL1!": 10,
  EMINI_SP: 10, EMINI_NQ: 10,
  MES: 1, MNQ: 1, MCL: 1,
  SPY: 1, QQQ: 1,
};

interface RemapResult { market: "MES" | "MNQ" | "MCL"; sizeMultiplier: number }
function remapMarket(raw: string): RemapResult | null {
  const k = String(raw ?? "").toUpperCase().trim();
  const market = MARKET_REMAP[k] ?? null;
  if (!market) return null;
  return { market, sizeMultiplier: MARKET_SIZE_MULTIPLIER[k] ?? 1 };
}

function applyScaling(
  rawSymbol: string,
  rawMaxContracts: number | null,
  rawBaseContracts: number | null,
  rawTierIncrement: number | null,
): {
  market: "MES" | "MNQ" | "MCL" | null;
  sizeMultiplier: number;
  scaledMaxContracts: number | null;
  scaledBaseContracts: number | null;
  scaledTierIncrement: number | null;
} {
  const remapped = remapMarket(rawSymbol);
  if (!remapped) return { market: null, sizeMultiplier: 0, scaledMaxContracts: null, scaledBaseContracts: null, scaledTierIncrement: null };
  const { market, sizeMultiplier } = remapped;
  return {
    market,
    sizeMultiplier,
    scaledMaxContracts:  rawMaxContracts  !== null ? Math.round(rawMaxContracts  * sizeMultiplier) : null,
    scaledBaseContracts: rawBaseContracts !== null ? Math.round(rawBaseContracts * sizeMultiplier) : null,
    scaledTierIncrement: rawTierIncrement !== null ? Math.round(rawTierIncrement * sizeMultiplier) : null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Wave 10 Task 1: remapMarket size scaling", () => {

  describe("ES → MES (10× scale)", () => {
    it("ES + max_contracts:3 → MES + max_contracts:30", () => {
      const r = applyScaling("ES", 3, null, null);
      expect(r.market).toBe("MES");
      expect(r.sizeMultiplier).toBe(10);
      expect(r.scaledMaxContracts).toBe(30);
    });

    it("ES with base_contracts:4 + tier_increment:2 → MES with 40 + 20", () => {
      const r = applyScaling("ES", null, 4, 2);
      expect(r.market).toBe("MES");
      expect(r.scaledBaseContracts).toBe(40);
      expect(r.scaledTierIncrement).toBe(20);
    });

    it("/ES canonical futures symbol → 10× scale", () => {
      const r = applyScaling("/ES", 5, null, null);
      expect(r.market).toBe("MES");
      expect(r.scaledMaxContracts).toBe(50);
    });

    it("ES1! TradingView format → 10× scale", () => {
      const r = applyScaling("ES1!", 2, null, null);
      expect(r.market).toBe("MES");
      expect(r.scaledMaxContracts).toBe(20);
    });
  });

  describe("NQ → MNQ (10× scale)", () => {
    it("NQ + max_contracts:5 → MNQ + max_contracts:50", () => {
      const r = applyScaling("NQ", 5, null, null);
      expect(r.market).toBe("MNQ");
      expect(r.sizeMultiplier).toBe(10);
      expect(r.scaledMaxContracts).toBe(50);
    });
  });

  describe("CL → MCL (10× scale)", () => {
    it("CL + max_contracts:2 → MCL + max_contracts:20", () => {
      const r = applyScaling("CL", 2, null, null);
      expect(r.market).toBe("MCL");
      expect(r.sizeMultiplier).toBe(10);
      expect(r.scaledMaxContracts).toBe(20);
    });
  });

  describe("Already-micro symbols (1× no-op)", () => {
    it("MES + max_contracts:30 → MES + max_contracts:30 (no-op)", () => {
      const r = applyScaling("MES", 30, null, null);
      expect(r.market).toBe("MES");
      expect(r.sizeMultiplier).toBe(1);
      expect(r.scaledMaxContracts).toBe(30);
    });

    it("MNQ + max_contracts:30 → MNQ + max_contracts:30 (no-op)", () => {
      const r = applyScaling("MNQ", 30, null, null);
      expect(r.sizeMultiplier).toBe(1);
      expect(r.scaledMaxContracts).toBe(30);
    });

    it("MCL + max_contracts:30 → MCL + max_contracts:30 (no-op)", () => {
      const r = applyScaling("MCL", 30, null, null);
      expect(r.sizeMultiplier).toBe(1);
      expect(r.scaledMaxContracts).toBe(30);
    });
  });

  describe("Equity proxies (1× no-op)", () => {
    it("SPY → MES with 1× multiplier (equity proxy, already micro-sized)", () => {
      const r = applyScaling("SPY", 4, null, null);
      expect(r.market).toBe("MES");
      expect(r.sizeMultiplier).toBe(1);
      expect(r.scaledMaxContracts).toBe(4);
    });

    it("QQQ → MNQ with 1× multiplier", () => {
      const r = applyScaling("QQQ", 4, null, null);
      expect(r.market).toBe("MNQ");
      expect(r.sizeMultiplier).toBe(1);
    });
  });

  describe("Unsupported symbols", () => {
    it("Forex EURUSD → null (dropped)", () => {
      const r = remapMarket("EURUSD");
      expect(r).toBeNull();
    });

    it("Single stock AAPL → null (dropped)", () => {
      const r = remapMarket("AAPL");
      expect(r).toBeNull();
    });

    it("Empty string → null (dropped)", () => {
      const r = remapMarket("");
      expect(r).toBeNull();
    });

    it("GOLD → null (dropped)", () => {
      const r = remapMarket("GOLD");
      expect(r).toBeNull();
    });
  });

  describe("All fields scale coherently", () => {
    it("ES idea with max_contracts+base_contracts+tier_increment → all 10×", () => {
      const r = applyScaling("ES", 6, 4, 2);
      expect(r.scaledMaxContracts).toBe(60);
      expect(r.scaledBaseContracts).toBe(40);
      expect(r.scaledTierIncrement).toBe(20);
    });

    it("null fields are not fabricated", () => {
      const r = applyScaling("ES", 3, null, null);
      expect(r.scaledBaseContracts).toBeNull();
      expect(r.scaledTierIncrement).toBeNull();
    });
  });

  describe("Case-insensitive input", () => {
    it("lowercase 'es' → MES 10×", () => {
      const r = remapMarket("es");
      expect(r?.market).toBe("MES");
      expect(r?.sizeMultiplier).toBe(10);
    });
  });
});
