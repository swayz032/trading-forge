/**
 * wave27-5-pass-d-contract-class.test.ts — Wave 27.5 Pass D.2 (paper-parity)
 *
 * Tests for src/server/lib/contract-class.ts
 *
 * Coverage:
 *   - getContractClass returns "micro" for MES/MNQ/MCL
 *   - getContractClass returns "mini" for ES/NQ/CL
 *   - getContractClass returns "unknown" for unrecognised symbols
 *   - getContractClass is case-insensitive
 *   - getCommissionPerSide(MES, "topstep") → 0.62 (micro Topstep rate)
 *   - getCommissionPerSide(MES, "mffu")    → 0.95 (micro MFFU rate)
 *   - getCommissionPerSide(MCL, "topstep") → 0.77 (MCL per-symbol override, topstep)
 *   - getCommissionPerSide(MCL, "mffu")    → 0.58 (MCL per-symbol override, mffu)
 *   - getCommissionPerSide(ES,  "topstep") → 1.90 (mini Topstep independent rate)
 *   - getCommissionPerSide(ES,  "mffu")    → 2.34 (mini MFFU independent rate)
 *   - Firm override respected over class default (Topstep mini is $1.90 not $2.34)
 *   - Unknown symbol falls back to DEFAULT_MICRO_COMMISSION_PER_SIDE + audit fires
 *   - mini_class_detected audit fires on Phase 5 mini symbol
 *   - Unknown firm uses class-level default (not firm override)
 *   - Null/undefined firmId falls back to class default
 *   - Round-trip commission arithmetic (2 × perSide × contracts)
 *   - Backward compat: micro symbols produce identical amounts to legacy helper
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getContractClass,
  getCommissionPerSide,
  DEFAULT_MICRO_COMMISSION_PER_SIDE,
  DEFAULT_MINI_COMMISSION_PER_SIDE,
  type ContractClass,
  type AuditEmitter,
} from "../lib/contract-class.js";

// ── Logger mock (leaf module per CLAUDE.md) ────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  vi.clearAllMocks();
});

// ─── getContractClass ─────────────────────────────────────────────────────────

describe("getContractClass", () => {
  it("returns 'micro' for MES", () => {
    expect(getContractClass("MES")).toBe<ContractClass>("micro");
  });

  it("returns 'micro' for MNQ", () => {
    expect(getContractClass("MNQ")).toBe<ContractClass>("micro");
  });

  it("returns 'micro' for MCL", () => {
    expect(getContractClass("MCL")).toBe<ContractClass>("micro");
  });

  it("returns 'mini' for ES", () => {
    expect(getContractClass("ES")).toBe<ContractClass>("mini");
  });

  it("returns 'mini' for NQ", () => {
    expect(getContractClass("NQ")).toBe<ContractClass>("mini");
  });

  it("returns 'mini' for CL", () => {
    expect(getContractClass("CL")).toBe<ContractClass>("mini");
  });

  it("returns 'unknown' for an unrecognised symbol", () => {
    expect(getContractClass("RTY")).toBe<ContractClass>("unknown");
  });

  it("returns 'unknown' for empty string", () => {
    expect(getContractClass("")).toBe<ContractClass>("unknown");
  });

  it("is case-insensitive — lowercase 'mes' → 'micro'", () => {
    expect(getContractClass("mes")).toBe<ContractClass>("micro");
  });

  it("is case-insensitive — lowercase 'es' → 'mini'", () => {
    expect(getContractClass("es")).toBe<ContractClass>("mini");
  });
});

// ─── Exported constants ───────────────────────────────────────────────────────

describe("Commission constants", () => {
  it("DEFAULT_MICRO_COMMISSION_PER_SIDE is 0.62 (conservative MFFU baseline)", () => {
    expect(DEFAULT_MICRO_COMMISSION_PER_SIDE).toBe(0.62);
  });

  it("DEFAULT_MINI_COMMISSION_PER_SIDE is 6.20 (10× micro baseline)", () => {
    expect(DEFAULT_MINI_COMMISSION_PER_SIDE).toBe(6.20);
  });

  it("DEFAULT_MINI_COMMISSION_PER_SIDE is exactly 10× DEFAULT_MICRO_COMMISSION_PER_SIDE", () => {
    expect(DEFAULT_MINI_COMMISSION_PER_SIDE).toBeCloseTo(DEFAULT_MICRO_COMMISSION_PER_SIDE * 10, 10);
  });
});

// ─── getCommissionPerSide — micro symbols ─────────────────────────────────────
// Values mirror firm_config.py::FIRM_COMMISSIONS (2026-06-23 correction applied).

describe("getCommissionPerSide — micro symbols", () => {
  it("MES + topstep → 0.62 (Topstep all-in $1.24 RT ÷ 2)", () => {
    expect(getCommissionPerSide("MES", "topstep")).toBe(0.62);
  });

  it("MES + mffu → 0.95 (MFFU all-in $1.90 RT ÷ 2)", () => {
    expect(getCommissionPerSide("MES", "mffu")).toBe(0.95);
  });

  it("MNQ + topstep → 0.62 (same class rate as MES at Topstep)", () => {
    expect(getCommissionPerSide("MNQ", "topstep")).toBe(0.62);
  });

  it("MNQ + mffu → 0.95 (same class rate as MES at MFFU)", () => {
    expect(getCommissionPerSide("MNQ", "mffu")).toBe(0.95);
  });

  // MCL has per-symbol overrides — different from the micro class rate
  it("MCL + topstep → 0.77 (per-symbol override; MCL all-in $1.54 RT ÷ 2)", () => {
    expect(getCommissionPerSide("MCL", "topstep")).toBe(0.77);
  });

  it("MCL + mffu → 0.58 (per-symbol override; MCL all-in $1.16 RT ÷ 2)", () => {
    expect(getCommissionPerSide("MCL", "mffu")).toBe(0.58);
  });

  it("MCL topstep is HIGHER than MES topstep (MCL exchange fees > equity micro)", () => {
    expect(getCommissionPerSide("MCL", "topstep")).toBeGreaterThan(getCommissionPerSide("MES", "topstep"));
  });

  it("MCL mffu is LOWER than MES mffu (MCL exchange fees < equity micro at MFFU)", () => {
    expect(getCommissionPerSide("MCL", "mffu")).toBeLessThan(getCommissionPerSide("MES", "mffu"));
  });
});

// ─── getCommissionPerSide — mini symbols (Phase 5 visibility) ─────────────────
// Mini rates are INDEPENDENTLY set in COMMISSION_RATES_BY_CLASS — NOT 10× micro.
// Commissions scale ~3× (not 10×) from micro to mini for the same notional.

describe("getCommissionPerSide — mini symbols (Phase 5)", () => {
  it("ES + topstep → 1.90 (Topstep mini all-in $3.80 RT ÷ 2; NOT 10× micro)", () => {
    expect(getCommissionPerSide("ES", "topstep")).toBeCloseTo(1.90, 10);
  });

  it("ES + mffu → 2.34 (MFFU mini all-in $4.68 RT ÷ 2; NOT 10× micro)", () => {
    expect(getCommissionPerSide("ES", "mffu")).toBeCloseTo(2.34, 10);
  });

  it("NQ + mffu → 2.34 (same mini class rate across NQ/ES at MFFU)", () => {
    expect(getCommissionPerSide("NQ", "mffu")).toBeCloseTo(2.34, 10);
  });

  it("Topstep mini rate is NOT the same as MFFU mini rate (firm-specific override preserved)", () => {
    const topstep = getCommissionPerSide("ES", "topstep");
    const mffu = getCommissionPerSide("ES", "mffu");
    expect(topstep).not.toBe(mffu);
    expect(topstep).toBeLessThan(mffu);
  });

  it("ES + topstep is NOT 10× MES + topstep (commissions scale ~3×, not 10×)", () => {
    const micro = getCommissionPerSide("MES", "topstep");
    const mini  = getCommissionPerSide("ES",  "topstep");
    // Verify the actual values, not a 10× relationship
    expect(micro).toBe(0.62);
    expect(mini).toBe(1.90);
    expect(mini).not.toBeCloseTo(micro * 10, 5);
  });

  it("ES + mffu is NOT 10× MES + mffu (commissions scale ~2.5×, not 10×)", () => {
    const micro = getCommissionPerSide("MES", "mffu");
    const mini  = getCommissionPerSide("ES",  "mffu");
    expect(micro).toBe(0.95);
    expect(mini).toBe(2.34);
    expect(mini).not.toBeCloseTo(micro * 10, 5);
  });

  it("mini_class_detected audit fires on mini symbol", () => {
    const auditFn = vi.fn();
    getCommissionPerSide("ES", "topstep", auditFn as AuditEmitter);
    expect(auditFn).toHaveBeenCalledWith(
      "commission.mini_class_detected",
      expect.objectContaining({ symbol: "ES", contract_class: "mini", phase5_future: true }),
    );
  });

  it("mini_class_detected audit does NOT fire on micro symbol", () => {
    const auditFn = vi.fn();
    getCommissionPerSide("MES", "topstep", auditFn as AuditEmitter);
    expect(auditFn).not.toHaveBeenCalled();
  });
});

// ─── getCommissionPerSide — unknown symbol fallback ───────────────────────────

describe("getCommissionPerSide — unknown symbol", () => {
  it("unknown symbol falls back to DEFAULT_MICRO_COMMISSION_PER_SIDE", () => {
    expect(getCommissionPerSide("RTY", "topstep")).toBe(DEFAULT_MICRO_COMMISSION_PER_SIDE);
  });

  it("unknown symbol with null firmId still falls back to DEFAULT_MICRO_COMMISSION_PER_SIDE", () => {
    expect(getCommissionPerSide("RTY", null)).toBe(DEFAULT_MICRO_COMMISSION_PER_SIDE);
  });

  it("symbol_class_unknown audit fires on unknown symbol", () => {
    const auditFn = vi.fn();
    getCommissionPerSide("RTY", "topstep", auditFn as AuditEmitter);
    expect(auditFn).toHaveBeenCalledWith(
      "commission.symbol_class_unknown",
      expect.objectContaining({ symbol: "RTY", fallback_rate: DEFAULT_MICRO_COMMISSION_PER_SIDE }),
    );
  });
});

// ─── getCommissionPerSide — null/unknown firm ─────────────────────────────────

describe("getCommissionPerSide — null/unknown firm", () => {
  it("null firmId for micro → DEFAULT_MICRO_COMMISSION_PER_SIDE", () => {
    expect(getCommissionPerSide("MES", null)).toBe(DEFAULT_MICRO_COMMISSION_PER_SIDE);
  });

  it("undefined firmId for micro → DEFAULT_MICRO_COMMISSION_PER_SIDE", () => {
    expect(getCommissionPerSide("MES", undefined)).toBe(DEFAULT_MICRO_COMMISSION_PER_SIDE);
  });

  it("null firmId for mini → DEFAULT_MINI_COMMISSION_PER_SIDE", () => {
    expect(getCommissionPerSide("ES", null)).toBeCloseTo(DEFAULT_MINI_COMMISSION_PER_SIDE, 10);
  });

  it("unknown firm string for micro → DEFAULT_MICRO_COMMISSION_PER_SIDE", () => {
    expect(getCommissionPerSide("MES", "some_unknown_firm")).toBe(DEFAULT_MICRO_COMMISSION_PER_SIDE);
  });

  it("unknown firm string for mini → DEFAULT_MINI_COMMISSION_PER_SIDE (class default, no firm override)", () => {
    expect(getCommissionPerSide("ES", "some_unknown_firm")).toBeCloseTo(DEFAULT_MINI_COMMISSION_PER_SIDE, 10);
  });
});

// ─── Backward compatibility ───────────────────────────────────────────────────
// 2026-06-23 correction updated Topstep 0.37→0.62, MFFU 0.62→0.95.
// These tests document the CURRENT authoritative rates (not legacy).

describe("Backward compatibility — current authoritative rates (2026-06-23 correction)", () => {
  it("MES + topstep = 0.62 (Topstep all-in $1.24 RT ÷ 2 per firm_config.py)", () => {
    expect(getCommissionPerSide("MES", "topstep")).toBe(0.62);
  });

  it("MES + mffu = 0.95 (MFFU all-in $1.90 RT ÷ 2 per firm_config.py)", () => {
    expect(getCommissionPerSide("MES", "mffu")).toBe(0.95);
  });

  it("round-trip commission for 10 MES contracts at MFFU = $19.00", () => {
    // round-trip = perSide × 2 × contracts = 0.95 × 2 × 10
    const perSide = getCommissionPerSide("MES", "mffu");
    const contracts = 10;
    const roundTrip = perSide * 2 * contracts;
    expect(roundTrip).toBeCloseTo(19.00, 10);
  });

  it("round-trip commission for 1 ES contract at MFFU = $4.68", () => {
    // 1 ES RT = 2.34 × 2 × 1 = $4.68
    const perSide = getCommissionPerSide("ES", "mffu");
    const contracts = 1;
    const roundTrip = perSide * 2 * contracts;
    expect(roundTrip).toBeCloseTo(4.68, 10);
  });
});
