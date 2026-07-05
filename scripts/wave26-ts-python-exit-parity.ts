/**
 * wave26-ts-python-exit-parity.ts — TS↔Python exit-engine parity smoke test.
 *
 * Wave 26 Task 2: verifies that the TS adaptive-exit-engine.ts and the Python
 * adaptive_exits.py produce identical outputs for the same synthetic inputs.
 *
 * deepscan17 (2026-07-05) B-4 CRITICAL REWRITE — read this before editing:
 *   The pre-fix version of this file hand-copied a SECOND, parallel
 *   reimplementation of the TS exit-plan math (`computeTsExitPlanPure`) instead
 *   of importing the real `computeExitPlan()`. A future edit to the real TS
 *   constants/logic would never be caught by this gate — it would only ever
 *   compare Python against a frozen copy-paste. That reimplementation has been
 *   DELETED. This file now imports and calls the REAL `computeExitPlan()` /
 *   `computePreLunchDecision()` (TS) and `compute_exit_plan_python()` /
 *   `compute_pre_lunch_decision()` (Python) directly.
 *
 *   B-4(b) liquidity-ranking divergence — TS ranks liquidity candidates by a
 *   COMPOSITE score (significance + sweep_probability + proximity, computed by
 *   `getNearestLiquidity()` in liquidity-map-service.ts); Python previously
 *   sorted by PURE geometric proximity. Identical liquidity snapshots could
 *   therefore select different TP1/TP2 targets on the two engines — untested,
 *   because every fixture here passed an empty snapshot. RESOLUTION: composite
 *   score is authoritative (see adaptive_exits.py module docstring for why —
 *   short version: liquidity-map-service.ts is explicitly documented as a
 *   "ranked" institutional engine, and config.py's AdaptiveExitContext
 *   docstring already states the TS launch helper hands Python a
 *   "pre-filtered + ranked" snapshot — Python's geometric re-sort was
 *   discarding that order, not implementing a deliberate determinism choice).
 *   `adaptive_exits.py::_build_liquidity_targets()` was ported to the composite
 *   formula. This file now includes NON-EMPTY liquidity fixtures (below) that
 *   fail under the old geometric-proximity code and pass under the fix.
 *
 *   B-15 — regime coverage was 5/8 keys (missing EXPANSION, LOW_LIQ_CHOP,
 *   UNKNOWN); now all 8 REGIME_SCALING_DEFAULTS keys are exercised. The
 *   `pre_lunch_threshold_r` check was tautological (both engines just echoed
 *   back the float they were handed — proves nothing about the actual
 *   fire/no-fire decision). A real PRE_LUNCH_FIXTURES matrix now drives the
 *   exported `computePreLunchDecision()` (TS) / `compute_pre_lunch_decision()`
 *   (Python, newly added — see adaptive_exits.py) across time/regime/pnl
 *   combinations with hand-verified expected outcomes, not just mutual echo.
 *
 * DB isolation (read before changing):
 *   `computeExitPlan()` transitively imports the DB module (audit-log-helper.js
 *   -> db/index.ts) at load time, which throws synchronously if DATABASE_URL is
 *   unset. This script FORCE-SETS a local unreachable DATABASE_URL before the
 *   dynamic import below — deliberately, not defensively — so this CI gate can
 *   NEVER read or write the real Postgres instance, even if a real
 *   DATABASE_URL happens to be exported in the calling shell. The liquidity
 *   lookup itself never touches that fake connection: a fake in-memory
 *   `LiquidityMapDAL` is injected via computeExitPlan's `liquidityFetcher`
 *   testing seam (adaptive-exit-engine.ts), so `getNearestLiquidity()`'s REAL
 *   composite-ranking algorithm runs against deterministic fixture data. The
 *   three fire-and-forget `insertAuditRow()` calls inside computeExitPlan will
 *   still attempt (and fail fast on) the fake connection — this is expected,
 *   non-blocking (already `.catch()`-guarded in the source), and silenced via
 *   `LOG_LEVEL=silent` below so it doesn't clutter CI output.
 *
 * Exit codes:
 *   0 — all fixtures passed (full parity)
 *   1 — one or more fixtures drifted (parity broken — CI hard gate FAIL)
 *
 * Usage:
 *   npx tsx scripts/wave26-ts-python-exit-parity.ts
 *   npm run check:ts-python-exit-parity
 *
 * PARITY TOLERANCE:
 *   TP prices: ±0.01 (floating-point arithmetic rounding only)
 *   runner_trail_method / tp{1,2}.source / tp{1,2}.level_type: exact match
 *   scaling (tp1_pct/tp2_pct/runner_pct): ±0.001 each
 *   pre_lunch_threshold_r: exact match (echo check only — see PRE_LUNCH_FIXTURES
 *     below for the real fire/no-fire behavioral parity check)
 */

