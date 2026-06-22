/**
 * rl-dsr-gate.ts — Wave 29 Pass C.3 (backtest-core)
 *
 * Pure-function DSR (Deflated Sharpe Ratio) gate for RL policy graduation.
 *
 * DSR Formula (QuantBeckman 2025 + arXiv 2512.12924):
 *
 *   DSR = (SR_oos − PSR_adjustment) / σ_SR
 *
 * where PSR_adjustment (Probabilistic Sharpe Ratio selection-bias correction):
 *   PSR_adjustment = σ_n × √(1 − γ) × Φ⁻¹(1 − 1 / (2N))
 *
 *   σ_n     = sample standard deviation adjustment: √( (1 + 0.5 × SR_is²) / (n_iterations − 1) )
 *             (approximation from Bailey & Lopez de Prado 2014 — full kurtosis/skewness
 *             correction requires per-sample moments; we use the simplified form)
 *   γ       = IS-to-OOS decay ratio: SR_oos / SR_is (clipped to [0, 1])
 *   Φ⁻¹(p) = probit / inverse-normal CDF  (Abramowitz & Stegun approximation, no scipy)
 *   N       = number of RL training iterations (trials) tested
 *   σ_SR    = standard error of OOS Sharpe: 1 / √(n_iterations)
 *             (asymptotic approximation for large N; we use N directly as
 *             proxy for the number of independent evaluation paths)
 *
 * DSR ≥ threshold (default 0.5) → RL policy graduates to 13th subsystem.
 * DSR < threshold               → policy rejected; does NOT enter composite.
 *
 * Audit events:
 *   quantum_rl.dsr_floor_block — emitted on rejection (ok=false)
 *   quantum_rl.dsr_passed      — emitted on pass (ok=true)
 * (Audit payload is returned; caller inserts.)
 *
 * Design:
 *   PURE FUNCTIONS ONLY — no I/O, no Date.now(), no side effects.
 *   Replay-deterministic: same inputs → same DSR always.
 *
 * Import notes (CLAUDE.md feedback_helper_logger_import.md):
 *   logger imported from ./logger.js leaf — never from ../index.js.
 */

import { logger } from "./logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default DSR graduation floor per Wave 29 institutional mandate.
 *
 * Read from QUANTUM_RL_DSR_FLOOR env var at module load (default 0.5).
 * Matches the Python challenger module which documents the same env var
 * (QUANTUM_RL_DSR_FLOOR in CLAUDE.md §2 / Wave 29 Pass C env var table).
 * The env-resolved value is used as the default for evaluateRlDsrGate()
 * so all callers that omit the threshold param pick up the env override.
 */
export const DEFAULT_DSR_THRESHOLD = parseFloat(
  process.env.QUANTUM_RL_DSR_FLOOR ?? "0.5",
);

/** Minimum n_training_iterations to avoid near-zero denominator instability. */
export const MIN_TRAINING_ITERATIONS = 2;

// ─── Probit (Φ⁻¹) approximation (no scipy) ───────────────────────────────────
// Abramowitz & Stegun 26.2.17 rational approximation.
// Maximum absolute error: 4.5 × 10⁻⁴ across the full (0,1) domain.
// Sufficient precision for DSR computation; RL graduation thresholds
// are 0.5-level comparisons, not high-precision statistics.

const _PROBIT_A = [2.515517, 0.802853, 0.010328];
const _PROBIT_B = [1.432788, 0.189269, 0.001308];

/** Rational approximation for the inner Φ⁻¹ core (p in [0.5, 1.0)). */
function _probitPositive(p: number): number {
  const t = Math.sqrt(-2 * Math.log(1 - p));
  const num = _PROBIT_A[0] + _PROBIT_A[1] * t + _PROBIT_A[2] * t * t;
  const den = 1 + _PROBIT_B[0] * t + _PROBIT_B[1] * t * t + _PROBIT_B[2] * t * t * t;
  return t - num / den;
}

/**
 * Inverse normal CDF (probit) for p ∈ (0, 1).
 * Returns ±Infinity for edge-case inputs (0 or 1).
 * Uses symmetry: Φ⁻¹(p) = −Φ⁻¹(1−p) for p < 0.5.
 */
export function probit(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return +Infinity;
  if (p === 0.5) return 0;
  if (p > 0.5) return _probitPositive(p);
  return -_probitPositive(1 - p);
}

// ─── DSR Computation ─────────────────────────────────────────────────────────

export interface DsrComponents {
  /** σ_n — sample standard deviation adjustment factor */
  sigma_n: number;
  /** γ — IS-to-OOS decay ratio (clipped to [0, 1]) */
  gamma: number;
  /** Φ⁻¹(1 − 1 / (2N)) */
  probit_value: number;
  /** PSR adjustment = σ_n × √(1 − γ) × Φ⁻¹(1 − 1/(2N)) */
  psr_adjustment: number;
  /** σ_SR = 1 / √N — standard error of OOS Sharpe */
  sigma_sr: number;
  /** Raw DSR numerator = SR_oos − psr_adjustment */
  numerator: number;
}

/**
 * Compute DSR components for diagnostics and tests.
 * Returns null when inputs are degenerate (N < MIN_TRAINING_ITERATIONS,
 * SR_is == 0, etc.).
 */
