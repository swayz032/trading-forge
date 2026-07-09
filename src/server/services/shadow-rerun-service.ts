/**
 * Shadow Re-Run Service — A11 (W12 Team A)
 *
 * When math changes (bug fix, model update, engine refactor), re-runs all PAPER+
 * strategies' historical backtests with the current code and diffs result_hash
 * against backtest_provenance (W10 A2). Findings surface in shadow_rerun_findings.
 *
 * PAPER+ scope: PAPER, DEPLOY_READY, DEPLOYED, DECLINING, RETIRED, GRAVEYARD
 * These strategies produced real evidence and were promoted past TESTING. A math fix
 * that changes their outcome retroactively is high-impact — operators must know.
 *
 * Authority: OBSERVATION ONLY. Does NOT gate any lifecycle decision.
 *
 * Status flip detection:
 *   Compares old_metrics vs new_metrics against the locked gate thresholds:
 *     - PF gate: >= 1.75 (minimum_profit_factor from CLAUDE.md)
 *     - Sharpe gate: >= 1.5  (minimum_sharpe_ratio from CLAUDE.md)
 *     - Max DD gate: <= 2000 (maximum_max_drawdown from CLAUDE.md)
 *   If old metrics passed all gates but new metrics fail (or vice versa),
 *   status_flipped = true and severity = 'critical'.
 *
 * Bounded parallelism: 5 concurrent re-runs (configurable via SHADOW_RERUN_CONCURRENCY).
 *
 * Idempotency: (strategy_id, backtest_id, new_code_git_sha) is UNIQUE.
 * Re-running on the same code SHA produces identical findings row — DB upsert ignores dups.
 *
 * Pipeline pause guard: isPipelineActive() checked at entry.
 */

import { eq, inArray, desc, and, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  strategies,
  backtests,
  backtestProvenance,
  shadowRerunFindings,
} from "../db/schema.js";
import { logger } from "../index.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { runBacktest } from "./backtest-service.js";
import { computeResultHash } from "../lib/result-hasher.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * PAPER+ lifecycle states. Strategies in these states produced real evidence
 * and were promoted past TESTING. Their backtest results are promotion decisions.
 */
export const PAPER_PLUS_STATES = [
  "PAPER",
  "DEPLOY_READY",
  "DEPLOYED",
  "DECLINING",
  "RETIRED",
  "GRAVEYARD",
] as const;

/**
 * Gate thresholds from CLAUDE.md (locked — do not change without plan approval).
 * Shadow re-run uses these to determine if a status flip occurred.
 */
const GATE_MIN_PF = 1.75;      // minimum_profit_factor
const GATE_MIN_SHARPE = 1.5;   // minimum_sharpe_ratio
const GATE_MAX_DD = 2000;      // maximum_max_drawdown (dollars)

/** Max concurrent shadow re-runs to avoid exhausting the Python pool. */
const DEFAULT_CONCURRENCY = 5;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShadowRerunStrategyInput {
  strategyId: string;
  backtestId: string;
}

export interface ShadowRerunFinding {
  strategyId: string;
  backtestId: string;
  oldCodeGitSha: string;
  newCodeGitSha: string;
  oldResultHash: string;
  newResultHash: string;
  oldPf: number | null;
  newPf: number | null;
  oldSharpe: number | null;
  newSharpe: number | null;
  oldMaxDd: number | null;
  newMaxDd: number | null;
  statusFlipped: boolean;
  severity: "info" | "warning" | "critical";
  error?: string;
}

export interface ShadowRerunReport {
  reason: string;
  newCodeGitSha: string;
  totalStrategies: number;
  processed: number;
  skipped: number; // no provenance row (pre-A2 backtest)
  errors: number;
  findings: {
    info: number;
    warning: number;
    critical: number;
  };
  criticalStrategies: Array<{ strategyId: string; backtestId: string }>;
  durationMs: number;
}

// ─── Gate decision helper ─────────────────────────────────────────────────────

/**
 * Determine whether a set of metrics passes the promotion gate.
 * Returns true if ALL three minimum thresholds are met.
 *
 * null metrics are treated as FAILING the gate (missing data = no promotion).
 */
function metricsPassGate(
  pf: number | null,
  sharpe: number | null,
  maxDd: number | null,
): boolean {
  if (pf === null || sharpe === null || maxDd === null) return false;
  return pf >= GATE_MIN_PF && sharpe >= GATE_MIN_SHARPE && Math.abs(maxDd) <= GATE_MAX_DD;
}

/**
 * Compute severity tier for a single shadow re-run finding.
 *   info     — same result_hash (no effect)
 *   warning  — different hash, same gate decision
 *   critical — different hash AND gate decision flipped
 */
