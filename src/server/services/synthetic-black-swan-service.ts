/**
 * Synthetic Black Swan Service — A14 (W19, Pass 3)
 *
 * Orchestrates the Python `black_swan_evaluator` against the synthetic regime
 * bank for a completed backtest:
 *   1. Pipeline pause guard — paused pipelines return `{ skipped, reason }`
 *      WITHOUT writing a DB row.
 *   2. Pending-row contract — INSERT status="pending" BEFORE spawning Python.
 *      `stale-pending-sweeper` cron flips abandoned rows after 1h.
 *   3. Spawn `src.engine.black_swan_evaluator` via the canonical
 *      `runPythonModule()` helper.
 *   4. On success — UPDATE row to status="completed" with all evaluator fields.
 *   5. On failure — UPDATE row to status="failed" with errorMessage.
 *
 * AUTHORITY BOUNDARY (Phase 0, current):
 *   This service ONLY persists evaluation results. It does NOT write the
 *   audit_log advisory row when survival_rate < 0.60. That advisory is a
 *   Pass 4 concern (lifecycle-service.ts integration). Pass 3 is intentionally
 *   limited to the service + route + pending-row contract.
 *
 * No upsert: two calls for the same backtestId create two distinct rows.
 * The schema does not enforce uniqueness on (backtestId, status) — replays
 * and retries are first-class.
 *
 * Pattern source: `frankenstein-service.ts` (A4 / W10) — same pending-row
 * contract, same isPipelineActive() guard, same error-handling shape.
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { syntheticBlackSwanRuns } from "../db/schema.js";
import { logger } from "../index.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { runPythonModule } from "../lib/python-runner.js";

const BLACK_SWAN_TIMEOUT_MS = 300_000; // 5 minutes — N=1000 regime backtests, single-threaded
const DEFAULT_REGIME_COUNT = 1000;
const DEFAULT_PROP_FIRM_CAP_DOLLARS = 2000.0; // Topstep 50K — tightest firm

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * JSON contract returned by `src/engine/black_swan_evaluator.py` (stdout).
 * Mirrors `RegimeSurvivalResult.to_json_dict()`.
 */
export interface BlackSwanPythonResult {
  num_regimes_tested: number;
  num_regimes_survived: number;
  survival_rate: number;
  worst_regime: { id: string; drawdown: number; label: string } | null;
  worst_k: Array<{ id: string; drawdown: number; label: string }>;
  generator_model_version: string;
  error?: string;
}

/**
 * Public output shape returned by runBlackSwanTest().
 * `null` on metric fields when the run failed (status="failed") or was
 * skipped (status="skipped_pipeline_paused").
 */
export interface BlackSwanResult {
  runId: string;
  backtestId: string;
  strategyId: string;
  status: "completed" | "failed" | "skipped_pipeline_paused";
  numRegimesTested: number | null;
  numRegimesSurvived: number | null;
  survivalRate: number | null;
  worstRegimeId: string | null;
  worstRegimeDrawdown: number | null;
  worstRegimeLabel: string | null;
  generatorModelVersion: string | null;
  errorMessage: string | null;
  /** Pipeline-paused short-circuit signal — set true ONLY when status="skipped_pipeline_paused". */
  skipped?: boolean;
  reason?: string;
}

