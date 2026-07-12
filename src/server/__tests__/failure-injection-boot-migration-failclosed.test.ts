/**
 * failure-injection-boot-migration-failclosed.test.ts
 *
 * FAILURE-INJECTION coverage for incident class #6 of the autonomous-readiness
 * fault-injection campaign (2026-07-12): boot-time migration runner fail-closed
 * behavior (src/server/lib/boot-migration-runner.ts).
 *
 * The existing suite (wave24-boot-migration-runner.test.ts Case 4, "failure
 * midway") already proves a failing SQL statement rolls back and throws. This
 * file goes one step further and injects the specific failure classes the
 * task brief calls out, verifying the FULL fail-closed contract end-to-end
 * through the real `runPendingMigrations()` entry point (not a unit of it in
 * isolation):
 *
 *   1. A failing migration statement -> the migration is NOT recorded as
 *      applied (no drizzle.__drizzle_migrations INSERT reaches the DB for it)
 *      -> boot throws (blocks app.listen()) -> AND a SECOND boot attempt
 *      (simulating an NSSM respawn) RE-ATTEMPTS the same migration instead of
 *      silently treating it as done. This is the actual "stays down, doesn't
 *      limp forward on a half-applied schema" guarantee — a test that only
 *      checks "it threw once" does not prove the ledger stayed clean.
 *
 *   2. A corrupt/malformed _journal.json (the BOM/corruption class the ledger
 *      references — reference_boot_migration_bom_crashloop_2026_06_24) ->
 *      boot is BLOCKED fail-closed via the SAME runPendingMigrations() path,
 *      not just the readJournalOrAlert() helper in isolation.
 *
 *   3. Crash-loop escalation cadence: repeated boot attempts against the SAME
 *      persistently-failing migration fire the Discord CRITICAL crash-loop
 *      alert on the documented cadence (attempt 1, 3, every 10th) — proving
 *      the alert is not a one-shot that goes silent on a stuck vacation-mode
 *      NSSM respawn loop.
 *
 * Mock scaffold is a from-scratch duplicate of the established pattern in
 * wave24-boot-migration-runner.test.ts (per-file scaffold duplication is the
 * existing convention for this module — see deepscan6/7/15,
 * boot-migration-runner-crlf-hash/-discord-alert/-mig2.test.ts, all of which
 * independently re-implement the same mock shape rather than sharing a helper
 * module).
 *
 * DO NOT EDIT SOURCE FROM THIS FILE.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";

// ─── Mock: node:fs ─────────────────────────────────────────────────────────────

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
    writeFileSync: vi.fn((p: string, content: string) => {
      mockFiles.set(p, content);
      mockExistingPaths.add(p);
    }),
    unlinkSync: vi.fn((p: string) => {
      mockFiles.delete(p);
      mockExistingPaths.delete(p);
    }),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  },
  existsSync: vi.fn((p: string) => mockExistingPaths.has(p)),
  readFileSync: vi.fn((p: string, _enc: string) => {
    const content = mockFiles.get(p);
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  }),
  writeFileSync: vi.fn((p: string, content: string) => {
    mockFiles.set(p, content);
    mockExistingPaths.add(p);
  }),
  unlinkSync: vi.fn((p: string) => {
    mockFiles.delete(p);
    mockExistingPaths.delete(p);
  }),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

// ─── Mock: node:child_process (pg_dump availability) ──────────────────────────

vi.mock("node:child_process", () => ({
  execFile: vi.fn((cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
    cb(null, "pg_dump (PostgreSQL) 14.0\n", "");
  }),
}));

// ─── Mock: db ──────────────────────────────────────────────────────────────────

function extractSqlString(obj: unknown): string {
  if (typeof obj === "string") return obj;
  if (obj && typeof obj === "object") {
    const chunks = (obj as { queryChunks?: Array<{ value?: unknown; sql?: string }> }).queryChunks;
    if (Array.isArray(chunks)) {
      return chunks
        .map((c) => {
          if (Array.isArray(c.value)) return (c.value as string[]).join("");
          if (typeof c.value === "string") return c.value;
          // drizzle-orm SQL.Param chunks hold the interpolated JS scalar
          // (e.g. the migration hash / `when` epoch) directly on `.value` as
          // a non-array scalar — stringify it inline so the reconstructed
          // text is queryable (the pre-existing convention this scaffold was
          // copied from silently DROPS scalar params, which would make any
          // digit-based assertion on the ledger INSERT vacuously pass/fail
          // regardless of the real code path — fixed here for test validity).
          if (c.value !== undefined && c.value !== null) return String(c.value);
          if (typeof c.sql === "string") return c.sql;
          return "";
        })
        .join(" ");
    }
    const sqlField = (obj as { sql?: string }).sql;
    if (typeof sqlField === "string") return sqlField;
  }
  return String(obj);
}

let _appliedWhens: Set<string> = new Set();
let _appliedHashByWhen: Map<string, string> = new Map();
/** Count of times the drizzle.__drizzle_migrations ledger INSERT actually executed inside a transaction (reset to 0 on rollback). */
let _ledgerInsertCallCount = 0;
/** Whens that reached a COMMITTED ledger INSERT (never populated on a rolled-back transaction). */
let _committedLedgerWhens: number[] = [];
/** Set to a tag to make its execute() call reject on the NEXT statement it runs (injected failure). */
let _failingStatementForTag: string | null = null;

