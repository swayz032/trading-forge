/**
 * wave-a-architect-migration-journal.test.ts
 *
 * Architect Wave A invariant: every .sql migration file under
 * src/server/db/migrations/ (excluding the rollbacks/ subdir and the
 * meta/ subdir) MUST have a matching _journal.json entry whose tag
 * equals the file basename without the .sql suffix.
 *
 * Closes the silent-skip failure mode where 0124 / 0150 / 0151 / 0164
 * existed on disk for weeks without journal entries — the boot-runner
 * filters by `journal.entries` so any un-journaled .sql is invisible to
 * production and never applied.
 *
 * This test is mock-free, read-only, runs against the canonical files.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "src", "server", "db", "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

interface JournalEntry {
  idx?: number;
  version?: string;
  when?: number;
  tag?: string;
  breakpoints?: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => !name.endsWith(".down.sql")) // forward-only contract
    .sort();
}

function loadJournal(): Journal {
  return JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as Journal;
}

describe("Wave A architect: migration ↔ journal completeness", () => {
  const migrationFiles = listMigrationFiles();
  const journal = loadJournal();
  const journalTags = new Set(
    journal.entries
      .map((e) => e.tag)
      .filter((t): t is string => typeof t === "string"),
  );

  it("at least 100 forward .sql migration files exist (sanity)", () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(100);
  });

  it("every forward .sql migration file has a matching journal entry", () => {
    const orphans: string[] = [];
    for (const file of migrationFiles) {
      const tag = file.replace(/\.sql$/, "");
      if (!journalTags.has(tag)) {
        orphans.push(tag);
      }
    }
    if (orphans.length > 0) {
      throw new Error(
        `Found ${orphans.length} orphan migration files (on disk but NOT in _journal.json):\n  - ${orphans.sort().join("\n  - ")}\n\nFix by hand-authoring a new entry in src/server/db/migrations/meta/_journal.json with the matching tag. NEVER run drizzle-kit generate to fix — that would renumber existing entries and break boot-runner.`,
      );
    }
    expect(orphans).toEqual([]);
  });

  it(".down.sql rollback files do NOT live alongside forward migrations", () => {
    // Defensive hygiene: rollback files belong in migrations/rollbacks/, not
    // in the main migrations dir where boot-runner's tag-lookup loop sees
    // them. Wave A architect moved 0058_audit_log_append_only.down.sql to
    // rollbacks/ on 2026-06-22.
    const stray = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".down.sql"));
    if (stray.length > 0) {
      throw new Error(
        `Found ${stray.length} .down.sql files in main migrations/ dir (should be in rollbacks/):\n  - ${stray.join("\n  - ")}`,
      );
    }
    expect(stray).toEqual([]);
  });
});
