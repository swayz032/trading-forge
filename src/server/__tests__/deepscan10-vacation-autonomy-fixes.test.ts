/**
 * Deep-scan #10 fix wave — Track N: vacation autonomy + silent-degradation alerting.
 *
 * FIX 1 (db-backup-service): DB_BACKUP_ENABLED=false emits audit row +
 *   Discord WARN on first occurrence and at most once per 24h.
 *
 * FIX 2 (boot-migration-runner): file-based crash-loop counter +
 *   shouldAlertBootFailure() pure cadence function (1, 3, every 10th).
 *
 * FIX 3 (scheduler — weekend auto-resume cron): verified via source scan
 *   (scheduler.ts must register a weekend cron that calls
 *   maybeAutoResumeAfterReboot and a boot-time invocation).
 *
 * FIX 4 (scheduler — databento refresh): verified via source scan
 *   (withRetry exhaustion emits databento_refresh.failed + Discord WARN;
 *   pipelineGate skip emits databento_refresh.skipped_pipeline_paused).
 *
 * FIX 5 (market-internals-service): WS disconnected → audit row
 *   market_internals.ws_disconnected (1h dedupe); reconnected → audit row
 *   market_internals.ws_reconnected with outage duration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Module-level mocks for db-backup-service and market-internals-service ────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    execute: vi.fn(() => Promise.resolve([])),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
  },
  client: { end: vi.fn() },
}));

const notifyMocks = vi.hoisted(() => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../services/notification-service.js", () => notifyMocks);

const auditMocks = vi.hoisted(() => ({
  insertAuditRow: vi.fn(async (_row?: unknown) => undefined),
  insertAuditRowSafe: vi.fn(async (_row?: unknown) => true),
}));
vi.mock("../lib/audit-log-helper.js", () => auditMocks);

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn(
    (technical: string, _plain: string, _action: string) => technical,
  ),
}));

// Heavy db-backup-service dependencies that aren't needed for the disabled-path
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn(),
  HeadBucketCommand: vi.fn(),
}));

// ─── FIX 2: shouldAlertBootFailure — pure function, no mocks needed ───────────

describe("FIX 2 — shouldAlertBootFailure cadence (pure)", () => {
  it("fires on attempt 1 (first failure always escalates)", async () => {
    const { shouldAlertBootFailure } = await import("../lib/boot-migration-runner.js");
    expect(shouldAlertBootFailure(1)).toBe(true);
  });

  it("does NOT fire on attempt 2", async () => {
    const { shouldAlertBootFailure } = await import("../lib/boot-migration-runner.js");
    expect(shouldAlertBootFailure(2)).toBe(false);
  });

  it("fires on attempt 3 (confirmation escalation)", async () => {
    const { shouldAlertBootFailure } = await import("../lib/boot-migration-runner.js");
    expect(shouldAlertBootFailure(3)).toBe(true);
  });

  it("does NOT fire on attempt 4-9", async () => {
    const { shouldAlertBootFailure } = await import("../lib/boot-migration-runner.js");
    for (const n of [4, 5, 6, 7, 8, 9]) {
      expect(shouldAlertBootFailure(n), `attempt ${n}`).toBe(false);
    }
  });

  it("fires on attempt 10 (every-10th rule)", async () => {
    const { shouldAlertBootFailure } = await import("../lib/boot-migration-runner.js");
    expect(shouldAlertBootFailure(10)).toBe(true);
  });

  it("fires on attempt 20 (every-10th rule)", async () => {
    const { shouldAlertBootFailure } = await import("../lib/boot-migration-runner.js");
    expect(shouldAlertBootFailure(20)).toBe(true);
  });

  it("does NOT fire on attempt 11-19", async () => {
    const { shouldAlertBootFailure } = await import("../lib/boot-migration-runner.js");
    for (const n of [11, 12, 13, 14, 15, 16, 17, 18, 19]) {
      expect(shouldAlertBootFailure(n), `attempt ${n}`).toBe(false);
    }
  });
});

// ─── FIX 1: db-backup disabled path emits audit + Discord WARN ───────────────

describe("FIX 1 — db-backup disabled-path audit + Discord WARN", () => {
  const ENV_KEYS = [
    "DB_BACKUP_ENABLED",
    "DB_BACKUP_LOCAL_DIR",
    "DATABASE_URL",
    "PG_DUMP_PATH",
  ];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
    }
    // Reset mock call histories
    auditMocks.insertAuditRowSafe.mockClear();
    notifyMocks.notifyWarning.mockClear();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.resetModules();
  });

  it("emits audit row with action=db_backup.disabled_by_env and status=warning when DB_BACKUP_ENABLED=false", async () => {
    process.env["DB_BACKUP_ENABLED"] = "false";
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();
    expect(result.status).toBe("disabled");

    // Wait for void async audit row
    await new Promise((r) => setTimeout(r, 20));

    expect(auditMocks.insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "db_backup.disabled_by_env",
        status: "warning",
        entityType: "system",
      }),
    );
  });

  it("emits Discord WARN with family postscript when DB_BACKUP_ENABLED=false", async () => {
    process.env["DB_BACKUP_ENABLED"] = "false";
    const { runDbBackup } = await import("../services/db-backup-service.js");
    await runDbBackup();

    await new Promise((r) => setTimeout(r, 20));

    expect(notifyMocks.notifyWarning).toHaveBeenCalledTimes(1);
    expect(notifyMocks.notifyWarning.mock.calls[0]?.[0]).toMatch(/Disabled/i);
  });

  it("emits Discord WARN for DB_BACKUP_ENABLED=0 too", async () => {
    process.env["DB_BACKUP_ENABLED"] = "0";
    const { runDbBackup } = await import("../services/db-backup-service.js");
    await runDbBackup();

    await new Promise((r) => setTimeout(r, 20));

    expect(notifyMocks.notifyWarning).toHaveBeenCalledTimes(1);
  });

  it("dedupes: second call within 24h does NOT emit audit + Discord again", async () => {
    process.env["DB_BACKUP_ENABLED"] = "false";
    const { runDbBackup } = await import("../services/db-backup-service.js");

    await runDbBackup();
    await new Promise((r) => setTimeout(r, 20));
    const callsAfterFirst = notifyMocks.notifyWarning.mock.calls.length;

    await runDbBackup();
    await new Promise((r) => setTimeout(r, 20));
    const callsAfterSecond = notifyMocks.notifyWarning.mock.calls.length;

    expect(callsAfterFirst).toBe(1);
    expect(callsAfterSecond).toBe(1); // no additional call
    expect(auditMocks.insertAuditRowSafe).toHaveBeenCalledTimes(1);
  });
});

// ─── FIX 5: market-internals WS disconnect/reconnect audit rows ───────────────

describe("FIX 5 — market-internals WS disconnect/reconnect audit rows", () => {
  // We test module-level state by resetting between sub-tests
  beforeEach(() => {
    auditMocks.insertAuditRowSafe.mockClear();
    auditMocks.insertAuditRow.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("__resetInternalsForTests resets WS observability state (exported seam)", async () => {
    // Verify the reset function exists and can be called without throwing
    const { __resetInternalsForTests } = await import("../services/market-internals-service.js");
    expect(() => __resetInternalsForTests()).not.toThrow();
  });
});

// ─── FIX 3 + FIX 4: source-level signal verification ────────────────────────
// These fixes live in scheduler.ts which is too large to unit test without
// full server bootstrapping. We verify the signals are wired via source scan.

describe("FIX 3 — weekend auto-resume cron registered in scheduler.ts", () => {
  const _filename = fileURLToPath(import.meta.url);
  const schedulerSrc = path.resolve(
    path.dirname(_filename),
    "..",
    "scheduler.ts",
  );

  it("scheduler.ts registers a weekend cron ('0,6' day field) for maybeAutoResumeAfterReboot", () => {
    const src = fs.readFileSync(schedulerSrc, "utf8");
    // The weekend cron must target Sun(0)/Sat(6) and call maybeAutoResumeAfterReboot.
    // Accept BOTH the raw `cron.schedule(...)` and the UTC-pinned `scheduleUtc(...)` wrapper —
    // scheduler.ts migrated all crons to scheduleUtc() (a thin cron.schedule wrapper); the
    // weekend job now reads `scheduleUtc("0 * * * 0,6", ...)` (scheduler.ts:1611).
    expect(src).toMatch(/(?:cron\.schedule|scheduleUtc)\([^)]*0,6[^)]*\)/);
    expect(src).toMatch(/maybeAutoResumeAfterReboot/);
  });

  it("scheduler.ts includes a boot-time auto-resume invocation", () => {
    const src = fs.readFileSync(schedulerSrc, "utf8");
    // Boot-time: dynamic import of windows-health-check-service + maybeAutoResumeAfterReboot
    expect(src).toMatch(/boot-time auto-resume/i);
    expect(src).toMatch(/maybeAutoResumeAfterReboot/);
  });
});

describe("FIX 4 — databento refresh failure signals in scheduler.ts", () => {
  const _filename = fileURLToPath(import.meta.url);
  const schedulerSrc = path.resolve(
    path.dirname(_filename),
    "..",
    "scheduler.ts",
  );

  it("withRetry exhaustion path emits databento_refresh.failed audit row", () => {
    const src = fs.readFileSync(schedulerSrc, "utf8");
    expect(src).toContain("databento_refresh.failed");
    expect(src).toContain("status: \"error\"");
  });

  it("withRetry exhaustion path fires Discord WARN for databento job", () => {
    const src = fs.readFileSync(schedulerSrc, "utf8");
    // notifyWarning called inside the databento-specific exhaustion block
    expect(src).toContain("Databento Weekly Refresh Failed");
  });

  it("pipelineGate skip path emits databento_refresh.skipped_pipeline_paused audit row", () => {
    const src = fs.readFileSync(schedulerSrc, "utf8");
    expect(src).toContain("databento_refresh.skipped_pipeline_paused");
    expect(src).toContain("pipeline_not_active");
  });

  it("pipeline-paused skip audit uses daily dedupe (_databentoSkipLastAuditDay)", () => {
    const src = fs.readFileSync(schedulerSrc, "utf8");
    expect(src).toContain("_databentoSkipLastAuditDay");
  });
});

describe("FIX 5 source verification — WS signals wired in market-internals-service.ts", () => {
  const _filename = fileURLToPath(import.meta.url);
  const misSrc = path.resolve(
    path.dirname(_filename),
    "..",
    "services",
    "market-internals-service.ts",
  );

  it("disconnected handler emits market_internals.ws_disconnected audit row", () => {
    const src = fs.readFileSync(misSrc, "utf8");
    expect(src).toContain("market_internals.ws_disconnected");
    expect(src).toContain("status: \"warning\"");
  });

  it("connected handler emits market_internals.ws_reconnected audit row with outageDurationMs", () => {
    const src = fs.readFileSync(misSrc, "utf8");
    expect(src).toContain("market_internals.ws_reconnected");
    expect(src).toContain("outageDurationMs");
  });

  it("disconnect handler has 1h dedupe guard (_wsDisconnectLastAuditAt)", () => {
    const src = fs.readFileSync(misSrc, "utf8");
    expect(src).toContain("_wsDisconnectLastAuditAt");
    expect(src).toContain("_WS_AUDIT_COOLDOWN_MS");
  });

  it("reconnect audit resets _wsDisconnectStartedAt so next disconnect gets audited", () => {
    const src = fs.readFileSync(misSrc, "utf8");
    // After reconnect, both state vars must be cleared
    expect(src).toContain("_wsDisconnectStartedAt = null");
    expect(src).toContain("_wsDisconnectLastAuditAt = null");
  });
});

describe("FIX 1 source verification — db-backup-service.ts", () => {
  const _filename = fileURLToPath(import.meta.url);
  const src = fs.readFileSync(
    path.resolve(path.dirname(_filename), "..", "services", "db-backup-service.ts"),
    "utf8",
  );

  it("imports notifyWarning from notification-service", () => {
    expect(src).toContain("notifyWarning");
  });

  it("has 24h cooldown constant for disabled-alert dedupe", () => {
    expect(src).toContain("_DISABLED_ALERT_COOLDOWN_MS");
    expect(src).toContain("24 * 60 * 60 * 1000");
  });

  it("emits db_backup.disabled_by_env with status warning", () => {
    expect(src).toContain("db_backup.disabled_by_env");
    expect(src).toContain("status: \"warning\"");
  });
});

describe("FIX 2 source verification — boot-migration-runner.ts", () => {
  const _filename = fileURLToPath(import.meta.url);
  const src = fs.readFileSync(
    path.resolve(path.dirname(_filename), "..", "lib", "boot-migration-runner.ts"),
    "utf8",
  );

  it("has shouldAlertBootFailure exported for testability", () => {
    expect(src).toContain("export function shouldAlertBootFailure");
  });

  it("has _bootFailureCounterPath under bin/ directory", () => {
    expect(src).toContain("boot-migration-failures.json");
    expect(src).toContain('\"bin\"');
  });

  it("resets failure counter on successful boot", () => {
    expect(src).toContain("_resetBootFailureCount()");
    // Should appear at both success paths (no-pending and all-applied)
    const matches = src.split("_resetBootFailureCount()").length - 1;
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  it("increments counter and fires crash-loop escalation before the throw", () => {
    expect(src).toContain("Migration Crash-Loop");
    expect(src).toContain("_writeBootFailureCount");
    expect(src).toContain("shouldAlertBootFailure(_failureAttempt)");
  });
});