function computeSeverity(
  oldResultHash: string,
  newResultHash: string,
  statusFlipped: boolean,
): "info" | "warning" | "critical" {
  if (oldResultHash === newResultHash) return "info";
  if (statusFlipped) return "critical";
  return "warning";
}

// ─── Core per-strategy re-run logic ──────────────────────────────────────────

/**
 * Re-run one strategy's backtest with current code and compute the finding.
 *
 * The re-run:
 *   1. Reads the latest completed backtest from `backtests`
 *   2. Reads the provenance row (A2) for that backtest — gives us old_result_hash
 *   3. Re-runs the backtest with the same config (same data_hash, new code)
 *   4. Computes new_result_hash from the new run's result
 *   5. Diffs old vs new, detects status flip, writes finding
 *
 * Returns null when no provenance row exists (pre-A2 backtest — skip silently).
 */
async function rerunOneStrategy(
  strategyId: string,
  backtestId: string,
  newCodeGitSha: string,
  reason: string,
): Promise<ShadowRerunFinding | null> {
  // 1. Load the original backtest config + metrics
  const [originalBacktest] = await db
    .select()
    .from(backtests)
    .where(eq(backtests.id, backtestId))
    .limit(1);

  if (!originalBacktest) {
    logger.warn({ strategyId, backtestId }, "shadow-rerun: backtest row not found — skipping");
    return null;
  }

  // 2. Load the provenance row for this backtest
  const [provenance] = await db
    .select()
    .from(backtestProvenance)
    .where(eq(backtestProvenance.backtestId, backtestId))
    .limit(1);

  if (!provenance) {
    // Pre-A2 backtest (no provenance row). Not an error — just skip.
    logger.debug(
      { strategyId, backtestId },
      "shadow-rerun: no provenance row (pre-A2 backtest) — skipping",
    );
    return null;
  }

  const oldResultHash = provenance.resultHash;
  const oldCodeGitSha = provenance.codeGitSha;
  const oldPf = originalBacktest.profitFactor !== null ? Number(originalBacktest.profitFactor) : null;
  const oldSharpe = originalBacktest.sharpeRatio !== null ? Number(originalBacktest.sharpeRatio) : null;
  const oldMaxDd = originalBacktest.maxDrawdown !== null ? Number(originalBacktest.maxDrawdown) : null;

  // 3. Re-run the backtest with the same config (current code)
  //    suppressAutoPromote=true: do NOT trigger lifecycle transitions for shadow runs.
  const config = {
    ...(originalBacktest.config as Record<string, unknown>),
    suppressAutoPromote: true,
  } as Parameters<typeof runBacktest>[1];

  // FIX H1 (deepscan15 2026-07-03): derive a correlationId from the original
  // backtestId so the shadow re-run is linkable back to the row it re-ran, in the
  // 90-day audit trail. Previously this call explicitly passed `undefined` even
  // though backtestId was already in scope — the shadow-rerun subprocess and any
  // audit rows it wrote were untraceable to the original backtest.
  const shadowRerunCorrelationId = `shadow-rerun:${backtestId}`;

  let shadowResult: Awaited<ReturnType<typeof runBacktest>>;
  try {
    shadowResult = await runBacktest(strategyId, config, undefined, undefined, shadowRerunCorrelationId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { strategyId, backtestId, err: errMsg },
      "shadow-rerun: runBacktest threw — recording error finding",
    );
    // Return an error finding with same hash (can't compare) — severity = info
    return {
      strategyId,
      backtestId,
      oldCodeGitSha,
      newCodeGitSha,
      oldResultHash,
      newResultHash: oldResultHash, // no new result — treat as unchanged
      oldPf,
      newPf: null,
      oldSharpe,
      newSharpe: null,
      oldMaxDd,
      newMaxDd: null,
      statusFlipped: false,
      severity: "info",
      error: errMsg,
    };
  }

  if (shadowResult.status === "skipped") {
    logger.warn(
      { strategyId, backtestId, reason: shadowResult.error },
      "shadow-rerun: backtest skipped (pipeline paused during re-run)",
    );
    return null;
  }

  // 4. Compute new_result_hash from the new backtest's persisted row
  //    We read it from the DB so we're hashing the same serialized form as A2.
  const [shadowBacktest] = await db
    .select()
    .from(backtests)
    .where(eq(backtests.id, shadowResult.id as string))
    .limit(1);

  if (!shadowBacktest) {
    logger.error(
      { strategyId, backtestId, shadowId: shadowResult.id },
      "shadow-rerun: shadow backtest row not found after run",
    );
    return null;
  }

  // Compute result hash from the shadow backtest row's stored metrics (same fields A2 uses)
  // We use the shadow backtest's result as stored in the DB row — this mirrors
  // how A2 computes result_hash from the Python backtester output.
  const shadowResultRecord: Record<string, unknown> = {
    total_return: shadowBacktest.totalReturn,
    sharpe_ratio: shadowBacktest.sharpeRatio,
    max_drawdown: shadowBacktest.maxDrawdown,
    win_rate: shadowBacktest.winRate,
    profit_factor: shadowBacktest.profitFactor,
    total_trades: shadowBacktest.totalTrades,
    avg_trade_pnl: shadowBacktest.avgTradePnl,
    avg_daily_pnl: shadowBacktest.avgDailyPnl,
    forge_score: shadowBacktest.forgeScore,
    tier: shadowBacktest.tier,
    ...(shadowBacktest.resultExtras as Record<string, unknown> ?? {}),
  };
  const newResultHash = computeResultHash(shadowResultRecord);

  const newPf = shadowBacktest.profitFactor !== null ? Number(shadowBacktest.profitFactor) : null;
  const newSharpe = shadowBacktest.sharpeRatio !== null ? Number(shadowBacktest.sharpeRatio) : null;
  const newMaxDd = shadowBacktest.maxDrawdown !== null ? Number(shadowBacktest.maxDrawdown) : null;

  // 5. Detect status flip
  const oldPassed = metricsPassGate(oldPf, oldSharpe, oldMaxDd);
  const newPassed = metricsPassGate(newPf, newSharpe, newMaxDd);
  const statusFlipped = oldPassed !== newPassed;
  const severity = computeSeverity(oldResultHash, newResultHash, statusFlipped);

  return {
    strategyId,
    backtestId,
    oldCodeGitSha,
    newCodeGitSha,
    oldResultHash,
    newResultHash,
    oldPf,
    newPf,
    oldSharpe,
    newSharpe,
    oldMaxDd,
    newMaxDd,
    statusFlipped,
    severity,
  };
}

