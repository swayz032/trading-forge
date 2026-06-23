/**
 * shadow-to-paper-gate-parity.test.ts — Pass 5 Track B (paper-parity 2026-06-23)
 *
 * Refactor-parity proof: the pure evaluator (evaluateShadowToPaperGate)
 * must produce identical verdicts to what the existing cron-sweep Gate 2.5
 * in lifecycle-service.ts produces using compareShadowToBacktest() directly.
 *
 * This test simulates the cron-sweep's inline Gate 2.5 logic path:
 *
 *   const divergenceResult = compareShadowToBacktest(sSignals, backtestExpected);
 *   if (!divergenceResult.ok) {
 *     const isInsufficientSamples = divergenceResult.reason === "insufficient_samples";
 *     → auditAction = isInsufficientSamples
 *         ? "lifecycle.shadow_divergence_insufficient_samples"
 *         : "lifecycle.shadow_divergence_blocked"
 *     → BLOCK
 *   } else {
 *     → auditAction = "lifecycle.shadow_promotion_passed"
 *     → PROMOTE
 *   }
 *   // catch block → auditAction = "lifecycle.shadow_divergence_check_unavailable_legacy" + PROCEED
 *
 * For each fixture scenario the test asserts:
 *   - cron.ok === evaluator.passed
 *   - cron.auditAction === evaluator.auditAction
 *   - cron.status maps correctly to evaluator.status
 *
 * Fixture scenarios:
 *   P1  30 matching signals (zero divergence) — expects pass
 *   P2  25 signals with 8% divergence — expects blocked
 *   P3  19 signals (below MIN_SAMPLE_SIZE) — expects insufficient_samples
 *   P4  0 signals (empty) — expects legacy_unavailable (grandfather)
 *   P5  20 signals exactly 5% divergence — expects blocked (boundary inclusive)
 *   P6  21 signals with 0% divergence — expects pass
 *   P7  Mixed: 22 signals, 1 direction + 1 size violation (2/22 ≈ 9.1%) — expects blocked
 */

import { describe, it, expect } from "vitest";
import { compareShadowToBacktest } from "../shadow-signal-divergence-checker.js";
import { evaluateShadowToPaperGate } from "../shadow-to-paper-gate.js";
import type { ShadowToPaperGateInput } from "../shadow-to-paper-gate.js";
import type { ShadowSignal, ExpectedSignal } from "../shadow-signal-divergence-checker.js";

// ──────────────────────────────────────────────────────────────────────────────
// Inline simulation of Gate 2.5 cron-sweep logic
// ──────────────────────────────────────────────────────────────────────────────

interface CronGateResult {
  /** Whether the cron would have promoted (true) or blocked (continue) */
  ok: boolean;
  /** Audit action the cron would have written */
  auditAction: string;
  /** Human-readable label */
  label: "pass" | "blocked" | "insufficient_samples" | "legacy_unavailable";
}

/**
 * Simulate the Gate 2.5 cron-sweep inline logic from lifecycle-service.ts.
 * This is the EXACT decision tree the cron uses — extracted inline here so
 * that the parity test is self-documenting and not a live-DB call.
 *
 * The cron logic (from lifecycle-service.ts ~2349-2495):
 *
 *   if shadowSignals is empty:
 *     → "lifecycle.shadow_divergence_check_unavailable_legacy" + PROCEED
 *
 *   const divergenceResult = compareShadowToBacktest(sSignals, backtestExpected)
 *   if (!divergenceResult.ok):
 *     const isInsufficientSamples = divergenceResult.reason === "insufficient_samples"
 *     auditAction = isInsufficientSamples
 *       ? "lifecycle.shadow_divergence_insufficient_samples"
 *       : "lifecycle.shadow_divergence_blocked"
 *     → BLOCK (continue)
 *   else:
 *     auditAction = "lifecycle.shadow_promotion_passed"
 *     → PROMOTE
 */
