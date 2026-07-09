/**
 * scheduler-drift.ts — pure leaf for the scheduler-drift detector (deep-scan Autonomy re-verify).
 *
 * Extracted so the "registered-but-never-scheduled" detection (the exact class that let
 * economic-calendar-sync silently never run) is directly unit-testable WITHOUT booting the
 * 8k-line scheduler module. `_validateAllJobsScheduled()` in scheduler.ts delegates here.
 */

/** Jobs that are in `registered` (via registerJob → SCHEDULER_JOBS) but not in `scheduled`
 *  (via cron.schedule → _scheduledJobs). A non-empty result is scheduler drift — a dead job. */
export function findUnscheduledJobs(
  registered: Iterable<string>,
  scheduled: ReadonlySet<string>,
): string[] {
  const missing: string[] = [];
  for (const job of registered) {
    if (!scheduled.has(job)) missing.push(job);
  }
  return missing;
}
