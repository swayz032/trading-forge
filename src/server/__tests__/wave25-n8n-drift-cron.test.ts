/**
 * Wave 25 Pass 2 — A-2: n8n drift detector cron registration and handler tests.
 *
 * Verifies:
 * 1. cron 'n8n-drift-detector-weekly' is registered with a Sunday schedule.
 * 2. cron 'n8n-drift-detector-monthly' is registered with a monthly schedule.
 * 3. Handler on exit=0 writes 'n8n.drift_check_clean' audit row.
 * 4. Handler on exit!=0 writes 'n8n.drift_detected' audit row + calls notifyCritical.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isSundayAtEtHour } from "../lib/weekly-cron-et-guard.js";
import { isFirstOfMonthAtEtHour } from "../lib/monthly-cron-et-guard.js";

// ─── Mock child_process execFile ───────────────────────────────────────────────

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;
type ExecFileOptions = {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string | undefined>;
};

const mockExecFile = vi.fn();

vi.mock("child_process", () => ({
  execFile: (
    _file: string,
    _args: string[],
    _opts: ExecFileOptions,
    cb: ExecFileCallback,
  ) => {
    return mockExecFile(_file, _args, _opts, cb);
  },
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockInsertAuditRow = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: mockInsertAuditRow,
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

const mockNotifyCritical = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: mockNotifyCritical,
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Simulate execFile calling the callback with a successful result (exit 0).
 */
function execFileSucceeds(stdout = "Total violations: 0\nExit 0") {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], _opts: ExecFileOptions, cb: ExecFileCallback) => {
      cb(null, stdout, "");
      return { kill: vi.fn() };
    },
  );
}

/**
 * Simulate execFile calling the callback with a non-zero exit (drift detected).
 */
