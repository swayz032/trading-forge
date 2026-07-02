/**
 * w1t1b-static-stylec-tp2.test.ts — Wave 1 Track 1B: static_styleC TP2 liquidity injection.
 *
 * Tests the in-band liquidity TP2 selection logic added to paper-execution-service.ts.
 * Uses the same pure-function mirror approach (inline logic) as wave8-bar-zod-guard.test.ts
 * to avoid the full paper-execution-service DB dependency graph.
 *
 * Coverage:
 *   A. TP2 picked from in-band liquidity level
 *   B. +2.0R fallback when no qualifying level
 *   C. Day-trader mandate: excluded level types (pwh_iso, pwl_iso, pmh, pml) rejected
 *   D. TP2 pre-check: price-reached logic for long and short
 *   E. Stop distance = 0 guard (never throws)
 *
 * Parity with Python style_c_handler.py:
 *   Python computes tp2 = entry + sign × risk_pts × 2.0. TS pre-check fires at
 *   storedTp2Price (may be < 2.0R when liquidity level is in-band). The stored price
 *   is set at position-open time; Python never sees it until Track 1A adds support.
 */

import { describe, it, expect } from "vitest";

// ─── Mirror of STATIC_STYLEC_INTRADAY_TYPES from paper-execution-service.ts ───
// Mirrors adaptive-exit-engine.ts::INTRADAY_ALLOWED_LEVEL_TYPES.
// Day-trader mandate: multi-day DOL levels excluded.
const INTRADAY_TYPES = new Set([
  "pdh", "pdl",
  "asian_high", "asian_low",
  "london_high", "london_low",
  "hod", "lod",
  "naked_poc",
  "untouched_fvg",
  "untouched_ob",
  "eqh", "eql",
]);

const EXCLUDED_TYPES = ["pwh_iso", "pwl_iso", "pmh", "pml"];

// ─── Mirror of the static_styleC TP2 selection logic ──────────────────────────
interface MockLevel {
  price: number;
  level_type: string;
}

function selectStaticStyleCTp2(
  entry: number,
  stopPrice: number,
  direction: "long" | "short",
  candidates: MockLevel[],
  tp2MinR = 1.4,
  tp2MaxR = 2.6,
): {
  tp2_price: number;
  tp2_source: "liquidity" | "r_multiple";
  tp2_level_type: string | null;
  tp2_r_multiple: number;
} {
  const stopDistance = Math.abs(entry - stopPrice);

  if (stopDistance <= 0) {
    const fallback = direction === "long" ? entry + 2.0 : entry - 2.0;
    return { tp2_price: fallback, tp2_source: "r_multiple", tp2_level_type: null, tp2_r_multiple: 2.0 };
  }

  for (const c of candidates) {
    if (!INTRADAY_TYPES.has(c.level_type)) continue;
    const rMult = Math.abs(c.price - entry) / stopDistance;
    if (rMult >= tp2MinR && rMult <= tp2MaxR) {
      return {
        tp2_price: c.price,
        tp2_source: "liquidity",
        tp2_level_type: c.level_type,
        tp2_r_multiple: rMult,
      };
    }
  }

  const fallbackPrice = direction === "long"
    ? entry + 2.0 * stopDistance
    : entry - 2.0 * stopDistance;
  return { tp2_price: fallbackPrice, tp2_source: "r_multiple", tp2_level_type: null, tp2_r_multiple: 2.0 };
}

