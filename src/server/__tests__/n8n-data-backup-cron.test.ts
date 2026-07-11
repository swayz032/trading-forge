/**
 * F-5 (deep-scan false-green, 2026-07-06) — the `n8n-data-backup-daily` cron must
 * actually exist in the scheduler.
 *
 * scripts/backup-n8n-data.mjs is the ONLY recovery net for the F-4 importer (which
 * can silently PUT stale local JSON over live workflows) and for a dropped n8n
 * schema. Its docstring claimed a `n8n-data-backup-daily` scheduler cron invoked
 * it — but no such cron existed (grep zero hits), so the safety net was dead. This
 * test pins that the cron is now registered, scheduled, pipeline-gate-exempt, and
 * writes an audit row on completion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schedulerSrc = readFileSync(
  join(process.cwd(), "src/server/scheduler.ts"),
  "utf-8",
);
const backupSrc = readFileSync(
  join(process.cwd(), "scripts/backup-n8n-data.mjs"),
  "utf-8",
);

describe("F-5 — n8n-data-backup-daily cron is wired into the scheduler", () => {
  it("registers the job and adds it to the scheduled set", () => {
    expect(schedulerSrc).toContain('registerJob("n8n-data-backup-daily"');
    expect(schedulerSrc).toContain('_scheduledJobs.add("n8n-data-backup-daily")');
  });

  it("is pipeline-gate-exempt (recovery data cannot be gated by the pause it guards)", () => {
    // The exempt-set membership carries a unique "// F-5: n8n Postgres recovery
    // backup" marker comment that appears nowhere else in the file.
    expect(schedulerSrc).toMatch(/"n8n-data-backup-daily",\s*\/\/ F-5: n8n Postgres recovery backup/);
  });

  it("has a UTC cron schedule with an ET-hour DST guard", () => {
    expect(schedulerSrc).toMatch(/scheduleUtc\(["']30 7,8 \* \* \*["']/);
  });

  it("invokes the backup helper and writes a completion audit row", () => {
    expect(schedulerSrc).toContain("_runN8nDataBackup");
    expect(schedulerSrc).toContain("backup-n8n-data.mjs");
    expect(schedulerSrc).toContain('"n8n.data_backup_completed"');
    expect(schedulerSrc).toContain('"n8n.data_backup_failed"');
  });

  it("the backup script still exports runBackup (the helper the cron imports)", () => {
    expect(backupSrc).toMatch(/export\s+async\s+function\s+runBackup/);
  });
});
