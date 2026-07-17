/**
 * paper-to-deploy-ready-precondition.ts — Gate 3 manual/cron precondition parity
 * (ratify-packet: docs/ratify-packets/gate3-manual-cron-parity-2026-07-17.md)
 *
 * PROBLEM THIS CLOSES
 * --------------------
 * The PAPER → DEPLOY_READY promotion gate has two independent callers of
 * evaluatePaperToDeployReadyGates() (paper-to-deploy-ready-gates.ts):
 *
 *   1. The cron sweep (checkAutoPromotions, lifecycle-service.ts ~:5567-5601) —
 *      computes tradingDays (distinct calendar dates on which paper_trades
 *      closed via paper_sessions, since strategy.lifecycleChangedAt) and
 *      rollingSharpe (strategy.rollingSharpe30d), and ONLY calls the 9-gate
 *      evaluator when tradingDays >= 30 && rollingSharpe >= 1.5.
 *
 *   2. The manual PATCH path (_promoteStrategyInner, lifecycle-service.ts :669) —
 *      called the evaluator directly with NO precondition check. The
 *      evaluator's own docstring (paper-to-deploy-ready-gates.ts:33) states
 *      "The caller is responsible for: Checking the pre-conditions
 *      (tradingDays >= 30, rollingSharpe >= 1.5)" — the manual path never did.
 *
 * This module supplies the two named constants both call sites reference (so
 * the threshold can never drift into two different numbers — the exact class
 * of duplicated-literal drift this campaign has repeatedly found and fixed
 * elsewhere, e.g. firm_profiles.py vs firm_config.py) plus a pure evaluator
 * the manual path uses to turn a computed (tradingDays, rollingSharpe) pair
 * into a pass/block verdict + audit payload.
 *
 * DESIGN CONTRACT (mirrors b14-ci-gate.ts / wfe-gate.ts / bif-gate.ts):
 *   - No DB calls. No Date.now(). No I/O. No side effects.
 *   - Caller (the manual path in _promoteStrategyInner) runs the IDENTICAL
 *     query shape the cron sweep uses (same join, same date-distinct group-by,
 *     same lifecycleChangedAt filter) and passes tradingDays/rollingSharpe in.
 *   - Caller writes the audit row from result.auditAction + a payload built
 *     from this result's fields.
 *
 * NOT env-configurable by design. This fix's scope is strictly "make the
 * manual path enforce what the cron already enforces" — not "make the
 * threshold configurable" (that would give the manual path a capability the
 * cron itself has never had, widening the change beyond the ratified scope).
 *
 * INTERIM STATUS: superseded-not-wasted by the future M3 5-10-qualifying-day
 * evaluator (both cron and manual will call that shared evaluator instead of
 * this day-count+Sharpe precondition) — see the ratify packet §2. The parity
 * principle (manual path enforces the SAME precondition the cron enforces)
 * survives that future swap; only the precondition's substance changes.
 */

/** Minimum distinct calendar trading days (paper_trades.exitTime dates, grouped via DATE()) since strategy.lifecycleChangedAt. */
export const PAPER_TO_DEPLOY_READY_MIN_TRADING_DAYS = 30;

/** Minimum strategies.rollingSharpe30d value. */
export const PAPER_TO_DEPLOY_READY_MIN_ROLLING_SHARPE = 1.5;

export interface PaperToDeployReadyPreconditionInput {
  /** Distinct trading-day count computed by the caller's DB query. */
  tradingDays: number;
  /** strategy.rollingSharpe30d, parsed to a number (0 when null/absent). */
  rollingSharpe: number;
  /**
   * True when strategy.lifecycleChangedAt was null and the caller could not
   * run the trading-day query at all. The cron sweep's own loop does
   * `if (!s.lifecycleChangedAt) continue;` — i.e. it never promotes such a
   * strategy either. This flag lets the manual path mirror that exact
   * semantics as an explicit block rather than an ambiguous 0-day reading.
   */
  lifecycleChangedAtMissing?: boolean;
}

export interface PaperToDeployReadyPreconditionResult {
  /** True when the precondition is satisfied and the 9-gate evaluator may run. */
  passed: boolean;
  tradingDays: number;
  rollingSharpe: number;
  minTradingDays: number;
  minRollingSharpe: number;
  /** Machine-stable reason code (mirrors the other lifecycle gate helpers' `status`/`reason` fields). */
  reason: "precondition_met" | "trading_days_or_sharpe_below_threshold" | "lifecycle_changed_at_missing";
  /** Canonical audit action name; null on pass (no audit-worthy block). */
  auditAction: "lifecycle.paper_to_deploy_ready_precondition_blocked" | null;
}

/**
 * Pure evaluator — no DB access. The manual path in _promoteStrategyInner
 * computes tradingDays/rollingSharpe via the cron's exact query shape and
 * passes them in here BEFORE calling evaluatePaperToDeployReadyGates(), so a
 * failing precondition never spends the 9-gate evaluator's on-demand
 * survival-twin Python subprocess.
 */
export function evaluatePaperToDeployReadyPrecondition(
  input: PaperToDeployReadyPreconditionInput,
): PaperToDeployReadyPreconditionResult {
  const { tradingDays, rollingSharpe, lifecycleChangedAtMissing } = input;

  if (lifecycleChangedAtMissing) {
    return {
      passed: false,
      tradingDays,
      rollingSharpe,
      minTradingDays: PAPER_TO_DEPLOY_READY_MIN_TRADING_DAYS,
      minRollingSharpe: PAPER_TO_DEPLOY_READY_MIN_ROLLING_SHARPE,
      reason: "lifecycle_changed_at_missing",
      auditAction: "lifecycle.paper_to_deploy_ready_precondition_blocked",
    };
  }

  const passed =
    tradingDays >= PAPER_TO_DEPLOY_READY_MIN_TRADING_DAYS &&
    rollingSharpe >= PAPER_TO_DEPLOY_READY_MIN_ROLLING_SHARPE;

  return {
    passed,
    tradingDays,
    rollingSharpe,
    minTradingDays: PAPER_TO_DEPLOY_READY_MIN_TRADING_DAYS,
    minRollingSharpe: PAPER_TO_DEPLOY_READY_MIN_ROLLING_SHARPE,
    reason: passed ? "precondition_met" : "trading_days_or_sharpe_below_threshold",
    auditAction: passed ? null : "lifecycle.paper_to_deploy_ready_precondition_blocked",
  };
}