function simulateCronGate2_5(
  shadowSignals: ShadowSignal[],
  backtestExpected: ExpectedSignal[],
): CronGateResult {
  // Cron catches exceptions and routes to legacy_unavailable.
  // For empty arrays it also proceeds (Wave 29 Pass A.3 grandfather).
  if (!shadowSignals || shadowSignals.length === 0) {
    return {
      ok: true,
      auditAction: "lifecycle.shadow_divergence_check_unavailable_legacy",
      label: "legacy_unavailable",
    };
  }

  const divergenceResult = compareShadowToBacktest(shadowSignals, backtestExpected);

  if (!divergenceResult.ok) {
    const isInsufficientSamples = divergenceResult.reason === "insufficient_samples";
    return {
      ok: false,
      auditAction: isInsufficientSamples
        ? "lifecycle.shadow_divergence_insufficient_samples"
        : "lifecycle.shadow_divergence_blocked",
      label: isInsufficientSamples ? "insufficient_samples" : "blocked",
    };
  }

  return {
    ok: true,
    auditAction: "lifecycle.shadow_promotion_passed",
    label: "pass",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ──────────────────────────────────────────────────────────────────────────────

const BASE_TS = 1_700_500_000;
const BAR_SECONDS = 300;
const STRATEGY_ID = "parity-strategy-0001";

function makeShadow(n: number, overrides: Partial<ShadowSignal>[] = []): ShadowSignal[] {
  return Array.from({ length: n }, (_, i) => ({
    signal_ts: BASE_TS + i * BAR_SECONDS,
    direction: "long",
    entry_price: 5100 + i,
    intended_size: 2,
    ...overrides[i],
  }));
}

function makeExpected(n: number, overrides: Partial<ExpectedSignal>[] = []): ExpectedSignal[] {
  return Array.from({ length: n }, (_, i) => ({
    signal_ts: BASE_TS + i * BAR_SECONDS,
    direction: "long",
    entry_price: 5100 + i,
    intended_size: 2,
    ...overrides[i],
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Parity fixtures
// ──────────────────────────────────────────────────────────────────────────────

interface ParityFixture {
  name: string;
  shadowSignals: ShadowSignal[];
  backtestExpected: ExpectedSignal[];
}

const FIXTURES: ParityFixture[] = [
  // P1: 30 matching signals → pass
  {
    name: "P1: 30 matching signals (zero divergence)",
    shadowSignals: makeShadow(30),
    backtestExpected: makeExpected(30),
  },

  // P2: 25 signals with 8% divergence (2 direction mismatches)
  {
    name: "P2: 25 signals, 2 direction mismatches → blocked",
    shadowSignals: makeShadow(25),
    backtestExpected: makeExpected(25, [
      { direction: "short" }, // mismatch idx 0
      { direction: "short" }, // mismatch idx 1
    ]),
  },

  // P3: 19 signals (below MIN_SAMPLE_SIZE=20) → insufficient_samples
  {
    name: "P3: 19 signals (below MIN_SAMPLE_SIZE=20) → insufficient_samples",
    shadowSignals: makeShadow(19),
    backtestExpected: makeExpected(19),
  },

  // P4: 0 signals → legacy_unavailable
  {
    name: "P4: empty shadow signals → legacy_unavailable",
    shadowSignals: [],
    backtestExpected: [],
  },

  // P5: exactly 5% divergence (20 signals, 1 direction mismatch) → blocked
  {
    name: "P5: exactly 5% divergence (1/20) → blocked (boundary inclusive)",
    shadowSignals: makeShadow(20),
    backtestExpected: makeExpected(20, [
      { direction: "short" }, // 1/20 = 5%
    ]),
  },

  // P6: 21 signals, 0% divergence → pass
  {
    name: "P6: 21 matching signals → pass",
    shadowSignals: makeShadow(21),
    backtestExpected: makeExpected(21),
  },

  // P7: 22 signals, 1 direction + 1 size violation (2 violations / 22 = 9.09%) → blocked
  {
    name: "P7: 22 signals, direction+size violations → blocked",
    shadowSignals: makeShadow(22),
    backtestExpected: makeExpected(22, [
      { direction: "short" },           // direction violation on signal 0
      { intended_size: 10 },            // size violation on signal 1 (size 10 vs 2 = 400% diff > 10%)
    ]),
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Parity tests
// ──────────────────────────────────────────────────────────────────────────────

describe("evaluateShadowToPaperGate — parity with Gate 2.5 cron-sweep", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      // Step 1: Get the cron-sweep Gate 2.5 verdict (inline simulation)
      const cronResult = simulateCronGate2_5(fixture.shadowSignals, fixture.backtestExpected);

      // Step 2: Get the pure evaluator verdict
      const evaluatorInput: ShadowToPaperGateInput = {
        shadowSignals: fixture.shadowSignals,
        backtestExpected: fixture.backtestExpected,
        backtestExpectedCount: fixture.backtestExpected.length,
        strategyId: STRATEGY_ID,
        correlationId: "parity-test-corr",
      };
      const evaluatorResult = evaluateShadowToPaperGate(evaluatorInput);

      // ── PARITY ASSERTION 1: promotion decision must match ──────────────────
      expect(evaluatorResult.passed).toBe(cronResult.ok);

      // ── PARITY ASSERTION 2: audit action must match ────────────────────────
      expect(evaluatorResult.auditAction).toBe(cronResult.auditAction);

      // ── PARITY ASSERTION 3: status label must match ────────────────────────
      expect(evaluatorResult.status).toBe(cronResult.label);
    });
  }

  it("all fixture names are unique (test self-check)", () => {
    const names = FIXTURES.map((f) => f.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});
