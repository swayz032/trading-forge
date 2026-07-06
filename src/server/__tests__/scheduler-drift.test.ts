/**
 * scheduler-drift.test.ts — deep-scan Autonomy re-verify failure-injection: prove the
 * registered-but-never-scheduled detector actually FIRES on drift (the class that let
 * economic-calendar-sync silently never run) and does NOT false-alarm when all jobs are scheduled.
 */
import { describe, it, expect } from "vitest";
import { findUnscheduledJobs } from "../lib/scheduler-drift.js";

describe("findUnscheduledJobs — scheduler drift detector", () => {
  it("FIRES: a registered job with no cron.schedule is flagged (fabricated drift)", () => {
    expect(findUnscheduledJobs(["a", "b", "c"], new Set(["a", "c"]))).toEqual(["b"]);
  });

  it("FIRES on the exact economic-calendar-sync class (registered, not scheduled)", () => {
    const registered = ["heartbeat-write", "economic-calendar-sync", "pre-market-prep"];
    const scheduled = new Set(["heartbeat-write", "pre-market-prep"]); // economic-calendar-sync missing
    expect(findUnscheduledJobs(registered, scheduled)).toEqual(["economic-calendar-sync"]);
  });

  it("does NOT false-alarm when every registered job is scheduled", () => {
    expect(findUnscheduledJobs(["a", "b"], new Set(["a", "b"]))).toEqual([]);
  });

  it("empty registry → no drift", () => {
    expect(findUnscheduledJobs([], new Set())).toEqual([]);
  });
});
