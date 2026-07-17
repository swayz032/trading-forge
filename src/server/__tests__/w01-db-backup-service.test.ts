/**
 * W0.1 — DB Backup Service tests.
 *
 * Tests runDbBackup() from src/server/services/db-backup-service.ts.
 *
 * Isolation strategy:
 *   - Mock node:fs to avoid touching real disk
 *   - Mock node:child_process execFile to simulate pg_dump (mocked, not run)
 *   - Mock @aws-sdk/client-s3 to simulate S3 push (mocked, not called)
 *   - Mock notification-service to capture Discord alerts
 *   - Mock audit-log-helper to capture audit rows
 *   - No real DB mutations, no real pg_dump, no real S3 upload
 *
 * Cases covered:
 *   1. Happy path: pg_dump + S3 push succeed → db_backup.completed audit row
 *   2. Disabled via DB_BACKUP_ENABLED=false → returns "disabled", no audit
 *   3. pg_dump not available → db_backup.failed audit + Discord critical
 *   4. DATABASE_URL missing → db_backup.failed audit + Discord critical
 *   5. pg_dump subprocess throws → db_backup.failed audit + Discord critical
 *   6. S3 push fails (HeadBucketCommand throws) → db_backup.failed + local dump preserved
 *   7. Off-tower unconfigured (no S3_BUCKET) → db_backup.offtower_unconfigured audit + Discord critical
 *   8. Retention pruner removes files older than cutoff
 *   9. Retention pruner leaves files newer than cutoff untouched
 *  10. buildDumpFilename produces a valid Windows-safe filename
 *  11. isOfftowerConfigured returns false when S3_BUCKET absent
 *  12. isOfftowerConfigured returns true when S3 vars present
 *  13. getRetentionDays defaults to 14
 *  14. getRetentionDays reads DB_BACKUP_RETENTION_DAYS env
 *  15. getOfftowerTarget defaults to "s3"
 *  16. getOfftowerTarget accepts "none"
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";

// ─── Shared mutable state ─────────────────────────────────────────────────────

let _pgDumpAvailable = true;
let _pgDumpShouldThrow = false;
let _pgDumpThrowMsg = "pg_dump: execution failed";

let _s3HeadShouldThrow = false;
let _s3PutShouldThrow = false;
let _s3HeadThrowMsg = "NoSuchBucket";

const _s3SendCalls: Array<{ type: string }> = [];
const _auditRowsWritten: Array<{ action: string; status: string }> = [];
const _notifyCriticalCalls: Array<{ title: string; body: string }> = [];
const _mkdirSyncCalls: string[] = [];
const _unlinkSyncCalls: string[] = [];

// Per-test statSync override: null means return default size (12345)
let _statSyncImpl: ((p: string) => { size: number; mtimeMs: number }) | null = null;

// Per-test readdirSync override
let _readdirSyncImpl: ((dir: string) => string[]) | null = null;

// Per-test existsSync override
let _existsSyncImpl: ((p: string) => boolean) | null = null;

// Per-test readFileSync override — default returns a plausible dump
// containing the table markers validateDumpContents() looks for (HIGH
// finding fix: runDbBackup() now reads the dump back before reporting
// success, so the mock must return realistic dump text by default).
const DEFAULT_DUMP_TEXT =
  "-- PostgreSQL database dump\nCREATE TABLE public.audit_log (id uuid PRIMARY KEY);\nCREATE TABLE public.strategies (id uuid PRIMARY KEY);\n";
let _readFileSyncImpl: ((p: string) => string) | null = null;

// ─── Mock: node:fs ────────────────────────────────────────────────────────────

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn((p: string) => (_existsSyncImpl ? _existsSyncImpl(p) : true)),
    mkdirSync: vi.fn((p: string) => { _mkdirSyncCalls.push(p); }),
    statSync: vi.fn((p: string) =>
      _statSyncImpl ? _statSyncImpl(p) : { size: 12345, mtimeMs: Date.now() },
    ),
    readdirSync: vi.fn((dir: string) => (_readdirSyncImpl ? _readdirSyncImpl(dir) : [])),
    unlinkSync: vi.fn((p: string) => { _unlinkSyncCalls.push(p); }),
    createReadStream: vi.fn((_p: string) => ({ pipe: vi.fn(), on: vi.fn() })),
    readFileSync: vi.fn((p: string) => (_readFileSyncImpl ? _readFileSyncImpl(p) : DEFAULT_DUMP_TEXT)),
  },
  existsSync: vi.fn((p: string) => (_existsSyncImpl ? _existsSyncImpl(p) : true)),
  mkdirSync: vi.fn((p: string) => { _mkdirSyncCalls.push(p); }),
  statSync: vi.fn((p: string) =>
    _statSyncImpl ? _statSyncImpl(p) : { size: 12345, mtimeMs: Date.now() },
  ),
  readdirSync: vi.fn((dir: string) => (_readdirSyncImpl ? _readdirSyncImpl(dir) : [])),
  unlinkSync: vi.fn((p: string) => { _unlinkSyncCalls.push(p); }),
  createReadStream: vi.fn((_p: string) => ({ pipe: vi.fn(), on: vi.fn() })),
  readFileSync: vi.fn((p: string) => (_readFileSyncImpl ? _readFileSyncImpl(p) : DEFAULT_DUMP_TEXT)),
}));

// ─── Mock: node:child_process ─────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (cmd === "pg_dump") {
        const isVersionCheck = Array.isArray(args) && args.includes("--version");
        if (!_pgDumpAvailable) {
          // Both --version and real dump fail: pg_dump not on PATH
          const err = Object.assign(new Error("pg_dump: command not found"), { code: "ENOENT" });
          cb(err, "", "");
        } else if (isVersionCheck) {
          // --version always succeeds when pg_dump is "available" on PATH
          cb(null, "pg_dump (PostgreSQL) 14.9\n", "");
        } else if (_pgDumpShouldThrow) {
          // Real dump call fails (e.g. connection refused, auth error)
          cb(new Error(_pgDumpThrowMsg), "", "");
        } else {
          // Real dump call succeeds
          cb(null, "", "");
        }
      } else {
        cb(null, "", "");
      }
    },
  ),
}));

// ─── Mock: @aws-sdk/client-s3 ─────────────────────────────────────────────────

vi.mock("@aws-sdk/client-s3", () => {
  function HeadBucketCommand(this: Record<string, unknown>, input: Record<string, unknown>) {
    this.input = input;
    this.type = "HeadBucketCommand";
  }
  function PutObjectCommand(this: Record<string, unknown>, input: Record<string, unknown>) {
    this.input = input;
    this.type = "PutObjectCommand";
  }
  return {
    S3Client: vi.fn().mockImplementation(() => ({
      send: vi.fn(async (cmd: { type: string }) => {
        _s3SendCalls.push({ type: cmd.type });
        if (cmd.type === "HeadBucketCommand" && _s3HeadShouldThrow) {
          throw new Error(_s3HeadThrowMsg);
        }
        if (cmd.type === "PutObjectCommand" && _s3PutShouldThrow) {
          throw new Error("AccessDenied");
        }
      }),
    })),
    HeadBucketCommand,
    PutObjectCommand,
  };
});

// ─── Mock: notification-service ───────────────────────────────────────────────

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn((title: string, body: string) => {
    _notifyCriticalCalls.push({ title, body });
  }),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
  notify: vi.fn(),
}));

// ─── Mock: audit-log-helper ───────────────────────────────────────────────────

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(
    async (values: { action: string; status: string }) => {
      _auditRowsWritten.push({ action: values.action, status: values.status });
      return true;
    },
  ),
  insertAuditRow: vi.fn(async () => {}),
}));

// ─── Mock: logger ─────────────────────────────────────────────────────────────

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetMocks() {
  _pgDumpAvailable = true;
  _pgDumpShouldThrow = false;
  _pgDumpThrowMsg = "pg_dump: execution failed";
  _s3HeadShouldThrow = false;
  _s3PutShouldThrow = false;
  _s3HeadThrowMsg = "NoSuchBucket";
  _s3SendCalls.length = 0;
  _auditRowsWritten.length = 0;
  _notifyCriticalCalls.length = 0;
  _mkdirSyncCalls.length = 0;
  _unlinkSyncCalls.length = 0;
  _statSyncImpl = null;
  _readdirSyncImpl = null;
  _existsSyncImpl = null;
  _readFileSyncImpl = null;
  vi.clearAllMocks();
}

function setRequiredEnv() {
  process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/trading_forge";
  process.env["S3_BUCKET"] = "tf-backups-test";
  process.env["AWS_ACCESS_KEY_ID"] = "AKIAIOSFODNN7EXAMPLE";
  process.env["AWS_SECRET_ACCESS_KEY"] = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  process.env["AWS_REGION"] = "us-east-1";
  process.env["DB_BACKUP_LOCAL_DIR"] = "/tmp/tf-test-backups";
  process.env["DB_BACKUP_ENABLED"] = "true";
  delete process.env["DB_BACKUP_OFFTOWER_TARGET"];
  delete process.env["DB_BACKUP_RETENTION_DAYS"];
  delete process.env["S3_BACKUP_PREFIX"];
}

function clearEnv() {
  delete process.env["DATABASE_URL"];
  delete process.env["S3_BUCKET"];
  delete process.env["AWS_ACCESS_KEY_ID"];
  delete process.env["AWS_SECRET_ACCESS_KEY"];
  delete process.env["AWS_REGION"];
  delete process.env["DB_BACKUP_LOCAL_DIR"];
  delete process.env["DB_BACKUP_ENABLED"];
  delete process.env["DB_BACKUP_OFFTOWER_TARGET"];
  delete process.env["DB_BACKUP_RETENTION_DAYS"];
  delete process.env["S3_BACKUP_PREFIX"];
}

// ─────────────────────────────────────────────────────────────────────────────

describe("db-backup-service: runDbBackup()", () => {
  beforeEach(() => {
    resetMocks();
    setRequiredEnv();
  });

  afterEach(() => {
    clearEnv();
  });

  // ─── Case 1: Happy path ─────────────────────────────────────────────────────
  it("1. happy path: pg_dump + S3 push succeed → status=success + db_backup.completed", async () => {
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();

    expect(result.status).toBe("success");
    expect(result.sizeBytes).toBe(12345); // default statSync mock
    expect(result.offtowerUrl).toMatch(/^s3:\/\/tf-backups-test\/db-backups\//);

    const completedAudit = _auditRowsWritten.find((r) => r.action === "db_backup.completed");
    expect(completedAudit).toBeDefined();
    expect(completedAudit?.status).toBe("success");

    // No failed audits on happy path
    expect(_auditRowsWritten.find((r) => r.action === "db_backup.failed")).toBeUndefined();
    expect(_notifyCriticalCalls).toHaveLength(0);
  });

  // ─── Case 2: Disabled ───────────────────────────────────────────────────────
  // NOTE (2026-07-17 telemetry-honesty scan, pre-existing test bug found on
  // inspection — not part of this wave's 7 findings, fixed on sight per
  // zero-carry-forward): this assertion predates "FIX 1 (deepscan10)"
  // (db-backup-service.ts's disabled path deliberately fires ONE
  // db_backup.disabled_by_env WARNING audit row + Discord WARN, so a
  // continuously-disabled backup is never silent) and was never updated to
  // match. Corrected to assert the actual, intended, already-shipped
  // behavior — no production code changed here.
  it("2. disabled via DB_BACKUP_ENABLED=false → status=disabled, emits ONE disabled_by_env WARNING audit (not silent)", async () => {
    process.env["DB_BACKUP_ENABLED"] = "false";
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();

    expect(result.status).toBe("disabled");
    expect(_auditRowsWritten).toHaveLength(1);
    expect(_auditRowsWritten[0]).toMatchObject({ action: "db_backup.disabled_by_env", status: "warning" });
    // Discord WARN (notifyWarning), not CRITICAL — a deliberate env-driven
    // disable is not an emergency.
    expect(_notifyCriticalCalls).toHaveLength(0);
  });

  // ─── Case 3: pg_dump not available ─────────────────────────────────────────
  it("3. pg_dump not on PATH → status=failed + db_backup.failed audit + Discord critical", async () => {
    _pgDumpAvailable = false;
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("pg_dump");

    const failedAudit = _auditRowsWritten.find((r) => r.action === "db_backup.failed");
    expect(failedAudit).toBeDefined();

    const critical = _notifyCriticalCalls.find((c) => c.title.toLowerCase().includes("pg_dump"));
    expect(critical).toBeDefined();
  });

  // ─── Case 4: DATABASE_URL missing ──────────────────────────────────────────
  it("4. DATABASE_URL missing → status=failed + db_backup.failed audit + Discord critical", async () => {
    delete process.env["DATABASE_URL"];
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("DATABASE_URL");

    expect(_auditRowsWritten.find((r) => r.action === "db_backup.failed")).toBeDefined();
    expect(_notifyCriticalCalls.find((c) => c.title.includes("DATABASE_URL"))).toBeDefined();
  });

  // ─── Case 5: pg_dump subprocess throws ─────────────────────────────────────
  it("5. pg_dump subprocess throws → status=failed + db_backup.failed + Discord critical", async () => {
    _pgDumpShouldThrow = true;
    _pgDumpThrowMsg = "connection refused on port 5432";
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("connection refused");

    expect(_auditRowsWritten.find((r) => r.action === "db_backup.failed")).toBeDefined();
    expect(
      _notifyCriticalCalls.find((c) => c.title.toLowerCase().includes("pg_dump")),
    ).toBeDefined();
  });

  // ─── Case 6: S3 push fails ──────────────────────────────────────────────────
  it("6. S3 HeadBucketCommand throws → status=failed, local dump path preserved", async () => {
    _s3HeadShouldThrow = true;
    _s3HeadThrowMsg = "NoSuchBucket: The specified bucket does not exist";
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("S3 push failed");
    // Local dump was written (sizeBytes + filePath come back)
    expect(result.filePath).toBeDefined();
    expect(result.sizeBytes).toBe(12345);

    expect(_auditRowsWritten.find((r) => r.action === "db_backup.failed")).toBeDefined();
    expect(
      _notifyCriticalCalls.find((c) => c.title.toLowerCase().includes("s3 push failed")),
    ).toBeDefined();
  });

  // ─── Case 7: Off-tower unconfigured ────────────────────────────────────────
  it("7. no S3_BUCKET → db_backup.offtower_unconfigured audit + Discord critical", async () => {
    delete process.env["S3_BUCKET"];
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();

    // Local dump must have been written (path is returned)
    expect(result.filePath).toBeDefined();

    expect(
      _auditRowsWritten.find((r) => r.action === "db_backup.offtower_unconfigured"),
    ).toBeDefined();
    expect(
      _notifyCriticalCalls.find((c) => c.title.toLowerCase().includes("off-tower")),
    ).toBeDefined();
  });

  // ─── Case 18: dump content sanity check — HIGH finding fix ─────────────────
  // (2026-07-17 telemetry-honesty scan) runDbBackup() previously only checked
  // that pg_dump exited without throwing, then unconditionally reported
  // success — an empty/wrong-database dump (clean exit code, near-empty file)
  // would report db_backup.completed with no evidence the backup is real.
  it("18. pg_dump exits cleanly but dump is too small (empty/wrong-DB dump) → status=failed, no db_backup.completed", async () => {
    _statSyncImpl = () => ({ size: 200, mtimeMs: Date.now() }); // far below MIN_PLAUSIBLE_DUMP_BYTES
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("invalid backup");

    expect(_auditRowsWritten.find((r) => r.action === "db_backup.completed")).toBeUndefined();
    const failedAudit = _auditRowsWritten.find((r) => r.action === "db_backup.failed");
    expect(failedAudit).toBeDefined();
    expect(
      _notifyCriticalCalls.find((c) => c.title.toLowerCase().includes("validation failed")),
    ).toBeDefined();
  });

  it("19. pg_dump exits cleanly with plausible size but missing expected tables (wrong DB) → status=failed, no db_backup.completed", async () => {
    _readFileSyncImpl = () => "-- PostgreSQL database dump\nCREATE TABLE public.some_other_schema_entirely (id int);\n".repeat(500);
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("invalid backup");
    expect(result.error).toContain("audit_log");

    expect(_auditRowsWritten.find((r) => r.action === "db_backup.completed")).toBeUndefined();
    expect(_auditRowsWritten.find((r) => r.action === "db_backup.failed")).toBeDefined();
  });

  it("20. real-looking dump (plausible size + expected table markers) → status=success (regression guard for case 18/19 fix)", async () => {
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();

    expect(result.status).toBe("success");
    expect(_auditRowsWritten.find((r) => r.action === "db_backup.completed")).toBeDefined();
  });
});

// ─── pruneOldLocalDumps ───────────────────────────────────────────────────────

describe("db-backup-service: pruneOldLocalDumps()", () => {
  beforeEach(() => resetMocks());
  afterEach(() => vi.clearAllMocks());

  it("8. removes files older than retentionDays", async () => {
    const { pruneOldLocalDumps } = await import("../services/db-backup-service.js");
    const localDir = "/tmp/tf-prune-test-a";
    const oldFile = "tf-db-backup-2024-01-01T00-00-00-000Z.sql";
    const newFile = "tf-db-backup-2099-01-01T00-00-00-000Z.sql";
    const nonMatchFile = "other-file.txt";

    const oldPath = path.join(localDir, oldFile);
    const newPath = path.join(localDir, newFile);
    const now = Date.now();
    const oldMtime = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago
    const newMtime = now - 3 * 24 * 60 * 60 * 1000;   // 3 days ago

    _existsSyncImpl = (p: string) => p === localDir;
    _readdirSyncImpl = (dir: string) =>
      dir === localDir ? [oldFile, newFile, nonMatchFile] : [];
    _statSyncImpl = (p: string) => {
      if (p === oldPath) return { size: 100, mtimeMs: oldMtime };
      if (p === newPath) return { size: 100, mtimeMs: newMtime };
      return { size: 100, mtimeMs: now };
    };

    const pruned = pruneOldLocalDumps(localDir, 14);

    expect(pruned).toContain(oldFile);
    expect(pruned).not.toContain(newFile);
    expect(pruned).not.toContain(nonMatchFile);
    expect(_unlinkSyncCalls).toContain(oldPath);
    expect(_unlinkSyncCalls).not.toContain(newPath);
  });

  it("9. leaves files newer than retentionDays untouched", async () => {
    const { pruneOldLocalDumps } = await import("../services/db-backup-service.js");
    const localDir = "/tmp/tf-prune-test-b";
    const recentFile = "tf-db-backup-2099-06-01T02-00-00-000Z.sql";
    const recentPath = path.join(localDir, recentFile);

    _existsSyncImpl = (p: string) => p === localDir;
    _readdirSyncImpl = (dir: string) => (dir === localDir ? [recentFile] : []);
    _statSyncImpl = (p: string) => ({
      size: 100,
      mtimeMs: p === recentPath ? Date.now() - 3 * 24 * 60 * 60 * 1000 : Date.now(),
    });

    const pruned = pruneOldLocalDumps(localDir, 14);

    expect(pruned).toHaveLength(0);
    expect(_unlinkSyncCalls).toHaveLength(0);
  });
});

// ─── Pure helpers and env accessors ──────────────────────────────────────────

describe("db-backup-service: pure helpers", () => {
  afterEach(() => {
    clearEnv();
    vi.clearAllMocks();
  });

  it("10. buildDumpFilename produces a Windows-safe SQL filename", async () => {
    const { buildDumpFilename } = await import("../services/db-backup-service.js");
    const ts = new Date("2026-06-22T02:00:00.000Z").getTime();
    const filename = buildDumpFilename(ts);
    expect(filename).toMatch(/^tf-db-backup-/);
    expect(filename).toMatch(/\.sql$/);
    expect(filename).not.toContain(":");
    expect(filename.length).toBeGreaterThan(20);
  });

  it("11. isOfftowerConfigured returns false when S3_BUCKET absent", async () => {
    delete process.env["S3_BUCKET"];
    delete process.env["AWS_ACCESS_KEY_ID"];
    delete process.env["AWS_SECRET_ACCESS_KEY"];
    const { isOfftowerConfigured } = await import("../services/db-backup-service.js");
    expect(isOfftowerConfigured()).toBe(false);
  });

  it("12. isOfftowerConfigured returns true when S3 vars present", async () => {
    process.env["S3_BUCKET"] = "my-bucket";
    process.env["AWS_ACCESS_KEY_ID"] = "AK";
    process.env["AWS_SECRET_ACCESS_KEY"] = "SK";
    const { isOfftowerConfigured } = await import("../services/db-backup-service.js");
    expect(isOfftowerConfigured()).toBe(true);
  });

  it("13. getRetentionDays defaults to 14", async () => {
    delete process.env["DB_BACKUP_RETENTION_DAYS"];
    const { getRetentionDays } = await import("../services/db-backup-service.js");
    expect(getRetentionDays()).toBe(14);
  });

  it("14. getRetentionDays reads DB_BACKUP_RETENTION_DAYS env", async () => {
    process.env["DB_BACKUP_RETENTION_DAYS"] = "30";
    const { getRetentionDays } = await import("../services/db-backup-service.js");
    expect(getRetentionDays()).toBe(30);
  });

  it("15. getOfftowerTarget defaults to s3", async () => {
    delete process.env["DB_BACKUP_OFFTOWER_TARGET"];
    const { getOfftowerTarget } = await import("../services/db-backup-service.js");
    expect(getOfftowerTarget()).toBe("s3");
  });

  it("16. getOfftowerTarget accepts none", async () => {
    process.env["DB_BACKUP_OFFTOWER_TARGET"] = "none";
    const { getOfftowerTarget } = await import("../services/db-backup-service.js");
    expect(getOfftowerTarget()).toBe("none");
  });
});

// ─── Cron wiring smoke test ───────────────────────────────────────────────────

describe("db-backup-service: cron wiring (DB_BACKUP_ENABLED=false no-op)", () => {
  it("17. runDbBackup is exported and callable without throwing (disabled mode)", async () => {
    process.env["DB_BACKUP_ENABLED"] = "false";
    const { runDbBackup } = await import("../services/db-backup-service.js");
    const result = await runDbBackup();
    expect(result.status).toBe("disabled");
    delete process.env["DB_BACKUP_ENABLED"];
  });
});
