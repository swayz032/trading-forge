/**
 * Adversarial Stress Service — Tier 3.4 (Gemini Quantum Blueprint)
 *
 * Orchestrates the Python Grover adversarial stress subprocess,
 * persists results to adversarial_stress_runs, and records cost
 * telemetry to quantum_run_costs.
 *
 * AUTHORITY BOUNDARY:
 *   - Output is challenger-only evidence. MUST NOT influence lifecycle gates.
 *   - Phase 0 shadow: runs and persists, but lifecycle service reads result
 *     for observation only — gate behavior is 100% classical.
 *   - Phase 1 (W7b Day 52): worst_case_breach_prob > 0.5 AND
 *     breach_minimal_n_trades < 4 blocks promotion IF QUANTUM_ADVERSARIAL_STRESS_ENABLED.
 *   - TIER gating: TIER_1 and TIER_2 only. TIER_3 strategies skip adversarial stress.
 *
 * Pending-row contract: status="pending" on insert, updated to
 * completed/failed/aborted after Python call resolves.
 *
 * isActive() guard: returns early when pipeline is paused.
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  adversarialStressRuns,
  backtests,
  backtestTrades,
} from "../db/schema.js";
import { logger } from "../index.js";
import { recordCost, completeCost } from "../lib/quantum-cost-tracker.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { parsePythonJson } from "../../shared/utils.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");
const ADVERSARIAL_STRESS_TIMEOUT_MS = 35_000; // 35s: 30s Python limit + 5s overhead

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdversarialStressPythonResult {
  worst_case_breach_prob: number | null;
  breach_minimal_n_trades: number | null;
  worst_sequence_examples: Array<{ sequence: number[]; loss_sum: number; grover_prob?: number }>;
  n_qubits: number;
  n_trades: number;
  daily_loss_limit: number;
  method: string;
  status: string;
  error_message: string | null;
  wall_clock_ms: number;
  qpu_seconds: number;
  governance_labels: Record<string, unknown>;
  reproducibility_hash: string;
  hardware: string;
}

export interface AdversarialStressRunOutput {
  runId: string;
  strategyId: string;
  backtestId: string;
  worstCaseBreachProb: number | null;
  breachMinimalNTrades: number | null;
  method: string;
  status: string;
  wallClockMs: number;
  governanceLabels: Record<string, unknown>;
  // Phase 1 decision helper (evaluated but NOT enforced in Phase 0)
  phase1BlockRecommended: boolean;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function runPythonAdversarialStress(
  configPath: string,
  timeoutMs: number = ADVERSARIAL_STRESS_TIMEOUT_MS,
): Promise<AdversarialStressPythonResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", "src.engine.quantum_adversarial_stress", "--input-json", configPath];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error(`Adversarial stress timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.debug({ component: "adversarial-stress" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        try {
          resolve(parsePythonJson<AdversarialStressPythonResult>(stdout));
        } catch {
          reject(new Error(`Failed to parse adversarial stress output: ${stdout.slice(0, 500)}`));
        }
      } else {
        reject(new Error(`Adversarial stress failed (exit ${code}): ${stderr.slice(0, 500)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

// ─── TIER guard ──────────────────────────────────────────────────────────────

/**
 * Returns true if adversarial stress should run for this strategy.
 * TIER_3 strategies are skipped — too noisy for meaningful worst-case ordering signal.
 * AUTHORITY BOUNDARY: this guard prevents noise, not authority escalation.
 */
function shouldRunForTier(tier: string | null | undefined): boolean {
  if (!tier) return false;
  const t = tier.toUpperCase();
  return t === "TIER_1" || t === "TIER_2";
}

// ─── Main service function ────────────────────────────────────────────────────

/**
 * Run adversarial stress for a completed backtest.
 *
 * Returns null when:
 *   - Pipeline is paused
 *   - Feature flag QUANTUM_ADVERSARIAL_STRESS_ENABLED=false
 *   - Strategy tier is TIER_3 or unknown
 *   - Backtest not found or not completed
 *
 * Never throws — all errors are caught and persisted as failed rows.
 */
