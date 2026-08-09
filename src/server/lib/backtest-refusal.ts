/**
 * Shared refusal classifier — D-10 (R-755 §4, OPTION A + one shared classifier).
 *
 * The engine can REFUSE to execute a strategy when the source is too ambiguous to
 * compile deterministically. A refusal is NOT a crash and NOT a zero result: it
 * carries no metrics at all, and every metric column on its persisted row is NULL
 * by construction (R-751 §8-5).
 *
 * Ten of the fourteen production `runBacktest()` call sites consume the result, and
 * before this wave they all shared one defect shape — `result.some_metric ?? 0` —
 * which turns "never measured" into "measured, and it was zero".
 *
 *   `A KEY PRESENT AS 0.0 IS A MEASUREMENT; A KEY ABSENT WITH A STATED REASON IS A REFUSAL.`
 *
 * ─── WHAT THIS MODULE DELIBERATELY DOES NOT DO ───────────────────────────────
 *
 * It CLASSIFIES. It does not act, and it NEVER THROWS (R-755 §4).
 *
 * Throwing was considered and rejected by the desk: it would convert a deliberate
 * governance decision into a failure, and one central exception cannot decide
 * whether the critic should stop ranking, the matrix should terminate, or evolution
 * should avoid retiring a parent. Those are different domain actions, and each
 * consumer still owns its own.
 */

import { BACKTEST_STATUS_REFUSED } from "../db/schema.js";

/**
 * Did this `runBacktest()` result come from an execution REFUSAL?
 *
 * Accepts `unknown` on purpose: several call sites hold the result as `any` (a cast
 * this wave is explicitly NOT refactoring away), so a narrowly-typed parameter would
 * be erased at exactly the sites with the worst defects.
 */
export function isExecutionRefused(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { status?: unknown }).status === BACKTEST_STATUS_REFUSED
  );
}

/**
 * The refusal evidence a consumer should persist instead of fabricated metrics.
 *
 * Returns only keys that are actually present on the result. A caller must never
 * turn a missing field into `0`, `false` or `""` — that is the defect this whole
 * wave exists to remove.
 */
export function refusalEvidence(result: unknown): Record<string, unknown> {
  if (!isExecutionRefused(result)) return {};
  const r = result as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    "execution_status",
    "condition_id",
    "disposition",
    "reason",
    "ambiguity",
    "entry_eligible",
    "metrics_omitted",
    "analysis_omitted",
  ]) {
    if (r[key] !== undefined) out[key] = r[key];
  }
  return out;
}
