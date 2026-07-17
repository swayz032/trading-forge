/**
 * Frankenstein Service — A4 (W10 Team C)
 *
 * Orchestrates the Python Frankenstein randomization detection test:
 * - Fetches bars for the backtest's symbol from S3 (via DuckDB queryInfo proxy)
 * - Spawns src/engine/frankenstein_test.py via subprocess
 * - Persists results to frankenstein_test_runs
 *
 * AUTHORITY BOUNDARY:
 *   passed=true is required for TESTING→PAPER lifecycle promotion.
 *   passed=false BLOCKS promotion. This is a hard gate (not Phase 0 shadow).
 *
 * Pending-row contract: status="pending" on insert, updated to
 *   "completed"/"failed" on Python call resolution.
 *
 * isActive() guard: returns early when pipeline is paused.
 *
 * 30s wall-clock cost ceiling: matches Tier 3.4 Grover pattern.
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { frankensteinTestRuns, backtests, backtestTrades } from "../db/schema.js";
import { logger } from "../index.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { parsePythonJson } from "../../shared/utils.js";
import { seededUniformDraw } from "../lib/deterministic-rng.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");
const FRANKENSTEIN_TIMEOUT_MS = 35_000; // 35s: 30s Python limit + 5s overhead

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FrankensteinPythonResult {
  test_mode: string;
  n_shuffles: number;
  p95_sharpe: number | null;
  median_pf: number | null;
  passed: boolean;
  sharpe_distribution: number[];
  pf_distribution: number[];
  failure_examples: Array<Record<string, unknown>>;
  wall_clock_ms: number;
  status: string;
  error_message: string | null;
  // CRIT LOUD-signal fix (capital-safety-compliance-gates wave, 2026-07-17):
  // additive/optional so it doesn't tighten validateFrankensteinResult()'s
  // contract (a shape a caller trusts to gate promotion should only get
  // STRICTER checks added deliberately, not accidentally via a new required
  // field). See src/engine/frankenstein_test.py module docstring "KNOWN
  // LIMITATION" for what this value means.
  engine_fidelity?: string;
}

export interface FrankensteinRunOutput {
  runId: string;
  backtestId: string;
  strategyId: string;
  testMode: string;
  nShuffles: number;
  p95Sharpe: number | null;
  medianPf: number | null;
  passed: boolean;
  wallClockMs: number;
  status: string;
  errorMessage: string | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Assert the Python Frankenstein result has the shape we trust to gate a
 * TESTING→PAPER promotion. Throws (→ fail-CLOSED at the caller) on any of:
 *   - `passed` is not a strict boolean (a truthy string / 1 / null would
 *     otherwise silently promote a curve-fit-lucky strategy)
 *   - required numeric fields (`n_shuffles`, `wall_clock_ms`) absent / non-finite
 *   - `p95_sharpe` / `median_pf` present but not `number | null`
 */
export function validateFrankensteinResult(
  result: unknown,
): asserts result is FrankensteinPythonResult {
  if (result === null || typeof result !== "object") {
    throw new Error("frankenstein_test: result is not an object");
  }
  const r = result as Record<string, unknown>;
  if (typeof r.passed !== "boolean") {
    throw new Error(
      `frankenstein_test: 'passed' must be a strict boolean, got ${typeof r.passed} (${JSON.stringify(r.passed)}) — refusing to trust promotion gate`,
    );
  }
  if (typeof r.n_shuffles !== "number" || !Number.isFinite(r.n_shuffles)) {
    throw new Error(`frankenstein_test: 'n_shuffles' must be a finite number, got ${JSON.stringify(r.n_shuffles)}`);
  }
  if (typeof r.wall_clock_ms !== "number" || !Number.isFinite(r.wall_clock_ms)) {
    throw new Error(`frankenstein_test: 'wall_clock_ms' must be a finite number, got ${JSON.stringify(r.wall_clock_ms)}`);
  }
  for (const key of ["p95_sharpe", "median_pf"] as const) {
    const v = r[key];
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v))) {
      throw new Error(`frankenstein_test: '${key}' must be a finite number or null, got ${JSON.stringify(v)}`);
    }
  }
}