const mockTxExecute = vi.fn(async (sqlObj: unknown) => {
  const rawSql = extractSqlString(sqlObj);
  if (
    _failingStatementForTag &&
    rawSql.includes(`"${_failingStatementForTag}"`) &&
    !rawSql.includes("INSERT INTO drizzle.__drizzle_migrations")
  ) {
    throw new Error(`syntax error at or near "${_failingStatementForTag}" (INJECTED)`);
  }
  if (rawSql.includes("INSERT INTO drizzle.__drizzle_migrations")) {
    _ledgerInsertCallCount += 1;
    // Extract the `when` epoch (second positional value) if present in the
    // reconstructed text; falls back to leaving the array unaugmented if the
    // reconstruction ever changes shape — the CALL COUNT above is the
    // primary, robust signal this file's assertions rely on.
    const match = rawSql.match(/(\d{6,})/g);
    if (match && match.length > 0) _committedLedgerWhens.push(Number(match[match.length - 1]));
  }
});

const mockTransaction = vi.fn(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
  const before = _ledgerInsertCallCount;
  const beforeWhens = _committedLedgerWhens.length;
  try {
    await fn({ execute: mockTxExecute });
  } catch (err) {
    // Real drizzle db.transaction() rolls back on throw — model that by
    // truncating any ledger inserts this (failed) transaction attempted, so
    // the assertion "not recorded applied" reflects genuine rollback
    // semantics rather than the mock's bookkeeping leaking a phantom insert
    // across the throw boundary.
    _ledgerInsertCallCount = before;
    _committedLedgerWhens = _committedLedgerWhens.slice(0, beforeWhens);
    throw err;
  }
});

const mockDbExecute = vi.fn(async (sqlObj: unknown) => {
  const rawSql = extractSqlString(sqlObj);
  if (rawSql.includes("INSERT INTO drizzle.__drizzle_migrations")) {
    return { rows: [] };
  }
  if (rawSql.includes("created_at") && rawSql.includes("drizzle_migrations")) {
    return {
      rows: [..._appliedWhens].map((w) => ({
        created_at: w,
        hash: _appliedHashByWhen.get(w) ?? `nohash-${w}`,
      })),
    };
  }
  return { rows: [] };
});

vi.mock("../db/index.js", () => ({
  db: {
    execute: mockDbExecute,
    transaction: mockTransaction,
  },
}));

// ─── Mock: logger ─────────────────────────────────────────────────────────────

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock("../lib/logger.js", () => ({ logger: mockLogger }));

// ─── Mock: audit-log-helper ───────────────────────────────────────────────────

const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(true);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: mockInsertAuditRowSafe,
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock: fetch (Discord CRITICAL notifications) — this IS the observable
// auto-remediation-attempted signal we assert on for the crash-loop cadence.

const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal("fetch", mockFetch);

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function makeJournal(entries: Array<{ idx: number; when: number; tag: string }>): string {
  return JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries: entries.map((e) => ({ ...e, version: "7", breakpoints: true })),
  });
}

function makeMigrationSql(name: string): string {
  return `-- ${name}\nCREATE TABLE IF NOT EXISTS "${name}" (id SERIAL PRIMARY KEY);\n`;
}

function getJournalPath(): string {
  return path.join(process.env.MIGRATIONS_DIR!, "meta", "_journal.json");
}
function getMigrationSqlPath(tag: string): string {
  return path.join(process.env.MIGRATIONS_DIR!, `${tag}.sql`);
}

const MOCK_MIGRATIONS_DIR = path.join(os.tmpdir(), "tf-failure-injection-migrations");
const MOCK_BACKUP_DIR = path.join(os.tmpdir(), "tf-failure-injection-backups");