export async function runAdversarialStress(
  backtestId: string,
  strategyId: string,
  options: {
    dailyLossLimit?: number;
    seed?: number;
    correlationId?: string;
  } = {},
): Promise<AdversarialStressRunOutput | null> {
  // ── Pipeline guard ────────────────────────────────────────────────────────
  const active = await isPipelineActive();
  if (!active) {
    logger.debug(
      { backtestId, strategyId },
      "adversarial-stress: pipeline paused — skipping run",
    );
    return null;
  }

  // ── Feature flag guard ────────────────────────────────────────────────────
  const featureEnabled =
    process.env.QUANTUM_ADVERSARIAL_STRESS_ENABLED?.toLowerCase() === "true";
  // Phase 0 shadow: even when flag is false, we still run in shadow mode
  // (result is written but not gated). Flag=false means Phase 0 shadow only.

  // ── Fetch backtest (includes tier — tier lives on backtests, not strategies) ──
  const [bt] = await db
    .select({ id: backtests.id, status: backtests.status, tier: backtests.tier })
    .from(backtests)
    .where(eq(backtests.id, backtestId))
    .limit(1);

  if (!bt) {
    logger.warn({ backtestId, strategyId }, "adversarial-stress: backtest not found — skip");
    return null;
  }

  if (!shouldRunForTier(bt.tier)) {
    logger.debug(
      { strategyId, backtestId, tier: bt.tier },
      "adversarial-stress: TIER_3 or unknown tier — skipping (too noisy)",
    );
    return null;
  }

  if (bt.status !== "completed") {
    logger.warn(
      { backtestId, status: bt.status },
      "adversarial-stress: backtest not completed — skip",
    );
    return null;
  }

  // ── Fetch trade ledger ────────────────────────────────────────────────────
  const trades = await db
    .select({
      id: backtestTrades.id,
      pnl: backtestTrades.pnl,
      direction: backtestTrades.direction,
      entryTime: backtestTrades.entryTime,
      exitTime: backtestTrades.exitTime,
    })
    .from(backtestTrades)
    .where(eq(backtestTrades.backtestId, backtestId))
    .orderBy(backtestTrades.entryTime);

  if (trades.length === 0) {
    logger.warn({ backtestId }, "adversarial-stress: no trades found — skip");
    return null;
  }

  const dailyLossLimit = options.dailyLossLimit ?? 2000.0;

  // ── Insert pending row ────────────────────────────────────────────────────
  const [pendingRow] = await db
    .insert(adversarialStressRuns)
    .values({
      backtestId,
      strategyId,
      nQubits: 0,
      nTrades: trades.length,
      dailyLossLimit: String(dailyLossLimit),
      status: "pending",
      method: "grover_quantum",
      governanceLabels: {
        experimental: true,
        authoritative: false,
        decision_role: "challenger_only",
      },
    })
    .returning();

  // ── Cost tracking ─────────────────────────────────────────────────────────
  const { id: costRowId } = await recordCost({
    moduleName: "adversarial_stress",
    backtestId,
    strategyId,
    qpuSeconds: 0,
    costDollars: 0,
    cacheHit: false,
  });

  const startMs = Date.now();
  let configPath: string | null = null;

  try {
    // ── Build Python config ───────────────────────────────────────────────
    const tradesList = trades.map((t) => ({
      trade_id: t.id,
      pnl: t.pnl != null ? parseFloat(String(t.pnl)) : 0.0,
      direction: t.direction ?? "long",
      entry_time: t.entryTime?.toISOString() ?? "",
      exit_time: t.exitTime?.toISOString() ?? "",
    }));

    const config = {
      trades: tradesList,
      rules: {
        daily_loss_limit: dailyLossLimit,
        max_consecutive_losers: 4,
        trailing_drawdown: null,
      },
      seed: options.seed ?? 42,
    };

    configPath = pathResolve(tmpdir(), `adversarial_stress_${randomUUID()}.json`);
    writeFileSync(configPath, JSON.stringify(config));

    // ── Run Python subprocess ─────────────────────────────────────────────
    const pythonResult = await runPythonAdversarialStress(configPath);
    const wallClockMs = Date.now() - startMs;

    // ── Update pending row to completed ───────────────────────────────────
    await db
      .update(adversarialStressRuns)
      .set({
        nQubits: pythonResult.n_qubits,
        nTrades: pythonResult.n_trades,
        worstCaseBreachProb: pythonResult.worst_case_breach_prob != null
          ? String(pythonResult.worst_case_breach_prob)
          : null,
        breachMinimalNTrades: pythonResult.breach_minimal_n_trades,
        worstSequenceExamples: pythonResult.worst_sequence_examples,
        qpuSeconds: String(pythonResult.qpu_seconds ?? 0),
        wallClockMs,
        method: pythonResult.method,
        status: pythonResult.status === "completed" ? "completed" : pythonResult.status,
        errorMessage: pythonResult.error_message,
      })
      .where(eq(adversarialStressRuns.id, pendingRow.id));

    await completeCost(costRowId, {
      wallClockMs,
      status: "completed",
      qpuSeconds: pythonResult.qpu_seconds ?? 0,
    });

    // ── Phase 1 decision helper (advisory — never enforced in Phase 0) ────
    const breachProb = pythonResult.worst_case_breach_prob ?? 0;
    const breachMinN = pythonResult.breach_minimal_n_trades ?? Infinity;
    const phase1BlockRecommended = breachProb > 0.5 && breachMinN < 4;

    if (phase1BlockRecommended && !featureEnabled) {
      logger.warn(
        {
          strategyId,
          backtestId,
          worstCaseBreachProb: breachProb,
          breachMinimalNTrades: breachMinN,
          phase: "0_shadow",
        },
        "adversarial-stress shadow: Phase 1 would BLOCK this promotion — Phase 0 shadow, classical gate unaffected",
      );
    }

    logger.info(
      {
        strategyId,
        backtestId,
        runId: pendingRow.id,
        worstCaseBreachProb: pythonResult.worst_case_breach_prob,
        breachMinimalNTrades: pythonResult.breach_minimal_n_trades,
        method: pythonResult.method,
        wallClockMs,
        hardware: pythonResult.hardware,
        phase1BlockRecommended,
        authority: "challenger_only",
      },
      "adversarial-stress: run completed (Phase 0 shadow — lifecycle gate unaffected)",
    );

    return {
      runId: pendingRow.id,
      strategyId,
      backtestId,
      worstCaseBreachProb: pythonResult.worst_case_breach_prob,
      breachMinimalNTrades: pythonResult.breach_minimal_n_trades,
      method: pythonResult.method,
      status: pythonResult.status,
      wallClockMs,
      governanceLabels: pythonResult.governance_labels,
      phase1BlockRecommended,
    };
  } catch (err) {
    const wallClockMs = Date.now() - startMs;
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.warn(
      { strategyId, backtestId, err: errorMessage, wallClockMs },
      "adversarial-stress: run failed — updating row to failed, classical gate unaffected",
    );

    // Update pending row to failed
    try {
      await db
        .update(adversarialStressRuns)
        .set({
          status: "failed",
          errorMessage,
          wallClockMs,
        })
        .where(eq(adversarialStressRuns.id, pendingRow.id));
    } catch (dbErr) {
      logger.warn({ dbErr }, "adversarial-stress: failed to update run row to failed");
    }

    await completeCost(costRowId, {
      wallClockMs,
      status: "failed",
      errorMessage,
    });

    return null;
  } finally {
    // Clean up temp config file
    if (configPath && existsSync(configPath)) {
      try { unlinkSync(configPath); } catch { /* ignore */ }
    }
  }
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch the latest completed adversarial stress run for a backtest.
 * Used by lifecycle-service for shadow evidence read.
 *
 * Returns null when no completed run exists. Never throws.
 */
export async function getLatestAdversarialStressRun(
  backtestId: string,
): Promise<{
  worstCaseBreachProb: number | null;
  breachMinimalNTrades: number | null;
  method: string;
  phase1BlockRecommended: boolean;
} | null> {
  try {
    const [row] = await db
      .select({
        worstCaseBreachProb: adversarialStressRuns.worstCaseBreachProb,
        breachMinimalNTrades: adversarialStressRuns.breachMinimalNTrades,
        method: adversarialStressRuns.method,
      })
      .from(adversarialStressRuns)
      .where(eq(adversarialStressRuns.backtestId, backtestId))
      .orderBy(desc(adversarialStressRuns.createdAt))
      .limit(1);

    if (!row) return null;

    const breachProb = row.worstCaseBreachProb != null
      ? parseFloat(String(row.worstCaseBreachProb))
      : null;
    const breachMinN = row.breachMinimalNTrades ?? null;
    const phase1BlockRecommended =
      breachProb != null && breachProb > 0.5 &&
      breachMinN != null && breachMinN < 4;

    return {
      worstCaseBreachProb: breachProb,
      breachMinimalNTrades: breachMinN,
      method: row.method,
      phase1BlockRecommended,
    };
  } catch (err) {
    logger.warn(
      { backtestId, err },
      "adversarial-stress: getLatestAdversarialStressRun failed — returning null",
    );
    return null;
  }
}