function runPythonFrankenstein(
  configPath: string,
  timeoutMs: number = FRANKENSTEIN_TIMEOUT_MS,
): Promise<FrankensteinPythonResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    const proc = spawn(pythonCmd, ["-m", "src.engine.frankenstein_test", configPath], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        DETERMINISM_MODE: "true",
        PYTHONPATH: PROJECT_ROOT,
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`frankenstein_test: subprocess timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `frankenstein_test: exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
          ),
        );
        return;
      }
      try {
        const result = parsePythonJson<FrankensteinPythonResult>(stdout);
        // Runtime shape validation — `passed` gates a real TESTING→PAPER
        // promotion, so a serialization bug that makes it non-boolean (or drops
        // required numeric fields) must NOT be trusted. Throwing here routes to
        // the caller's catch which fails CLOSED (passed=false + loud audit).
        validateFrankensteinResult(result);
        resolve(result);
      } catch (parseErr) {
        reject(
          new Error(
            `frankenstein_test: JSON parse failed. stdout: ${stdout.slice(0, 200)}. err: ${parseErr}`,
          ),
        );
      }
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Fetch trade bars for a backtest from the backtest_trades table.
 * Returns an Nx4 array of [open, high, low, close] from trade entry/exit prices.
 *
 * NOTE: Full OHLC bars from S3 would be ideal, but this service is callable
 * from the lifecycle gate where S3 access may not be available. Instead, we
 * synthesize bars from trade records, which is sufficient for the Frankenstein
 * test (which uses a simple SMA crossover as the probe strategy — it only needs
 * a plausible price series, not exact market data).
 *
 * When trade records are sparse, we interpolate between entry/exit prices to
 * produce enough bars for the 50/200 SMA crossover to have signal.
 *
 * MED fix (capital-safety-compliance-gates wave, 2026-07-17): the OHLC-spread
 * synthesis below previously drew from unseeded `Math.random()` — for a
 * fail-closed capital-safety gate (A4 Frankenstein: passed=false blocks
 * TESTING→PAPER), that meant re-running the SAME backtestId could produce a
 * DIFFERENT synthesized bar series, and therefore a different pass/fail
 * verdict, on identical inputs. Now uses `seededUniformDraw()` (same
 * hash-seed pattern the M2 wave applied to paper-execution-service.ts's fill
 * model) keyed off `backtestId` + bar index + a distinct siteTag per draw —
 * same backtestId always synthesizes byte-identical bars, so the gate's
 * verdict is replayable/auditable across re-runs.
 *
 * Exported (not otherwise part of the public API) so the determinism fix
 * above can be tested directly without mocking the full spawn()/writeFileSync
 * subprocess plumbing of runFrankensteinTest() — mirrors the same
 * export-for-testability pattern used by pbo-gate.ts::getPboLifecycleThreshold.
 */