export interface BlackSwanRunOptions {
  /** Number of regimes to draw from the bank. Default 1000. */
  regimeCount?: number;
  /** Prop-firm drawdown cap in dollars. Default 2000 (Topstep 50K). */
  propFirmCapDollars?: number;
  /** Optional correlation ID propagated to Python via _metadata. */
  correlationId?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the Synthetic Black Swan evaluation for a completed backtest.
 *
 * @param backtestId UUID of the completed backtest
 * @param strategyId UUID of the strategy
 * @param options Optional regime count, prop-firm cap, correlation ID
 */
export async function runBlackSwanTest(
  backtestId: string,
  strategyId: string,
  options: BlackSwanRunOptions = {},
): Promise<BlackSwanResult> {
  const {
    regimeCount = DEFAULT_REGIME_COUNT,
    propFirmCapDollars = DEFAULT_PROP_FIRM_CAP_DOLLARS,
    correlationId,
  } = options;

  // ── Pipeline pause guard — universal Pass 5 requirement ────────────────────
  if (!(await isPipelineActive())) {
    logger.warn(
      { backtestId, strategyId },
      "synthetic_black_swan: pipeline paused — skipping",
    );
    return {
      runId: "",
      backtestId,
      strategyId,
      status: "skipped_pipeline_paused",
      numRegimesTested: null,
      numRegimesSurvived: null,
      survivalRate: null,
      worstRegimeId: null,
      worstRegimeDrawdown: null,
      worstRegimeLabel: null,
      generatorModelVersion: null,
      errorMessage: null,
      skipped: true,
      reason: "pipeline_paused",
    };
  }

  // ── Pending-row contract: insert BEFORE spawning Python ──────────────────
  const [pendingRow] = await db
    .insert(syntheticBlackSwanRuns)
    .values({
      strategyId,
      backtestId,
      status: "pending",
    })
    .returning();

  const runId = pendingRow.id;

  // ── Build Python config (matches black_swan_evaluator.py CLI contract) ───
  const pythonConfig = {
    strategy_id: strategyId,
    backtest_id: backtestId,
    regime_count: regimeCount,
    prop_firm_cap_dollars: propFirmCapDollars,
  };

  const startedAt = Date.now();

  try {
    const pythonResult = await runPythonModule<BlackSwanPythonResult>({
      module: "src.engine.black_swan_evaluator",
      config: pythonConfig,
      timeoutMs: BLACK_SWAN_TIMEOUT_MS,
      componentName: "black_swan_evaluator",
      correlationId,
    });

    // Python script may print a JSON error envelope and exit(1); the runner
    // would reject in that case. Defensively also check for an `error` field
    // when exit code 0 (e.g. partial failure encoded in payload).
    if (pythonResult.error) {
      throw new Error(pythonResult.error);
    }

    const wallClockMs = Date.now() - startedAt;
    const worst = pythonResult.worst_regime;

    await db
      .update(syntheticBlackSwanRuns)
      .set({
        status: "completed",
        numRegimesTested: pythonResult.num_regimes_tested,
        numRegimesSurvived: pythonResult.num_regimes_survived,
        survivalRate: String(pythonResult.survival_rate),
        worstRegimeId: worst ? worst.id : null,
        worstRegimeDrawdown: worst ? String(worst.drawdown) : null,
        worstRegimeLabel: worst ? worst.label : null,
        resultSummary: pythonResult.worst_k ?? [],
        executionTimeMs: wallClockMs,
        generatorModelVersion: pythonResult.generator_model_version,
        errorMessage: null,
        resolvedAt: new Date(),
      })
      .where(eq(syntheticBlackSwanRuns.id, runId));

    logger.info(
      {
        backtestId,
        strategyId,
        runId,
        numRegimesTested: pythonResult.num_regimes_tested,
        numRegimesSurvived: pythonResult.num_regimes_survived,
        survivalRate: pythonResult.survival_rate,
        wallClockMs,
      },
      "synthetic_black_swan: evaluation completed",
    );

    return {
      runId,
      backtestId,
      strategyId,
      status: "completed",
      numRegimesTested: pythonResult.num_regimes_tested,
      numRegimesSurvived: pythonResult.num_regimes_survived,
      survivalRate: pythonResult.survival_rate,
      worstRegimeId: worst ? worst.id : null,
      worstRegimeDrawdown: worst ? worst.drawdown : null,
      worstRegimeLabel: worst ? worst.label : null,
      generatorModelVersion: pythonResult.generator_model_version,
      errorMessage: null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { backtestId, strategyId, runId, err: errMsg },
      "synthetic_black_swan: Python subprocess failed",
    );

    await db
      .update(syntheticBlackSwanRuns)
      .set({
        status: "failed",
        errorMessage: errMsg,
        executionTimeMs: Date.now() - startedAt,
        resolvedAt: new Date(),
      })
      .where(eq(syntheticBlackSwanRuns.id, runId));

    return {
      runId,
      backtestId,
      strategyId,
      status: "failed",
      numRegimesTested: null,
      numRegimesSurvived: null,
      survivalRate: null,
      worstRegimeId: null,
      worstRegimeDrawdown: null,
      worstRegimeLabel: null,
      generatorModelVersion: null,
      errorMessage: errMsg,
    };
  }
}

/**
 * Get the latest completed Synthetic Black Swan run for a backtest.
 * Returns null when no completed run exists.
 */
export async function getLatestBlackSwanRun(
  backtestId: string,
): Promise<BlackSwanResult | null> {
  const rows = await db
    .select()
    .from(syntheticBlackSwanRuns)
    .where(
      and(
        eq(syntheticBlackSwanRuns.backtestId, backtestId),
        eq(syntheticBlackSwanRuns.status, "completed"),
      ),
    )
    .orderBy(desc(syntheticBlackSwanRuns.createdAt))
    .limit(1);

  const run = rows[0];
  if (!run) return null;

  return {
    runId: String(run.id),
    backtestId: String(run.backtestId),
    strategyId: String(run.strategyId),
    status: "completed",
    numRegimesTested: run.numRegimesTested ?? null,
    numRegimesSurvived: run.numRegimesSurvived ?? null,
    survivalRate:
      run.survivalRate != null ? parseFloat(String(run.survivalRate)) : null,
    worstRegimeId: run.worstRegimeId != null ? String(run.worstRegimeId) : null,
    worstRegimeDrawdown:
      run.worstRegimeDrawdown != null
        ? parseFloat(String(run.worstRegimeDrawdown))
        : null,
    worstRegimeLabel:
      run.worstRegimeLabel != null ? String(run.worstRegimeLabel) : null,
    generatorModelVersion:
      run.generatorModelVersion != null
        ? String(run.generatorModelVersion)
        : null,
    errorMessage: run.errorMessage ?? null,
  };
}