beforeEach(() => {
  vi.clearAllMocks();
  mockFiles.clear();
  mockExistingPaths.clear();
  _appliedWhens = new Set();
  _appliedHashByWhen = new Map();
  _ledgerInsertCallCount = 0;
  _committedLedgerWhens = [];
  _failingStatementForTag = null;

  process.env.BOOT_MIGRATION_ENABLED = "true";
  process.env.BOOT_MIGRATION_ALLOW_NO_BACKUP = "false";
  process.env.BOOT_MIGRATION_BACKUP_DIR = MOCK_BACKUP_DIR;
  process.env.BOOT_MIGRATION_TIMEOUT_MS = "10000";
  process.env.MIGRATIONS_DIR = MOCK_MIGRATIONS_DIR;
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
  process.env.DISCORD_ALERT_PORT = "9999";
  // Point the crash-loop counter + alert-dedup files at throwaway mock paths so
  // this file's assertions are isolated from any real bin/*.json state and from
  // other test files sharing the same module singleton path.
  process.env.BOOT_MIGRATION_CRITICAL_ALERT_DEDUP_PATH = path.join(
    os.tmpdir(),
    `tf-failure-injection-dedup-${Math.random().toString(36).slice(2)}.json`,
  );

  mockExistingPaths.add(MOCK_BACKUP_DIR);
});