export async function fetchBarsFromTrades(backtestId: string): Promise<number[][]> {
  const trades = await db
    .select({
      entryPrice: backtestTrades.entryPrice,
      exitPrice: backtestTrades.exitPrice,
      direction: backtestTrades.direction,
    })
    .from(backtestTrades)
    .where(eq(backtestTrades.backtestId, backtestId))
    .orderBy(backtestTrades.entryTime);

  if (trades.length < 5) {
    return [];
  }

  // Build a synthetic price series from trade prices
  // Each trade contributes: entry, midpoint, exit
  const prices: number[] = [];
  for (const trade of trades) {
    const entry = parseFloat(String(trade.entryPrice));
    const exit = trade.exitPrice ? parseFloat(String(trade.exitPrice)) : entry;
    if (!isNaN(entry)) prices.push(entry);
    if (!isNaN(exit)) prices.push(exit);
  }

  if (prices.length < 10) return [];

  // Interpolate to produce at least 300 bars (enough for 50/200 SMA crossover)
  const targetN = Math.max(300, prices.length * 3);
  const result: number[][] = [];
  const step = (prices.length - 1) / targetN;

  for (let i = 0; i < targetN; i++) {
    const exactIdx = i * step;
    const lo = Math.floor(exactIdx);
    const hi = Math.min(lo + 1, prices.length - 1);
    const frac = exactIdx - lo;
    const close = prices[lo] * (1 - frac) + prices[hi] * frac;

    // Synthesize OHLC with small deterministic pseudo-random spread (±0.1% of
    // close). Seeded on (backtestId, bar index, siteTag) — see function
    // docstring — so re-running this synthesis for the same backtestId is
    // byte-identical, not just distributionally similar.
    const spread = close * 0.001;
    const open = close + (seededUniformDraw([backtestId, i, "open"]) - 0.5) * spread;
    const high = Math.max(open, close) + seededUniformDraw([backtestId, i, "high"]) * spread;
    const low = Math.min(open, close) - seededUniformDraw([backtestId, i, "low"]) * spread;

    result.push([open, high, low, close]);
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the Frankenstein test for a completed backtest.
 *
 * @param backtestId - UUID of the completed backtest
 * @param strategyId - UUID of the strategy
 * @param strategyConfig - Strategy DSL config (for tick_value, commission lookup)
 * @param testMode - Shuffle mode: full_shuffle | benchmark_relative | calendar_preserving | synthetic_gbm
 * @param nShuffles - Number of shuffles (100 for full_shuffle, 50 for GBM)
 * @param seed - RNG seed for reproducibility
 */
export async function runFrankensteinTest(
  backtestId: string,
  strategyId: string,
  strategyConfig: Record<string, unknown> = {},
  testMode: string = "full_shuffle",
  nShuffles: number = 100,
  seed: number = 42,
): Promise<FrankensteinRunOutput> {
  // Pipeline pause guard — universal Pass 5 requirement
  if (!(await isPipelineActive())) {
    logger.warn({ backtestId, strategyId }, "frankenstein: pipeline paused — skipping");
    return {
      runId: "",
      backtestId,
      strategyId,
      testMode,
      nShuffles,
      p95Sharpe: null,
      medianPf: null,
      passed: false,
      wallClockMs: 0,
      status: "skipped_pipeline_paused",
      errorMessage: "Pipeline is paused",
    };
  }

  // ── Pending-row contract: insert before Python call ──
  const [pendingRow] = await db
    .insert(frankensteinTestRuns)
    .values({
      backtestId,
      strategyId,
      testMode,
      nShuffles,
      p95Sharpe: "0",   // placeholder — updated on completion
      medianPf: "0",
      passed: false,
      status: "pending",
    })
    .returning();

  const runId = pendingRow.id;

  // Determine tick value and commission from strategy config / symbol
  const symbol = String(strategyConfig.symbol ?? "MES").toUpperCase();
  const tickValueMap: Record<string, number> = { MES: 5.0, MNQ: 2.0, MCL: 10.0 };
  const tickValue = tickValueMap[symbol] ?? 5.0;
  const commissionPerSide = 0.62; // default; firm-specific handled in backtest, not here

  // Fetch bars from trade records
  const bars = await fetchBarsFromTrades(backtestId);

  if (bars.length < 60) {
    const errMsg = `frankenstein: insufficient bars (${bars.length}) for meaningful test — need >=60`;
    logger.warn({ backtestId, strategyId, barCount: bars.length }, errMsg);
    await db
      .update(frankensteinTestRuns)
      .set({ status: "failed", errorMessage: errMsg })
      .where(eq(frankensteinTestRuns.id, runId));
    return {
      runId,
      backtestId,
      strategyId,
      testMode,
      nShuffles,
      p95Sharpe: null,
      medianPf: null,
      passed: false,
      wallClockMs: 0,
      status: "failed",
      errorMessage: errMsg,
    };
  }

  // Write config to temp file for Python subprocess
  const configPath = pathResolve(tmpdir(), `frankenstein_${randomUUID()}.json`);
  const pythonConfig = {
    strategy_config: strategyConfig,
    bars,
    test_mode: testMode,
    n_shuffles: nShuffles,
    n_workers: 10,
    seed,
    tick_value: tickValue,
    commission_per_side: commissionPerSide,
  };

  try {
    writeFileSync(configPath, JSON.stringify(pythonConfig));
  } catch (writeErr) {
    const errMsg = `frankenstein: failed to write config file: ${writeErr}`;
    await db
      .update(frankensteinTestRuns)
      .set({ status: "failed", errorMessage: errMsg })
      .where(eq(frankensteinTestRuns.id, runId));
    return {
      runId,
      backtestId,
      strategyId,
      testMode,
      nShuffles,
      p95Sharpe: null,
      medianPf: null,
      passed: false,
      wallClockMs: 0,
      status: "failed",
      errorMessage: errMsg,
    };
  }

  try {
    const pythonResult = await runPythonFrankenstein(configPath);

    // Update DB row with results
    await db
      .update(frankensteinTestRuns)
      .set({
        nShuffles: pythonResult.n_shuffles,
        p95Sharpe: pythonResult.p95_sharpe != null ? String(pythonResult.p95_sharpe) : "0",
        medianPf: pythonResult.median_pf != null ? String(pythonResult.median_pf) : "1",
        passed: pythonResult.passed,
        sharpeDistribution: pythonResult.sharpe_distribution ?? [],
        pfDistribution: pythonResult.pf_distribution ?? [],
        failureExamples: pythonResult.failure_examples ?? [],
        wallClockMs: pythonResult.wall_clock_ms,
        status: "completed",
        errorMessage: null,
      })
      .where(eq(frankensteinTestRuns.id, runId));

    // CRIT LOUD-signal fix (capital-safety-compliance-gates wave, 2026-07-17):
    // surface the gate's known synthetic-reimplementation limitation on
    // EVERY completed run, not just in the Python subprocess's own stderr
    // (which this success path never even inspects). Uses logger.warn (not
    // .info) so it is not lost in routine log volume — this is a hard
    // capital-safety gate's confidence caveat, not a debug note.
    logger.warn(
      {
        backtestId,
        strategyId,
        runId,
        engineFidelity: pythonResult.engine_fidelity ?? "synthetic_reimplementation_not_real_backtester",
      },
      "frankenstein: A4 gate result is gating promotion on a hand-rolled reimplementation " +
        "run against trade-interpolated synthetic bars, NOT the real backtester.py fill/" +
        "management logic on real market bars — see src/engine/frankenstein_test.py module " +
        "docstring KNOWN LIMITATION block.",
    );

    logger.info(
      {
        backtestId,
        strategyId,
        runId,
        testMode,
        nShuffles: pythonResult.n_shuffles,
        p95Sharpe: pythonResult.p95_sharpe,
        medianPf: pythonResult.median_pf,
        passed: pythonResult.passed,
        wallClockMs: pythonResult.wall_clock_ms,
      },
      `frankenstein: test completed — ${pythonResult.passed ? "PASSED" : "FAILED"}`,
    );

    return {
      runId,
      backtestId,
      strategyId,
      testMode,
      nShuffles: pythonResult.n_shuffles,
      p95Sharpe: pythonResult.p95_sharpe,
      medianPf: pythonResult.median_pf,
      passed: pythonResult.passed,
      wallClockMs: pythonResult.wall_clock_ms,
      status: "completed",
      errorMessage: null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ backtestId, strategyId, runId, err }, "frankenstein: Python subprocess failed");

    await db
      .update(frankensteinTestRuns)
      .set({
        status: "failed",
        errorMessage: errMsg,
      })
      .where(eq(frankensteinTestRuns.id, runId));

    return {
      runId,
      backtestId,
      strategyId,
      testMode,
      nShuffles,
      p95Sharpe: null,
      medianPf: null,
      passed: false,
      wallClockMs: 0,
      status: "failed",
      errorMessage: errMsg,
    };
  } finally {
    // Clean up temp config file
    if (existsSync(configPath)) {
      try {
        unlinkSync(configPath);
      } catch (_unlinkErr) {
        // Non-blocking — temp file cleanup failure is cosmetic
      }
    }
  }
}

/**
 * Get the latest completed Frankenstein test run for a backtest.
 * Returns null if no completed run exists.
 */
export async function getLatestFrankensteinRun(
  backtestId: string,
): Promise<FrankensteinRunOutput | null> {
  const [run] = await db
    .select()
    .from(frankensteinTestRuns)
    .where(
      and(
        eq(frankensteinTestRuns.backtestId, backtestId),
        eq(frankensteinTestRuns.status, "completed"),
      ),
    )
    .orderBy(desc(frankensteinTestRuns.createdAt))
    .limit(1);

  if (!run) return null;

  return {
    runId: run.id,
    backtestId: run.backtestId,
    strategyId: run.strategyId,
    testMode: run.testMode,
    nShuffles: run.nShuffles,
    p95Sharpe: run.p95Sharpe != null ? parseFloat(String(run.p95Sharpe)) : null,
    medianPf: run.medianPf != null ? parseFloat(String(run.medianPf)) : null,
    passed: run.passed,
    wallClockMs: run.wallClockMs ?? 0,
    status: run.status,
    errorMessage: run.errorMessage ?? null,
  };
}