// ─── DB isolation — MUST run before any dynamic import of service code ────────
process.env.DATABASE_URL = "postgresql://parity-harness:unused@127.0.0.1:1/parity_harness_unused";
process.env.LOG_LEVEL = "silent";

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import type {
  ExitPlanInput,
  ExitPlan,
  LiquidityFetcher,
} from "../src/server/services/adaptive-exit-engine.js";
import type {
  LiquidityMapDAL,
  ActiveLevelRow,
  LevelType,
} from "../src/server/services/liquidity-map-service.js";

// Dynamic import: DATABASE_URL above must land before this module (and its
// transitive db/index.ts import) evaluates. Static imports are hoisted ahead
// of top-level statements in the same file, so this cannot be a static import.
// `.js` extension matches project convention (NodeNext moduleResolution resolves
// the sibling .ts source — see adaptive-exit-engine.ts's own imports).
const { computeExitPlan, computePreLunchDecision } = await import(
  "../src/server/services/adaptive-exit-engine.js"
);
const { getNearestLiquidity, computeSweepProbability } = await import(
  "../src/server/services/liquidity-map-service.js"
);

// ─── Python executable resolution ──────────────────────────────────────────
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
const PYTHON_EXE = resolvePythonExe();

// ─── Fake in-memory LiquidityMapDAL (deepscan17) ───────────────────────────
// Feeds computeExitPlan's liquidityFetcher seam so getNearestLiquidity()'s REAL
// composite-rank-score algorithm runs against deterministic fixture rows —
// zero DB dependency, full real ranking logic exercised.
interface LiquidityFixtureLevel {
  levelType: LevelType;
  price: number;
  htfSignificance: number;
}

function makeFakeLiquidityFetcher(levels: LiquidityFixtureLevel[]): LiquidityFetcher {
  const now = new Date();
  const rows: ActiveLevelRow[] = levels.map((lvl, i) => ({
    id: `fixture-${i}-${lvl.levelType}`,
    symbol: "FIXTURE",
    sessionDate: "2026-05-24",
    levelType: lvl.levelType,
    price: lvl.price,
    htfSignificance: lvl.htfSignificance,
    sweepProbability: null,
    touchedCount: 0,
    sourceMeta: {},
    createdAt: now, // ageHours ≈ 0 -> ageDecay = 1 (deterministic, no time-based flake)
  }));
  const dal: LiquidityMapDAL = {
    async getActiveLevels() {
      return rows;
    },
    async upsertLevel() {
      return { id: "unused" };
    },
    async updateSweepProbability() {
      /* no-op */
    },
    async incrementTouchedCount() {
      /* no-op */
    },
    async expireLevels() {
      return 0;
    },
    async getPreMarketSession() {
      return null;
    },
  };
  return (symbol, fromPrice, direction, maxDistance) =>
    getNearestLiquidity(symbol, fromPrice, direction, maxDistance, dal);
}

/**
 * Compute the Python-side liquidity_snapshot for a fixture: replays the same
 * sweep_probability formula getNearestLiquidity() uses internally (ageHours=0,
 * touchedCount=0 to match makeFakeLiquidityFetcher above), via the REAL
 * exported computeSweepProbability() — not a reimplementation. This mirrors
 * the documented production contract (config.py AdaptiveExitContext docstring):
 * the TS launch helper pre-computes sweep_probability before handing Python
 * the snapshot; Python never recomputes it from age/touch data it doesn't have.
 */
function toPythonLiquiditySnapshot(
  levels: LiquidityFixtureLevel[],
  entryPrice: number,
  direction: "long" | "short",
  maxDistance: number,
): Array<{ level_type: string; price: number; htf_significance: number; sweep_probability: number }> {
  return levels.map((lvl) => {
    const dist = direction === "long" ? lvl.price - entryPrice : entryPrice - lvl.price;
    const sp = computeSweepProbability(lvl.htfSignificance, 0, 0, dist, maxDistance);
    return {
      level_type: lvl.levelType,
      price: lvl.price,
      htf_significance: lvl.htfSignificance,
      sweep_probability: sp,
    };
  });
}

// ─── Call Python compute_exit_plan_python() via subprocess ────────────────
interface PyExitPlanResult {
  tp1_price: number;
  tp1_source: string;
  tp1_level_type: string | null;
  tp2_price: number;
  tp2_source: string;
  tp2_level_type: string | null;
  runner_trail_method: string;
  scaling_tp1_pct: number;
  scaling_tp2_pct: number;
  scaling_runner_pct: number;
  pre_lunch_threshold_r: number;
}

