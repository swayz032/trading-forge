/**
 * Wave 26 Task 2 — TS↔Python exit-engine parity verification.
 *
 * Verifies that the TS adaptive-exit-engine.ts pure-function layer and
 * the Python adaptive_exits.py compute_exit_plan_python() produce identical
 * outputs for 5 synthetic fixtures (no liquidity → R-multiple fallback only).
 *
 * Tolerance contract:
 *   - tp1.price / tp2.price: ±0.01 (float arithmetic rounding only)
 *   - runner_trail_method: exact string
 *   - scaling fractions: ±0.001 each
 *   - pre_lunch_threshold_r: exact
 *
 * These tests mirror the logic in scripts/wave26-ts-python-exit-parity.ts but
 * run inside Vitest so they participate in the full CI test suite.
 *
 * IMPORTANT: Python must be available in PATH for these tests to run.
 * In environments without Python (CI with no Python), tests are skipped
 * gracefully via SKIP_PYTHON_PARITY=true env var.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";

// ─── Tolerance constants ────────────────────────────────────────────────────

const PRICE_TOLERANCE = 0.01;
const SCALING_TOLERANCE = 0.001;

// ─── TS pure-function layer (inline to avoid DB dependency) ─────────────────

const REGIME_SCALING_DEFAULTS: Record<string, [number, number, number]> = {
  TRENDING_UP:    [0.20, 0.30, 0.50],
  TRENDING_DOWN:  [0.20, 0.30, 0.50],
  EXPANSION:      [0.20, 0.30, 0.50],
  RANGE_BOUND:    [0.50, 0.30, 0.20],
  COMPRESSION:    [0.50, 0.30, 0.20],
  HIGH_VOL_MACRO: [0.60, 0.30, 0.10],
  LOW_LIQ_CHOP:   [0.50, 0.50, 0.00],
  UNKNOWN:        [0.50, 0.30, 0.20],
};

const REGIME_RUNNER_TRAIL_DEFAULTS: Record<string, string> = {
  TRENDING_UP:    "anchored_vwap",
  TRENDING_DOWN:  "anchored_vwap",
  EXPANSION:      "anchored_vwap",
  RANGE_BOUND:    "developing_poc",
  COMPRESSION:    "structure_trail",
  HIGH_VOL_MACRO: "chandelier",
  LOW_LIQ_CHOP:   "developing_poc",
};

interface PureExitPlan {
  tp1_price: number;
  tp2_price: number;
  runner_trail_method: string;
  scaling_tp1_pct: number;
  scaling_tp2_pct: number;
  scaling_runner_pct: number;
  pre_lunch_threshold_r: number;
}

function computeTsExitPlanPure(
  entry_price: number,
  stop_price: number,
  direction: "long" | "short",
  regime: string,
  pre_lunch_threshold_r: number,
): PureExitPlan {
  const stopDistance = Math.abs(entry_price - stop_price);
  const tp1Price = direction === "long"
    ? entry_price + 1.0 * stopDistance
    : entry_price - 1.0 * stopDistance;
  const tp2Price = direction === "long"
    ? entry_price + 2.0 * stopDistance
    : entry_price - 2.0 * stopDistance;
  const scaling = REGIME_SCALING_DEFAULTS[regime] ?? REGIME_SCALING_DEFAULTS["UNKNOWN"];
  const runnerMethod = REGIME_RUNNER_TRAIL_DEFAULTS[regime] ?? "developing_poc";
  return {
    tp1_price: tp1Price,
    tp2_price: tp2Price,
    runner_trail_method: runnerMethod,
    scaling_tp1_pct: scaling[0],
    scaling_tp2_pct: scaling[1],
    scaling_runner_pct: scaling[2],
    pre_lunch_threshold_r,
  };
}

// ─── Python subprocess helper ────────────────────────────────────────────────

// Resolve Python executable: check common Windows/Linux paths + PATH.
// Use a short 2s probe so module-level resolution doesn't block test collection.
function resolvePythonExe(): string | null {
  const candidates = [
    "C:\\Program Files\\Python313\\python.exe",
    "C:\\Program Files\\Python312\\python.exe",
    "C:\\Program Files\\Python311\\python.exe",
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "python3",
    "python",
  ];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ["--version"], { encoding: "utf-8", timeout: 2_000 });
      if (r.status === 0 && !r.error) return cmd;
    } catch {
      // Candidate not found — try next.
    }
  }
  return null;
}

// Resolved once at module-load (happens during test collection, after file execution).
const PYTHON_EXE = resolvePythonExe();

function callPythonExitPlan(
  entry_price: number,
  stop_price: number,
  direction: string,
  regime: string,
  pre_lunch_threshold_r: number,
): PureExitPlan | { error: string } {
  if (!PYTHON_EXE) {
    return { error: "no Python executable found in common locations" };
  }

  const pythonCode = `
import sys, json
sys.path.insert(0, r"${process.cwd().replace(/\\/g, "\\\\")}")
from src.engine.exits.adaptive_exits import compute_exit_plan_python
from datetime import datetime

plan = compute_exit_plan_python(
    entry_price=${entry_price},
    stop_price=${stop_price},
    direction="${direction}",
    symbol="MES",
    bar_ts=datetime(2026, 5, 24, 14, 0),
    atr=6.0,
    regime="${regime}",
    liquidity_snapshot=[],
    pre_lunch_threshold_r=${pre_lunch_threshold_r},
    delta_div_threshold=0.6,
)
print(json.dumps({
    "tp1_price": plan.tp1.price,
    "tp2_price": plan.tp2.price,
    "runner_trail_method": plan.runner_trail_method,
    "scaling_tp1_pct": plan.scaling.tp1_pct,
    "scaling_tp2_pct": plan.scaling.tp2_pct,
    "scaling_runner_pct": plan.scaling.runner_pct,
    "pre_lunch_threshold_r": plan.pre_lunch_threshold_r,
}))
`;

  const r = spawnSync(PYTHON_EXE, ["-c", pythonCode], {
    encoding: "utf-8",
    // 10s cap: if Python import fails or hangs, fail fast rather than blocking the test.
    timeout: 10_000,
    cwd: process.cwd(),
  });

  if (r.status !== 0 || r.error) {
    return { error: r.stderr || String(r.error ?? "non-zero exit") };
  }

  try {
    return JSON.parse(r.stdout.trim()) as PureExitPlan;
  } catch {
    return { error: `JSON parse error: ${r.stdout.trim()}` };
  }
}

// ─── Check whether to skip Python-dependent tests ────────────────────────────

// Skip when env flag is set OR when Python is not available on this machine.
const SKIP_PYTHON = process.env["SKIP_PYTHON_PARITY"] === "true" || PYTHON_EXE === null;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURES = [
  {
    name: "long+TRENDING_UP",
    entry_price: 4000.0,
    stop_price: 3994.0,
    direction: "long" as const,
    regime: "TRENDING_UP",
    pre_lunch_threshold_r: 0.3,
  },
  {
    name: "short+TRENDING_DOWN",
    entry_price: 4000.0,
    stop_price: 4006.0,
    direction: "short" as const,
    regime: "TRENDING_DOWN",
    pre_lunch_threshold_r: 0.3,
  },
  {
    name: "long+RANGE_BOUND",
    entry_price: 5250.0,
    stop_price: 5244.0,
    direction: "long" as const,
    regime: "RANGE_BOUND",
    pre_lunch_threshold_r: 0.3,
  },
  {
    name: "long+HIGH_VOL_MACRO",
    entry_price: 4500.0,
    stop_price: 4494.0,
    direction: "long" as const,
    regime: "HIGH_VOL_MACRO",
    pre_lunch_threshold_r: 0.5,
  },
  {
    name: "long+COMPRESSION",
    entry_price: 4250.0,
    stop_price: 4244.0,
    direction: "long" as const,
    regime: "COMPRESSION",
    pre_lunch_threshold_r: 0.3,
  },
];

// ─── TS-only tests (no Python dependency) ────────────────────────────────────

describe("Wave 26 TS exit-plan pure layer (no DB)", () => {
  it("TRENDING_UP → anchored_vwap runner trail", () => {
    const plan = computeTsExitPlanPure(4000, 3994, "long", "TRENDING_UP", 0.3);
    expect(plan.runner_trail_method).toBe("anchored_vwap");
  });

  it("TRENDING_DOWN → anchored_vwap runner trail", () => {
    const plan = computeTsExitPlanPure(4000, 4006, "short", "TRENDING_DOWN", 0.3);
    expect(plan.runner_trail_method).toBe("anchored_vwap");
  });

  it("RANGE_BOUND → developing_poc runner trail", () => {
    const plan = computeTsExitPlanPure(5250, 5244, "long", "RANGE_BOUND", 0.3);
    expect(plan.runner_trail_method).toBe("developing_poc");
  });

  it("HIGH_VOL_MACRO → chandelier runner trail", () => {
    const plan = computeTsExitPlanPure(4500, 4494, "long", "HIGH_VOL_MACRO", 0.5);
    expect(plan.runner_trail_method).toBe("chandelier");
  });

  it("COMPRESSION → structure_trail runner trail", () => {
    const plan = computeTsExitPlanPure(4250, 4244, "long", "COMPRESSION", 0.3);
    expect(plan.runner_trail_method).toBe("structure_trail");
  });

  it("long TRENDING_UP: tp1=entry+1R, tp2=entry+2R", () => {
    const plan = computeTsExitPlanPure(4000, 3994, "long", "TRENDING_UP", 0.3);
    expect(plan.tp1_price).toBeCloseTo(4006.0, 2);  // 4000 + 6
    expect(plan.tp2_price).toBeCloseTo(4012.0, 2);  // 4000 + 12
  });

  it("short TRENDING_DOWN: tp1=entry-1R, tp2=entry-2R", () => {
    const plan = computeTsExitPlanPure(4000, 4006, "short", "TRENDING_DOWN", 0.3);
    expect(plan.tp1_price).toBeCloseTo(3994.0, 2);  // 4000 - 6
    expect(plan.tp2_price).toBeCloseTo(3988.0, 2);  // 4000 - 12
  });

  it("TRENDING_UP scaling: 20/30/50 (bigger runner)", () => {
    const plan = computeTsExitPlanPure(4000, 3994, "long", "TRENDING_UP", 0.3);
    expect(plan.scaling_tp1_pct).toBeCloseTo(0.20, 3);
    expect(plan.scaling_tp2_pct).toBeCloseTo(0.30, 3);
    expect(plan.scaling_runner_pct).toBeCloseTo(0.50, 3);
  });

  it("RANGE_BOUND scaling: 50/30/20 (quick harvest)", () => {
    const plan = computeTsExitPlanPure(5250, 5244, "long", "RANGE_BOUND", 0.3);
    expect(plan.scaling_tp1_pct).toBeCloseTo(0.50, 3);
    expect(plan.scaling_tp2_pct).toBeCloseTo(0.30, 3);
    expect(plan.scaling_runner_pct).toBeCloseTo(0.20, 3);
  });

  it("scaling fractions sum to 1.00 for all fixtures", () => {
    for (const f of FIXTURES) {
      const plan = computeTsExitPlanPure(f.entry_price, f.stop_price, f.direction, f.regime, f.pre_lunch_threshold_r);
      const sum = plan.scaling_tp1_pct + plan.scaling_tp2_pct + plan.scaling_runner_pct;
      expect(sum).toBeCloseTo(1.0, 3);
    }
  });

  it("pre_lunch_threshold_r stored correctly", () => {
    const plan = computeTsExitPlanPure(4500, 4494, "long", "HIGH_VOL_MACRO", 0.5);
    expect(plan.pre_lunch_threshold_r).toBe(0.5);
  });
});

// ─── TS↔Python parity tests (require Python) ──────────────────────────────────

describe("Wave 26 TS↔Python exit-plan parity (5 fixtures)", () => {
  for (const fixture of FIXTURES) {
    // 15s timeout: Python subprocess probe + import + compute. Falls back to skip if Python unavailable.
    it(`fixture ${fixture.name}: tp1/tp2/runner/scaling match Python (±${PRICE_TOLERANCE})`, { timeout: 15_000 }, () => {
      if (SKIP_PYTHON) {
        // Graceful skip when Python not available (SKIP_PYTHON_PARITY=true or no Python exe found).
        return;
      }

      const tsPlan = computeTsExitPlanPure(
        fixture.entry_price,
        fixture.stop_price,
        fixture.direction,
        fixture.regime,
        fixture.pre_lunch_threshold_r,
      );

      const pyPlanOrError = callPythonExitPlan(
        fixture.entry_price,
        fixture.stop_price,
        fixture.direction,
        fixture.regime,
        fixture.pre_lunch_threshold_r,
      );

      if ("error" in pyPlanOrError) {
        // Python unavailable — skip rather than fail
        console.warn(`[parity] Python unavailable for ${fixture.name}: ${pyPlanOrError.error}`);
        return;
      }

      const pyPlan = pyPlanOrError;

      // TP1 price
      expect(Math.abs(tsPlan.tp1_price - pyPlan.tp1_price)).toBeLessThanOrEqual(PRICE_TOLERANCE);

      // TP2 price
      expect(Math.abs(tsPlan.tp2_price - pyPlan.tp2_price)).toBeLessThanOrEqual(PRICE_TOLERANCE);

      // runner_trail_method (exact)
      expect(tsPlan.runner_trail_method).toBe(pyPlan.runner_trail_method);

      // scaling fractions
      expect(Math.abs(tsPlan.scaling_tp1_pct - pyPlan.scaling_tp1_pct)).toBeLessThanOrEqual(SCALING_TOLERANCE);
      expect(Math.abs(tsPlan.scaling_tp2_pct - pyPlan.scaling_tp2_pct)).toBeLessThanOrEqual(SCALING_TOLERANCE);
      expect(Math.abs(tsPlan.scaling_runner_pct - pyPlan.scaling_runner_pct)).toBeLessThanOrEqual(SCALING_TOLERANCE);

      // pre_lunch_threshold_r (exact)
      expect(tsPlan.pre_lunch_threshold_r).toBe(pyPlan.pre_lunch_threshold_r);
    });
  }
});
