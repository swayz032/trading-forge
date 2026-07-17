/**
 * n8n-drift-audit-classifier.ts — pure leaf for the n8n drift-detector crons
 * (scheduler.ts `_runN8nDriftAudit`, shared by n8n-drift-detector-weekly and
 * n8n-drift-detector-monthly).
 *
 * Extracted (mirrors the scheduler-drift.ts pattern) so the "API-unreachable
 * looks the same as genuine drift" class of bug is directly unit-testable
 * without booting the multi-thousand-line scheduler.ts module or spawning a
 * real subprocess.
 *
 * WHY THIS EXISTS (fixwave2-scheduler-health-monitoring, 2026-07-17):
 *   `npm run audit:n8n` (scripts/audit-n8n-workflows.mjs) exits non-zero both
 *   when it finds genuine workflow drift (missing errorWorkflow / retry /
 *   webhook-auth — totalViolations>0, exit 1) AND when it cannot even reach
 *   the n8n API (missing env, network failure, stale/expired API key — an
 *   N8nApiUnreachableError propagates to `main().catch()`, exit 2). Before
 *   this fix both cases produced the identical misleading "n8n workflow
 *   drift detected...missing safety configurations" CRITICAL Discord alert.
 *   This module classifies the exit code so the caller can alert
 *   appropriately differently for each case — a real drift finding is
 *   CRITICAL and actionable; an unreachable API is a transient-infra WARNING
 *   that says nothing about workflow health.
 */

/** Exit code scripts/audit-n8n-workflows.mjs uses for "could not reach the
 *  n8n API" (env missing, network error, non-2xx HTTP response on the
 *  workflow-list/detail fetch). Exit 0 = clean, exit 1 = genuine drift found
 *  (totalViolations > 0). Keep this constant in sync with the literal
 *  `process.exit(2)` calls in that script — a mismatch here silently
 *  reclassifies "unreachable" back into "drift". */
export const N8N_AUDIT_EXIT_API_UNREACHABLE = 2;

export type N8nDriftAuditOutcome = "clean" | "drift" | "unreachable" | "timeout" | "unknown_error";

/**
 * Classifies a completed (non-hung) `audit:n8n` subprocess run by its exit
 * code. `timedOut` should be true only when the caller's own wall-clock
 * timeout fired (a distinct, already-handled branch in `_runN8nDriftAudit`
 * upstream of this classifier) — callers on the timeout path do not need to
 * call this function at all, but it is included here for completeness /
 * defense-in-depth if the two paths are ever merged.
 */
export function classifyN8nDriftAuditExit(exitCode: number, timedOut: boolean): N8nDriftAuditOutcome {
  if (timedOut) return "timeout";
  if (exitCode === 0) return "clean";
  if (exitCode === N8N_AUDIT_EXIT_API_UNREACHABLE) return "unreachable";
  if (exitCode === 1) return "drift";
  // Any other exit code is unexpected — treat conservatively as if drift
  // were found (safe default: alert loudly rather than silently swallow an
  // unrecognized failure mode) but tag it distinctly so the audit trail
  // shows the classifier didn't recognize the code.
  return "unknown_error";
}
