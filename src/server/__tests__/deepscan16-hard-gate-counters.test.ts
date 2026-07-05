/**
 * deepscan16-hard-gate-counters.test.ts — Deep-scan #16 Wave-1 Track 5 (HIGH E-6/E-7/E-8)
 *
 * Coverage:
 *   E-6 — tf_b14_gate_total / tf_wfe_gate_total / tf_parameter_drift_gate_total
 *         are registered, zero-initialized across all 12 (transition × outcome)
 *         combinations, and increment correctly.
 *   E-7 — tf_backtest_completion_write_failed_total is registered, zero-initialized
 *         for both stages, and increments correctly.
 *   E-8 — tf_quantum_mc_runs_total is registered, zero-initialized for all 4
 *         outcomes, and increments correctly.
 *
 * These tests exercise the REAL (non-mocked) metrics-registry.ts module directly —
 * the same pattern used by wave29-prod-hardening-prom-counters.test.ts — so they
 * verify the counters exist and behave correctly independent of the (heavily
 * DB-coupled) lifecycle-service.ts / backtest-service.ts / quantum-mc-service.ts
 * call sites. The outcome-derivation logic used at those call sites (in
 * lifecycle-service.ts's _incB14GateCounter / _incWfeGateCounter /
 * _incParameterDriftGateCounter helpers) is unit-tested independently below via
 * an exact-copy reference implementation, mirroring the established pattern for
 * bifGateEvaluationsTotal's outcome mapping (observability-gap-fixes.test.ts GAP 3).
 */

import { describe, it, expect } from "vitest";
import {
  promRegistry,
  b14GateTotal,
  wfeGateTotal,
  parameterDriftGateTotal,
  backtestCompletionWriteFailedTotal,
  quantumMcRunsTotal,
  backtestDslGuardsFailedTotal,
} from "../lib/metrics-registry.js";

async function getCounterValue(
  metricName: string,
  labelFilter: Record<string, string> = {},
): Promise<number> {
  const metrics = await promRegistry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === metricName);
  if (!metric) return 0;
  const values = metric.values as Array<{ labels: Record<string, string>; value: number }>;
  if (Object.keys(labelFilter).length === 0) {
    return values.reduce((acc, v) => acc + v.value, 0);
  }
  const match = values.find((v) =>
    Object.entries(labelFilter).every(([k, val]) => v.labels[k] === val),
  );
  return match?.value ?? 0;
}

const TRANSITIONS = ["TESTING_TO_PAPER", "SHADOW_TO_PAPER", "PAPER_TO_DEPLOY_READY"] as const;
const OUTCOMES = ["pass", "block", "legacy", "error"] as const;

describe("HIGH E-6 — tf_b14_gate_total", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_b14_gate_total");
  });

  it("is zero-initialized for all 3 transitions × 4 outcomes (12 combos)", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_b14_gate_total");
    expect(metric).toBeDefined();
    const values = (metric as any).values as Array<{ labels: Record<string, string>; value: number }>;
    for (const transition of TRANSITIONS) {
      for (const outcome of OUTCOMES) {
        const entry = values.find((v) => v.labels.transition === transition && v.labels.outcome === outcome);
        expect(entry, `missing zero-init for transition=${transition} outcome=${outcome}`).toBeDefined();
        expect(entry!.value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("increments independently per transition+outcome pair", async () => {
    const before = await getCounterValue("tf_b14_gate_total", { transition: "PAPER_TO_DEPLOY_READY", outcome: "block" });
    b14GateTotal.labels({ transition: "PAPER_TO_DEPLOY_READY", outcome: "block" }).inc();
    const after = await getCounterValue("tf_b14_gate_total", { transition: "PAPER_TO_DEPLOY_READY", outcome: "block" });
    expect(after).toBe(before + 1);
  });
});

describe("HIGH E-6 — tf_wfe_gate_total", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_wfe_gate_total");
  });

  it("is zero-initialized for all 3 transitions × 4 outcomes (12 combos)", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_wfe_gate_total");
    const values = (metric as any).values as Array<{ labels: Record<string, string>; value: number }>;
    for (const transition of TRANSITIONS) {
      for (const outcome of OUTCOMES) {
        const entry = values.find((v) => v.labels.transition === transition && v.labels.outcome === outcome);
        expect(entry, `missing zero-init for transition=${transition} outcome=${outcome}`).toBeDefined();
      }
    }
  });

  it("increments independently per transition+outcome pair", async () => {
    const before = await getCounterValue("tf_wfe_gate_total", { transition: "TESTING_TO_PAPER", outcome: "legacy" });
    wfeGateTotal.labels({ transition: "TESTING_TO_PAPER", outcome: "legacy" }).inc();
    const after = await getCounterValue("tf_wfe_gate_total", { transition: "TESTING_TO_PAPER", outcome: "legacy" });
    expect(after).toBe(before + 1);
  });
});