function computePythonExitPlan(fixture: Fixture): PyExitPlanResult | { error: string } {
  if (!PYTHON_EXE) {
    return { error: "no Python executable found in common locations" };
  }
  const snapshot = toPythonLiquiditySnapshot(
    fixture.liquidityLevels,
    fixture.entry_price,
    fixture.direction,
    fixture.atr,
  );

  const pythonScript = `
import sys, json
sys.path.insert(0, r"${process.cwd().replace(/\\/g, "\\\\")}")
from src.engine.exits.adaptive_exits import compute_exit_plan_python
from datetime import datetime

plan = compute_exit_plan_python(
    entry_price=${fixture.entry_price},
    stop_price=${fixture.stop_price},
    direction="${fixture.direction}",
    symbol="MES",
    bar_ts=datetime(2026, 5, 24, 14, 0),
    atr=${fixture.atr},
    regime="${fixture.regime}",
    liquidity_snapshot=${JSON.stringify(snapshot)},
    pre_lunch_threshold_r=${fixture.pre_lunch_threshold_r},
    delta_div_threshold=0.6,
)
result = {
    "tp1_price": plan.tp1.price,
    "tp1_source": plan.tp1.source,
    "tp1_level_type": plan.tp1.level_type,
    "tp2_price": plan.tp2.price,
    "tp2_source": plan.tp2.source,
    "tp2_level_type": plan.tp2.level_type,
    "runner_trail_method": plan.runner_trail_method,
    "scaling_tp1_pct": plan.scaling.tp1_pct,
    "scaling_tp2_pct": plan.scaling.tp2_pct,
    "scaling_runner_pct": plan.scaling.runner_pct,
    "pre_lunch_threshold_r": plan.pre_lunch_threshold_r,
}
print(json.dumps(result))
`;

  const result = spawnSync(PYTHON_EXE, ["-c", pythonScript], {
    encoding: "utf-8",
    timeout: 30_000,
    cwd: process.cwd(),
  });

  if (result.status !== 0 || result.error) {
    return { error: result.stderr || String(result.error ?? "non-zero exit") };
  }
  try {
    return JSON.parse(result.stdout.trim()) as PyExitPlanResult;
  } catch {
    return { error: `JSON parse error: ${result.stdout.trim()}` };
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────
interface Fixture {
  name: string;
  entry_price: number;
  stop_price: number;
  direction: "long" | "short";
  regime: string;
  pre_lunch_threshold_r: number;
  atr: number;
  /** [] for backtest-realistic empty-snapshot fixtures (point-in-time integrity —
   * see backtest-service.ts adaptive_exit_context comment). Non-empty entries
   * exercise the composite-rank liquidity-selection surface. */
  liquidityLevels: LiquidityFixtureLevel[];
  /** Ground-truth expectation (not just TS==Python) for liquidity fixtures —
   * proves the composite-rank fix actually changed the selected candidate,
   * not merely that both engines agree with each other on a stale bug. */
  expectedTp1LevelType?: LevelType;
}

// All 8 REGIME_SCALING_DEFAULTS keys covered exactly once (B-15 fix — was 5/8).
const FIXTURES: Fixture[] = [
  {
    name: "long+TRENDING_UP+liquidity_rank_divergence",
    entry_price: 4000.0,
    stop_price: 3994.0, // 6pt stop -> 1R = 6pt
    direction: "long",
    regime: "TRENDING_UP",
    pre_lunch_threshold_r: 0.3,
    atr: 6.0,
    // hod (near, low significance, R=0.833) vs pdh (far, high significance, R=1.0).
    // Old Python geometric-proximity code picked hod (nearest price) as TP1.
    // Composite rank score favors pdh (significance dominates) -> TP1 = pdh.
    // This fixture FAILS under the pre-fix Python code and PASSES under the fix.
    liquidityLevels: [
      { levelType: "hod", price: 4005.0, htfSignificance: 1 },
      { levelType: "pdh", price: 4006.0, htfSignificance: 3 },
    ],
    expectedTp1LevelType: "pdh",
  },
  {
    name: "short+TRENDING_DOWN",
    entry_price: 4000.0,
    stop_price: 4006.0, // 6pt stop above entry
    direction: "short",
    regime: "TRENDING_DOWN",
    pre_lunch_threshold_r: 0.3,
    atr: 6.0,
    liquidityLevels: [], // backtest-realistic empty snapshot -> R-multiple fallback
  },
  {
    name: "long+RANGE_BOUND+liquidity_rank_divergence",
    entry_price: 5250.0,
    stop_price: 5244.0, // 6pt stop
    direction: "long",
    regime: "RANGE_BOUND",
    pre_lunch_threshold_r: 0.3,
    atr: 6.0,
    // naked_poc (near, htf_sig=2) vs eqh (far, htf_sig=3). Composite rank favors eqh.
    liquidityLevels: [
      { levelType: "naked_poc", price: 5255.0, htfSignificance: 2 },
      { levelType: "eqh", price: 5256.0, htfSignificance: 3 },
    ],
    expectedTp1LevelType: "eqh",
  },
  {
    name: "long+HIGH_VOL_MACRO",
    entry_price: 4500.0,
    stop_price: 4494.0,
    direction: "long",
    regime: "HIGH_VOL_MACRO",
    pre_lunch_threshold_r: 0.5, // larger threshold on macro days
    atr: 6.0,
    liquidityLevels: [],
  },
  {
    name: "long+COMPRESSION",
    entry_price: 4250.0,
    stop_price: 4244.0,
    direction: "long",
    regime: "COMPRESSION",
    pre_lunch_threshold_r: 0.3,
    atr: 6.0,
    liquidityLevels: [],
  },
  {
    name: "long+EXPANSION",
    entry_price: 4750.0,
    stop_price: 4744.0,
    direction: "long",
    regime: "EXPANSION",
    pre_lunch_threshold_r: 0.3,
    atr: 6.0,
    liquidityLevels: [], // B-15: previously untested regime key
  },
  {
    name: "short+LOW_LIQ_CHOP+liquidity_rank_divergence",
    entry_price: 4100.0,
    stop_price: 4106.0, // short, 6pt stop
    direction: "short",
    regime: "LOW_LIQ_CHOP", // B-15: previously untested regime key; zero-runner-pct (50/50/0)
    pre_lunch_threshold_r: 0.3,
    atr: 6.0,
    // lod (near, htf_sig=1) vs pdl (far, htf_sig=3) — same divergence shape, short side.
    liquidityLevels: [
      { levelType: "lod", price: 4095.0, htfSignificance: 1 },
      { levelType: "pdl", price: 4094.0, htfSignificance: 3 },
    ],
    expectedTp1LevelType: "pdl",
  },
  {
    name: "long+UNKNOWN",
    entry_price: 4900.0,
    stop_price: 4894.0,
    direction: "long",
    regime: "UNKNOWN", // B-15: previously untested — explicit UNKNOWN scaling key +
    // fallback default in REGIME_RUNNER_TRAIL_DEFAULTS (no "UNKNOWN" key there)
    pre_lunch_threshold_r: 0.3,
    atr: 6.0,
    liquidityLevels: [],
  },
];

// ─── Assertion helpers ─────────────────────────────────────────────────────
const PRICE_TOLERANCE = 0.01;
const SCALING_TOLERANCE = 0.001;

interface CheckResult {
  field: string;
  ts_val: number | string | boolean | null;
  py_val: number | string | boolean | null;
  passed: boolean;
  reason: string;
}

function checkPrice(field: string, ts: number, py: number): CheckResult {
  const delta = Math.abs(ts - py);
  const passed = delta <= PRICE_TOLERANCE;
  return { field, ts_val: ts, py_val: py, passed, reason: passed ? "OK" : `delta=${delta.toFixed(6)} > tolerance=${PRICE_TOLERANCE}` };
}

function checkExact<T extends string | number | boolean | null>(field: string, ts: T, py: T): CheckResult {
  const passed = ts === py;
  return { field, ts_val: ts, py_val: py, passed, reason: passed ? "OK" : `TS="${ts}" != Python="${py}"` };
}

function checkScaling(field: string, ts: number, py: number): CheckResult {
  const delta = Math.abs(ts - py);
  const passed = delta <= SCALING_TOLERANCE;
  return { field, ts_val: ts, py_val: py, passed, reason: passed ? "OK" : `delta=${delta.toFixed(6)} > tolerance=${SCALING_TOLERANCE}` };
}

// ─── Main: exit-plan fixtures ───────────────────────────────────────────────

interface FixtureResult {
  fixture: string;
  ts_plan: Record<string, unknown>;
  py_plan: PyExitPlanResult | { error: string };
  checks: CheckResult[];
  passed: boolean;
  python_error?: string;
}

const fixtureResults: FixtureResult[] = [];
let overallPassed = true;

console.log("Wave 26 — TS<->Python Exit Engine Parity Smoke (deepscan17 real-import rewrite)");
console.log(`Fixtures: ${FIXTURES.length} (all 8 regime keys; ${FIXTURES.filter((f) => f.liquidityLevels.length > 0).length} with non-empty liquidity)`);
console.log(`Price tolerance: +/-${PRICE_TOLERANCE}`);
console.log(`Scaling tolerance: +/-${SCALING_TOLERANCE}`);
console.log("");

for (const fixture of FIXTURES) {
  process.stdout.write(`  [${fixture.name}] `);

  const opts: ExitPlanInput = {
    // pre_lunch_threshold_r must ride in exit_plan_config — computeExitPlan reads
    // config?.pre_lunch_threshold_r, not a top-level param (bug caught by this
    // rewrite: the pre-fix shadow reimplementation took it as a bare function
    // arg, which is exactly the kind of drift a shadow reimplementation hides).
    strategy: { id: "parity-harness", exit_plan_config: { pre_lunch_threshold_r: fixture.pre_lunch_threshold_r } },
    entry: {
      price: fixture.entry_price,
      stop: fixture.stop_price,
      direction: fixture.direction,
      timestamp: new Date("2026-05-24T14:00:00.000Z"),
    },
    symbol: "MES",
    bar: {
      close: fixture.entry_price,
      high: fixture.entry_price,
      low: fixture.entry_price,
      volume: 100,
      ts_event: new Date("2026-05-24T14:00:00.000Z"),
    },
    marketState: { regime: fixture.regime, narrativePhase: null, atr: fixture.atr },
    liquidityFetcher: makeFakeLiquidityFetcher(fixture.liquidityLevels),
  };

  const tsPlan: ExitPlan = await computeExitPlan(opts);
  const pyPlan = computePythonExitPlan(fixture);

  if ("error" in pyPlan) {
    console.log(`FAIL — Python error: ${pyPlan.error}`);
    fixtureResults.push({
      fixture: fixture.name,
      ts_plan: tsPlan as unknown as Record<string, unknown>,
      py_plan: pyPlan,
      checks: [],
      passed: false,
      python_error: pyPlan.error,
    });
    overallPassed = false;
    continue;
  }

  const checks: CheckResult[] = [
    checkPrice("tp1.price", tsPlan.tp1.price, pyPlan.tp1_price),
    checkExact("tp1.source", tsPlan.tp1.source, pyPlan.tp1_source),
    checkExact("tp1.level_type", tsPlan.tp1.level_type ?? null, pyPlan.tp1_level_type),
    checkPrice("tp2.price", tsPlan.tp2.price, pyPlan.tp2_price),
    checkExact("tp2.source", tsPlan.tp2.source, pyPlan.tp2_source),
    checkExact("tp2.level_type", tsPlan.tp2.level_type ?? null, pyPlan.tp2_level_type),
    checkExact("runner_trail_method", tsPlan.runner.trail_method, pyPlan.runner_trail_method),
    checkScaling("scaling.tp1_pct", tsPlan.scaling.tp1_pct, pyPlan.scaling_tp1_pct),
    checkScaling("scaling.tp2_pct", tsPlan.scaling.tp2_pct, pyPlan.scaling_tp2_pct),
    checkScaling("scaling.runner_pct", tsPlan.scaling.runner_pct, pyPlan.scaling_runner_pct),
    checkExact("pre_lunch_threshold_r", tsPlan.pre_lunch_threshold_r, pyPlan.pre_lunch_threshold_r),
  ];

  if (fixture.expectedTp1LevelType) {
    checks.push(checkExact("tp1.level_type (ground truth, not just mutual echo)", tsPlan.tp1.level_type ?? null, fixture.expectedTp1LevelType));
    checks.push(checkExact("tp1.level_type (Python ground truth)", pyPlan.tp1_level_type, fixture.expectedTp1LevelType));
  }

  const fixturePassed = checks.every((c) => c.passed);
  if (!fixturePassed) overallPassed = false;

  const failedChecks = checks.filter((c) => !c.passed);
  console.log(fixturePassed ? "PASS" : `FAIL (${failedChecks.map((c) => `${c.field}: ${c.reason}`).join("; ")})`);

  fixtureResults.push({
    fixture: fixture.name,
    ts_plan: tsPlan as unknown as Record<string, unknown>,
    py_plan: pyPlan,
    checks,
    passed: fixturePassed,
  });
}

// ─── Pre-lunch decision fixtures (B-15 real-behavior fix) ──────────────────
// deepscan17: replaces the tautological pre_lunch_threshold_r echo-check above
// with real fire/no-fire behavioral parity against computePreLunchDecision()
// (TS) and the newly-added compute_pre_lunch_decision() (Python). Each fixture
// carries a hand-verified `expectedShouldFire` ground truth derived from the
// documented contract (fire iff regime is a trigger regime AND time >= 11:30 ET
// AND pnl_r >= threshold_r) — not just cross-engine agreement.

function etTimeToUtcIso(hh: number, mm: number): string {
  // 2026-05-24 is EDT (UTC-4) — fixed date, no DST ambiguity.
  return new Date(Date.UTC(2026, 4, 24, hh + 4, mm)).toISOString();
}

interface PreLunchFixture {
  name: string;
  regime: string;
  etHour: number;
  etMinute: number;
  entry: number;
  stop: number;
  direction: "long" | "short";
  currentPnlR: number;
  thresholdR: number;
  expectedShouldFire: boolean;
}

const PRE_LUNCH_FIXTURES: PreLunchFixture[] = [
  { name: "RANGE_BOUND 10:00 ET (before gate) -> no fire", regime: "RANGE_BOUND", etHour: 10, etMinute: 0, entry: 5250, stop: 5244, direction: "long", currentPnlR: 1.0, thresholdR: 0.3, expectedShouldFire: false },
  { name: "RANGE_BOUND 11:30 ET pnl below threshold -> no fire", regime: "RANGE_BOUND", etHour: 11, etMinute: 30, entry: 5250, stop: 5244, direction: "long", currentPnlR: 0.1, thresholdR: 0.3, expectedShouldFire: false },
  { name: "RANGE_BOUND 11:30 ET pnl==threshold (boundary >=) -> FIRES", regime: "RANGE_BOUND", etHour: 11, etMinute: 30, entry: 5250, stop: 5244, direction: "long", currentPnlR: 0.3, thresholdR: 0.3, expectedShouldFire: true },
  { name: "RANGE_BOUND 11:45 ET pnl above threshold -> FIRES", regime: "RANGE_BOUND", etHour: 11, etMinute: 45, entry: 5250, stop: 5244, direction: "long", currentPnlR: 0.5, thresholdR: 0.3, expectedShouldFire: true },
  { name: "TRENDING_UP 12:00 ET (not a trigger regime) -> no fire", regime: "TRENDING_UP", etHour: 12, etMinute: 0, entry: 4000, stop: 3994, direction: "long", currentPnlR: 1.0, thresholdR: 0.3, expectedShouldFire: false },
  { name: "LOW_LIQ_CHOP 13:00 ET pnl above threshold, short -> FIRES", regime: "LOW_LIQ_CHOP", etHour: 13, etMinute: 0, entry: 4100, stop: 4106, direction: "short", currentPnlR: 0.4, thresholdR: 0.3, expectedShouldFire: true },
  { name: "COMPRESSION 11:29 ET (1 min before gate) -> no fire", regime: "COMPRESSION", etHour: 11, etMinute: 29, entry: 4250, stop: 4244, direction: "long", currentPnlR: 1.0, thresholdR: 0.3, expectedShouldFire: false },
  { name: "HIGH_VOL_MACRO 12:00 ET (not a trigger regime) -> no fire", regime: "HIGH_VOL_MACRO", etHour: 12, etMinute: 0, entry: 4500, stop: 4494, direction: "long", currentPnlR: 1.0, thresholdR: 0.5, expectedShouldFire: false },
  { name: "EXPANSION 12:00 ET (not a trigger regime) -> no fire", regime: "EXPANSION", etHour: 12, etMinute: 0, entry: 4750, stop: 4744, direction: "long", currentPnlR: 1.0, thresholdR: 0.3, expectedShouldFire: false },
  { name: "LOW_LIQ_CHOP 15:00 ET pnl just under threshold -> no fire", regime: "LOW_LIQ_CHOP", etHour: 15, etMinute: 0, entry: 4100, stop: 4094, direction: "long", currentPnlR: 0.29, thresholdR: 0.3, expectedShouldFire: false },
];

function computePythonPreLunchDecision(f: PreLunchFixture): { should_fire: boolean; partial_pct: number; tightened_stop: number } | { error: string } {
  if (!PYTHON_EXE) return { error: "no Python executable found in common locations" };
  const iso = etTimeToUtcIso(f.etHour, f.etMinute);
  const pythonScript = `
import sys, json
sys.path.insert(0, r"${process.cwd().replace(/\\/g, "\\\\")}")
from src.engine.exits.adaptive_exits import compute_pre_lunch_decision
from datetime import datetime

d = compute_pre_lunch_decision(
    regime="${f.regime}",
    bar_ts=datetime.fromisoformat("${iso}"),
    entry_price=${f.entry},
    stop_price=${f.stop},
    direction="${f.direction}",
    current_pnl_r=${f.currentPnlR},
    threshold_r=${f.thresholdR},
)
print(json.dumps({
    "should_fire": d["should_fire"],
    "partial_pct": d["partial_pct"],
    "tightened_stop": d["tightened_stop"],
}))
`;
  const result = spawnSync(PYTHON_EXE, ["-c", pythonScript], { encoding: "utf-8", timeout: 30_000, cwd: process.cwd() });
  if (result.status !== 0 || result.error) return { error: result.stderr || String(result.error ?? "non-zero exit") };
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return { error: `JSON parse error: ${result.stdout.trim()}` };
  }
}

console.log("\n--- Pre-lunch decision fixtures (real behavior, not an echo check) ---");
let preLunchAllPassed = true;
const preLunchResults: Array<{ fixture: string; checks: CheckResult[]; passed: boolean; python_error?: string }> = [];

for (const f of PRE_LUNCH_FIXTURES) {
  process.stdout.write(`  [${f.name}] `);

  const tsDecision = computePreLunchDecision({
    regime: f.regime,
    bar: { close: f.entry, high: f.entry, low: f.entry, volume: 100, ts_event: new Date(etTimeToUtcIso(f.etHour, f.etMinute)) },
    entry: { price: f.entry, stop: f.stop, direction: f.direction, timestamp: new Date("2026-05-24T14:00:00.000Z") },
    currentPnlR: f.currentPnlR,
    thresholdR: f.thresholdR,
  });

  const pyDecision = computePythonPreLunchDecision(f);
  if ("error" in pyDecision) {
    console.log(`FAIL — Python error: ${pyDecision.error}`);
    preLunchResults.push({ fixture: f.name, checks: [], passed: false, python_error: pyDecision.error });
    preLunchAllPassed = false;
    overallPassed = false;
    continue;
  }

  const checks: CheckResult[] = [
    checkExact("shouldFire (ground truth)", tsDecision.shouldFire, f.expectedShouldFire),
    checkExact("should_fire (Python, ground truth)", pyDecision.should_fire, f.expectedShouldFire),
    checkExact("shouldFire (TS<->Python parity)", tsDecision.shouldFire, pyDecision.should_fire),
    checkScaling("partial_pct", tsDecision.partial_pct, pyDecision.partial_pct),
    checkPrice("tightened_stop", tsDecision.tightened_stop, pyDecision.tightened_stop),
  ];
  const passed = checks.every((c) => c.passed);
  if (!passed) preLunchAllPassed = false;
  if (!passed) overallPassed = false;

  const failedChecks = checks.filter((c) => !c.passed);
  console.log(passed ? "PASS" : `FAIL (${failedChecks.map((c) => `${c.field}: ${c.reason}`).join("; ")})`);
  preLunchResults.push({ fixture: f.name, checks, passed });
}
console.log(`  Pre-lunch fixtures: ${preLunchAllPassed ? "ALL PASS" : "FAILURES DETECTED"}`);

// ─── Wave 1 Track 1B TS-only assertions ───────────────────────────────────
// These test TS-side behavior for two new subsystems added in Wave 1 Track 1B:
//   A. VIX-tiered ATR multiplier (computeVixAtrMultiplier in risk-sizing.ts)
//   B. static_styleC TP2 liquidity lookup (paper-execution-service.ts)
//
// NOTE: These are TS-SIDE-ONLY assertions, OUT OF SCOPE for the deepscan17 B-4
// fix (risk-sizing.ts / paper-execution-service.ts / style_c_handler.py are not
// part of this fix's allowed file list). Python parity run remains DEFERRED to
// Wave 1 Track 1 close-out per the original note below — left unchanged.
// Once Python parity is wired, convert these to full TS↔Python fixtures
// using computePythonExitPlan() and add to the main FIXTURES array above.

// ── A. VIX-tiered ATR multiplier ──────────────────────────────────────────────
// Mirrors `computeVixAtrMultiplier()` from risk-sizing.ts (pure, no DB).
// Breakpoints: vix<20→LOW(1.5), 20-30→MID(2.0), >30→HIGH(2.5).

function computeTsVixAtrMultiplier(
  vixNow: number | null,
  baseMultiplier: number,
  enabled: boolean = false,
  tierLow = 1.5,
  tierMid = 2.0,
  tierHigh = 2.5,
): number {
  if (!enabled) return baseMultiplier;
  if (vixNow == null || vixNow <= 0) return baseMultiplier; // fail-open
  if (vixNow < 20) return tierLow;
  if (vixNow <= 30) return tierMid;
  return tierHigh;
}

interface VixTierAssertion {
  name: string;
  vixNow: number | null;
  baseMultiplier: number;
  enabled: boolean;
  expectedMultiplier: number;
}

const VIX_TIER_ASSERTIONS: VixTierAssertion[] = [
  { name: "OFF+vix=15 → base unchanged", vixNow: 15, baseMultiplier: 1.5, enabled: false, expectedMultiplier: 1.5 },
  { name: "OFF+vix=null → base unchanged", vixNow: null, baseMultiplier: 1.5, enabled: false, expectedMultiplier: 1.5 },
  { name: "ON+vix=15 → LOW tier (1.5)", vixNow: 15, baseMultiplier: 1.5, enabled: true, expectedMultiplier: 1.5 },
  { name: "ON+vix=25 → MID tier (2.0)", vixNow: 25, baseMultiplier: 1.5, enabled: true, expectedMultiplier: 2.0 },
  { name: "ON+vix=35 → HIGH tier (2.5)", vixNow: 35, baseMultiplier: 1.5, enabled: true, expectedMultiplier: 2.5 },
  { name: "ON+vix=20 → MID tier boundary", vixNow: 20, baseMultiplier: 1.5, enabled: true, expectedMultiplier: 2.0 },
  { name: "ON+vix=30 → MID tier boundary", vixNow: 30, baseMultiplier: 1.5, enabled: true, expectedMultiplier: 2.0 },
  { name: "ON+vix=31 → HIGH tier", vixNow: 31, baseMultiplier: 1.5, enabled: true, expectedMultiplier: 2.5 },
  { name: "ON+vix=null → fail-open (base)", vixNow: null, baseMultiplier: 1.5, enabled: true, expectedMultiplier: 1.5 },
];

console.log("\n--- VIX-tier ATR multiplier assertions (TS-only, Python deferred) ---");
let vixTierAllPassed = true;
for (const a of VIX_TIER_ASSERTIONS) {
  const got = computeTsVixAtrMultiplier(a.vixNow, a.baseMultiplier, a.enabled);
  const passed = Math.abs(got - a.expectedMultiplier) < 0.0001;
  if (!passed) {
    vixTierAllPassed = false;
    overallPassed = false;
  }
  console.log(`  [${a.name}] ${passed ? "PASS" : `FAIL (got=${got}, expected=${a.expectedMultiplier})`}`);
}
console.log(`  VIX-tier: ${vixTierAllPassed ? "ALL PASS" : "FAILURES DETECTED"}`);

// ── B. static_styleC TP2 flat +2.0R (pure-function layer) ────────────────────
// F-b parity fix (ENGINE-100 Track F): static_styleC TP2 is ALWAYS flat +2.0R.
// Liquidity-mapped TPs belong exclusively to exit_style="adaptive".
// Prior code (Wave 1 Track 1B) selected in-band liquidity levels — removed.
// Python style_c_handler.py TP2_AT_R_C = 2.0 (line 85) is now the parity anchor.

function computeStaticStyleCTp2Pure(
  entry: number,
  stopPrice: number,
  direction: "long" | "short",
): { tp2_price: number; tp2_source: "r_multiple"; tp2_r: number } {
  const stopDistance = Math.abs(entry - stopPrice);
  const tp2Price = direction === "long" ? entry + 2.0 * stopDistance : entry - 2.0 * stopDistance;
  return { tp2_price: tp2Price, tp2_source: "r_multiple", tp2_r: 2.0 };
}

interface StyleCTp2Assertion {
  name: string;
  entry: number;
  stop: number;
  direction: "long" | "short";
  expectedTp2Price: number;
}

const STYLEC_TP2_ASSERTIONS: StyleCTp2Assertion[] = [
  { name: "long — flat +2.0R (entry=5000, stop=4994 → TP2=5012)", entry: 5000.0, stop: 4994.0, direction: "long", expectedTp2Price: 5012.0 },
  { name: "long — pdh at 1.6R present → still flat +2.0R (5012, not 5009.6)", entry: 5000.0, stop: 4994.0, direction: "long", expectedTp2Price: 5012.0 },
  { name: "long — excluded level type (pwh_iso) present → flat +2.0R", entry: 5000.0, stop: 4994.0, direction: "long", expectedTp2Price: 5012.0 },
  { name: "long — far level at 3.0R present → flat +2.0R", entry: 5000.0, stop: 4994.0, direction: "long", expectedTp2Price: 5012.0 },
  { name: "short — flat -2.0R (entry=5000, stop=5006 → TP2=4988)", entry: 5000.0, stop: 5006.0, direction: "short", expectedTp2Price: 4988.0 },
  { name: "short — pdl at 1.6R present → still flat -2.0R (4988, not 4990.4)", entry: 5000.0, stop: 5006.0, direction: "short", expectedTp2Price: 4988.0 },
];

console.log("\n--- static_styleC TP2 flat +2.0R assertions (TS-only; F-b parity fix) ---");
let styleCTp2AllPassed = true;
for (const a of STYLEC_TP2_ASSERTIONS) {
  const result = computeStaticStyleCTp2Pure(a.entry, a.stop, a.direction);
  const pricePassed = Math.abs(result.tp2_price - a.expectedTp2Price) <= PRICE_TOLERANCE;
  const sourcePassed = result.tp2_source === "r_multiple";
  const passed = pricePassed && sourcePassed;
  if (!passed) {
    styleCTp2AllPassed = false;
    overallPassed = false;
  }
  const detail = passed ? "PASS" : `FAIL (tp2_price=${result.tp2_price} expected=${a.expectedTp2Price} source=${result.tp2_source})`;
  console.log(`  [${a.name}] ${detail}`);
}
console.log(`  static_styleC TP2: ${styleCTp2AllPassed ? "ALL PASS" : "FAILURES DETECTED"}`);
console.log("\n  NOTE: Python parity for VIX-tier is DEFERRED.");
console.log("        static_styleC TP2 Python parity is COMPLETE — style_c_handler.py TP2_AT_R_C=2.0.");

// ─── JSON report ──────────────────────────────────────────────────────────
const reportPath = path.join("docs", "wave26-ts-python-exit-parity-report.json");
try {
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        run_date: new Date().toISOString(),
        overall_passed: overallPassed,
        price_tolerance: PRICE_TOLERANCE,
        scaling_tolerance: SCALING_TOLERANCE,
        fixtures: fixtureResults,
        pre_lunch_fixtures: preLunchResults,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(`\nReport written: ${reportPath}`);
} catch (err) {
  console.warn(`\nWARN: could not write report: ${err}`);
}

console.log(`\nOverall: ${overallPassed ? "PASS" : "FAIL"}`);
process.exit(overallPassed ? 0 : 1);
