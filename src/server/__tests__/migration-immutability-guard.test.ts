/**
 * deep-scan migrations F1 (HIGH, 2026-07-06): immutability guard for already-applied migrations.
 *
 * The boot-migration-runner keys "already applied" on each migration file's SHA-256 CONTENT hash
 * (migration-journal-utils.ts::computeMigrationPlan) — NOT on the SQL being idempotent. ~40 statements
 * across ~19 pre-0114 migrations are non-idempotent (unguarded CREATE TABLE / ADD CONSTRAINT / CREATE INDEX /
 * ADD COLUMN). Those are inert in steady state ONLY because their content hash never changes. If a future
 * formatter pass, comment fix, or line-ending normalization edits ANY byte of an already-applied migration,
 * its hash changes → the runner routes it to `toApply` → boot re-runs it → `relation ... already exists` →
 * the whole API goes offline (fail-closed + loud, but a real outage).
 *
 * This test freezes every migration's content hash in migrations-hash-manifest.json. Editing an existing
 * migration fails this test in CI (catches the accidental edit BEFORE it reaches a boot). Adding a NEW
 * migration is fine — run `node scripts/gen-migration-manifest.mjs` to record it, which is a reviewable diff.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, "..", "db", "migrations");
const MANIFEST_PATH = join(__dirname, "..", "db", "migrations-hash-manifest.json");

function hashMigration(file: string): string {
  const buf = readFileSync(join(MIG_DIR, file));
  // Strip a UTF-8 BOM to match the boot-runner's readUtf8StripBom, then hash the content.
  const content =
    buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  return createHash("sha256").update(content).digest("hex");
}

describe("migration immutability guard (deep-scan F1)", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, string>;
  const onDisk = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  it("no already-recorded migration file has been edited (content hash unchanged)", () => {
    const changed: string[] = [];
    for (const [file, expected] of Object.entries(manifest)) {
      if (!onDisk.includes(file)) continue; // deletion handled by the next test
      const actual = hashMigration(file);
      if (actual !== expected) changed.push(file);
    }
    expect(
      changed,
      `These already-applied migrations were EDITED — editing a historical migration changes its content hash, ` +
        `which makes the boot-migration-runner re-run it and CRASH the API (relation already exists). ` +
        `Revert the edit, or (only if this is truly a brand-new migration) run: node scripts/gen-migration-manifest.mjs\n` +
        `Changed: ${changed.join(", ")}`,
    ).toEqual([]);
  });

  it("no manifest-recorded migration file has been deleted", () => {
    const deleted = Object.keys(manifest).filter((f) => !onDisk.includes(f));
    expect(deleted, `Applied migrations must never be deleted: ${deleted.join(", ")}`).toEqual([]);
  });

  it("every migration file on disk is recorded in the manifest (new ones must be committed to the manifest)", () => {
    const unrecorded = onDisk.filter((f) => !(f in manifest));
    expect(
      unrecorded,
      `New migration(s) not in the immutability manifest — run: node scripts/gen-migration-manifest.mjs\n` +
        `Unrecorded: ${unrecorded.join(", ")}`,
    ).toEqual([]);
  });
});
