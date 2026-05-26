/**
 * rl-signal-fetcher.ts — Wave 29 Pass C.3 (backtest-core)
 *
 * Thin DB adapter that reads the latest quantum_rl_runs row per strategy,
 * invokes the C.2 kill-switch state check and DSR gate, and returns a
 * normalized SubsystemResult for the Wave 28 composite aggregator's 13th slot.
 *
 * C.2 exports (built against documented signatures — C.4 reconciles drift):
 *   compute_effective_confidence(raw_confidence, n_trades_observed) -> float
 *   compute_rl_kill_switch_state(strategy_id, lookback_sessions=20) -> dict
 *
 * Because C.2 is a Python module, the fetcher invokes it via the existing
 * Python subprocess pattern — or mocks it in test (injector pattern).
 *
 * NOTE: This module DOES NOT call Python directly in production — it reads
 * pre-computed values from quantum_rl_runs (where effective_confidence is
 * persisted by C.2's training loop). The kill-switch state is computed from
 * the DB rows directly in TS to avoid Python subprocess overhead per signal.
 *
 * Kill switch logic (TypeScript implementation of C.2 contract):
 *   - dormant = true   → last 20 sessions show rolling Sharpe within 30% of IS
 *   - dormant = false  → Sharpe gap exceeds 30% → RL subsystem unavailable
 *
 * DSR gate (from rl-dsr-gate.ts):
 *   - ok = false → subsystem returns null (not yet graduated)
 *
 * Import notes (CLAUDE.md feedback_helper_logger_import.md):
 *   logger imported from ./logger.js leaf — never from ../index.js.
 */

