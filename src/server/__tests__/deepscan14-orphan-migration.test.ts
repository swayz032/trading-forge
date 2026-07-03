/**
 * deepscan14 F2 — orphan .sql file with no journal entry.
 *
 * boot-migration-runner.ts computes `pending` strictly from meta/_journal.json
 * entries. A .sql file dropped on disk without a matching journal entry was
 * previously INVISIBLE: never applied, no error, no warning, no audit row.
 * This is the symmetric counterpart to the (already-loud) "journal entry with
 * a missing .sql file" case.
 *
 * Coverage:
 *   1. findOrphanSqlFiles — pure function, real temp-dir fixture, no DB/mocks.
 *   2. checkForOrphanSqlFiles — asserts the warn/audit actually fires for an
 *      orphan file, and stays silent when disk and journal agree.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_URL ||= "postgres://ci:ci@localhost:5432/ci_deepscan14";

const insertAuditRowSafeMock = vi.fn().mockResolvedValue(true);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: (...args: unknown[]) => insertAuditRowSafeMock(...args),
}));

interface JournalEntryLike {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
interface JournalLike {
  version: string;
  dialect: string;
  entries: JournalEntryLike[];
}

let findOrphanSqlFiles: (migrationsDir: string, journal: JournalLike) => string[];
let checkForOrphanSqlFiles: (journal: JournalLike, correlationId: string | null) => Promise<void>;

beforeAll(async () => {
  ({ findOrphanSqlFiles, checkForOrphanSqlFiles } = await import("../lib/boot-migration-runner.js"));
});

function makeJournal(tags: string[]): JournalLike {
  return {
    version: "7",
    dialect: "postgresql",
    entries: tags.map((tag, idx) => ({ idx, version: "7", when: 1000 + idx, tag, breakpoints: true })),
  };
}

function makeTempMigrationsDir(sqlFilenames: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-deepscan14-migrations-"));
  for (const name of sqlFilenames) {
    fs.writeFileSync(path.join(dir, name), "-- test fixture\nSELECT 1;\n", "utf8");
  }
  // Non-.sql siblings (meta dir, schema.ts) must never be mistaken for orphans.
  fs.mkdirSync(path.join(dir, "meta"), { recursive: true });
  fs.writeFileSync(path.join(dir, "schema.ts"), "export {};\n", "utf8");
  return dir;
}

const tempDirsToClean: string[] = [];
afterEach(() => {
  insertAuditRowSafeMock.mockClear();
  while (tempDirsToClean.length > 0) {
    const d = tempDirsToClean.pop()!;
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

describe("deepscan14 F2 — findOrphanSqlFiles (pure)", () => {
  it("returns empty when every .sql file has a matching journal entry", () => {
    const dir = makeTempMigrationsDir(["0001_a.sql", "0002_b.sql"]);
    tempDirsToClean.push(dir);
    const journal = makeJournal(["0001_a", "0002_b"]);
    expect(findOrphanSqlFiles(dir, journal)).toEqual([]);
  });

  it("flags a .sql file on disk with NO journal entry", () => {
    const dir = makeTempMigrationsDir(["0001_a.sql", "0002_orphan.sql"]);
    tempDirsToClean.push(dir);
    const journal = makeJournal(["0001_a"]); // 0002_orphan is NOT registered
    expect(findOrphanSqlFiles(dir, journal)).toEqual(["0002_orphan"]);
  });

  it("flags multiple orphans, sorted", () => {
    const dir = makeTempMigrationsDir(["0001_a.sql", "0003_zorphan.sql", "0002_aorphan.sql"]);
    tempDirsToClean.push(dir);
    const journal = makeJournal(["0001_a"]);
    expect(findOrphanSqlFiles(dir, journal)).toEqual(["0002_aorphan", "0003_zorphan"]);
  });

  it("ignores non-.sql files (meta/, schema.ts) — never false-flags them", () => {
    const dir = makeTempMigrationsDir(["0001_a.sql"]);
    tempDirsToClean.push(dir);
    const journal = makeJournal(["0001_a"]);
    expect(findOrphanSqlFiles(dir, journal)).toEqual([]);
  });

  it("returns empty for a nonexistent migrations dir instead of throwing", () => {
    const journal = makeJournal(["0001_a"]);
    expect(() => findOrphanSqlFiles("/nonexistent/path/does-not-exist", journal)).not.toThrow();
    expect(findOrphanSqlFiles("/nonexistent/path/does-not-exist", journal)).toEqual([]);
  });
});

describe("deepscan14 F2 — checkForOrphanSqlFiles (warn/audit emission)", () => {
  const prevMigrationsDir = process.env.MIGRATIONS_DIR;

  afterEach(() => {
    if (prevMigrationsDir === undefined) delete process.env.MIGRATIONS_DIR;
    else process.env.MIGRATIONS_DIR = prevMigrationsDir;
  });

  it("emits boot_migration.orphan_sql_file_no_journal_entry when an orphan exists", async () => {
    const dir = makeTempMigrationsDir(["0001_a.sql", "0002_orphan.sql"]);
    tempDirsToClean.push(dir);
    process.env.MIGRATIONS_DIR = dir;
    const journal = makeJournal(["0001_a"]);

    await checkForOrphanSqlFiles(journal, "corr-deepscan14-1");

    expect(insertAuditRowSafeMock).toHaveBeenCalledTimes(1);
    const call = insertAuditRowSafeMock.mock.calls[0][0];
    expect(call.action).toBe("boot_migration.orphan_sql_file_no_journal_entry");
    expect(call.status).toBe("warning");
    expect(call.correlationId).toBe("corr-deepscan14-1");
    expect(call.input.orphanTags).toEqual(["0002_orphan"]);
  });

  it("does NOT emit anything when disk and journal are in agreement", async () => {
    const dir = makeTempMigrationsDir(["0001_a.sql", "0002_b.sql"]);
    tempDirsToClean.push(dir);
    process.env.MIGRATIONS_DIR = dir;
    const journal = makeJournal(["0001_a", "0002_b"]);

    await checkForOrphanSqlFiles(journal, "corr-deepscan14-2");

    expect(insertAuditRowSafeMock).not.toHaveBeenCalled();
  });

  it("never throws even if the audit write itself fails (non-blocking contract)", async () => {
    const dir = makeTempMigrationsDir(["0001_a.sql", "0002_orphan.sql"]);
    tempDirsToClean.push(dir);
    process.env.MIGRATIONS_DIR = dir;
    const journal = makeJournal(["0001_a"]);
    insertAuditRowSafeMock.mockRejectedValueOnce(new Error("db unreachable"));

    await expect(checkForOrphanSqlFiles(journal, null)).resolves.toBeUndefined();
  });
});
