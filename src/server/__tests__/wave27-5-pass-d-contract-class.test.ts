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
 *   - getCommissionPerSide(MES, "topstep") → 0.37 (micro Topstep rate)
 *   - getCommissionPerSide(MES, "mffu")    → 0.62 (micro MFFU rate)
 *   - getCommissionPerSide(ES,  "topstep") → 3.70 (mini Topstep 10× rate)
 *   - getCommissionPerSide(ES,  "mffu")    → 6.20 (mini MFFU 10× rate)
 *   - Firm override respected over class default (Topstep mini is $3.70 not $6.20)
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

describe("getCommissionPerSide — micro symbols", () => {
  it("MES + topstep → 0.37 (Topstep micro rate)", () => {
    expect(getCommissionPerSide("MES", "topstep")).toBe(0.37);
  });

  it("MES + mffu → 0.62 (MFFU micro rate)", () => {
    expect(getCommissionPerSide("MES", "mffu")).toBe(0.62);
  });

  it("MNQ + topstep → 0.37 (same micro rate as MES at Topstep)", () => {
    expect(getCommissionPerSide("MNQ", "topstep")).toBe(0.37);
  });

  it("MCL + mffu → 0.62 (same micro rate as MES at MFFU)", () => {
    expect(getCommissionPerSide("MCL", "mffu")).toBe(0.62);
  });
});

// ─── getCommissionPerSide — mini symbols (Phase 5 visibility) ─────────────────

describe("getCommissionPerSide — mini symbols (Phase 5)", () => {
  it("ES + topstep → 3.70 (Topstep mini = 10× micro 0.37)", () => {
    expect(getCommissionPerSide("ES", "topstep")).toBeCloseTo(3.70, 10);
  });

  it("ES + mffu → 6.20 (MFFU mini = 10× micro 0.62)", () => {
    expect(getCommissionPerSide("ES", "mffu")).toBeCloseTo(6.20, 10);
  });

  it("NQ + mffu → 6.20 (same mini rate across NQ/ES at MFFU)", () => {
    expect(getCommissionPerSide("NQ", "mffu")).toBeCloseTo(6.20, 10);
  });

  it("Topstep mini rate is NOT the same as MFFU mini rate (firm-specific override preserved)", () => {
    const topstep = getCommissionPerSide("ES", "topstep");
    const mffu = getCommissionPerSide("ES", "mffu");
    expect(topstep).not.toBe(mffu);
    expect(topstep).toBeLessThan(mffu);
  });

  it("ES + topstep is 10× MES + topstep", () => {
    const micro = getCommissionPerSide("MES", "topstep");
    const mini  = getCommissionPerSide("ES",  "topstep");
    expect(mini).toBeCloseTo(micro * 10, 10);
  });

  it("ES + mffu is 10× MES + mffu", () => {
    const micro = getCommissionPerSide("MES", "mffu");
    const mini  = getCommissionPerSide("ES",  "mffu");
    expect(mini).toBeCloseTo(micro * 10, 10);
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

describe("Backward compatibility — micro strategies unchanged", () => {
  it("MES + topstep produces same amount as legacy getCommissionPerSide(topstep) = 0.37", () => {
    // This test pins backward compat: micro strategies see no behavioral change.
    // Legacy: getCommissionPerSide("topstep") → 0.37
    // New:    getCommissionPerSide("MES", "topstep") → 0.37
    expect(getCommissionPerSide("MES", "topstep")).toBe(0.37);
  });

  it("MES + mffu produces same amount as legacy getCommissionPerSide(mffu) = 0.62", () => {
    expect(getCommissionPerSide("MES", "mffu")).toBe(0.62);
  });

  it("round-trip commission for 10 MES contracts at MFFU = $12.40", () => {
    // round-trip = perSide × 2 × contracts
    const perSide = getCommissionPerSide("MES", "mffu");
    const contracts = 10;
    const roundTrip = perSide * 2 * contracts;
    expect(roundTrip).toBeCloseTo(12.40, 10);
  });

  it("round-trip commission for 1 ES contract at MFFU = $12.40 (same notional, different per-contract)", () => {
    // 10 MES round-trip = 1 ES round-trip in notional terms, but per-contract rate differs 10×
    const perSide = getCommissionPerSide("ES", "mffu");
    const contracts = 1;
    const roundTrip = perSide * 2 * contracts;
    expect(roundTrip).toBeCloseTo(12.40, 10);
  });
});