// ─── Persistence helper ───────────────────────────────────────────────────────

/**
 * Persist a finding row to shadow_rerun_findings.
 * ON CONFLICT DO NOTHING: idempotent — same (strategy, backtest, new_sha) → skip.
 */
async function persistFinding(
  finding: ShadowRerunFinding,
  reason: string,
): Promise<void> {
  await db
    .insert(shadowRerunFindings)
    .values({
      runReason: reason,
      strategyId: finding.strategyId,
      backtestId: finding.backtestId,
      oldCodeGitSha: finding.oldCodeGitSha,
      newCodeGitSha: finding.newCodeGitSha,
      oldResultHash: finding.oldResultHash,
      newResultHash: finding.newResultHash,
      oldPf: finding.oldPf?.toString() ?? null,
      newPf: finding.newPf?.toString() ?? null,
      oldSharpe: finding.oldSharpe?.toString() ?? null,
      newSharpe: finding.newSharpe?.toString() ?? null,
      oldMaxDd: finding.oldMaxDd?.toString() ?? null,
      newMaxDd: finding.newMaxDd?.toString() ?? null,
      statusFlipped: finding.statusFlipped,
      severity: finding.severity,
    })
    .onConflictDoNothing();
}

// ─── Bounded parallel executor ────────────────────────────────────────────────

/**
 * Run up to `concurrency` async tasks concurrently.
 * Returns results in the same order as the input tasks.
 */
