/**
 * wave3-track3b-bif-gate.test.ts — Wave 3 Track 3B (paper-parity)
 *
 * Tests the pure-function evaluateBifGate helper.
 * Mirrors the structure of wave27-5-pass-b-b14-ci-gate.test.ts.
 *
 * Covers:
 *   - bif null/undefined → legacyNull=true, passed=true (never block on missing data)
 *   - bif <= warnThreshold → clean pass
 *   - bif exactly equal to warnThreshold → clean pass (boundary)
 *   - bif in warn band (warnThreshold < bif <= blockThreshold) → passed=true, warn reason
 *   - bif exactly equal to blockThreshold → passed=true (strict >, not >=)
 *   - bif > blockThreshold → passed=false, blocked reason
 *   - synthetically-overfit fixture (high bif + large k_eff) → BLOCKS
 *   - env-var overrides respected for both warn and block thresholds
 *   - getBifWarnThreshold / getBifBlockThreshold default and env-override
 *   - audit payload fields complete and correctly typed
 *   - k_eff surfaced in payload but does not affect pass/block decision
 *   - non-finite bif (NaN/Infinity) treated as null (legacy null path)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  evaluateBifGate,
  getBifWarnThreshold,
  getBifBlockThreshold,
} from "../lib/bif-gate.js";

// ── Logger mock (leaf module per CLAUDE.md) ────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  delete process.env.BIF_WARN_THRESHOLD;
  delete process.env.BIF_BLOCK_THRESHOLD;
});

// ─── Threshold env-var helpers ────────────────────────────────────────────────

describe("getBifWarnThreshold", () => {
  it("returns 2.0 when env var is unset", () => {
    delete process.env.BIF_WARN_THRESHOLD;
    expect(getBifWarnThreshold()).toBe(2.0);
  });

  it("returns parsed value when env var is a valid float string", () => {
    process.env.BIF_WARN_THRESHOLD = "1.5";
    expect(getBifWarnThreshold()).toBe(1.5);
  });

  it("returns 2.0 default for invalid string", () => {
    process.env.BIF_WARN_THRESHOLD = "banana";
    expect(getBifWarnThreshold()).toBe(2.0);
  });

  it("returns 2.0 default for empty string", () => {
    process.env.BIF_WARN_THRESHOLD = "";
    expect(getBifWarnThreshold()).toBe(2.0);
  });
});

describe("getBifBlockThreshold", () => {
  it("returns 4.0 when env var is unset", () => {
    delete process.env.BIF_BLOCK_THRESHOLD;
    expect(getBifBlockThreshold()).toBe(4.0);
  });

  it("returns parsed value when env var is a valid float string", () => {
    process.env.BIF_BLOCK_THRESHOLD = "3.5";
    expect(getBifBlockThreshold()).toBe(3.5);
  });

  it("returns 4.0 default for invalid string", () => {
    process.env.BIF_BLOCK_THRESHOLD = "not-a-number";
    expect(getBifBlockThreshold()).toBe(4.0);
  });
});

// ─── Legacy null (pre-Wave-3 backtests) ──────────────────────────────────────

describe("evaluateBifGate — null/undefined bif → legacy grandfather pass", () => {
  it("passes when bif is null (pre-Wave-3 backtest)", () => {
    const result = evaluateBifGate(null, null);
    expect(result.passed).toBe(true);
    expect(result.legacyNull).toBe(true);
    expect(result.reason).toBe("bif.legacy_null_pre_wave3");
    expect(result.auditPayload.bif).toBeNull();
    expect(result.auditPayload.blocked).toBe(false);
    expect(result.auditPayload.legacy_null).toBe(true);
  });

  it("passes when bif is undefined (pre-Wave-3 backtest)", () => {
    const result = evaluateBifGate(undefined, undefined);
    expect(result.passed).toBe(true);
    expect(result.legacyNull).toBe(true);
    expect(result.reason).toBe("bif.legacy_null_pre_wave3");
  });

  it("passes when bif is null but k_eff is provided — k_eff surfaced in payload", () => {
    const result = evaluateBifGate(null, 3.2);
    expect(result.passed).toBe(true);
    expect(result.legacyNull).toBe(true);
    // k_eff should be in payload even when bif is null
    expect(result.auditPayload.k_eff).toBe(3.2);
  });

  it("treats NaN as null (non-finite bif → legacy grandfather pass)", () => {
    const result = evaluateBifGate(NaN, null);
    expect(result.passed).toBe(true);
    expect(result.legacyNull).toBe(true);
    expect(result.auditPayload.bif).toBeNull();
  });

  it("treats Infinity as null (non-finite bif → legacy grandfather pass)", () => {
    const result = evaluateBifGate(Infinity, null);
    expect(result.passed).toBe(true);
    expect(result.legacyNull).toBe(true);
  });
});

// ─── Clean pass (bif <= warnThreshold) ───────────────────────────────────────

describe("evaluateBifGate — bif <= warnThreshold → clean pass", () => {
  it("passes when bif is 0.5 (well below default warn threshold 2.0)", () => {
    const result = evaluateBifGate(0.5, 2.0);
    expect(result.passed).toBe(true);
    expect(result.legacyNull).toBe(false);
    expect(result.reason).toBe("bif.clean");
    expect(result.auditPayload.blocked).toBe(false);
    expect(result.auditPayload.bif).toBe(0.5);
    expect(result.auditPayload.k_eff).toBe(2.0);
  });

  it("passes when bif is 1.0 (below default warn threshold 2.0)", () => {
    const result = evaluateBifGate(1.0, 1.5);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("bif.clean");
  });

  it("passes when bif exactly equals the warn threshold (boundary — NOT in warn band)", () => {
    // Warn band is STRICTLY greater than warnThreshold.
    const result = evaluateBifGate(2.0, null, { warnThreshold: 2.0, blockThreshold: 4.0 });
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("bif.clean");
  });

  it("payload contains correct threshold values", () => {
    const result = evaluateBifGate(1.5, 2.5, { warnThreshold: 2.0, blockThreshold: 4.0 });
    expect(result.auditPayload.warn_threshold).toBe(2.0);
    expect(result.auditPayload.block_threshold).toBe(4.0);
    expect(result.auditPayload.legacy_null).toBe(false);
    expect(result.auditPayload.reason).toBe("bif.clean");
  });
});

// ─── Warn band (warnThreshold < bif <= blockThreshold) ───────────────────────

describe("evaluateBifGate — warn band → passed=true with warn reason", () => {
  it("passes with warn when bif is 2.5 (in default warn band 2.0–4.0)", () => {
    const result = evaluateBifGate(2.5, 4.0);
    expect(result.passed).toBe(true);
    expect(result.legacyNull).toBe(false);
    expect(result.reason).toBe("bif.warn_above_warn_threshold");
    expect(result.auditPayload.blocked).toBe(false);
    expect(result.auditPayload.bif).toBe(2.5);
  });

  it("passes with warn when bif is 3.9 (just below default block threshold 4.0)", () => {
    const result = evaluateBifGate(3.9, 5.0);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("bif.warn_above_warn_threshold");
  });

  it("passes with warn when bif exactly equals block threshold (strict > not >=)", () => {
    // bif === blockThreshold should NOT block (strict > convention, same as B14).
    const result = evaluateBifGate(4.0, null, { warnThreshold: 2.0, blockThreshold: 4.0 });
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("bif.warn_above_warn_threshold");
  });

  it("uses env-var overridden thresholds for warn band", () => {
    process.env.BIF_WARN_THRESHOLD = "1.0";
    process.env.BIF_BLOCK_THRESHOLD = "3.0";
    const result = evaluateBifGate(1.5, null);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("bif.warn_above_warn_threshold");
    expect(result.auditPayload.warn_threshold).toBe(1.0);
    expect(result.auditPayload.block_threshold).toBe(3.0);
  });
});

// ─── Hard block (bif > blockThreshold) ───────────────────────────────────────

describe("evaluateBifGate — bif > blockThreshold → BLOCKED", () => {
  it("blocks when bif is 4.1 (just above default block threshold 4.0)", () => {
    const result = evaluateBifGate(4.1, null);
    expect(result.passed).toBe(false);
    expect(result.legacyNull).toBe(false);
    expect(result.reason).toBe("bif.blocked_exceeds_threshold");
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.bif).toBe(4.1);
  });

  it("blocks when bif is 8.0 (very high overfitting bias)", () => {
    const result = evaluateBifGate(8.0, 12.0);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("bif.blocked_exceeds_threshold");
    expect(result.auditPayload.k_eff).toBe(12.0);
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("blocks with explicit opts override for threshold", () => {
    const result = evaluateBifGate(3.0, null, { warnThreshold: 1.0, blockThreshold: 2.5 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("bif.blocked_exceeds_threshold");
    expect(result.auditPayload.block_threshold).toBe(2.5);
  });

  it("uses env-var overridden block threshold", () => {
    process.env.BIF_BLOCK_THRESHOLD = "3.0";
    const result = evaluateBifGate(3.5, null);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("bif.blocked_exceeds_threshold");
    expect(result.auditPayload.block_threshold).toBe(3.0);
  });
});

// ─── Synthetic overfit fixture ────────────────────────────────────────────────

describe("evaluateBifGate — synthetically-overfit fixture BLOCKS", () => {
  it("blocks a strategy with high bif (7.5) and large k_eff (18) — synthetic overfit", () => {
    // This fixture represents a strategy that used 18 effective parameters in IS
    // optimisation and achieved a very high IS Sharpe, but the bias-corrected OOS
    // Sharpe is materially lower — BIF of 7.5 indicates the IS edge does not transfer.
    const result = evaluateBifGate(7.5, 18.0);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("bif.blocked_exceeds_threshold");
    expect(result.auditPayload.bif).toBe(7.5);
    expect(result.auditPayload.k_eff).toBe(18.0);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.legacy_null).toBe(false);
    // Threshold info preserved in payload for operator inspection
    expect(result.auditPayload.block_threshold).toBe(4.0);
  });
});

// ─── k_eff does not affect pass/block, only payload ──────────────────────────

describe("evaluateBifGate — k_eff does not affect gate decision", () => {
  it("passes clean regardless of k_eff when bif is clean", () => {
    const result1 = evaluateBifGate(1.0, 0);
    const result2 = evaluateBifGate(1.0, 100);
    expect(result1.passed).toBe(true);
    expect(result2.passed).toBe(true);
    expect(result1.reason).toBe("bif.clean");
    expect(result2.reason).toBe("bif.clean");
  });

  it("blocks regardless of k_eff when bif exceeds block threshold", () => {
    const result1 = evaluateBifGate(5.0, 0);
    const result2 = evaluateBifGate(5.0, 100);
    expect(result1.passed).toBe(false);
    expect(result2.passed).toBe(false);
  });

  it("surfaces null k_eff in payload when not provided", () => {
    const result = evaluateBifGate(1.5, null);
    expect(result.auditPayload.k_eff).toBeNull();
  });

  it("surfaces non-finite k_eff as null in payload", () => {
    const result = evaluateBifGate(1.5, NaN);
    expect(result.auditPayload.k_eff).toBeNull();
  });
});

// ─── Audit payload completeness ───────────────────────────────────────────────

describe("evaluateBifGate — audit payload shape is always complete", () => {
  const cases = [
    { bif: null, kEff: null, label: "legacy null" },
    { bif: 1.0, kEff: 2.0, label: "clean" },
    { bif: 3.0, kEff: 5.0, label: "warn band" },
    { bif: 6.0, kEff: 10.0, label: "blocked" },
  ] as const;

  for (const { bif, kEff, label } of cases) {
    it(`payload has all required fields for ${label} case`, () => {
      // Cast to allow null in the test driver
      const result = evaluateBifGate(bif as number | null, kEff as number | null);
      // All six fields must always be present
      expect(result.auditPayload).toHaveProperty("bif");
      expect(result.auditPayload).toHaveProperty("k_eff");
      expect(result.auditPayload).toHaveProperty("warn_threshold");
      expect(result.auditPayload).toHaveProperty("block_threshold");
      expect(result.auditPayload).toHaveProperty("blocked");
      expect(result.auditPayload).toHaveProperty("legacy_null");
      expect(result.auditPayload).toHaveProperty("reason");
      // reason in payload must match top-level reason
      expect(result.auditPayload.reason).toBe(result.reason);
    });
  }
});