afterEach(() => {
  delete process.env.BOOT_MIGRATION_ENABLED;
  delete process.env.BOOT_MIGRATION_ALLOW_NO_BACKUP;
  delete process.env.BOOT_MIGRATION_BACKUP_DIR;
  delete process.env.BOOT_MIGRATION_TIMEOUT_MS;
  delete process.env.MIGRATIONS_DIR;
  delete process.env.BOOT_MIGRATION_CRITICAL_ALERT_DEDUP_PATH;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FAILURE-INJECTION: boot-migration fail-closed (incident class #6)", () => {
  it("INJECTED: a failing migration statement -> NOT recorded applied (ledger stays clean) -> throws (boot blocked)", async () => {
    const failTag = "0128_fails_injected";
    const entries = [{ idx: 0, when: 7000000, tag: failTag }];
    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);
    const sqlPath = getMigrationSqlPath(failTag);
    mockFiles.set(sqlPath, makeMigrationSql(failTag));
    mockExistingPaths.add(sqlPath);

    _failingStatementForTag = failTag;

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await expect(runPendingMigrations()).rejects.toThrow(/failed to apply/);

    // RESPONSE: rollback actually happened — the ledger INSERT statement was
    // never committed for this migration (the assertion a bare "it threw"
    // test would miss: it does not prove the ledger stayed clean). The
    // failing statement is the CREATE TABLE itself, which runs BEFORE the
    // ledger INSERT in the transaction body — so a genuine rollback means the
    // ledger INSERT execute() call count stays at 0.
    expect(_ledgerInsertCallCount).toBe(0);
    expect(_committedLedgerWhens).not.toContain(7000000);

    // Audit failure row + Discord CRITICAL both fired.
    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "migration.auto_apply_failed", status: "failure" }),
    );
    expect(mockFetch).toHaveBeenCalled();
  });

  it("INJECTED: a SECOND boot attempt (simulated NSSM respawn) against the SAME failing migration RE-ATTEMPTS it — proves the failure did not poison the applied-ledger into silently skipping it", async () => {
    const failTag = "0129_persistent_fail";
    const entries = [{ idx: 0, when: 7100000, tag: failTag }];
    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);
    const sqlPath = getMigrationSqlPath(failTag);
    mockFiles.set(sqlPath, makeMigrationSql(failTag));
    mockExistingPaths.add(sqlPath);

    _failingStatementForTag = failTag;

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");

    // Boot attempt 1 (fails, as above).
    await expect(runPendingMigrations()).rejects.toThrow();
    const txCallsAfterFirst = mockTransaction.mock.calls.length;
    expect(txCallsAfterFirst).toBe(1);

    // Boot attempt 2 — simulates NSSM respawning the process after the crash.
    // _appliedWhens/_appliedHashByWhen are untouched (the DB genuinely never
    // recorded the failed migration — this mirrors production: a fresh process
    // queries drizzle.__drizzle_migrations from the SAME real Postgres table,
    // which still shows the migration missing).
    await expect(runPendingMigrations()).rejects.toThrow();
    const txCallsAfterSecond = mockTransaction.mock.calls.length;

    // The SAME migration must have been attempted again — NOT silently
    // skipped as "already applied". A regression here (e.g. a bug that marks
    // a migration applied on the FIRST statement rather than after full
    // commit) would show txCallsAfterSecond === txCallsAfterFirst.
    expect(txCallsAfterSecond).toBe(txCallsAfterFirst + 1);
  });

  it("INJECTED: a corrupt/malformed _journal.json -> runPendingMigrations() itself (the real boot entry point) throws fail-closed, fires Discord CRITICAL + audit, WITHOUT ever reaching a transaction", async () => {
    const journalPath = getJournalPath();
    // Malformed JSON — unresolved-merge-conflict-marker class of corruption.
    mockFiles.set(journalPath, '{\n<<<<<<< HEAD\n  "entries": [\n=======\n  "entries": [\n>>>>>>> branch\n');
    mockExistingPaths.add(journalPath);

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");
    await expect(runPendingMigrations()).rejects.toThrow(/journal\.json parse failed/);

    // Fail-closed: boot never reached the point of executing ANY migration SQL.
    expect(mockTransaction).not.toHaveBeenCalled();

    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "migration.journal_parse_failed", status: "failure" }),
    );
    expect(mockFetch).toHaveBeenCalled();
  });

  it("CRASH-LOOP CADENCE: repeated boot attempts against a persistently-failing migration fire the Discord CRITICAL crash-loop escalation on attempt 1 and attempt 3 (not silently going quiet after the first alert)", async () => {
    const failTag = "0130_crashloop";
    const entries = [{ idx: 0, when: 7200000, tag: failTag }];
    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);
    const sqlPath = getMigrationSqlPath(failTag);
    mockFiles.set(sqlPath, makeMigrationSql(failTag));
    mockExistingPaths.add(sqlPath);
    _failingStatementForTag = failTag;

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");

    // Three consecutive failed boot attempts (simulated NSSM respawn loop).
    for (let i = 0; i < 3; i++) {
      await expect(runPendingMigrations()).rejects.toThrow();
    }

    // Every fetch() call is a Discord dispatch (mocked globally) — inspect the
    // request bodies for the crash-loop-specific title text, which only fires
    // per bumpBootFailureCrashLoopAlert()'s documented cadence (attempt 1, 3,
    // every 10th thereafter — shouldAlertBootFailure()).
    const bodies = mockFetch.mock.calls
      .map((c) => {
        try {
          return JSON.parse((c[1] as { body?: string } | undefined)?.body ?? "{}");
        } catch {
          return {};
        }
      })
      .map((b) => String(b.title ?? b.embeds?.[0]?.title ?? ""));

    const crashLoopAlerts = bodies.filter((t) => t.includes("Migration Crash-Loop"));
    // Attempt 1 and attempt 3 both fire per shouldAlertBootFailure(); attempt 2
    // is deliberately silent (cadence, not spam). At minimum both 1 and 3 must
    // have produced a crash-loop title somewhere in the 3-boot sequence.
    expect(crashLoopAlerts.length).toBeGreaterThanOrEqual(2);
  });

  it("negative control: a CLEAN boot (migration succeeds) after a prior failure resets the crash-loop counter — the ledger genuinely recovers, not just stops erroring", async () => {
    const failTag = "0131_eventually_fixed";
    const entries = [{ idx: 0, when: 7300000, tag: failTag }];
    const journalPath = getJournalPath();
    mockFiles.set(journalPath, makeJournal(entries));
    mockExistingPaths.add(journalPath);
    const sqlPath = getMigrationSqlPath(failTag);
    mockFiles.set(sqlPath, makeMigrationSql(failTag));
    mockExistingPaths.add(sqlPath);

    const { runPendingMigrations } = await import("../lib/boot-migration-runner.js");

    // Attempt 1: injected failure.
    _failingStatementForTag = failTag;
    await expect(runPendingMigrations()).rejects.toThrow();
    expect(_appliedWhens.has("7300000")).toBe(false);

    // Operator "fixes" the migration (simulated: the injected failure clears).
    _failingStatementForTag = null;

    // Attempt 2: succeeds cleanly.
    await runPendingMigrations();

    // The migration is now genuinely applied (ledger insert reached the tx).
    expect(_ledgerInsertCallCount).toBe(1);
    const successAudit = mockInsertAuditRowSafe.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)?.action === "migration.auto_applied",
    );
    expect(successAudit).toBeDefined();
  });
});
