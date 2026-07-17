/**
 * n8n-health-classifier.ts — pure leaf for the n8n-health-check cron
 * (scheduler.ts "n8n-health-check", every 15 min).
 *
 * Extracted (mirrors the scheduler-drift.ts pattern) so the "empty execution
 * log looks the same as all-healthy" class of bug is directly unit-testable
 * without booting the multi-thousand-line scheduler.ts module.
 *
 * WHY THIS EXISTS (fixwave2-scheduler-health-monitoring, 2026-07-17):
 *   The health check queries n8n_execution_log for the last hour, grouped by
 *   workflow, and flags any workflow with failures>0. When the execution-log
 *   SCRAPER (a separate 5-min cron, n8n-execution-scraper-service.ts) is
 *   itself down — n8n API outage, stale/expired API key, network partition —
 *   the scraper writes zero new rows. The health check then sees an EMPTY
 *   stats array and (pre-fix) reported "all workflows healthy" via the same
 *   code path as a real all-clear — a total-outage false-green. This module
 *   distinguishes "checked, genuinely healthy" from "the check itself
 *   produced no data" so the caller never reports the latter as healthy.
 */

export type N8nHealthCheckStatus =
  | "failing" // >=1 workflow has failures in the window — real signal, alert as before
  | "healthy" // stats present, zero failures — genuinely verified healthy
  | "indeterminate" // stats empty AND scraper is stale/erroring — can't tell, must NOT report healthy
  | "quiet" // stats empty but scraper is fine and recently succeeded — genuinely no activity
  | "disabled"; // scraper has no N8N_BASE_URL/API key configured — deliberate no-op, not an error

/** Scrape cadence is 5 min (scheduler.ts registerJob("n8n-execution-scrape", 5*60*1000, ...)).
 *  A gap of 4x that cadence means the scraper has stopped ticking (crash, hang, disabled job,
 *  or a pipeline pause that somehow reached it — it's in _PIPELINE_GATE_EXEMPT so it shouldn't). */
export const SCRAPE_STALE_AFTER_MS = 20 * 60 * 1000;

export interface N8nScrapeState {
  /** epoch ms of the most recent scrape attempt, or null if it never ran this process lifetime */
  lastAttemptAt: number | null;
  /** epoch ms of the most recent scrape that reached the n8n API without error */
  lastSuccessAt: number | null;
  /** error message from the most recent scrape attempt, or null when it succeeded (or hasn't run) */
  lastError: string | null;
  /** true when the scraper has no N8N_BASE_URL / API key configured */
  disabled: boolean;
}

export interface N8nHealthCheckStats {
  workflowName: string;
  total: number;
  failures: number;
}

export interface N8nHealthCheckResult {
  status: N8nHealthCheckStatus;
  failing: N8nHealthCheckStats[];
  reason: string;
}

export function classifyN8nHealthCheck(
  stats: N8nHealthCheckStats[],
  scrapeState: N8nScrapeState,
  now: number = Date.now(),
): N8nHealthCheckResult {
  const failing = stats.filter((s) => s.failures > 0);
  if (failing.length > 0) {
    return {
      status: "failing",
      failing,
      reason: `${failing.length} workflow(s) have failures in the last hour`,
    };
  }
  if (stats.length > 0) {
    return { status: "healthy", failing: [], reason: "execution log has data and zero failures in the last hour" };
  }

  // stats.length === 0 — the ambiguous case this module exists to resolve.
  if (scrapeState.disabled) {
    return {
      status: "disabled",
      failing: [],
      reason: "n8n execution-log scraper has no N8N_BASE_URL/API key configured",
    };
  }

  const scrapeStale =
    scrapeState.lastAttemptAt === null || now - scrapeState.lastAttemptAt > SCRAPE_STALE_AFTER_MS;
  const scrapeErroring = scrapeState.lastError !== null;

  if (scrapeStale || scrapeErroring) {
    return {
      status: "indeterminate",
      failing: [],
      reason: scrapeErroring
        ? `execution log is empty and the scraper's last attempt errored: ${scrapeState.lastError}`
        : "execution log is empty and the scraper has not run recently — cannot verify n8n health",
    };
  }

  return {
    status: "quiet",
    failing: [],
    reason: "execution log is empty but the scraper is healthy and recent — genuinely no activity",
  };
}