describe("HIGH E-6 — tf_parameter_drift_gate_total", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_parameter_drift_gate_total");
  });

  it("is zero-initialized for all 3 transitions × 4 outcomes (12 combos)", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_parameter_drift_gate_total");
    const values = (metric as any).values as Array<{ labels: Record<string, string>; value: number }>;
    for (const transition of TRANSITIONS) {
      for (const outcome of OUTCOMES) {
        const entry = values.find((v) => v.labels.transition === transition && v.labels.outcome === outcome);
        expect(entry, `missing zero-init for transition=${transition} outcome=${outcome}`).toBeDefined();
      }
    }
  });

  it("increments independently per transition+outcome pair", async () => {
    const before = await getCounterValue("tf_parameter_drift_gate_total", { transition: "SHADOW_TO_PAPER", outcome: "pass" });
    parameterDriftGateTotal.labels({ transition: "SHADOW_TO_PAPER", outcome: "pass" }).inc();
    const after = await getCounterValue("tf_parameter_drift_gate_total", { transition: "SHADOW_TO_PAPER", outcome: "pass" });
    expect(after).toBe(before + 1);
  });
});

describe("HIGH E-7 — tf_backtest_completion_write_failed_total", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_backtest_completion_write_failed_total");
  });

  it("is zero-initialized for both stages", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_backtest_completion_write_failed_total");
    const values = (metric as any).values as Array<{ labels: Record<string, string>; value: number }>;
    for (const stage of ["completion_write", "recovery_write"]) {
      expect(values.find((v) => v.labels.stage === stage)).toBeDefined();
    }
  });

  it("increments per stage independently", async () => {
    const before = await getCounterValue("tf_backtest_completion_write_failed_total", { stage: "recovery_write" });
    backtestCompletionWriteFailedTotal.labels({ stage: "recovery_write" }).inc();
    const after = await getCounterValue("tf_backtest_completion_write_failed_total", { stage: "recovery_write" });
    expect(after).toBe(before + 1);
  });
});

describe("HIGH E-8 — tf_quantum_mc_runs_total", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_quantum_mc_runs_total");
  });

  it("is zero-initialized for all 4 outcomes", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_quantum_mc_runs_total");
    const values = (metric as any).values as Array<{ labels: Record<string, string>; value: number }>;
    for (const outcome of ["completed", "failed", "pre_insert_error", "auto_fire_uncaught"]) {
      expect(values.find((v) => v.labels.outcome === outcome)).toBeDefined();
    }
  });

  it("increments per outcome independently", async () => {
    const before = await getCounterValue("tf_quantum_mc_runs_total", { outcome: "auto_fire_uncaught" });
    quantumMcRunsTotal.labels({ outcome: "auto_fire_uncaught" }).inc();
    const after = await getCounterValue("tf_quantum_mc_runs_total", { outcome: "auto_fire_uncaught" });
    expect(after).toBe(before + 1);
  });
});

// ─── Outcome-derivation logic (mirrors lifecycle-service.ts's private helpers) ──
//
// lifecycle-service.ts is heavily DB-coupled; rather than mock its entire
// dependency graph to exercise the private _incB14GateCounter / _incWfeGateCounter
// / _incParameterDriftGateCounter helpers directly, this section unit-tests an
// EXACT COPY of their outcome-derivation logic (same pattern as the existing
// bifGateEvaluationsTotal GAP-3 test). If lifecycle-service.ts's mapping logic
// ever drifts from this reference, the source-code assertions below (which check
// the increment call sites exist) plus this behavioral spec together bound the risk.