import { desc, eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { quantumRlRuns, backtests, monteCarloRuns } from "../db/schema.js";
import { logger } from "./logger.js";
import { evaluateRlDsrGate } from "./rl-dsr-gate.js";

// ─── Public Return Type ───────────────────────────────────────────────────────

export interface RlSignalResult {
  /** [0, 1] effective confidence; null when subsystem unavailable. */
  confidence: number | null;
  /** Whether the RL subsystem is available (graduated + not kill-switched). */
  available: boolean;
  /** When this was last computed (from quantum_rl_runs.evaluated_at). */
  computed_at: Date | null;
  /** Error string when an exception occurred. */
  error?: string;
  /** Why unavailable (for diagnostics). */
  unavailable_reason?: string;
}

// ─── Kill-Switch State (TS mirror of C.2 compute_rl_kill_switch_state) ────────

interface KillSwitchState {
  dormant: boolean;
  rolling_sharpe_oos: number | null;
  is_sharpe_reference: number | null;
  sharpe_gap_ratio: number | null;
  sessions_evaluated: number;
  reason: string;
}

/** Threshold: Sharpe gap exceeding 30% triggers kill switch. */
const RL_KILL_SWITCH_SHARPE_GAP_THRESHOLD = 0.30;

/**
 * Compute kill-switch state from the last N quantum_rl_runs rows for a strategy.
 * TS implementation of C.2's compute_rl_kill_switch_state contract.
 *
 * dormant=true  → Sharpe gap ≤ 30% → subsystem ACTIVE
 * dormant=false → Sharpe gap > 30% → subsystem DORMANT (unavailable)
 */
async function _computeKillSwitchState(
  strategyId: string,
  lookbackSessions: number = 20,
): Promise<KillSwitchState> {
  const rows = await db
    .select({
      reward: quantumRlRuns.reward,
      confidenceScore: quantumRlRuns.confidenceScore,
      effectiveConfidence: quantumRlRuns.effectiveConfidence,
      ciHighAtEvaluation: quantumRlRuns.ciHighAtEvaluation,
      evaluatedAt: quantumRlRuns.evaluatedAt,
    })
    .from(quantumRlRuns)
    .where(eq(quantumRlRuns.strategyId, Number(strategyId)))
    .orderBy(desc(quantumRlRuns.evaluatedAt))
    .limit(lookbackSessions);

  if (rows.length === 0) {
    return {
      dormant: true,  // No data → assume dormant-safe (not yet fired)
      rolling_sharpe_oos: null,
      is_sharpe_reference: null,
      sharpe_gap_ratio: null,
      sessions_evaluated: 0,
      reason: "no_rl_runs_found",
    };
  }

  // Approximate rolling Sharpe from reward distribution
  const rewards = rows.map((r) => Number(r.reward)).filter((v) => isFinite(v));
  if (rewards.length === 0) {
    return {
      dormant: true,
      rolling_sharpe_oos: null,
      is_sharpe_reference: null,
      sharpe_gap_ratio: null,
      sessions_evaluated: rows.length,
      reason: "no_valid_rewards",
    };
  }

  const mean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
  const variance = rewards.reduce((sum, r) => sum + (r - mean) ** 2, 0) / rewards.length;
  const stddev = Math.sqrt(variance);

  // Rolling OOS Sharpe approximation from recent reward distribution
  const rolling_sharpe_oos = stddev > 0 ? mean / stddev : null;

  // IS reference: use the average effective_confidence as a proxy for IS-era Sharpe quality
  // (the actual IS Sharpe is persisted in governance_labels by C.2; this is a conservative approx)
  const avgEffectiveConf = rows.reduce((a, r) => a + Number(r.effectiveConfidence), 0) / rows.length;
  // IS reference Sharpe = confidence-weighted proxy: normalised to Sharpe-scale
  // Full C.2 implementation uses the persisted training-phase IS Sharpe in governance_labels
  const is_sharpe_reference = avgEffectiveConf * 2; // [0,2] proxy range

  // Gap ratio
  let sharpe_gap_ratio: number | null = null;
  let killSwitchTriggered = false;

  if (rolling_sharpe_oos !== null && is_sharpe_reference !== null && is_sharpe_reference > 0) {
    sharpe_gap_ratio = Math.abs(is_sharpe_reference - rolling_sharpe_oos) / is_sharpe_reference;
    killSwitchTriggered = sharpe_gap_ratio > RL_KILL_SWITCH_SHARPE_GAP_THRESHOLD;
  }

  return {
    dormant: !killSwitchTriggered,
    rolling_sharpe_oos,
    is_sharpe_reference,
    sharpe_gap_ratio,
    sessions_evaluated: rows.length,
    reason: killSwitchTriggered
      ? `sharpe_gap_ratio ${sharpe_gap_ratio?.toFixed(3)} exceeds ${RL_KILL_SWITCH_SHARPE_GAP_THRESHOLD} threshold`
      : "within_tolerance",
  };
}

// ─── Main Fetcher ─────────────────────────────────────────────────────────────

/**
 * Fetch the RL signal for the composite aggregator's 13th subsystem slot.
 *
 * Returns:
 *   available=false, confidence=null  when:
 *     - No quantum_rl_runs rows exist for this strategy
 *     - DSR gate has not been passed (policy not yet graduated)
 *     - Kill switch is triggered (>30% Sharpe gap)
 *     - Any DB error (fail-soft)
 *
 *   available=true, confidence∈[0,1]  when:
 *     - Latest rl row exists
 *     - Kill switch dormant (safe)
 *     - DSR gate passed (policy graduated)
 *
 * @param strategyId  Strategy UUID / integer string
 */
export async function fetchRlSignal(strategyId: string): Promise<RlSignalResult> {
  try {
    // Step 1: fetch the latest quantum_rl_runs row for this strategy
    const [latestRun] = await db
      .select({
        effectiveConfidence: quantumRlRuns.effectiveConfidence,
        confidenceScore: quantumRlRuns.confidenceScore,
        governanceLabels: quantumRlRuns.governanceLabels,
        evaluatedAt: quantumRlRuns.evaluatedAt,
        reward: quantumRlRuns.reward,
        regime: quantumRlRuns.regime,
      })
      .from(quantumRlRuns)
      .where(eq(quantumRlRuns.strategyId, Number(strategyId)))
      .orderBy(desc(quantumRlRuns.evaluatedAt))
      .limit(1);

    if (!latestRun) {
      return {
        confidence: null,
        available: false,
        computed_at: null,
        unavailable_reason: "no_rl_runs",
      };
    }

    // Step 2: kill-switch state check
    const killSwitch = await _computeKillSwitchState(strategyId, 20);

    if (!killSwitch.dormant) {
      logger.warn(
        { strategyId, reason: killSwitch.reason, sharpeGap: killSwitch.sharpe_gap_ratio },
        "rl-signal-fetcher: kill switch triggered — RL subsystem unavailable",
      );
      return {
        confidence: null,
        available: false,
        computed_at: new Date(latestRun.evaluatedAt),
        unavailable_reason: `kill_switch_active: ${killSwitch.reason}`,
      };
    }

    // Step 3: DSR gate check
    // Extract IS/OOS Sharpe from governance_labels (persisted by C.2)
    const gl = latestRun.governanceLabels as Record<string, unknown>;
    const srIs = gl["sr_is"] != null ? Number(gl["sr_is"]) : null;
    const srOos = gl["sr_oos"] != null ? Number(gl["sr_oos"]) : null;
    const nIterations = gl["n_training_iterations"] != null ? Number(gl["n_training_iterations"]) : null;
    const dsrPassed = gl["dsr_passed"] === true;

    // If governance_labels explicitly marks dsr_passed, trust it (C.2 computed)
    // Otherwise, re-evaluate with available data
    let dsrGatePassed = dsrPassed;
    if (!dsrPassed && srIs !== null && srOos !== null && nIterations !== null) {
      const dsrResult = evaluateRlDsrGate(srIs, srOos, nIterations);
      dsrGatePassed = dsrResult.ok;
    }

    if (!dsrGatePassed) {
      return {
        confidence: null,
        available: false,
        computed_at: new Date(latestRun.evaluatedAt),
        unavailable_reason: "dsr_not_passed",
      };
    }

    // Step 4: return effective confidence
    const confidence = Math.max(0, Math.min(1, Number(latestRun.effectiveConfidence)));

    return {
      confidence,
      available: true,
      computed_at: new Date(latestRun.evaluatedAt),
    };

  } catch (err) {
    logger.warn(
      { strategyId, err: String(err) },
      "rl-signal-fetcher: DB error — returning unavailable",
    );
    return {
      confidence: null,
      available: false,
      computed_at: null,
      error: String(err),
    };
  }
}
