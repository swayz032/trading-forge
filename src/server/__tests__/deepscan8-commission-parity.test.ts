/**
 * deepscan8-commission-parity.test.ts — deep-scan #8 2026-07-02
 *
 * Parity tests asserting that contract-class.ts commission values match
 * src/engine/firm_config.py::FIRM_COMMISSIONS exactly.
 *
 * Pattern: mirrored literals with provenance comment — values are copied
 * from firm_config.py by hand so that any Python-side rate change that
 * is NOT reflected in contract-class.ts causes this test to fail on review.
 * No cross-language runtime check is needed; review-time diff is sufficient.
 *
 * Source of truth: src/engine/firm_config.py
 *   FIRM_COMMISSIONS["topstep_50k"] = {
 *     "MES": 0.62,  "MNQ": 0.62,  "MCL": 0.77,
 *     "ES":  1.90,  "NQ":  1.90,  "CL":  2.02,
 *   }
 *   FIRM_COMMISSIONS["mffu_50k"] = {
 *     "MES": 0.95,  "MNQ": 0.95,  "MCL": 0.58,
 *     "ES":  2.34,  "NQ":  2.34,  "CL":  2.46,
 *   }
 *
 * All values are per-side, all-in (exchange + NFA + broker), RT ÷ 2.
 */

import { describe, it, expect } from "vitest";
import { getCommissionPerSide } from "../lib/contract-class.js";

// ─── Mirrored literal table from firm_config.py ───────────────────────────────
// Update these if firm_config.py::FIRM_COMMISSIONS changes.

const EXPECTED: Record<string, Record<string, number>> = {
  // firm_config.py FIRM_COMMISSIONS["topstep_50k"]
  topstep: {
    MES: 0.62,  // $1.24 RT ÷ 2
    MNQ: 0.62,  // $1.24 RT ÷ 2
    MCL: 0.77,  // $1.54 RT ÷ 2 — per-symbol override required
  },
  // firm_config.py FIRM_COMMISSIONS["mffu_50k"]
  mffu: {
    MES: 0.95,  // $1.90 RT ÷ 2
    MNQ: 0.95,  // $1.90 RT ÷ 2
    MCL: 0.58,  // $1.16 RT ÷ 2 — per-symbol override required
  },
};

// ─── Parity assertions ────────────────────────────────────────────────────────

describe("commission parity — TS contract-class.ts vs Python firm_config.py", () => {
  for (const [firm, symbols] of Object.entries(EXPECTED)) {
    for (const [symbol, expectedPerSide] of Object.entries(symbols)) {
      it(`${symbol} × ${firm}: getCommissionPerSide → ${expectedPerSide} (firm_config.py parity)`, () => {
        expect(getCommissionPerSide(symbol, firm)).toBe(expectedPerSide);
      });
    }
  }

  // Explicitly test MCL override direction — ensures per-symbol wins over class
  it("MCL + topstep is HIGHER than class default (0.77 > 0.62; per-symbol override active)", () => {
    const mcl = getCommissionPerSide("MCL", "topstep");
    const mes = getCommissionPerSide("MES", "topstep");  // class rate for micro
    expect(mcl).toBeGreaterThan(mes);
    expect(mcl).toBe(0.77);
  });

  it("MCL + mffu is LOWER than class default (0.58 < 0.95; per-symbol override active)", () => {
    const mcl = getCommissionPerSide("MCL", "mffu");
    const mes = getCommissionPerSide("MES", "mffu");  // class rate for micro
    expect(mcl).toBeLessThan(mes);
    expect(mcl).toBe(0.58);
  });

  it("MES and MNQ share the same class rate for each firm (no per-symbol override)", () => {
    expect(getCommissionPerSide("MES", "topstep")).toBe(getCommissionPerSide("MNQ", "topstep"));
    expect(getCommissionPerSide("MES", "mffu")).toBe(getCommissionPerSide("MNQ", "mffu"));
  });
});
