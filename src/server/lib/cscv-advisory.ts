/**
 * cscv-advisory.ts — CSCV confluence-weight overfit advisory gate.
 *
 * Exposes compute_cscv_pbo as a TS callable that:
 *   1. Accepts a performance matrix (N_configs × T_observations).
 *   2. Calls the Python cscv_gate.py CLI via subprocess.
 *   3. If PBO > 0.5: emits audit event cscv.confluence_overfit_risk + logs WARN.
 *   4. If CSCV_CONFLUENCE_HARD=true: blocks (throws) on high PBO; default advisory-only.
 *
 * Wiring guidance:
 *   - Call evaluateCscvConfluenceOverfit() when confluence weights are refreshed
 *     or when a strategy's confluence_score_weights override is proposed.
 *   - Currently the production weights are CODE_DEFAULTS (hardcoded), so this
 *     gate fires when called explicitly — e.g., from the backtest audit pipeline
 *     once per-config performance matrices are available.
 *   - Real PBO cannot be computed until per-config backtest performance time series
 *     exist (0 backtests intentional as of 2026-06-29 hardening phase).
 *
 * Default behavior:
 *   CSCV_CONFLUENCE_HARD=false (default) → advisory-only; never blocks.
 *   CSCV_CONFLUENCE_HARD=true            → throws CscvOverfitError on PBO > 0.5.
 *
 * Logger: uses ./logger.js leaf module (feedback_helper_logger_import.md).
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Project root: two levels up from src/server/lib/
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const HARD_ENV = "CSCV_CONFLUENCE_HARD";
const PBO_WARN_THRESHOLD = 0.5;

export interface CscvResult {
  pbo: number | null;
  n_splits: number;
  logit_count: number;
  reason?: string;
  /** True when PBO was computed and exceeds the warn threshold. */
  overfit_risk: boolean;
  /** True when CSCV_CONFLUENCE_HARD=true and overfit_risk=true. */
  hard_blocked: boolean;
}

export class CscvOverfitError extends Error {
  readonly pbo: number;
  constructor(pbo: number) {
    super(
      `CSCV confluence overfit risk: PBO=${pbo.toFixed(3)} > ${PBO_WARN_THRESHOLD} ` +
        `(CSCV_CONFLUENCE_HARD=true). Confluence weights selection is likely overfit. ` +
        `Set CSCV_CONFLUENCE_HARD=false to downgrade to advisory.`
    );
    this.name = "CscvOverfitError";
    this.pbo = pbo;
  }
}

/**
 * Evaluate CSCV PBO for a confluence-weight config performance matrix.
 *
 * @param M       N_configs × T_observations performance array (e.g. per-period Sharpe).
 * @param S       Number of CSCV subsets (default 16).
 * @param context Human-readable label for audit log (e.g. "confluence_weights_v1").
 * @param emitAudit  Optional audit-emitting callback: (action, payload) => void.
 *                   Pass the audit_log writer from backtest-service or lifecycle-service.
 */
export async function evaluateCscvConfluenceOverfit(
  M: number[][],
  S: number = 16,
  context: string = "confluence_weights",
  emitAudit?: (action: string, payload: Record<string, unknown>) => void
): Promise<CscvResult> {
  const hardMode = (process.env[HARD_ENV] ?? "false").toLowerCase() === "true";

  const pythonCmd =
    process.env["PYTHON_BIN"] ??
    (process.platform === "win32" ? "python" : "python3");

  const input = JSON.stringify({ M, S });

  const proc = spawnSync(
    pythonCmd,
    ["-m", "src.engine.statistics.cscv_gate"],
    {
      input,
      encoding: "utf-8",
      cwd: PROJECT_ROOT,
      timeout: 120_000, // 2-minute ceiling for large S=16 matrices
    }
  );

  if (proc.error) {
    logger.warn(
      { err: proc.error, context },
      "cscv-advisory: Python subprocess error — advisory skipped"
    );
    return {
      pbo: null,
      n_splits: 0,
      logit_count: 0,
      reason: `subprocess_error: ${proc.error.message}`,
      overfit_risk: false,
      hard_blocked: false,
    };
  }

  let parsed: {
    pbo: number | null;
    n_splits: number;
    logit_count: number;
    reason?: string;
  };

  try {
    parsed = JSON.parse(proc.stdout ?? "{}") as typeof parsed;
  } catch {
    logger.warn(
      { stdout: proc.stdout, stderr: proc.stderr, context },
      "cscv-advisory: malformed Python output — advisory skipped"
    );
    return {
      pbo: null,
      n_splits: 0,
      logit_count: 0,
      reason: "malformed_subprocess_output",
      overfit_risk: false,
      hard_blocked: false,
    };
  }

  const pbo = typeof parsed.pbo === "number" ? parsed.pbo : null;
  const overfit_risk = pbo !== null && pbo > PBO_WARN_THRESHOLD;

  if (overfit_risk) {
    logger.warn(
      { pbo, n_splits: parsed.n_splits, context, hard_mode: hardMode },
      `cscv.confluence_overfit_risk: PBO=${pbo?.toFixed(3)} > ${PBO_WARN_THRESHOLD} — parameter snooping risk detected`
    );
    emitAudit?.("cscv.confluence_overfit_risk", {
      pbo,
      n_splits: parsed.n_splits,
      logit_count: parsed.logit_count,
      context,
      threshold: PBO_WARN_THRESHOLD,
      hard_mode: hardMode,
    });
  } else {
    logger.info(
      { pbo, n_splits: parsed.n_splits, context },
      "cscv.confluence_pbo_evaluated: no overfit risk detected"
    );
    emitAudit?.("cscv.confluence_pbo_evaluated", {
      pbo,
      n_splits: parsed.n_splits,
      logit_count: parsed.logit_count,
      context,
    });
  }

  const result: CscvResult = {
    pbo,
    n_splits: parsed.n_splits,
    logit_count: parsed.logit_count,
    overfit_risk,
    hard_blocked: hardMode && overfit_risk,
  };
  if (parsed.reason) result.reason = parsed.reason;

  if (result.hard_blocked && pbo !== null) {
    throw new CscvOverfitError(pbo);
  }

  return result;
}
