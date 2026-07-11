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
 *   P4  0 signals (empty) — expects insufficient_samples BLOCK (fail-closed, parity with cron; HIGH-1 fix)
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
 * Faithful model of the REAL Gate 2.5 cron-sweep decision tree from
 * lifecycle-service.ts (~5054-5128).
 *
 * CORRECTED 2026-07-09 (deep-scan HIGH-2, operator-ratified): the prior
 * `simulateCronGate2_5` FABRICATED a `shadowSignals.length === 0 → ok:true
 * (legacy_unavailable)` short-circuit that the production cron DOES NOT HAVE.
 * The real cron calls `compareShadowToBacktest(sSignals, backtestExpected)`
 * directly (lifecycle-service.ts:5054) and `continue`s (BLOCKS) on `!ok`
 * (line 5128) — including `insufficient_samples` at 0 signals. The fabricated
 * oracle made the parity suite structurally unable to detect the manual path's
 * false-green at 0 signals (HIGH-1). This model has NO such short-circuit.
 *
 *   const divergenceResult = compareShadowToBacktest(sSignals, backtestExpected)
 *   if (!divergenceResult.ok):
 *     isInsufficientSamples = reason === "insufficient_samples"
 *     auditAction = isInsufficientSamples
 *       ? "lifecycle.shadow_divergence_insufficient_samples"
 *       : "lifecycle.shadow_divergence_blocked"
 *     → BLOCK (continue)     // 0 signals lands HERE (0 < MIN_SAMPLE_SIZE)
 *   else:
 *     auditAction = "lifecycle.shadow_promotion_passed" → PROMOTE
 */
function cronGate2_5Verdict(
  shadowSignals: ShadowSignal[],
  backtestExpected: ExpectedSignal[],
): CronGateResult {
  const divergenceResult = compareShadowToBacktest(shadowSignals ?? [], backtestExpected ?? []);

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

  // P4: 0 signals → insufficient_samples BLOCK (fail-closed, parity with cron)
  // (HIGH-1 fix 2026-07-09: was legacy_unavailable→PASS on the manual path only)
  {
    name: "P4: empty shadow signals → insufficient_samples BLOCK (fail-closed)",
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
      // Step 1: Get the cron-sweep Gate 2.5 verdict (faithful model of the real cron)
      const cronResult = cronGate2_5Verdict(fixture.shadowSignals, fixture.backtestExpected);

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

// ──────────────────────────────────────────────────────────────────────────────
// HIGH-1 fail-closed lock (deep-scan 2026-07-09, operator-ratified)
// Explicit, non-parametrized proof that the manual evaluator BLOCKS at 0/null
// shadow signals — the training-serving-skew false-green that HIGH-1 closed.
// This RED-fails against the pre-fix code (which returned passed:true /
// legacy_unavailable at 0 signals) and GREENs after.
// ──────────────────────────────────────────────────────────────────────────────
describe("evaluateShadowToPaperGate — 0/null signals FAIL-CLOSED (HIGH-1)", () => {
  const baseInput = {
    backtestExpected: [] as ExpectedSignal[],
    backtestExpectedCount: 0,
    strategyId: STRATEGY_ID,
    correlationId: "high1-fail-closed",
  };

  it("0 shadow signals → BLOCK (insufficient_samples), NOT legacy_unavailable pass", () => {
    const r = evaluateShadowToPaperGate({ ...baseInput, shadowSignals: [] });
    expect(r.passed).toBe(false);
    expect(r.status).toBe("insufficient_samples");
    expect(r.auditAction).toBe("lifecycle.shadow_divergence_insufficient_samples");
    // Regression guard: the removed false-green path must never return again.
    expect(r.status).not.toBe("legacy_unavailable");
    expect(r.passed).not.toBe(true);
  });

  it("null shadow signals → BLOCK (no throw, fail-closed)", () => {
    const r = evaluateShadowToPaperGate({
      ...baseInput,
      shadowSignals: null as unknown as ShadowSignal[],
    });
    expect(r.passed).toBe(false);
    expect(r.status).toBe("insufficient_samples");
  });

  it("manual evaluator and cron model agree at 0 signals (both BLOCK)", () => {
    const evalR = evaluateShadowToPaperGate({ ...baseInput, shadowSignals: [] });
    const cronR = cronGate2_5Verdict([], []);
    expect(evalR.passed).toBe(cronR.ok);           // both false
    expect(evalR.auditAction).toBe(cronR.auditAction);
    expect(evalR.status).toBe(cronR.label);        // both "insufficient_samples"
  });
});