function deriveB14Outcome(result: { passed: boolean; legacyFallback?: boolean }): string {
  return !result.passed ? "block" : result.legacyFallback ? "legacy" : "pass";
}

function deriveWfeOrDriftOutcome(result: { passed: boolean; status: string }): string {
  const isLegacy = result.status === "legacy_null" || result.status === "cpcv_exempt";
  return isLegacy ? "legacy" : result.passed ? "pass" : "block";
}

describe("Outcome-derivation logic — B14 gate", () => {
  it("maps passed=true, no legacy fallback -> pass", () => {
    expect(deriveB14Outcome({ passed: true, legacyFallback: false })).toBe("pass");
  });
  it("maps passed=true WITH legacy fallback -> legacy", () => {
    expect(deriveB14Outcome({ passed: true, legacyFallback: true })).toBe("legacy");
  });
  it("maps passed=false -> block regardless of legacyFallback", () => {
    expect(deriveB14Outcome({ passed: false, legacyFallback: false })).toBe("block");
    expect(deriveB14Outcome({ passed: false, legacyFallback: true })).toBe("block");
  });
});

describe("Outcome-derivation logic — WFE / parameter-drift gates", () => {
  it("maps status=legacy_null -> legacy regardless of passed", () => {
    expect(deriveWfeOrDriftOutcome({ passed: true, status: "legacy_null" })).toBe("legacy");
  });
  it("maps status=cpcv_exempt -> legacy regardless of passed", () => {
    expect(deriveWfeOrDriftOutcome({ passed: true, status: "cpcv_exempt" })).toBe("legacy");
  });
  it("maps passed=true, non-legacy status -> pass", () => {
    expect(deriveWfeOrDriftOutcome({ passed: true, status: "passed" })).toBe("pass");
    expect(deriveWfeOrDriftOutcome({ passed: true, status: "warned_overfit" })).toBe("pass");
  });
  it("maps passed=false, non-legacy status -> block", () => {
    expect(deriveWfeOrDriftOutcome({ passed: false, status: "blocked" })).toBe("block");
    expect(deriveWfeOrDriftOutcome({ passed: false, status: "degenerate_is_block" })).toBe("block");
    expect(deriveWfeOrDriftOutcome({ passed: false, status: "blocked_classifier_error" })).toBe("block");
  });
});

// ─── Source-code assertions — call sites exist at every gate-evaluation point ──
//
// Guards against the increment call being silently deleted at one of the 9 B14 /
// 6 WFE / 6 parameter-drift evaluation sites in a future refactor.

describe("Source-code assertions — lifecycle-service.ts increment call sites", () => {
  it("calls _incB14GateCounter at all three transitions (TESTING_TO_PAPER, SHADOW_TO_PAPER, PAPER_TO_DEPLOY_READY)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { join, dirname } = await import("node:path");
    const filePath = join(dirname(fileURLToPath(import.meta.url)), "../services/lifecycle-service.ts");
    const src = readFileSync(filePath, "utf-8");

    expect(src).toContain('_incB14GateCounter("TESTING_TO_PAPER"');
    expect(src).toContain('_incB14GateCounter("SHADOW_TO_PAPER"');
    expect(src).toContain('_incB14GateCounter("PAPER_TO_DEPLOY_READY"');

    expect(src).toContain('_incWfeGateCounter("TESTING_TO_PAPER"');
    expect(src).toContain('_incWfeGateCounter("SHADOW_TO_PAPER"');
    expect(src).toContain('wfeGateTotal.labels({ transition: "PAPER_TO_DEPLOY_READY"');

    expect(src).toContain('_incParameterDriftGateCounter("TESTING_TO_PAPER"');
    expect(src).toContain('_incParameterDriftGateCounter("SHADOW_TO_PAPER"');
    expect(src).toContain('_incParameterDriftGateCounter("PAPER_TO_DEPLOY_READY"');

    // Error-path counters at each gate's catch block
    expect(src).toContain('b14GateTotal.labels({ transition: "TESTING_TO_PAPER", outcome: "error" })');
    expect(src).toContain('b14GateTotal.labels({ transition: "SHADOW_TO_PAPER", outcome: "error" })');
    expect(src).toContain('b14GateTotal.labels({ transition: "PAPER_TO_DEPLOY_READY", outcome: "error" })');
  });
});

