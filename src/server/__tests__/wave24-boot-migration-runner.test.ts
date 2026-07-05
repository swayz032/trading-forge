/**
 * Wave 24 Pass 2 Item #7 — Boot-time migration runner tests.
 *
 * Tests runPendingMigrations() from src/server/lib/boot-migration-runner.ts.
 *
 * Isolation strategy:
 *   - Mock db (drizzle) to avoid real PostgreSQL
 *   - Mock fs (journal reads, SQL file reads, existsSync)
 *   - Mock execFile to simulate pg_dump availability
 *   - Mock insertAuditRowSafe + logger to verify observability
 *   - No real DB mutations; verifies DB call shapes and failure paths
 *
 * Cases covered:
 *   1. No pending migrations → no-op (no audit row, no backup)
 *   2. Single pending → applies SQL, writes __drizzle_migrations row, emits audit
 *   3. Multi-pending → applies in journal order
 *   4. Failure midway → rollback, emits auto_apply_failed audit, fires Discord CRITICAL, throws
 *   5. pg_dump unavailable + ALLOW_NO_BACKUP=false → fails-closed before applying any migration
 *   6. pg_dump unavailable + ALLOW_NO_BACKUP=true → proceeds with information_schema backup
 *   7. Idempotent re-run (all already applied) → no-op
 *   8. BOOT_MIGRATION_ENABLED=false → skips entirely
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";

// ─── Mock: node:fs ─────────────────────────────────────────────────────────────
// We control which files "exist" and their content.

const mockFiles: Map<string, string> = new Map();
const mockExistingPaths: Set<string> = new Set();

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn((p: string) => mockExistingPaths.has(p)),
    readFileSync: vi.fn((p: string, _enc: string) => {
      const content = mockFiles.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    }),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn((p: string) => mockExistingPaths.has(p)),
  readFileSync: vi.fn((p: string, _enc: string) => {
    const content = mockFiles.get(p);
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// ─── Mock: node:child_process (pg_dump availability) ──────────────────────────

let _pgDumpAvailable = true;

vi.mock("node:child_process", () => ({
  execFile: vi.fn((cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
    if (cmd === "pg_dump") {
      if (_pgDumpAvailable) {
        cb(null, "pg_dump (PostgreSQL) 14.0\n", "");
      } else {
        const err = new Error("pg_dump: command not found");
        (err as NodeJS.ErrnoException).code = "ENOENT";
        cb(err, "", "");
      }
    } else {
      cb(null, "", "");
    }
  }),
}));

// ─── Mock: db ──────────────────────────────────────────────────────────────────

// Utility: extract the SQL string from a drizzle SQL object or plain string.
// Drizzle's sql`` tag creates objects with queryChunks: Array<{value: string[]}>
// where each chunk's value is an array of string literals (interpolated parts).
function extractSqlString(obj: unknown): string {
  if (typeof obj === "string") return obj;
  if (obj && typeof obj === "object") {
    // drizzle-orm sql`` object: { queryChunks: [{value: string[]},...] }
    const chunks = (obj as { queryChunks?: Array<{ value?: unknown; sql?: string }> }).queryChunks;
    if (Array.isArray(chunks)) {
      return chunks
        .map((c) => {
          // value is string[] (the raw SQL parts between interpolations)
          if (Array.isArray(c.value)) return (c.value as string[]).join("");
          if (typeof c.value === "string") return c.value;
          if (typeof c.sql === "string") return c.sql;
          return "";
        })
        .join(" ");
    }
    // Fallback: { sql: string }
    const sqlField = (obj as { sql?: string }).sql;
    if (typeof sqlField === "string") return sqlField;
  }
  return String(obj);
}

// Track the SQL statements executed and __drizzle_migrations inserts.
let _appliedWhens: Set<string> = new Set();
let _txStmts: string[] = [];
let _txMigrationsInserted: number[] = [];

const mockTxExecute = vi.fn(async (sqlObj: unknown) => {
  const rawSql = extractSqlString(sqlObj);
  if (rawSql.includes("INSERT INTO drizzle.__drizzle_migrations")) {
    // Extract the `when` value from the INSERT (second positional param)
    const match = rawSql.match(/VALUES\s*\([^,]+,\s*(\d+)\)/);
    if (match) _txMigrationsInserted.push(Number(match[1]));
  } else {
    _txStmts.push(rawSql);
  }
});

const mockTransaction = vi.fn(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
  _txStmts = [];
  _txMigrationsInserted = [];
  await fn({ execute: mockTxExecute });
});

// db.execute is used for bootstrap + applied query
const mockDbExecute = vi.fn(async (sqlObj: unknown) => {
  const rawSql = extractSqlString(sqlObj);

  if (rawSql.includes("created_at") && rawSql.includes("drizzle_migrations")) {
    // "SELECT created_at::text AS created_at FROM drizzle.__drizzle_migrations"
    return { rows: [..._appliedWhens].map((w) => ({ created_at: w })) };
  }
  if (rawSql.toLowerCase().includes("create") || rawSql.includes("__drizzle_migrations")) {
    return { rows: [] };
  }
  // information_schema queries (fallback backup) — return empty rows
  return { rows: [] };
});

vi.mock("../db/index.js", () => ({
  db: {
    execute: mockDbExecute,
    transaction: mockTransaction,
  },
}));

// ─── Mock: logger ─────────────────────────────────────────────────────────────

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../lib/logger.js", () => ({
  logger: mockLogger,
}));

// ─── Mock: audit-log-helper ───────────────────────────────────────────────────

const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(true);

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: mockInsertAuditRowSafe,
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock: fetch (Discord notifications) ─────────────────────────────────────

const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal("fetch", mockFetch);

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeJournal(entries: Array<{ idx: number; when: number; tag: string }>) {
  return JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries: entries.map((e) => ({
      ...e,
      version: "7",
      breakpoints: true,
    })),
  });
}

function makeMigrationSql(name: string) {
  return `-- ${name}\nCREATE TABLE IF NOT EXISTS "${name}" (id SERIAL PRIMARY KEY);\n--> statement-breakpoint\nCREATE INDEX IF NOT EXISTS "${name}_idx" ON "${name}" (id);\n`;
}

/** Resolve the journal path the runner would use (mirrors boot-migration-runner.ts logic). */
function getJournalPath() {
  // The runner resolves from: src/server/lib/ → up 3 → repo root → src/server/db/migrations/meta/_journal.json
  // In test context under vitest, we use an absolute path that we control via mockFiles.
  // We override MIGRATIONS_DIR env var to point to our mock path.
  return path.join(process.env.MIGRATIONS_DIR!, "meta", "_journal.json");
}

