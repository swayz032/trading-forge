/**
 * shadow-to-paper-gate.test.ts — Pass 5 Track B (paper-parity 2026-06-23)
 *
 * Unit tests for evaluateShadowToPaperGate().
 *
 * Covers:
 *   T1  20+ matching shadow signals → passes
 *   T2  20+ shadow signals with >5% divergence → blocked + lifecycle.shadow_divergence_blocked
 *   T3  19 shadow signals (below min) → insufficient_samples block
 *   T4  0 shadow signals → insufficient_samples BLOCK (fail-closed, HIGH-1 fix 2026-07-09)
 *   T5  null shadowSignals → insufficient_samples BLOCK (fail-closed, no throw)
 *   T6  Boundary: exactly 5% divergence with exactly 20 samples → blocks (>= threshold)
 *   T7  Boundary: exactly 20 samples, divergence < 5% → passes
 *   T8  Boundary: exactly 19 samples, no divergence → still insufficient_samples (min not met)
 *   T9  audit payload contains strategyId and correlationId
 *   T10 auditAction "lifecycle.shadow_divergence_blocked" on divergence block
 *   T11 auditAction "lifecycle.shadow_divergence_insufficient_samples" on sample floor
 *   T12 auditAction "lifecycle.shadow_divergence_insufficient_samples" on empty array (fail-closed)
 *   T13 auditAction "lifecycle.shadow_promotion_passed" on pass
 *   T14 passed=false on insufficient_samples
 *   T15 passed=false on blocked
 *   T16 passed=false at 0 signals (fail-closed, HIGH-1 fix)
 *   T17 passed=true on pass
 *   T18 caller-supplied tighter threshold (0.03) blocks at 4% divergence
 *   T19 caller-supplied looser threshold does not override blocked result
 *   T20 unmatched backtest signals count as divergence violations
 */

import { describe, it, expect } from "vitest";
import {
  evaluateShadowToPaperGate,
} from "../shadow-to-paper-gate.js";
import type {
  ShadowToPaperGateInput,
  ShadowSignalRow,
} from "../shadow-to-paper-gate.js";
import type { ExpectedSignal } from "../shadow-signal-divergence-checker.js";

// ──────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ──────────────────────────────────────────────────────────────────────────────

const STRATEGY_ID = "strategy-abc-0001";
const BASE_TS = 1_700_000_000; // arbitrary epoch seconds
const BAR_SECONDS = 300; // 5-min bars

/**
 * Build N shadow signals all at ts=BASE_TS + i * BAR_SECONDS, direction=long, size=2.
 */
function buildShadowSignals(n: number): ShadowSignalRow[] {
  return Array.from({ length: n }, (_, i) => ({
    signal_ts: BASE_TS + i * BAR_SECONDS,
    direction: "long",
    entry_price: 5000 + i,
    intended_size: 2,
  }));
}

/**
 * Build N expected signals that EXACTLY match the shadow signals (zero divergence).
 */
function buildMatchingExpected(n: number): ExpectedSignal[] {
  return Array.from({ length: n }, (_, i) => ({
    signal_ts: BASE_TS + i * BAR_SECONDS,
    direction: "long",
    entry_price: 5000 + i,
    intended_size: 2,
  }));
}

/**
 * Build N expected signals where the first `divergingCount` signals have
 * direction='short' instead of 'long' — direction divergence.
 */
function buildDivergingExpected(n: number, divergingCount: number): ExpectedSignal[] {
  return Array.from({ length: n }, (_, i) => ({
    signal_ts: BASE_TS + i * BAR_SECONDS,
    direction: i < divergingCount ? "short" : "long",
    entry_price: 5000 + i,
    intended_size: 2,
  }));
}