// ─── Cross-track contract — dsl_guards.guards_failed consumer (E-1) ────────────
//
// Track 2 is adding result["dsl_guards"]["guards_failed"] to the Python engine
// (backtester.py already emits result["dsl_guards"] with stop_ceiling_skips /
// time_stop_exits / dll_halt_blocks, but guards_failed did not exist yet at the
// time this track shipped). backtest-service.ts reads it back out of the raw
// Python result inside the completion transaction (forward-compatible — a no-op
// today, live the moment Track 2 lands the producer field) and:
//   1. persists the whole dsl_guards object via buildResultExtras (so any future
//      consumer, including this one on a later run, can read it back), and
//   2. writes a distinct "backtest.dsl_guards_failed" audit_log row + increments
//      tf_backtest_dsl_guards_failed_total whenever guards_failed is non-empty,
//      so the backtest is flagged invalid-for-promotion in the audit trail rather
//      than silently counted as a clean "backtest.run success".
//
// This does NOT wire a lifecycle hard gate — that wiring is out of scope for this
// track (backtest-service.ts is a producer of the audit signal, not the gate).
describe("Cross-track E-1 — tf_backtest_dsl_guards_failed_total + dsl_guards persistence", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_backtest_dsl_guards_failed_total");
  });

  it("increments on backtestDslGuardsFailedTotal.inc()", async () => {
    const before = await getCounterValue("tf_backtest_dsl_guards_failed_total");
    backtestDslGuardsFailedTotal.inc();
    const after = await getCounterValue("tf_backtest_dsl_guards_failed_total");
    expect(after).toBe(before + 1);
  });

  it("backtest-service.ts persists dsl_guards via buildResultExtras and checks guards_failed in the completion transaction", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { join, dirname } = await import("node:path");
    const filePath = join(dirname(fileURLToPath(import.meta.url)), "../services/backtest-service.ts");
    const src = readFileSync(filePath, "utf-8");

    // buildResultExtras persists the whole dsl_guards object (forward-compatible
    // with whatever shape Track 2 lands, not just guards_failed).
    expect(src).toContain('"dsl_guards"');
    // The completion-transaction consumer reads guards_failed back out of the raw
    // Python result and marks the backtest invalid-for-promotion.
    expect(src).toContain("dslGuardsRaw?.guards_failed");
    expect(src).toContain(").dsl_guards");
    expect(src).toContain('action: "backtest.dsl_guards_failed"');
    expect(src).toContain("backtestDslGuardsFailedTotal.inc()");
  });
});

// ─── Reference implementation — guards_failed list normalization ──────────────
//
// Exact-copy reference of the normalization logic in backtest-service.ts's
// completion-transaction step 7 (Array.isArray passthrough / truthy-scalar
// wrap / absent-or-falsy -> empty). Unit-tested independently of the (heavily
// DB-coupled) completion transaction, mirroring this file's established pattern.
function deriveGuardsFailedList(guardsFailedRaw: unknown): unknown[] {
  return Array.isArray(guardsFailedRaw)
    ? guardsFailedRaw
    : guardsFailedRaw
      ? [guardsFailedRaw]
      : [];
}

describe("Outcome-derivation logic — guards_failed list normalization", () => {
  it("passes through an array unchanged", () => {
    expect(deriveGuardsFailedList(["stop_ceiling", "dll_halt"])).toEqual(["stop_ceiling", "dll_halt"]);
  });
  it("wraps a truthy scalar in a single-element array", () => {
    expect(deriveGuardsFailedList("stop_ceiling")).toEqual(["stop_ceiling"]);
  });
  it("returns [] for undefined/null/empty-string/false", () => {
    expect(deriveGuardsFailedList(undefined)).toEqual([]);
    expect(deriveGuardsFailedList(null)).toEqual([]);
    expect(deriveGuardsFailedList("")).toEqual([]);
    expect(deriveGuardsFailedList(false)).toEqual([]);
  });
  it("returns [] for an empty array (does not treat presence-of-key as failure)", () => {
    expect(deriveGuardsFailedList([])).toEqual([]);
  });
});