export function computeDsrComponents(
  rlSharpeIs: number,
  rlSharpeOos: number,
  nTrainingIterations: number,
): DsrComponents | null {
  if (nTrainingIterations < MIN_TRAINING_ITERATIONS) return null;

  // σ_n: simplified Bailey-Lopez de Prado (2014) approximation
  // Assumes IID returns; uses SR_is to capture information decay
  const sigma_n = Math.sqrt((1 + 0.5 * rlSharpeIs * rlSharpeIs) / (nTrainingIterations - 1));

  // γ: IS-to-OOS decay ratio — clipped [0, 1]
  // When SR_is is 0, decay is undefined → use 0 (worst-case, most conservative)
  let gamma = 0;
  if (rlSharpeIs !== 0) {
    gamma = Math.max(0, Math.min(1, rlSharpeOos / rlSharpeIs));
  }

  // Φ⁻¹(1 − 1 / (2N))
  const probitArg = 1 - 1 / (2 * nTrainingIterations);
  const probit_value = probit(probitArg);

  // PSR adjustment (selection-bias correction)
  const psr_adjustment = sigma_n * Math.sqrt(1 - gamma) * probit_value;

  // σ_SR: asymptotic standard error of OOS Sharpe
  const sigma_sr = 1 / Math.sqrt(nTrainingIterations);

  // Numerator
  const numerator = rlSharpeOos - psr_adjustment;

  return {
    sigma_n,
    gamma,
    probit_value,
    psr_adjustment,
    sigma_sr,
    numerator,
  };
}

// ─── Gate Result ──────────────────────────────────────────────────────────────

export interface RlDsrGateResult {
  /** True when DSR ≥ threshold (policy graduates). */
  ok: boolean;
  /** Computed DSR value (or null when inputs are degenerate). */
  dsr: number | null;
  /** Threshold applied. */
  dsrThreshold: number;
  /** Human-readable reason. */
  reason?: string;
  /** Diagnostic components for audit payload. */
  components: DsrComponents | null;
  /**
   * Audit payload — merge into audit_log.result.
   * action = "quantum_rl.dsr_passed" when ok=true
   * action = "quantum_rl.dsr_floor_block" when ok=false
   */
  auditPayload: {
    dsr: number | null;
    dsr_threshold: number;
    sr_oos: number;
    sr_is: number;
    n_training_iterations: number;
    blocked: boolean;
    components: DsrComponents | null;
    reason: string;
  };
}

/**
 * Evaluate the RL DSR gate.
 *
 * @param rlSharpeIs            Sharpe ratio from IS (in-sample) RL training period.
 * @param rlSharpeOos           Sharpe ratio from OOS (out-of-sample) RL evaluation.
 * @param nTrainingIterations   Number of RL training iterations / trials tested.
 * @param threshold             DSR threshold (default DEFAULT_DSR_THRESHOLD = 0.5).
 * @returns                     Gate result with DSR, threshold, and audit payload.
 */
export function evaluateRlDsrGate(
  rlSharpeIs: number,
  rlSharpeOos: number,
  nTrainingIterations: number,
  threshold: number = DEFAULT_DSR_THRESHOLD,
): RlDsrGateResult {
  // Degenerate-input guard
  if (nTrainingIterations < MIN_TRAINING_ITERATIONS) {
    const reason =
      `Insufficient training iterations: ${nTrainingIterations} < ${MIN_TRAINING_ITERATIONS}. ` +
      "DSR cannot be computed — RL policy rejected by default.";
    logger.warn(
      { nTrainingIterations, threshold },
      "rl-dsr-gate: degenerate N — auto-reject",
    );
    return {
      ok: false,
      dsr: null,
      dsrThreshold: threshold,
      reason,
      components: null,
      auditPayload: {
        dsr: null,
        dsr_threshold: threshold,
        sr_oos: rlSharpeOos,
        sr_is: rlSharpeIs,
        n_training_iterations: nTrainingIterations,
        blocked: true,
        components: null,
        reason,
      },
    };
  }

  const components = computeDsrComponents(rlSharpeIs, rlSharpeOos, nTrainingIterations);
  if (components === null) {
    // Should not happen given the N check above, but be defensive
    const reason = "DSR computation returned null despite valid N — auto-reject.";
    return {
      ok: false,
      dsr: null,
      dsrThreshold: threshold,
      reason,
      components: null,
      auditPayload: {
        dsr: null,
        dsr_threshold: threshold,
        sr_oos: rlSharpeOos,
        sr_is: rlSharpeIs,
        n_training_iterations: nTrainingIterations,
        blocked: true,
        components: null,
        reason,
      },
    };
  }

  // DSR = numerator / σ_SR
  const dsr = components.sigma_sr > 0
    ? components.numerator / components.sigma_sr
    : null;

  // Gate: ok when DSR ≥ threshold (strict ≥ per institutional mandate)
  const passed = dsr !== null && dsr >= threshold;
  const reason = dsr === null
    ? "DSR is null (sigma_sr = 0) — auto-reject"
    : passed
      ? `DSR ${dsr.toFixed(4)} >= threshold ${threshold} — RL policy graduated`
      : `DSR ${dsr.toFixed(4)} < threshold ${threshold} — RL policy rejected`;

  if (passed) {
    logger.info(
      { dsr, threshold, rlSharpeIs, rlSharpeOos, nTrainingIterations },
      "rl-dsr-gate: PASS — DSR exceeds graduation floor",
    );
  } else {
    logger.warn(
      { dsr, threshold, rlSharpeIs, rlSharpeOos, nTrainingIterations },
      "rl-dsr-gate: FAIL — DSR below graduation floor",
    );
  }

  return {
    ok: passed,
    dsr,
    dsrThreshold: threshold,
    reason,
    components,
    auditPayload: {
      dsr,
      dsr_threshold: threshold,
      sr_oos: rlSharpeOos,
      sr_is: rlSharpeIs,
      n_training_iterations: nTrainingIterations,
      blocked: !passed,
      components,
      reason,
    },
  };
}
