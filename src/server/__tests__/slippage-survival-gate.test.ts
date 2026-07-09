/**
 * slippage-survival-gate.test.ts — Wave A (paper-parity), 2026-07-03
 *
 * Unit tests for the pure-function evaluateSlippageSurvivalGate helper.
 * Mirrors the structure of wave3-track3b-bif-gate.test.ts / wave27-5-pass-b-b14-ci-gate.test.ts.
 *
 * Covers every branch from the design spec (docs/superpowers/specs/2026-07-03-slippage-survival-gate-design.md):
 *   - disabled (default) → PASS + advisory, regardless of underlying data
 *   - legacy null (no slippage_survival on backtest) → PASS + legacy warn
 *   - malformed / wrong-key shape (present but missing `breaks_at` key) → PASS + distinct warn (not "clean")
 *   - insufficient_sample → PASS + warn
 *   - breaks_at <= block_mult (default 2.0) → BLOCK
 *   - breaks_at === 3.0 → PASS + warn
 *   - breaks_at === null (survives all) → clean PASS
 *   - env-var overrides (SLIPPAGE_SURVIVAL_GATE_ENABLED, SLIPPAGE_SURVIVAL_BLOCK_MULT,
 *     SLIPPAGE_SURVIVAL_MULTIPLES, SLIPPAGE_SURVIVAL_MIN_PF, SLIPPAGE_SURVIVAL_MIN_TRADES)
 *   - audit payload fields complete and correctly typed
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  evaluateSlippageSurvivalGate,
  getSlippageSurvivalGateEnabled,
  getSlippageSurvivalBlockMult,
  getSlippageSurvivalMultiples,
  getSlippageSurvivalMinPf,
  getSlippageSurvivalMinTrades,
  type SlippageSurvivalDict,
} from "../lib/slippage-survival-gate.js";

// ── Logger mock (leaf module per CLAUDE.md — never import from ../index.js) ──
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  delete process.env.SLIPPAGE_SURVIVAL_GATE_ENABLED;
  delete process.env.SLIPPAGE_SURVIVAL_BLOCK_MULT;
  delete process.env.SLIPPAGE_SURVIVAL_MULTIPLES;
  delete process.env.SLIPPAGE_SURVIVAL_MIN_PF;
  delete process.env.SLIPPAGE_SURVIVAL_MIN_TRADES;
});

// ─── Env-var helpers ──────────────────────────────────────────────────────────

describe("getSlippageSurvivalGateEnabled", () => {
  it("defaults to false when unset", () => {
    delete process.env.SLIPPAGE_SURVIVAL_GATE_ENABLED;
    expect(getSlippageSurvivalGateEnabled()).toBe(false);
  });

  it("returns true only for the literal string 'true'", () => {
    process.env.SLIPPAGE_SURVIVAL_GATE_ENABLED = "true";
    expect(getSlippageSurvivalGateEnabled()).toBe(true);
  });

  it("returns false for any other value (e.g. '1', 'TRUE', 'yes')", () => {
    process.env.SLIPPAGE_SURVIVAL_GATE_ENABLED = "1";
    expect(getSlippageSurvivalGateEnabled()).toBe(false);
    process.env.SLIPPAGE_SURVIVAL_GATE_ENABLED = "TRUE";
    expect(getSlippageSurvivalGateEnabled()).toBe(false);
  });
});

describe("getSlippageSurvivalBlockMult", () => {
  it("defaults to 2.0 when unset", () => {
    delete process.env.SLIPPAGE_SURVIVAL_BLOCK_MULT;
    expect(getSlippageSurvivalBlockMult()).toBe(2.0);
  });

  it("returns parsed value when env var is a valid float string", () => {
    process.env.SLIPPAGE_SURVIVAL_BLOCK_MULT = "1.5";
    expect(getSlippageSurvivalBlockMult()).toBe(1.5);
  });

  it("defaults on invalid string", () => {
    process.env.SLIPPAGE_SURVIVAL_BLOCK_MULT = "banana";
    expect(getSlippageSurvivalBlockMult()).toBe(2.0);
  });

  it("defaults on negative value", () => {
    process.env.SLIPPAGE_SURVIVAL_BLOCK_MULT = "-1";
    expect(getSlippageSurvivalBlockMult()).toBe(2.0);
  });
});

describe("getSlippageSurvivalMultiples", () => {
  it("defaults to [1,2,3] when unset", () => {
    delete process.env.SLIPPAGE_SURVIVAL_MULTIPLES;
    expect(getSlippageSurvivalMultiples()).toEqual([1, 2, 3]);
  });

  it("parses a comma-separated override", () => {
    process.env.SLIPPAGE_SURVIVAL_MULTIPLES = "1,1.5,2,2.5";
    expect(getSlippageSurvivalMultiples()).toEqual([1, 1.5, 2, 2.5]);
  });

  it("defaults on garbage input", () => {
    process.env.SLIPPAGE_SURVIVAL_MULTIPLES = "not,valid";
    expect(getSlippageSurvivalMultiples()).toEqual([1, 2, 3]);
  });
});

describe("getSlippageSurvivalMinPf / getSlippageSurvivalMinTrades", () => {
  it("default to 1.0 and 20 respectively", () => {
    delete process.env.SLIPPAGE_SURVIVAL_MIN_PF;
    delete process.env.SLIPPAGE_SURVIVAL_MIN_TRADES;
    expect(getSlippageSurvivalMinPf()).toBe(1.0);
    expect(getSlippageSurvivalMinTrades()).toBe(20);
  });

  it("respect env overrides", () => {
    process.env.SLIPPAGE_SURVIVAL_MIN_PF = "1.2";
    process.env.SLIPPAGE_SURVIVAL_MIN_TRADES = "30";
    expect(getSlippageSurvivalMinPf()).toBe(1.2);
    expect(getSlippageSurvivalMinTrades()).toBe(30);
  });
});

// ─── Gate evaluator ───────────────────────────────────────────────────────────

describe("evaluateSlippageSurvivalGate", () => {
  const fragile: SlippageSurvivalDict = {
    schema_version: 1,
    multiples: [1, 2, 3],
    pf: { "1x": 1.4, "2x": 0.9, "3x": 0.5 },
    expectancy_r: { "1x": 0.3, "2x": -0.1, "3x": -0.4 },
    breaks_at: 2.0,
    retention_2x: -0.33,
    n_trades: 100,
    insufficient_sample: false,
    computed_at: "2026-07-03T00:00:00Z",
  };

  const survivor: SlippageSurvivalDict = {
    schema_version: 1,
    multiples: [1, 2, 3],
    pf: { "1x": 1.9, "2x": 1.6, "3x": 1.3 },
    expectancy_r: { "1x": 0.5, "2x": 0.35, "3x": 0.2 },
    breaks_at: null,
    retention_2x: 0.7,
    n_trades: 214,
    insufficient_sample: false,
    computed_at: "2026-07-03T00:00:00Z",
  };

  describe("disabled (default — SLIPPAGE_SURVIVAL_GATE_ENABLED unset)", () => {
    it("PASSes regardless of underlying data — even a fragile strategy", () => {
      const result = evaluateSlippageSurvivalGate(fragile);
      expect(result.passed).toBe(true);
      expect(result.status).toBe("disabled");
      expect(result.reason).toBe("slippage_survival.gate_disabled_advisory");
      expect(result.auditPayload.enabled).toBe(false);
      // Still surfaces the underlying breaks_at for observability, even though disabled.
      expect(result.auditPayload.breaks_at).toBe(2.0);
    });

    it("PASSes when explicitly disabled via opts", () => {
      const result = evaluateSlippageSurvivalGate(fragile, { enabled: false });
      expect(result.passed).toBe(true);
      expect(result.status).toBe("disabled");
    });
  });

  describe("legacy null — no slippage_survival on the backtest", () => {
    it("PASSes with legacy warn when null", () => {
      const result = evaluateSlippageSurvivalGate(null, { enabled: true });
      expect(result.passed).toBe(true);
      expect(result.status).toBe("legacy_null");
      expect(result.reason).toBe("slippage_survival.unavailable_legacy");
      expect(result.auditPayload.legacy_null).toBe(true);
      expect(result.auditPayload.breaks_at).toBeNull();
    });

    it("PASSes with legacy warn when undefined", () => {
      const result = evaluateSlippageSurvivalGate(undefined, { enabled: true });
      expect(result.passed).toBe(true);
      expect(result.status).toBe("legacy_null");
    });
  });

  describe("malformed / wrong-key shape (must NOT silently pass as clean)", () => {
    it("PASSes but with a status DISTINCT from clean when `breaks_at` key is entirely absent", () => {
      // Simulates a producer that drifted to a different key name (e.g. `break_at`
      // typo, or a future schema rename) — the real fragile value (2.0, which
      // WOULD block) is present under the wrong key and invisible to the gate.
      const wrongKeyShape = {
        schema_version: 1,
        break_at: 2.0, // WRONG KEY — should have been `breaks_at`
        n_trades: 100,
      } as unknown as SlippageSurvivalDict;

      const result = evaluateSlippageSurvivalGate(wrongKeyShape, { enabled: true });

      expect(result.passed).toBe(true); // fail-OPEN — never fabricate a block from bad data
      expect(result.status).toBe("malformed");
      expect(result.status).not.toBe("clean"); // MUST be distinguishable from a genuine survivor
      expect(result.reason).toBe("slippage_survival.malformed_missing_breaks_at");
      expect(result.auditPayload.breaks_at).toBeNull();
    });

    it("treats an explicit `breaks_at: null` (own key present) as a genuine survivor, NOT malformed", () => {
      const result = evaluateSlippageSurvivalGate(survivor, { enabled: true });
      expect(result.status).not.toBe("malformed");
      expect(result.status).toBe("clean");
    });
  });

  describe("insufficient_sample", () => {
    it("PASSes with warn when insufficient_sample=true, regardless of breaks_at", () => {
      const thinSample: SlippageSurvivalDict = {
        schema_version: 1,
        breaks_at: null,
        n_trades: 8,
        insufficient_sample: true,
      };
      const result = evaluateSlippageSurvivalGate(thinSample, { enabled: true });
      expect(result.passed).toBe(true);
      expect(result.status).toBe("insufficient_sample");
      expect(result.reason).toBe("slippage_survival.insufficient_sample");
      expect(result.auditPayload.insufficient_sample).toBe(true);
      expect(result.auditPayload.n_trades).toBe(8);
    });

    it("insufficient_sample takes priority over a fragile breaks_at value", () => {
      const thinButFragile: SlippageSurvivalDict = {
        breaks_at: 1.0,
        n_trades: 5,
        insufficient_sample: true,
      };
      const result = evaluateSlippageSurvivalGate(thinButFragile, { enabled: true });
      expect(result.passed).toBe(true);
      expect(result.status).toBe("insufficient_sample");
    });
  });

  describe("hard block — breaks_at <= block_mult (default 2.0)", () => {
    it("BLOCKS when breaks_at=2.0 (exactly at the default threshold — strict <=)", () => {
      const result = evaluateSlippageSurvivalGate(fragile, { enabled: true });
      expect(result.passed).toBe(false);
      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("slippage_survival.blocked_breaks_at_at_or_below_threshold");
      expect(result.auditPayload.blocked).toBe(true);
    });

    it("BLOCKS when breaks_at=1.0 (dies at the very first multiple)", () => {
      const veryFragile: SlippageSurvivalDict = { breaks_at: 1.0, n_trades: 50 };
      const result = evaluateSlippageSurvivalGate(veryFragile, { enabled: true });
      expect(result.passed).toBe(false);
      expect(result.status).toBe("blocked");
    });

    it("respects a custom blockMult override", () => {
      // breaks_at=2.0 would normally block; loosen the threshold to 1.5 so 2.0 > 1.5 passes.
      const result = evaluateSlippageSurvivalGate(fragile, { enabled: true, blockMult: 1.5 });
      expect(result.passed).toBe(true);
      expect(result.status).not.toBe("blocked");
    });

    it("respects SLIPPAGE_SURVIVAL_BLOCK_MULT env override", () => {
      process.env.SLIPPAGE_SURVIVAL_BLOCK_MULT = "1.0";
      // breaks_at=2.0 > 1.0 env threshold → no longer blocks
      const result = evaluateSlippageSurvivalGate(fragile, { enabled: true });
      expect(result.passed).toBe(true);
      expect(result.status).not.toBe("blocked");
    });
  });

  describe("warn — breaks_at above the block multiple", () => {
    it("PASSes with a distinct warn status when it dies at the top of the sweep (3x, default block 2x)", () => {
      const edgeCase: SlippageSurvivalDict = { breaks_at: 3.0, n_trades: 150 };
      const result = evaluateSlippageSurvivalGate(edgeCase, { enabled: true });
      expect(result.passed).toBe(true);
      expect(result.status).toBe("warn_breaks_at_above_block");
      expect(result.reason).toBe("slippage_survival.warn_breaks_at_above_block");
    });

    it("warns (not clean, not blocked) for any non-null breaks_at above the block multiple", () => {
      // breaks_at=2.5 with default block_mult=2.0 → survives block, dies within sweep → warn
      const tuned: SlippageSurvivalDict = { breaks_at: 2.5, n_trades: 150 };
      const result = evaluateSlippageSurvivalGate(tuned, { enabled: true });
      expect(result.passed).toBe(true);
      expect(result.status).toBe("warn_breaks_at_above_block");
    });
  });

  describe("clean pass — survives every swept multiple", () => {
    it("PASSes cleanly when breaks_at is null (explicit survivor key)", () => {
      const result = evaluateSlippageSurvivalGate(survivor, { enabled: true });
      expect(result.passed).toBe(true);
      expect(result.status).toBe("clean");
      expect(result.reason).toBe("slippage_survival.clean");
      expect(result.auditPayload.retention_2x).toBe(0.7);
      expect(result.auditPayload.n_trades).toBe(214);
    });
  });

  describe("audit payload completeness", () => {
    it("always includes all documented fields regardless of branch taken", () => {
      const result = evaluateSlippageSurvivalGate(fragile, { enabled: true });
      expect(result.auditPayload).toMatchObject({
        enabled: true,
        breaks_at: 2.0,
        block_mult: 2.0,
        n_trades: 100,
        insufficient_sample: false,
        blocked: true,
        legacy_null: false,
        status: "blocked",
        reason: "slippage_survival.blocked_breaks_at_at_or_below_threshold",
      });
    });
  });
});