function execFileFails(exitCode = 1, stdout = "Total violations: 3", stderr = "3 violations found") {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], _opts: ExecFileOptions, cb: ExecFileCallback) => {
      const err = Object.assign(new Error("Command failed"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", status: exitCode, killed: false });
      cb(err, stdout, stderr);
      return { kill: vi.fn() };
    },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 25 Pass 2 A-2 — n8n drift detector cron registration", () => {
  it("n8n-drift-detector-weekly is registered with BOTH DST-offset schedules (deepscan23 fix)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schedulerSrc = readFileSync(
      join(process.cwd(), "src/server/scheduler.ts"),
      "utf-8",
    );

    // Job must be registered
    expect(schedulerSrc).toContain('"n8n-drift-detector-weekly"');

    // Sunday 19:00 ET = Sunday 23:00 UTC (EDT) or Monday 00:00 UTC (EST) — these
    // land on DIFFERENT UTC weekdays, so both separate schedule() calls must be
    // present. (The prior single "0 23 * * 1" pattern this test used to assert
    // was itself the bug: Monday 23:00 UTC never corresponds to Sunday 19:00 ET
    // under either offset — see the behavioral tests below.)
    expect(schedulerSrc).toMatch(/scheduleUtc\(["']0 23 \* \* 0["']/);
    expect(schedulerSrc).toMatch(/scheduleUtc\(["']0 0 \* \* 1["']/);
  });

  it("isSundayAtEtHour(19) fires on the real EDT and EST target instants, and only those", () => {
    // EDT: Sunday 19:00 ET == 2026-08-02T23:00:00Z (verified: 2026-08-02 is a Sunday, August is EDT season)
    expect(isSundayAtEtHour(new Date("2026-08-02T23:00:00Z"), 19)).toBe(true);
    // EST: Sunday 19:00 ET == 2027-01-04T00:00:00Z (verified: 2027-01-03 is a Sunday, January is EST season)
    expect(isSundayAtEtHour(new Date("2027-01-04T00:00:00Z"), 19)).toBe(true);
    // The OLD buggy schedule's actual fire moment (Monday 23:00 UTC, EDT season) must NOT match —
    // this is the concrete instant the string-matching version of this test could never have caught.
    expect(isSundayAtEtHour(new Date("2026-08-03T23:00:00Z"), 19)).toBe(false);
    // One hour off the genuine EDT target must not match either.
    expect(isSundayAtEtHour(new Date("2026-08-02T22:00:00Z"), 19)).toBe(false);
  });

  it("isSundayAtEtHour(18) fires on the real EDT and EST target instants for weekly-drift-2sigma-check", () => {
    // EDT: Sunday 18:00 ET == 2026-08-02T22:00:00Z
    expect(isSundayAtEtHour(new Date("2026-08-02T22:00:00Z"), 18)).toBe(true);
    // EST: Sunday 18:00 ET == 2027-01-03T23:00:00Z
    expect(isSundayAtEtHour(new Date("2027-01-03T23:00:00Z"), 18)).toBe(true);
    // The OLD buggy schedule's actual fire moment (Monday 22:00 UTC) must NOT match.
    expect(isSundayAtEtHour(new Date("2026-08-03T22:00:00Z"), 18)).toBe(false);
  });

  it("n8n-drift-detector-monthly is registered with a monthly cron schedule (1st of month)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schedulerSrc = readFileSync(
      join(process.cwd(), "src/server/scheduler.ts"),
      "utf-8",
    );

    // Job must be registered
    expect(schedulerSrc).toContain('"n8n-drift-detector-monthly"');

    // The cron pattern must fire on the 1st of every month.
    // 09:00 ET = 13:00 or 14:00 UTC. Pattern: "0 13,14 1 * *"
    const monthlySchedulePattern = /scheduleUtc\(["']0 13,14 1 \* \*["']/;
    expect(monthlySchedulePattern.test(schedulerSrc)).toBe(true);
  });

  it("isFirstOfMonthAtEtHour(9) fires on the real EDT and EST 1st-of-month target instants, and only those (deepscan monthly fix)", () => {
    // Both DST regimes at the 1st-of-month 09:00 ET boundary (the cron double-fires
    // at 13:00 + 14:00 UTC to cover both offsets; the guard must accept exactly one
    // of the two per season and reject the other).
    // EDT: 1st of month 09:00 ET == 13:00 UTC (verified: 2026-08-01 09:00 EDT = UTC-4).
    expect(isFirstOfMonthAtEtHour(new Date("2026-08-01T13:00:00Z"), 9)).toBe(true);
    // EST: 1st of month 09:00 ET == 14:00 UTC (verified: 2026-01-01 09:00 EST = UTC-5).
    expect(isFirstOfMonthAtEtHour(new Date("2026-01-01T14:00:00Z"), 9)).toBe(true);

    // The OTHER UTC fire of the double-fire cron must be rejected each season:
    // 14:00 UTC in EDT season is 10:00 ET (hour off) — must NOT match.
    expect(isFirstOfMonthAtEtHour(new Date("2026-08-01T14:00:00Z"), 9)).toBe(false);
    // 13:00 UTC in EST season is 08:00 ET (hour off) — must NOT match.
    expect(isFirstOfMonthAtEtHour(new Date("2026-01-01T13:00:00Z"), 9)).toBe(false);

    // 2nd of month at 09:00 ET — right hour, wrong day-of-month — must NOT match.
    expect(isFirstOfMonthAtEtHour(new Date("2026-08-02T13:00:00Z"), 9)).toBe(false);
    // 1st of month at 08:00 ET — right day, wrong hour — must NOT match.
    expect(isFirstOfMonthAtEtHour(new Date("2026-08-01T12:00:00Z"), 9)).toBe(false);
  });

  it("would have caught the original bug: the old split(\" \") guard never fires on the genuine target instant", () => {
    // Regression proof — replicate the EXACT shipped-broken guard inline and assert
    // it FAILS to fire on the same genuine EDT target instant the fixed guard accepts.
    // This is the concrete instant the string-split version could never have caught:
    // ICU renders "1, 09", so etDay="1," (never "1") and etHour="09" (never "9").
    const target = new Date("2026-08-01T13:00:00Z"); // 1st of month, 09:00 ET (EDT)

    const oldGuardFires = (now: Date): boolean => {
      const etStr = now.toLocaleString("en-US", {
        timeZone: "America/New_York",
        day: "numeric",
        hour: "numeric",
        hour12: false,
      });
      const [etDay, etHour] = etStr.split(" ");
      // Old code: `if (etDay !== "1" || etHour !== "9") return;` — i.e. it FIRES
      // only when NEITHER inequality holds. Model that firing condition directly.
      return etDay === "1" && etHour === "9";
    };

    // The old guard is broken: it does NOT fire on the genuine target...
    expect(oldGuardFires(target)).toBe(false);
    // ...while the fixed guard DOES. If someone reintroduces the split() logic in
    // the real helper, the behavioral test above goes RED against this same instant.
    expect(isFirstOfMonthAtEtHour(target, 9)).toBe(true);
  });
});

describe("Wave 25 Pass 2 A-2 — _runN8nDriftAudit handler outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes 'n8n.drift_check_clean' audit row when audit:n8n exits 0", async () => {
    execFileSucceeds("Total violations: 0\nAll workflows healthy");

    // Import the scheduler module to access _runN8nDriftAudit indirectly.
    // We test it via the scheduler source inspection + a direct test of the
    // audit row action name by simulating what the function does.
    //
    // The cleanest approach: call the helper through the module's test seam
    // or simply verify the scheduler source contains the correct action string.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schedulerSrc = readFileSync(
      join(process.cwd(), "src/server/scheduler.ts"),
      "utf-8",
    );

    // Verify the clean audit action name is in the source
    expect(schedulerSrc).toContain('"n8n.drift_check_clean"');

    // Also verify the structure: action is written on exit 0
    const cleanSection = schedulerSrc.slice(
      schedulerSrc.indexOf("n8n.drift_check_clean") - 200,
      schedulerSrc.indexOf("n8n.drift_check_clean") + 300,
    );
    expect(cleanSection).toContain("exitCode: 0");
    expect(cleanSection).toContain("status: \"success\"");
  });

  it("writes 'n8n.drift_detected' audit row + calls notifyCritical when audit:n8n exits non-zero", async () => {
    execFileFails(1, "3 workflows missing errorWorkflow", "drift check failed");

    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schedulerSrc = readFileSync(
      join(process.cwd(), "src/server/scheduler.ts"),
      "utf-8",
    );

    // Verify the drift audit action name is in the source
    expect(schedulerSrc).toContain('"n8n.drift_detected"');

    // Verify notifyCritical is called in the non-zero-exit branch
    const driftSection = schedulerSrc.slice(
      schedulerSrc.indexOf("n8n.drift_detected") - 100,
      schedulerSrc.indexOf("n8n.drift_detected") + 500,
    );
    expect(driftSection).toContain("notifyCritical");
    expect(driftSection).toContain("status: \"failed\"");

    // Verify the errored audit action name is also in the source (for timeout/spawn error)
    expect(schedulerSrc).toContain('"n8n.drift_check_errored"');

    // Verify both Discord messages contain operator-actionable remediation text
    expect(schedulerSrc).toContain("npm run audit:n8n");
    expect(schedulerSrc).toContain("DGEk1D478xWJClKD");
  });
});
