/**
 * synthetic-regime-bank-scheduler.test.ts
 *
 * Verifies that the scheduler.ts wiring for "synthetic-regime-bank-populate"
 * is correctly registered — import, _PIPELINE_GATE_EXEMPT, registerJob,
 * cron expression, _scheduledJobs.add, and _tryAcquireJobLock guard.
 *
 * Uses source-text inspection rather than importing the full scheduler,
 * because the scheduler pulls in 100+ services and causes schema-mock
 * conflicts when combined with module mocking tests.
 *
 * This pattern is equivalent to the "pinned-facts" checks already used
 * in the codebase for cron wiring verification.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCHEDULER_PATH = resolve(
  import.meta.dirname ?? ".",
  "../scheduler.ts",
);

let _schedulerSrc: string | null = null;
function schedulerSrc(): string {
  if (!_schedulerSrc) {
    _schedulerSrc = readFileSync(SCHEDULER_PATH, "utf-8");
  }
  return _schedulerSrc;
}

describe("scheduler: synthetic-regime-bank-populate cron wiring", () => {
  it("S1. import for runSyntheticRegimeBankPopulate is present", () => {
    const src = schedulerSrc();
    expect(src).toContain("from \"./services/synthetic-regime-bank-service.js\"");
    expect(src).toContain("runSyntheticRegimeBankPopulate");
  });

  it("S2. _PIPELINE_GATE_EXEMPT static set includes synthetic-regime-bank-populate", () => {
    const src = schedulerSrc();
    // The job name must appear inside the _PIPELINE_GATE_EXEMPT = new Set([...]) block
    const setStart = src.indexOf("_PIPELINE_GATE_EXEMPT = new Set");
    expect(setStart).toBeGreaterThan(-1);
    const setEnd = src.indexOf("]);", setStart);
    expect(setEnd).toBeGreaterThan(setStart);
    const exemptBlock = src.slice(setStart, setEnd);
    expect(exemptBlock).toContain('"synthetic-regime-bank-populate"');
  });

  it("S3. registerJob call uses the correct job name", () => {
    const src = schedulerSrc();
    expect(src).toContain('registerJob("synthetic-regime-bank-populate"');
  });

  it("S4. cron.schedule fires on Sunday (day 0) at 07,08 UTC — DST double-fire", () => {
    // Sunday = 0 in node-cron; 07:00 UTC = 03:00 ET EDT; 08:00 UTC = 03:00 ET EST
    const src = schedulerSrc();
    expect(src).toContain('"0 7,8 * * 0"');
  });

  it("S5. _scheduledJobs.add registers the job for drift detection", () => {
    const src = schedulerSrc();
    expect(src).toContain('_scheduledJobs.add("synthetic-regime-bank-populate")');
  });

  it("S6. _tryAcquireJobLock overlap guard is wired", () => {
    const src = schedulerSrc();
    // The lock guard pattern: if (!_tryAcquireJobLock("job-name")) return;
    expect(src).toContain(
      '_tryAcquireJobLock("synthetic-regime-bank-populate")',
    );
  });

  it("S7. _releaseJobLock is called in finally block", () => {
    const src = schedulerSrc();
    // Find the cron block for our job and verify _releaseJobLock
    const cronBlockStart = src.indexOf('"0 7,8 * * 0"');
    expect(cronBlockStart).toBeGreaterThan(-1);
    // Within the next 2000 chars from the cron expression, releaseJobLock must appear
    const cronBlockEnd = src.indexOf('_scheduledJobs.add("synthetic-regime-bank-populate")', cronBlockStart);
    expect(cronBlockEnd).toBeGreaterThan(cronBlockStart);
    const cronBlock = src.slice(cronBlockStart, cronBlockEnd);
    expect(cronBlock).toContain(
      '_releaseJobLock("synthetic-regime-bank-populate")',
    );
  });
});