// ─── Mirror of the TP2 pre-check in updatePositionPrices ──────────────────────
function tp2PreCheck(
  storedTp2Price: number | null,
  currentPrice: number,
  side: "long" | "short",
  tp1Filled: boolean,
  tp2Filled: boolean,
): boolean {
  if (!tp1Filled || tp2Filled || storedTp2Price == null) return false;
  return side === "long"
    ? currentPrice >= storedTp2Price
    : currentPrice <= storedTp2Price;
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const ENTRY = 5000.0;
const STOP_LONG  = 4994.0;  // 6pt below entry
const STOP_SHORT = 5006.0;  // 6pt above entry

describe("static_styleC TP2 — in-band liquidity selection (TS pure logic)", () => {
  describe("A. In-band level picked over +2.0R fallback", () => {
    it("long: pdh at 1.6R picked (in [1.4, 2.6] band)", () => {
      // 6pt stop → 1.6R = 9.6pt above entry = 5009.6
      const result = selectStaticStyleCTp2(ENTRY, STOP_LONG, "long", [
        { price: 5009.6, level_type: "pdh" },
      ]);
      expect(result.tp2_source).toBe("liquidity");
      expect(result.tp2_price).toBe(5009.6);
      expect(result.tp2_level_type).toBe("pdh");
      expect(result.tp2_r_multiple).toBeCloseTo(1.6, 5);
    });

    it("long: nearest in-band level wins (first qualifying candidate)", () => {
      // Two in-band candidates: 1.5R and 2.1R → first (1.5R) wins
      const result = selectStaticStyleCTp2(ENTRY, STOP_LONG, "long", [
        { price: 5009.0, level_type: "hod" },   // 1.5R
        { price: 5012.6, level_type: "pdh" },   // 2.1R
      ]);
      expect(result.tp2_price).toBe(5009.0);
      expect(result.tp2_r_multiple).toBeCloseTo(1.5, 5);
    });

    it("short: pdl at 1.6R below entry picked", () => {
      // stop=5006, 6pt stop → 1.6R = 9.6pt below entry = 4990.4
      const result = selectStaticStyleCTp2(ENTRY, STOP_SHORT, "short", [
        { price: 4990.4, level_type: "pdl" },
      ]);
      expect(result.tp2_source).toBe("liquidity");
      expect(result.tp2_price).toBe(4990.4);
    });

    it("level just inside tp2MinR boundary (1.5R) → accepted", () => {
      // 1.5R = 9pt → 5009.0; 9.0/6.0 = 1.5 (exact IEEE 754)
      const result = selectStaticStyleCTp2(ENTRY, STOP_LONG, "long", [
        { price: 5009.0, level_type: "eqh" },
      ]);
      expect(result.tp2_source).toBe("liquidity");
      expect(result.tp2_r_multiple).toBeCloseTo(1.5, 5);
    });

    it("level just inside tp2MaxR boundary (2.5R) → accepted", () => {
      // 2.5R = 15pt → 5015.0; 15.0/6.0 = 2.5 (exact IEEE 754)
      const result = selectStaticStyleCTp2(ENTRY, STOP_LONG, "long", [
        { price: 5015.0, level_type: "naked_poc" },
      ]);
      expect(result.tp2_source).toBe("liquidity");
      expect(result.tp2_r_multiple).toBeCloseTo(2.5, 5);
    });
  });

  describe("B. +2.0R fallback when no qualifying level", () => {
    it("no candidates → fallback +2.0R", () => {
      const result = selectStaticStyleCTp2(ENTRY, STOP_LONG, "long", []);
      expect(result.tp2_source).toBe("r_multiple");
      expect(result.tp2_price).toBe(5012.0);   // 5000 + 2.0×6 = 5012
      expect(result.tp2_r_multiple).toBe(2.0);
    });

    it("level below 1.4R threshold (0.83R) → +2.0R fallback", () => {
      // 5pt = 0.83R < 1.4 threshold
      const result = selectStaticStyleCTp2(ENTRY, STOP_LONG, "long", [
        { price: 5005.0, level_type: "hod" },
      ]);
      expect(result.tp2_source).toBe("r_multiple");
      expect(result.tp2_price).toBe(5012.0);
    });

    it("level above 2.6R (3.0R) → +2.0R fallback", () => {
      // 18pt = 3.0R > 2.6 ceiling
      const result = selectStaticStyleCTp2(ENTRY, STOP_LONG, "long", [
        { price: 5018.0, level_type: "pdh" },
      ]);
      expect(result.tp2_source).toBe("r_multiple");
      expect(result.tp2_price).toBe(5012.0);
    });

    it("short fallback: +2.0R below entry = 4988", () => {
      const result = selectStaticStyleCTp2(ENTRY, STOP_SHORT, "short", []);
      expect(result.tp2_price).toBe(4988.0);   // 5000 - 2.0×6 = 4988
    });
  });

  describe("C. Day-trader mandate: excluded level types", () => {
    for (const excluded of EXCLUDED_TYPES) {
      it(`${excluded} → excluded (multi-day DOL violates EOD-DD mandate)`, () => {
        const result = selectStaticStyleCTp2(ENTRY, STOP_LONG, "long", [
          { price: 5009.6, level_type: excluded },  // in-band price but excluded type
        ]);
        expect(result.tp2_source).toBe("r_multiple");
        expect(result.tp2_price).toBe(5012.0);  // fallback
      });
    }

    it("excluded level followed by valid level → valid level wins", () => {
      const result = selectStaticStyleCTp2(ENTRY, STOP_LONG, "long", [
        { price: 5009.6, level_type: "pwh_iso" },  // excluded
        { price: 5010.8, level_type: "pdh" },       // valid, 1.8R
      ]);
      expect(result.tp2_source).toBe("liquidity");
      expect(result.tp2_price).toBe(5010.8);
      expect(result.tp2_level_type).toBe("pdh");
    });
  });

  describe("D. TP2 pre-check logic (price-reached gate)", () => {
    it("long: fires when currentPrice >= storedTp2Price", () => {
      expect(tp2PreCheck(5009.6, 5009.6, "long", true, false)).toBe(true);
      expect(tp2PreCheck(5009.6, 5010.0, "long", true, false)).toBe(true); // past
      expect(tp2PreCheck(5009.6, 5009.5, "long", true, false)).toBe(false); // not yet
    });

    it("short: fires when currentPrice <= storedTp2Price", () => {
      expect(tp2PreCheck(4990.4, 4990.4, "short", true, false)).toBe(true);
      expect(tp2PreCheck(4990.4, 4990.0, "short", true, false)).toBe(true); // past
      expect(tp2PreCheck(4990.4, 4990.5, "short", true, false)).toBe(false); // not yet
    });

    it("does NOT fire when tp1Filled=false (TP2 requires TP1 to be filled first)", () => {
      expect(tp2PreCheck(5009.6, 5015.0, "long", false, false)).toBe(false);
    });

    it("does NOT fire when tp2Filled=true (idempotent — already filled)", () => {
      expect(tp2PreCheck(5009.6, 5015.0, "long", true, true)).toBe(false);
    });

    it("does NOT fire when storedTp2Price=null (no stored TP2 → Python handles)", () => {
      expect(tp2PreCheck(null, 5015.0, "long", true, false)).toBe(false);
    });
  });

  describe("E. Edge cases", () => {
    it("stopDistance=0 → +2.0R fallback with 1pt nominal distance (no throw)", () => {
      // Stop price equals entry price: degenerate case
      const result = selectStaticStyleCTp2(5000.0, 5000.0, "long", [
        { price: 5009.6, level_type: "pdh" },
      ]);
      expect(result.tp2_source).toBe("r_multiple");
      expect(result.tp2_price).toBe(5002.0);  // entry + 2×1 (nominal fallback)
    });

    it("all intraday level types accepted", () => {
      const intradayTypes = [
        "pdh", "pdl", "asian_high", "asian_low", "london_high", "london_low",
        "hod", "lod", "naked_poc", "untouched_fvg", "untouched_ob", "eqh", "eql",
      ];
      for (const lvlType of intradayTypes) {
        const result = selectStaticStyleCTp2(5000, 4994, "long", [
          { price: 5009.6, level_type: lvlType },
        ]);
        expect(result.tp2_source).toBe("liquidity");
      }
    });
  });
});