function baseInput(overrides: Partial<ShadowToPaperGateInput> = {}): ShadowToPaperGateInput {
  return {
    shadowSignals: buildShadowSignals(20),
    backtestExpected: buildMatchingExpected(20),
    backtestExpectedCount: 20,
    strategyId: STRATEGY_ID,
    correlationId: "corr-test-001",
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("evaluateShadowToPaperGate", () => {
  // ── T1: 20+ matching signals → pass ────────────────────────────────────────
  it("T1: 20+ matching shadow signals → passed=true, status=pass", () => {
    const result = evaluateShadowToPaperGate(baseInput());
    expect(result.passed).toBe(true);
    expect(result.status).toBe("pass");
  });

  // ── T2: 20+ signals with >5% divergence → blocked ──────────────────────────
  it("T2: 20+ shadow signals with >5% divergence → passed=false, status=blocked", () => {
    // 2 direction divergences out of 20 = 10% > 5% threshold
    const input = baseInput({
      backtestExpected: buildDivergingExpected(20, 2),
    });
    const result = evaluateShadowToPaperGate(input);
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
  });

  // ── T3: 19 shadow signals (below min) → insufficient_samples ───────────────
  it("T3: 19 shadow signals → passed=false, status=insufficient_samples", () => {
    const input = baseInput({
      shadowSignals: buildShadowSignals(19),
      backtestExpected: buildMatchingExpected(19),
      backtestExpectedCount: 19,
    });
    const result = evaluateShadowToPaperGate(input);
    expect(result.passed).toBe(false);
    expect(result.status).toBe("insufficient_samples");
  });

  // ── T4: 0 shadow signals → FAIL-CLOSED block (HIGH-1 fix, ratified 2026-07-09) ──
  // Was legacy_unavailable→pass (false-green on the training-serving-skew HARD gate);
  // now blocks with insufficient_samples, matching the canonical cron path.
  it("T4: 0 shadow signals → passed=false, status=insufficient_samples (fail-closed)", () => {
    const input = baseInput({
      shadowSignals: [],
      backtestExpected: [],
      backtestExpectedCount: 0,
    });
    const result = evaluateShadowToPaperGate(input);
    expect(result.passed).toBe(false);
    expect(result.status).toBe("insufficient_samples");
    expect(result.status).not.toBe("legacy_unavailable");
  });

  // ── T5: null shadowSignals → FAIL-CLOSED block (HIGH-1 fix) ────────────────
  it("T5: null shadowSignals → passed=false, status=insufficient_samples (no throw)", () => {
    const input = baseInput({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      shadowSignals: null as any,
      backtestExpected: [],
    });
    const result = evaluateShadowToPaperGate(input);
    expect(result.passed).toBe(false);
    expect(result.status).toBe("insufficient_samples");
  });

  // ── T6: Exactly 5% divergence with 20 samples → BLOCK (>= threshold) ───────
  it("T6: exactly 5% divergence, 20 samples → blocked (boundary inclusive)", () => {
    // 1 direction divergence out of 20 = 5.0% — exactly at the boundary
    // The comparator blocks at divergence_pct >= DIVERGENCE_THRESHOLD (0.05)
    const input = baseInput({
      backtestExpected: buildDivergingExpected(20, 1),
    });
    const result = evaluateShadowToPaperGate(input);
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
  });

  // ── T7: Exactly 20 samples, divergence < 5% → pass ────────────────────────
  it("T7: exactly 20 samples, 0% divergence → passed", () => {
    const input = baseInput({
      shadowSignals: buildShadowSignals(20),
      backtestExpected: buildMatchingExpected(20),
    });
    const result = evaluateShadowToPaperGate(input);
    expect(result.passed).toBe(true);
    expect(result.status).toBe("pass");
  });

  // ── T8: Exactly 19 samples, no divergence → insufficient_samples ───────────
  it("T8: exactly 19 samples (below min=20), zero divergence → insufficient_samples regardless", () => {
    const input = baseInput({
      shadowSignals: buildShadowSignals(19),
      backtestExpected: buildMatchingExpected(19),
    });
    const result = evaluateShadowToPaperGate(input);
    expect(result.passed).toBe(false);
    expect(result.status).toBe("insufficient_samples");
  });

  // ── T9: audit payload contains strategyId and correlationId ────────────────
  it("T9: auditPayload contains strategyId and correlationId", () => {
    const result = evaluateShadowToPaperGate(baseInput({
      strategyId: "strat-xyz",
      correlationId: "corr-xyz-123",
    }));
    expect(result.auditPayload.strategyId).toBe("strat-xyz");
    expect(result.auditPayload.correlationId).toBe("corr-xyz-123");
  });

  // ── T10: auditAction on divergence block ────────────────────────────────────
  it("T10: auditAction = lifecycle.shadow_divergence_blocked when blocked", () => {
    const input = baseInput({
      backtestExpected: buildDivergingExpected(20, 2), // 10% divergence
    });
    const result = evaluateShadowToPaperGate(input);
    expect(result.auditAction).toBe("lifecycle.shadow_divergence_blocked");
  });

  // ── T11: auditAction on insufficient_samples ────────────────────────────────
  it("T11: auditAction = lifecycle.shadow_divergence_insufficient_samples on sample floor", () => {
    const result = evaluateShadowToPaperGate(baseInput({
      shadowSignals: buildShadowSignals(15),
      backtestExpected: buildMatchingExpected(15),
    }));
    expect(result.auditAction).toBe("lifecycle.shadow_divergence_insufficient_samples");
  });

  // ── T12: auditAction on empty → insufficient_samples (HIGH-1 fix) ───────────
  it("T12: auditAction = lifecycle.shadow_divergence_insufficient_samples on empty", () => {
    const result = evaluateShadowToPaperGate(baseInput({
      shadowSignals: [],
      backtestExpected: [],
    }));
    expect(result.auditAction).toBe("lifecycle.shadow_divergence_insufficient_samples");
  });

  // ── T13: auditAction on pass ────────────────────────────────────────────────
  it("T13: auditAction = lifecycle.shadow_promotion_passed on pass", () => {
    const result = evaluateShadowToPaperGate(baseInput());
    expect(result.auditAction).toBe("lifecycle.shadow_promotion_passed");
  });

  // ── T14: passed=false on insufficient_samples ───────────────────────────────
  it("T14: passed=false on insufficient_samples", () => {
    const result = evaluateShadowToPaperGate(baseInput({
      shadowSignals: buildShadowSignals(5),
      backtestExpected: buildMatchingExpected(5),
    }));
    expect(result.passed).toBe(false);
  });

  // ── T15: passed=false on blocked ────────────────────────────────────────────
  it("T15: passed=false on blocked divergence", () => {
    const input = baseInput({ backtestExpected: buildDivergingExpected(20, 4) });
    expect(evaluateShadowToPaperGate(input).passed).toBe(false);
  });

  // ── T16: passed=false at 0 signals (HIGH-1 fail-closed) ─────────────────────
  it("T16: passed=false at 0 signals (fail-closed, was legacy_unavailable pass)", () => {
    const result = evaluateShadowToPaperGate(baseInput({ shadowSignals: [] }));
    expect(result.passed).toBe(false);
  });

  // ── T17: passed=true on pass ────────────────────────────────────────────────
  it("T17: passed=true on pass", () => {
    expect(evaluateShadowToPaperGate(baseInput()).passed).toBe(true);
  });

  // ── T18: Caller-supplied tighter threshold blocks at 4% divergence ──────────
  it("T18: caller threshold=0.03 blocks at 4% divergence (below default 0.05)", () => {
    // 1 direction divergence out of 25 signals = 4% — below default 0.05 but above 0.03
    const signals = buildShadowSignals(25);
    const expected = buildDivergingExpected(25, 1); // 1/25 = 4%
    const input: ShadowToPaperGateInput = {
      shadowSignals: signals,
      backtestExpected: expected,
      backtestExpectedCount: 25,
      strategyId: STRATEGY_ID,
    };
    // Default threshold (0.05) would pass — caller-supplied 0.03 should block
    const resultDefault = evaluateShadowToPaperGate(input);
    const resultTight = evaluateShadowToPaperGate(input, 0.03);
    // With default threshold: 4% < 5% → pass
    expect(resultDefault.passed).toBe(true);
    // With tight threshold: 4% >= 3% → block
    expect(resultTight.passed).toBe(false);
    expect(resultTight.status).toBe("blocked");
  });

  // ── T19: Caller-supplied looser threshold: comparator already blocked → stays blocked
  it("T19: caller threshold=0.10 does not unblock a strategy blocked by comparator (divergence=10%)", () => {
    // The comparator blocks at >= 0.05. Even if caller passes 0.10 as threshold,
    // the comparator already returned ok=false — the gate stays blocked.
    const input = baseInput({
      backtestExpected: buildDivergingExpected(20, 2), // 10% divergence
    });
    // Caller threshold 0.10 — but comparator already saw 10% >= 5% and returned !ok
    const result = evaluateShadowToPaperGate(input, 0.10);
    // Comparator blocked at 0.05 threshold; result stands as blocked
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
  });

  // ── T20: Unmatched backtest signals count as divergence violations ──────────
  it("T20: shadow signals with no matching backtest expected → all unmatched → blocked", () => {
    const signals = buildShadowSignals(20);
    // Expected signals at completely different timestamps (no match within 1 bar)
    const unmatchedExpected: ExpectedSignal[] = Array.from({ length: 20 }, (_, i) => ({
      signal_ts: BASE_TS + 1_000_000 + i * BAR_SECONDS, // far away in time
      direction: "long",
      entry_price: 5000 + i,
      intended_size: 2,
    }));
    const input: ShadowToPaperGateInput = {
      shadowSignals: signals,
      backtestExpected: unmatchedExpected,
      backtestExpectedCount: 20,
      strategyId: STRATEGY_ID,
    };
    const result = evaluateShadowToPaperGate(input);
    expect(result.passed).toBe(false);
    expect(result.status).toBe("blocked");
    // All 20 signals unmatched = 100% divergence
    expect(result.auditPayload.divergence_pct).toBe(1);
  });

  // ── Additional coverage ─────────────────────────────────────────────────────

  it("reason field is a non-empty string in all cases", () => {
    const cases: ShadowToPaperGateInput[] = [
      baseInput(),
      baseInput({ shadowSignals: [], backtestExpected: [] }),
      baseInput({ shadowSignals: buildShadowSignals(5), backtestExpected: buildMatchingExpected(5) }),
      baseInput({ backtestExpected: buildDivergingExpected(20, 2) }),
    ];
    for (const input of cases) {
      const result = evaluateShadowToPaperGate(input);
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("backtestExpectedCount is propagated into auditPayload", () => {
    const result = evaluateShadowToPaperGate(baseInput({ backtestExpectedCount: 42 }));
    expect(result.auditPayload.backtestExpectedCount).toBe(42);
  });

  it("correlationId null is preserved in auditPayload", () => {
    const result = evaluateShadowToPaperGate(baseInput({ correlationId: null }));
    expect(result.auditPayload.correlationId).toBeNull();
  });

  it("correlationId undefined becomes null in auditPayload", () => {
    const result = evaluateShadowToPaperGate(baseInput({ correlationId: undefined }));
    expect(result.auditPayload.correlationId).toBeNull();
  });

  it("larger sample (30 matching) also passes", () => {
    const result = evaluateShadowToPaperGate(baseInput({
      shadowSignals: buildShadowSignals(30),
      backtestExpected: buildMatchingExpected(30),
      backtestExpectedCount: 30,
    }));
    expect(result.passed).toBe(true);
    expect(result.status).toBe("pass");
  });

  it("minSample override: 5 signals with minSample=5 → passes sample gate", () => {
    const input: ShadowToPaperGateInput = {
      shadowSignals: buildShadowSignals(5),
      backtestExpected: buildMatchingExpected(5),
      backtestExpectedCount: 5,
      strategyId: STRATEGY_ID,
    };
    // Without override: 5 < 20 → insufficient_samples
    expect(evaluateShadowToPaperGate(input).status).toBe("insufficient_samples");
    // With minSample override to 5: passes sample gate (divergence check runs)
    // The comparator itself requires MIN_SAMPLE_SIZE=20, so it will return
    // insufficient_samples from within compareShadowToBacktest — which our
    // evaluator surfaces as insufficient_samples with the comparator note.
    const result = evaluateShadowToPaperGate(input, undefined, 5);
    // Even with outer minSample=5, the comparator MIN_SAMPLE_SIZE=20 still fires
    expect(result.status).toBe("insufficient_samples");
  });
});