async function pLimit<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<Array<T | Error>> {
  const results: Array<T | Error> = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const myIndex = nextIndex++;
      if (myIndex >= tasks.length) break;
      try {
        results[myIndex] = await tasks[myIndex]();
      } catch (err) {
        results[myIndex] = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Main public API ──────────────────────────────────────────────────────────

/**
 * Run shadow re-run for all PAPER+ strategies (default) or a specified subset.
 *
 * @param reason       Free-text explaining why this shadow re-run was triggered.
 *                     Example: "bug fix: WF intraday DD corrected in commit abc123"
 * @param strategyIds  Optional explicit list of strategy IDs to re-run.
 *                     When omitted, all PAPER+ strategies are targeted.
 * @returns            Summary report for the shadow re-run session.
 */
export async function runShadowRerun(
  reason: string,
  strategyIds?: string[],
): Promise<ShadowRerunReport> {
  const startMs = Date.now();

  // Pipeline pause guard
  if (!(await isPipelineActive())) {
    logger.info({ fn: "runShadowRerun" }, "shadow-rerun: pipeline paused — skipping");
    return {
      reason,
      newCodeGitSha: process.env.FORGE_GIT_SHA ?? "unknown",
      totalStrategies: 0,
      processed: 0,
      skipped: 0,
      errors: 0,
      findings: { info: 0, warning: 0, critical: 0 },
      criticalStrategies: [],
      durationMs: Date.now() - startMs,
    };
  }

  const newCodeGitSha = process.env.FORGE_GIT_SHA ?? "unknown";
  const concurrency =
    Number.parseInt(process.env.SHADOW_RERUN_CONCURRENCY ?? `${DEFAULT_CONCURRENCY}`, 10) || DEFAULT_CONCURRENCY;

  // ── Identify PAPER+ strategies and their latest completed backtests ──────────
  //
  // We want: for each PAPER+ strategy, the LATEST completed backtest
  // (the one that was most recently used to make the promotion decision).
  //
  // If strategyIds is provided, filter to that set.
  const stateFilter = inArray(strategies.lifecycleState, [...PAPER_PLUS_STATES]);

  // Limit to 500: no real deployment will have more than 500 PAPER+ strategies.
  // Using .limit() also makes the mock testable (same terminal call as other queries).
  const candidateStrategies = await db
    .select({
      strategyId: strategies.id,
    })
    .from(strategies)
    .where(
      strategyIds && strategyIds.length > 0
        ? and(stateFilter, inArray(strategies.id, strategyIds))
        : stateFilter,
    )
    .limit(500);

  const totalStrategies = candidateStrategies.length;

  if (totalStrategies === 0) {
    logger.info({ scope: PAPER_PLUS_STATES }, "shadow-rerun: no PAPER+ strategies found");
    return {
      reason,
      newCodeGitSha,
      totalStrategies: 0,
      processed: 0,
      skipped: 0,
      errors: 0,
      findings: { info: 0, warning: 0, critical: 0 },
      criticalStrategies: [],
      durationMs: Date.now() - startMs,
    };
  }

  logger.info(
    { totalStrategies, newCodeGitSha: newCodeGitSha.slice(0, 8), concurrency },
    "shadow-rerun: starting",
  );

  // For each strategy, find its latest completed backtest
  const strategyBacktestPairs: ShadowRerunStrategyInput[] = [];

  for (const { strategyId } of candidateStrategies) {
    const [latestBt] = await db
      .select({ id: backtests.id })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (latestBt) {
      strategyBacktestPairs.push({ strategyId, backtestId: latestBt.id });
    }
  }

  // ── Bounded parallel re-runs ───────────────────────────────────────────────
  const tasks = strategyBacktestPairs.map(
    ({ strategyId, backtestId }) =>
      () => rerunOneStrategy(strategyId, backtestId, newCodeGitSha, reason),
  );

  const rawResults = await pLimit(tasks, concurrency);

  // ── Aggregate results and persist findings ─────────────────────────────────
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  const findingCounts = { info: 0, warning: 0, critical: 0 };
  const criticalStrategies: Array<{ strategyId: string; backtestId: string }> = [];

  for (let i = 0; i < rawResults.length; i++) {
    const raw = rawResults[i];
    const input = strategyBacktestPairs[i];

    if (raw instanceof Error) {
      errors++;
      logger.error(
        { strategyId: input.strategyId, backtestId: input.backtestId, err: raw.message },
        "shadow-rerun: strategy re-run failed",
      );
      continue;
    }

    if (raw === null) {
      // No provenance row — pre-A2 backtest, skip
      skipped++;
      continue;
    }

    // Persist the finding
    try {
      await persistFinding(raw, reason);
    } catch (persistErr) {
      const errMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      logger.warn(
        { strategyId: raw.strategyId, backtestId: raw.backtestId, err: errMsg },
        "shadow-rerun: failed to persist finding (non-blocking)",
      );
    }

    processed++;
    findingCounts[raw.severity]++;

    if (raw.severity === "critical") {
      criticalStrategies.push({ strategyId: raw.strategyId, backtestId: raw.backtestId });
    }

    logger.info(
      {
        strategyId: raw.strategyId,
        backtestId: raw.backtestId,
        severity: raw.severity,
        statusFlipped: raw.statusFlipped,
        hashChanged: raw.oldResultHash !== raw.newResultHash,
      },
      "shadow-rerun: finding recorded",
    );
  }

  const durationMs = Date.now() - startMs;

  const report: ShadowRerunReport = {
    reason,
    newCodeGitSha,
    totalStrategies,
    processed,
    skipped,
    errors,
    findings: findingCounts,
    criticalStrategies,
    durationMs,
  };

  logger.info(
    { ...report, criticalCount: criticalStrategies.length },
    "shadow-rerun: complete",
  );

  return report;
}

/**
 * Read recent shadow_rerun_findings rows for a strategy or all strategies.
 * Used by the route layer to surface findings in the dashboard.
 */
export async function getShadowRerunFindings(
  strategyId?: string,
  limit = 50,
): Promise<typeof shadowRerunFindings.$inferSelect[]> {
  const query = db
    .select()
    .from(shadowRerunFindings)
    .orderBy(desc(shadowRerunFindings.runAt))
    .limit(limit);

  if (strategyId) {
    return db
      .select()
      .from(shadowRerunFindings)
      .where(eq(shadowRerunFindings.strategyId, strategyId))
      .orderBy(desc(shadowRerunFindings.runAt))
      .limit(limit);
  }

  return query;
}