function getMigrationSqlPath(tag: string) {
  return path.join(process.env.MIGRATIONS_DIR!, `${tag}.sql`);
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const MOCK_MIGRATIONS_DIR = path.join(os.tmpdir(), "tf-test-migrations");
const MOCK_BACKUP_DIR = path.join(os.tmpdir(), "tf-test-backups");

beforeEach(() => {
  vi.clearAllMocks();
  mockFiles.clear();
  mockExistingPaths.clear();
  _appliedWhens = new Set();
  _txStmts = [];
  _txMigrationsInserted = [];
  _pgDumpAvailable = true;

  // Restore env
  process.env.BOOT_MIGRATION_ENABLED = "true";
  process.env.BOOT_MIGRATION_ALLOW_NO_BACKUP = "false";
  process.env.BOOT_MIGRATION_BACKUP_DIR = MOCK_BACKUP_DIR;
  process.env.BOOT_MIGRATION_TIMEOUT_MS = "10000";
  process.env.MIGRATIONS_DIR = MOCK_MIGRATIONS_DIR;
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
  process.env.DISCORD_ALERT_PORT = "9999"; // Port that will fail fast

  // backupDir "exists"
  mockExistingPaths.add(MOCK_BACKUP_DIR);
});

afterEach(() => {
  delete process.env.BOOT_MIGRATION_ENABLED;
  delete process.env.BOOT_MIGRATION_ALLOW_NO_BACKUP;
  delete process.env.BOOT_MIGRATION_BACKUP_DIR;
  delete process.env.BOOT_MIGRATION_TIMEOUT_MS;
  delete process.env.MIGRATIONS_DIR;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 24 Pass 2 Item #7 — boot-migration-runner", () => {

  // ─── Case 1: No pending (all applied) → no-op ───────────────────────────────
  describe("no-op when all migrations applied", () => {
    it("emits no audit row and calls no transaction when pending is empty", async () => {
      const entries = [
        { idx: 0, when: 1000000, tag: "0000_init" },
        { idx: 1, when: 1000001, tag: "0001_add_table" },
      ];
      // Mark all as applied
      _appliedWhens = new Set(entries.map((e) => String(e.when)));

      const journalPath = getJournalPath();
      mockFiles.set(journalPath, makeJournal(entries));
      mockExistingPaths.add(journalPath);

      const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
      await runPendingMigrations();

      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockInsertAuditRowSafe).not.toHaveBeenCalled();
      // Verify the no-pending info log was emitted
      const infoCalls = mockLogger.info.mock.calls.map((c) => String(c[c.length - 1]));
      expect(infoCalls.some((m) => m.includes("no pending"))).toBe(true);
    });
  });

  // ─── Case 7: Idempotent re-run → no-op (same as case 1 but explicit naming) ─
  it("idempotent: re-running with all applied is a pure no-op", async () => {
    const entries = [{ idx: 0, when: 2000000, tag: "0000_base" }];
    _appliedWhens = new Set(["2000000"]);

    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");

    // Run twice
    await runPendingMigrations();
    await runPendingMigrations();

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalled();
  });

  // ─── Case 8: BOOT_MIGRATION_ENABLED=false → skip entirely ───────────────────
  it("skips entirely when BOOT_MIGRATION_ENABLED=false", async () => {
    process.env.BOOT_MIGRATION_ENABLED = "false";

    // Even if journal has pending, should not apply
    const entries = [{ idx: 0, when: 3000000, tag: "0000_base" }];
    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    const sqlPath = getMigrationSqlPath("0000_base");
    mockFiles.set(sqlPath, makeMigrationSql("0000_base"));
    mockExistingPaths.add(sqlPath);

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await runPendingMigrations();

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  // ─── Case 2: Single pending → applies + audit + journal row ─────────────────
  it("single pending: executes SQL statements, inserts journal row, emits audit", async () => {
    const tag = "0127_add_column";
    const entries = [{ idx: 0, when: 4000000, tag }];
    _appliedWhens = new Set(); // none applied

    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    const sqlPath = getMigrationSqlPath(tag);
    mockFiles.set(sqlPath, makeMigrationSql(tag));
    mockExistingPaths.add(sqlPath);

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await runPendingMigrations();

    // Transaction was called once
    expect(mockTransaction).toHaveBeenCalledOnce();

    // Audit success row emitted
    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "migration.auto_applied",
        status: "success",
        input: expect.objectContaining({ migration_name: tag }),
      }),
    );

    // No failure audit
    const failureCall = mockInsertAuditRowSafe.mock.calls.find(
      (c) => c[0]?.action === "migration.auto_apply_failed",
    );
    expect(failureCall).toBeUndefined();
  });

  // ─── Case 3: Multi-pending → applies in journal order ───────────────────────
  it("multi-pending: applies all in journal order, emits one audit per migration", async () => {
    const entries = [
      { idx: 0, when: 5000000, tag: "0127_first" },
      { idx: 1, when: 5000001, tag: "0128_second" },
      { idx: 2, when: 5000002, tag: "0129_third" },
    ];
    _appliedWhens = new Set(); // none applied

    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    for (const e of entries) {
      const sqlPath = getMigrationSqlPath(e.tag);
      mockFiles.set(sqlPath, makeMigrationSql(e.tag));
      mockExistingPaths.add(sqlPath);
    }

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await runPendingMigrations();

    // Three transactions
    expect(mockTransaction).toHaveBeenCalledTimes(3);

    // Three success audit rows
    const successCalls = mockInsertAuditRowSafe.mock.calls.filter(
      (c) => c[0]?.action === "migration.auto_applied",
    );
    expect(successCalls).toHaveLength(3);

    // Order preserved: first called for 0127_first, then 0128_second, then 0129_third
    expect(successCalls[0][0].input.migration_name).toBe("0127_first");
    expect(successCalls[1][0].input.migration_name).toBe("0128_second");
    expect(successCalls[2][0].input.migration_name).toBe("0129_third");
  });

  // ─── Case 4: Failure midway → rollback, emits CRITICAL, throws ──────────────
  it("failure midway: emits auto_apply_failed audit, fires Discord CRITICAL, throws to block boot", async () => {
    const entries = [
      { idx: 0, when: 6000000, tag: "0127_ok" },
      { idx: 1, when: 6000001, tag: "0128_fails" },
      { idx: 2, when: 6000002, tag: "0129_skipped" },
    ];
    _appliedWhens = new Set(); // none applied

    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    for (const e of entries) {
      const sqlPath = getMigrationSqlPath(e.tag);
      mockFiles.set(sqlPath, makeMigrationSql(e.tag));
      mockExistingPaths.add(sqlPath);
    }

    // First tx succeeds; second fails
    let txCount = 0;
    mockTransaction.mockImplementation(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
      txCount++;
      if (txCount === 2) {
        throw new Error("syntax error at or near INVALID");
      }
      await fn({ execute: mockTxExecute });
    });

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await expect(runPendingMigrations()).rejects.toThrow("boot-migration: failed to apply 0128_fails");

    // Failure audit row emitted for the failing migration
    const failureCalls = mockInsertAuditRowSafe.mock.calls.filter(
      (c) => c[0]?.action === "migration.auto_apply_failed",
    );
    expect(failureCalls).toHaveLength(1);
    expect(failureCalls[0][0].input.migration_name).toBe("0128_fails");
    expect(failureCalls[0][0].status).toBe("failure");

    // Third migration was never attempted (boot blocked after second failure)
    const successCalls = mockInsertAuditRowSafe.mock.calls.filter(
      (c) => c[0]?.action === "migration.auto_applied",
    );
    const thirdAttempted = successCalls.find((c) => c[0]?.input?.migration_name === "0129_skipped");
    expect(thirdAttempted).toBeUndefined();

    // Discord CRITICAL was fired (fetch called for the local relay)
    expect(mockFetch).toHaveBeenCalled();
    const discordCall = mockFetch.mock.calls.find(
      (c) => String(c[0]).includes("/alert/alerts") || String(c[0]).includes("discord.com"),
    );
    expect(discordCall).toBeDefined();
  });

  // ─── Deep-Scan #16 E-5: per-migration SQL file read failure (TOCTOU race) ───
  // The .sql file passes the existsSync() check a few lines above the read,
  // but the read itself throws (file removed/replaced/locked in the window
  // between the two calls, or an AV-scanner lock). Before the fix this
  // propagated straight out of the loop with ZERO audit row and ZERO Discord
  // alert — a silent crash-loop. Verify it now alerts loudly before rethrowing.
  it("per-migration SQL read failure (existsSync true, readFileSync throws): audits + alerts + rethrows (fail-closed)", async () => {
    const tag = "0130_toctou_race";
    const entries = [{ idx: 0, when: 6100000, tag }];
    _appliedWhens = new Set();

    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    const sqlPath = getMigrationSqlPath(tag);
    // Mark the file as EXISTING (passes the existsSync gate) but never register
    // its content in mockFiles — the mocked readFileSync throws ENOENT for any
    // path not in the map, simulating the file vanishing/locking after the
    // existsSync check ran.
    mockExistingPaths.add(sqlPath);

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await expect(runPendingMigrations()).rejects.toThrow(/failed to read SQL file/i);

    // Transaction (SQL execution) must never have been reached.
    expect(mockTransaction).not.toHaveBeenCalled();

    // Loud audit row for the read failure specifically.
    const readFailureCalls = mockInsertAuditRowSafe.mock.calls.filter(
      (c) => c[0]?.action === "migration.auto_apply_failed" && c[0]?.input?.phase === "migration_sql_read",
    );
    expect(readFailureCalls).toHaveLength(1);
    expect(readFailureCalls[0][0].input.tag).toBe(tag);
    expect(readFailureCalls[0][0].status).toBe("failure");

    // Discord CRITICAL fired before the rethrow.
    expect(mockFetch).toHaveBeenCalled();
    const discordCall = mockFetch.mock.calls.find(
      (c) => String(c[0]).includes("/alert/alerts") || String(c[0]).includes("discord.com"),
    );
    expect(discordCall).toBeDefined();
  });

  // ─── Case 5: pg_dump unavailable + ALLOW_NO_BACKUP=false → fail-closed ──────
  it("pg_dump unavailable + ALLOW_NO_BACKUP=false: fails-closed before applying any migration", async () => {
    _pgDumpAvailable = false;
    process.env.BOOT_MIGRATION_ALLOW_NO_BACKUP = "false";

    const entries = [{ idx: 0, when: 7000000, tag: "0127_col" }];
    _appliedWhens = new Set();

    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    const sqlPath = getMigrationSqlPath("0127_col");
    mockFiles.set(sqlPath, makeMigrationSql("0127_col"));
    mockExistingPaths.add(sqlPath);

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await expect(runPendingMigrations()).rejects.toThrow(/BOOT_MIGRATION_ALLOW_NO_BACKUP=false/);

    // No transaction was executed — boot blocked before applying
    expect(mockTransaction).not.toHaveBeenCalled();

    // Discord CRITICAL fired (pg_dump blocked)
    expect(mockFetch).toHaveBeenCalled();
    const discordCall = mockFetch.mock.calls.find(
      (c) => String(c[0]).includes("/alert/alerts") || String(c[0]).includes("discord.com"),
    );
    expect(discordCall).toBeDefined();
  });

  // ─── Case 6: pg_dump unavailable + ALLOW_NO_BACKUP=true → proceeds ──────────
  it("pg_dump unavailable + ALLOW_NO_BACKUP=true: proceeds with information_schema backup and applies migration", async () => {
    _pgDumpAvailable = false;
    process.env.BOOT_MIGRATION_ALLOW_NO_BACKUP = "true";

    const entries = [{ idx: 0, when: 8000000, tag: "0127_compat" }];
    _appliedWhens = new Set();

    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    const sqlPath = getMigrationSqlPath("0127_compat");
    mockFiles.set(sqlPath, makeMigrationSql("0127_compat"));
    mockExistingPaths.add(sqlPath);

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await runPendingMigrations();

    // Transaction was executed (migration applied)
    expect(mockTransaction).toHaveBeenCalledOnce();

    // Warn emitted that pg_dump was unavailable
    const warnCalls = mockLogger.warn.mock.calls.map((c) => String(c[c.length - 1]));
    expect(warnCalls.some((m) => m.includes("pg_dump unavailable"))).toBe(true);

    // Audit success emitted
    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "migration.auto_applied",
        status: "success",
      }),
    );
  });

  // ─── Journal absent → graceful no-op ────────────────────────────────────────
  it("journal file absent: graceful no-op (bare env / test environment)", async () => {
    // Do NOT add journal to mockExistingPaths
    const journalPath = getJournalPath();
    expect(mockExistingPaths.has(journalPath)).toBe(false);

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await runPendingMigrations();

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockInsertAuditRowSafe).not.toHaveBeenCalled();
  });

  // ─── Partial apply: second run is no-op for already-applied ─────────────────
  it("partial state: only applies migrations not yet in __drizzle_migrations", async () => {
    const entries = [
      { idx: 0, when: 9000000, tag: "0127_applied" },
      { idx: 1, when: 9000001, tag: "0128_pending" },
    ];
    // 0127 already applied, 0128 pending
    _appliedWhens = new Set(["9000000"]);

    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    for (const e of entries) {
      const sqlPath = getMigrationSqlPath(e.tag);
      mockFiles.set(sqlPath, makeMigrationSql(e.tag));
      mockExistingPaths.add(sqlPath);
    }

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await runPendingMigrations();

    // Only one transaction (for 0128_pending)
    expect(mockTransaction).toHaveBeenCalledOnce();

    const successCalls = mockInsertAuditRowSafe.mock.calls.filter(
      (c) => c[0]?.action === "migration.auto_applied",
    );
    expect(successCalls).toHaveLength(1);
    expect(successCalls[0][0].input.migration_name).toBe("0128_pending");
  });

  // ─── SQL file missing → skips entry without throwing ─────────────────────────
  it("SQL file missing for a pending entry: skips that entry with a warning, continues", async () => {
    const entries = [
      { idx: 0, when: 10000000, tag: "0127_no_file" },
      { idx: 1, when: 10000001, tag: "0128_has_file" },
    ];
    _appliedWhens = new Set();

    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    // Only provide SQL for the second entry
    const sqlPath = getMigrationSqlPath("0128_has_file");
    mockFiles.set(sqlPath, makeMigrationSql("0128_has_file"));
    mockExistingPaths.add(sqlPath);
    // 0127_no_file has no SQL file

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await runPendingMigrations();

    // Only second migration applied
    expect(mockTransaction).toHaveBeenCalledOnce();

    const warnCalls = mockLogger.warn.mock.calls.map((c) => String(c[c.length - 1]));
    expect(warnCalls.some((m) => m.includes("SQL file missing"))).toBe(true);
  });

  // ─── Backup path included in failure audit row ────────────────────────────────
  it("failure audit row includes backup_path so operator can restore", async () => {
    const entries = [{ idx: 0, when: 11000000, tag: "0127_bad" }];
    _appliedWhens = new Set();

    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);

    const sqlPath = getMigrationSqlPath("0127_bad");
    mockFiles.set(sqlPath, makeMigrationSql("0127_bad"));
    mockExistingPaths.add(sqlPath);

    // Make pg_dump succeed (creates backup) but transaction fail
    mockTransaction.mockRejectedValueOnce(new Error("column already exists"));

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await expect(runPendingMigrations()).rejects.toThrow();

    const failureCalls = mockInsertAuditRowSafe.mock.calls.filter(
      (c) => c[0]?.action === "migration.auto_apply_failed",
    );
    expect(failureCalls).toHaveLength(1);
    // backup_path is in the input — may be null if pg_dump itself failed, but key must exist
    expect("backup_path" in (failureCalls[0][0].input as Record<string, unknown>)).toBe(true);
  });
});
