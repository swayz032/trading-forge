/**
 * Tests for M1 fix: BIF gate proxy-basis non-blocking audit warn.
 *
 * Verifies that evaluateBifGate() emits the proxy_basis_warn field in
 * auditPayload when proxyBasis="oos_mean_not_is" is present, and that this
 * NEVER changes the passed/blocked verdict.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger to intercept warn calls
vi.mock("../lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { evaluateBifGate } from "../lib/bif-gate.js";
import { logger } from "../lib/logger.js";

describe("evaluateBifGate — M1 proxy-basis warn (bif.proxy_basis_oos_mean)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Non-blocking guarantee ──────────────────────────────────────────────────

  it("clean BIF with proxyBasis does NOT block", () => {
    const result = evaluateBifGate(1.0, 15, { proxyBasis: "oos_mean_not_is" });
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("bif.clean");
    expect(result.legacyNull).toBe(false);
  });

  it("warn-band BIF with proxyBasis does NOT block", () => {
    const result = evaluateBifGate(2.5, 15, { proxyBasis: "oos_mean_not_is" });
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("bif.warn_above_warn_threshold");
  });

  it("block-level BIF still blocks even with proxyBasis (proxyBasis never unblocks)", () => {
    const result = evaluateBifGate(5.0, 15, { proxyBasis: "oos_mean_not_is" });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("bif.blocked_exceeds_threshold");
  });

  it("legacy null BIF with proxyBasis still passes (grandfather)", () => {
    const result = evaluateBifGate(null, null, { proxyBasis: "oos_mean_not_is" });
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("bif.legacy_null_pre_wave3");
    expect(result.legacyNull).toBe(true);
  });

  // ── proxy_basis_warn in auditPayload ────────────────────────────────────────

  it("auditPayload.proxy_basis_warn is set when proxyBasis='oos_mean_not_is'", () => {
    const result = evaluateBifGate(1.0, 15, { proxyBasis: "oos_mean_not_is" });
    expect(result.auditPayload.proxy_basis_warn).toBe("bif.proxy_basis_oos_mean");
  });

  it("auditPayload.proxy_basis_warn is null when proxyBasis is absent", () => {
    const result = evaluateBifGate(1.0, 15);
    expect(result.auditPayload.proxy_basis_warn).toBeNull();
  });

  it("auditPayload.proxy_basis_warn is null when proxyBasis is null", () => {
    const result = evaluateBifGate(1.0, 15, { proxyBasis: null });
    expect(result.auditPayload.proxy_basis_warn).toBeNull();
  });

  it("auditPayload.proxy_basis_warn is null when proxyBasis is unknown string", () => {
    const result = evaluateBifGate(1.0, 15, { proxyBasis: "some_other_basis" });
    expect(result.auditPayload.proxy_basis_warn).toBeNull();
  });

  // ── logger.warn emitted for proxy basis ─────────────────────────────────────

  it("emits logger.warn mentioning bif.proxy_basis_oos_mean when proxyBasis set", () => {
    evaluateBifGate(1.0, 15, { proxyBasis: "oos_mean_not_is" });
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const proxyWarnCall = warnCalls.find(
      (args) => typeof args[1] === "string" && (args[1] as string).includes("bif.proxy_basis_oos_mean"),
    );
    expect(proxyWarnCall).toBeDefined();
  });

  it("does NOT emit proxy-basis warn when proxyBasis is absent", () => {
    evaluateBifGate(1.0, 15);
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const proxyWarnCall = warnCalls.find(
      (args) => typeof args[1] === "string" && (args[1] as string).includes("bif.proxy_basis_oos_mean"),
    );
    expect(proxyWarnCall).toBeUndefined();
  });

  // ── All four gate branches carry proxy_basis_warn ───────────────────────────

  it("branch 1 (legacy null): proxy_basis_warn in auditPayload", () => {
    const r = evaluateBifGate(null, 15, { proxyBasis: "oos_mean_not_is" });
    expect(r.auditPayload.proxy_basis_warn).toBe("bif.proxy_basis_oos_mean");
  });

  it("branch 2 (hard block): proxy_basis_warn in auditPayload", () => {
    const r = evaluateBifGate(10.0, 15, { proxyBasis: "oos_mean_not_is" });
    expect(r.passed).toBe(false);
    expect(r.auditPayload.proxy_basis_warn).toBe("bif.proxy_basis_oos_mean");
  });

  it("branch 3 (warn band): proxy_basis_warn in auditPayload", () => {
    const r = evaluateBifGate(3.0, 15, { proxyBasis: "oos_mean_not_is" });
    expect(r.passed).toBe(true);
    expect(r.reason).toBe("bif.warn_above_warn_threshold");
    expect(r.auditPayload.proxy_basis_warn).toBe("bif.proxy_basis_oos_mean");
  });

  it("branch 4 (clean): proxy_basis_warn in auditPayload", () => {
    const r = evaluateBifGate(0.5, 15, { proxyBasis: "oos_mean_not_is" });
    expect(r.passed).toBe(true);
    expect(r.reason).toBe("bif.clean");
    expect(r.auditPayload.proxy_basis_warn).toBe("bif.proxy_basis_oos_mean");
  });

  // ── Existing threshold behavior unaffected ───────────────────────────────────

  it("custom thresholds still work with proxyBasis set", () => {
    const r = evaluateBifGate(3.0, 10, {
      warnThreshold: 1.0,
      blockThreshold: 5.0,
      proxyBasis: "oos_mean_not_is",
    });
    expect(r.passed).toBe(true);
    expect(r.reason).toBe("bif.warn_above_warn_threshold");
    expect(r.auditPayload.proxy_basis_warn).toBe("bif.proxy_basis_oos_mean");
    expect(r.auditPayload.warn_threshold).toBe(1.0);
    expect(r.auditPayload.block_threshold).toBe(5.0);
  });
});

describe("evaluateBifGate — L-2 computation-error fail-closed (deep-scan 2026-07-06)", () => {
  it("computationError=true → FAILS CLOSED (blocked), distinct from legacy-null grandfather", () => {
    // A modern compute_bif() throw emits bif=null + bif_computation_error=true. Must block, NOT grandfather.
    const r = evaluateBifGate(null, 4, { computationError: true });
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("bif.computation_error_fail_closed");
    expect(r.legacyNull).toBe(false);
    expect(r.auditPayload.blocked).toBe(true);
    expect(r.auditPayload.computation_error).toBe(true);
  });

  it("genuine legacy-null (no computationError) still grandfathers (passed, legacyNull) — unchanged", () => {
    const r = evaluateBifGate(null, 4, {});
    expect(r.passed).toBe(true);
    expect(r.legacyNull).toBe(true);
    expect(r.reason).toBe("bif.legacy_null_pre_wave3");
  });

  it("computationError=false with a real bif value evaluates normally (no false fail-closed)", () => {
    const r = evaluateBifGate(1.5, 4, { computationError: false });
    expect(r.passed).toBe(true); // 1.5 < warn 2.0
    expect(r.reason).not.toBe("bif.computation_error_fail_closed");
  });
});
