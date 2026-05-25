/**
 * Canonical schema for walk-forward window OOS metrics.
 *
 * 9-field contract (total_trading_days is optional — not always populated
 * for intraday strategies with sparse daily P&L records).
 *
 * This schema is the authoritative contract between:
 *   - Python engine (walk_forward.py) → produces these fields
 *   - DB persistence (backtest-service.ts) → validates before insert
 *   - Downstream consumers (critic, prop sim, portfolio optimizer)
 *
 * Wave 27.5 Pass B additions (all additive/optional — backward compat preserved):
 *   - WFE fields (wfe_overall, wfe_status, wfe_hard_floor, wfe_warn_floor)
 *   - PBO fields (pbo, pbo_pass, pbo_p_value, pbo_detail)
 *   - Param stability regime-context fields (drift_classification etc.)
 *
 * DO NOT add required fields — every new field must be .optional() to preserve
 * backward compatibility with pre-Wave-27.5 walk_forward results stored in DB.
 */

import { z } from "zod";

export const WFWindowMetricsSchema = z.object({
  /** Annualised Sharpe ratio computed from OOS daily P&Ls */
  sharpe_ratio: z.number(),
  /** Gross-wins / gross-losses ratio across all OOS trades */
  profit_factor: z.number(),
  /** Maximum peak-to-trough drawdown over the OOS window ($) */
  max_drawdown: z.number(),
  /** Fraction of OOS trades that closed with positive P&L */
  win_rate: z.number(),
  /** Total number of OOS trades executed */
  total_trades: z.number().int(),
  /** Mean daily P&L over OOS trading days */
  avg_daily_pnl: z.number(),
  /** Sum of all OOS trade P&Ls ($) */
  total_return: z.number(),
  /** total_return / total_trades — average P&L per trade ($) */
  avg_trade_pnl: z.number(),
  /** Calendar trading days in the OOS window (optional — may be absent for
   *  intraday strategies that do not populate daily_pnls on every session) */
  total_trading_days: z.number().int().optional(),
});

export type WFWindowMetrics = z.infer<typeof WFWindowMetricsSchema>;

/**
 * Alias for WFWindowMetricsSchema — consumers may import either name.
 * WFWindowOosMetricsSchema is the public-facing name for the canonical OOS
 * metrics contract; WFWindowMetricsSchema is the internal backtest-service name.
 * Both refer to the same shape — do not diverge them.
 */
export const WFWindowOosMetricsSchema = WFWindowMetricsSchema;
export type WFWindowOosMetrics = WFWindowMetrics;

// ── Wave 27.5 Pass B: WFE result schema ──────────────────────────────────────

/**
 * Walk-Forward Efficiency result emitted by the Python engine.
 * All fields are optional — absent on pre-W27.5 results stored in DB.
 *
 * wfe_status values:
 *   "pass" — wfe_overall >= WFE_HARD_FLOOR (default 0.70)
 *   "warn" — wfe_overall >= WFE_WARN_FLOOR (default 0.50) but < hard_floor
 *   "fail" — wfe_overall < WFE_WARN_FLOOR (red flag, Pass B.2 will gate PAPER→DEPLOY_READY)
 *   null   — WFE could not be computed (IS Sharpe <= 0 or no IS data)
 */
export const WFEResultSchema = z.object({
  /** Combined OOS Sharpe / combined IS Sharpe across all folds (not per-window average) */
  wfe_overall: z.number().nullable().optional(),
  /** "pass" | "warn" | "fail" | null */
  wfe_status: z.enum(["pass", "warn", "fail"]).nullable().optional(),
  /** Hard floor used (default 0.70; reads WFE_HARD_FLOOR env) */
  wfe_hard_floor: z.number().optional(),
  /** Warn floor used (default 0.50; reads WFE_WARN_FLOOR env) */
  wfe_warn_floor: z.number().optional(),
  /** Per-window WFE breakdown (may be empty [] when using combined-fold computation) */
  wfe_per_window: z.array(z.record(z.unknown())).optional(),
});

export type WFEResult = z.infer<typeof WFEResultSchema>;

// ── Wave 27.5 Pass B: PBO result schema ──────────────────────────────────────

/**
 * PBO (Probability of Backtest Overfitting) result, auto-wired into WF output.
 * pbo > 0.5 means strategy is more likely overfit than not.
 * pbo_pass = false is a HIGH advisory; PAPER→DEPLOY_READY gate wiring is Pass B.2's job.
 */
export const PBOResultSchema = z.object({
  /** PBO in [0, 1], or null when < 4 windows available */
  pbo: z.number().nullable().optional(),
  /** true when pbo <= PBO_OVERFIT_THRESHOLD (default 0.5); null when pbo is null */
  pbo_pass: z.boolean().nullable().optional(),
  /** Reserved for Bayesian extension; currently always null */
  pbo_p_value: z.number().nullable().optional(),
  /** Full PBO computation detail dict */
  pbo_detail: z.record(z.unknown()).nullable().optional(),
});

export type PBOResult = z.infer<typeof PBOResultSchema>;

// ── Wave 27.5 Pass B: Param stability regime-context fields ──────────────────

/**
 * Parameter drift classification emitted alongside the legacy is_fragile flag.
 * All fields are optional; backward compat with pre-W27.5 param_stability output.
 */
export const ParamDriftClassificationSchema = z.object({
  /**
   * 4-class classification:
   *   "stable"        — CV <= 30%; params are consistent
   *   "regime_driven" — drift correlates with regime shifts (Spearman rho >= 0.3)
   *   "overfit_drift" — stable regime but params jitter (likely curve-fit)
   *   "indeterminate" — cannot distinguish adaptation from noise
   */
  drift_classification: z.enum(["stable", "regime_driven", "overfit_drift", "indeterminate"]).optional(),
  /** Confidence in the classification [0, 1]; 0 = no regime data */
  drift_confidence: z.number().optional(),
  /** Raw evidence dict (spearman_rho, regime_sequence, per_param_cv, etc.) */
  drift_evidence: z.record(z.unknown()).optional(),
});

export type ParamDriftClassification = z.infer<typeof ParamDriftClassificationSchema>;

// ── Composite walk-forward result schema (top-level output) ──────────────────

/**
 * Extended walk-forward result schema — merges legacy fields with W27.5 Pass B
 * additions. All W27.5 fields are optional so existing DB rows remain valid.
 *
 * Consumers who need WFE/PBO/drift should use the nullable optional accessors
 * and treat absence as "not yet computed" (pre-W27.5 backtest).
 */
export const WalkForwardResultSchema = WFWindowMetricsSchema.partial().extend({
  ...WFEResultSchema.shape,
  ...PBOResultSchema.shape,
  ...ParamDriftClassificationSchema.shape,
});
