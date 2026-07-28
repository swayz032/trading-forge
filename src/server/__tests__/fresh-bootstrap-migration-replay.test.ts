/**
 * fresh-bootstrap-migration-replay.test.ts — deep-scan land 2026-07-10: the definitive proof
 * that the ENTIRE migration journal applies cleanly against a genuinely empty database, using
 * the REAL runtime decision logic (computeMigrationPlan + the SAME hashOf algorithm the
 * boot-migration-runner uses: readUtf8StripBom + sha256).
 *
 * Context: a prior investigation found a class of "fresh-bootstrap-breaking" migration bugs.
 * This test independently re-derives the proof against THIS tree's actual migration files
 * (whose byte content differs from any other worktree per the documented CRLF-vs-LF divergence
 * — see AGENT-LOGS / commit b4437c8's own message). Confirmed + fixed this session:
 *
 *   1. Forward-reference bugs — a migration ALTERs/DELETEs/references a table (or extension)
 *      before it's CREATE TABLE'd / CREATE EXTENSION'd later in journal order:
 *        - 0003_tournament_expires_at.sql ALTERs tournament_results, created later by
 *          0015_schema_sync.sql (idx 15 > 3). Fixed via `ALTER TABLE IF EXISTS`.
 *        - 0038a_referential_integrity_pine_version.sql DELETEs from + ADD CONSTRAINTs on
 *          system_parameter_history / system_parameters, created later by
 *          0044a_system_parameters_tables.sql (idx 46 > 39). Fixed via a `to_regclass()` guard
 *          (DELETE) + `ALTER TABLE IF EXISTS` (constraint).
 *        - 0104_concept_fingerprint.sql calls the pgcrypto digest() function before
 *          0128_hmac_secret_encryption.sql ever CREATE EXTENSIONs pgcrypto (idx 130 > 107).
 *          Fixed via a `pg_extension` existence guard (PL/pgSQL lazily resolves function calls
 *          only inside the taken branch, so an untaken branch never triggers "function does
 *          not exist").
 *      (0097_legacy_firm_data_cleanup.sql was also found broken independently by this replay —
 *      its audit_log INSERT referenced `category`/`actor` columns that never existed on this
 *      table and omitted the NOT NULL `status` column; fixed by folding both into the existing
 *      `result` JSONB payload using only real columns.)
 *
 *   2. Non-idempotent bare `CREATE TABLE`/`CREATE INDEX`/`ADD CONSTRAINT` in post-0066 migrations
 *      — 0066 itself documents a REAL 2-day silent-migration-gap incident from this exact bug
 *      class and was already retrofitted with IF NOT EXISTS on this branch. 19 SIBLING files
 *      (0067–0104, plus 0119) still had the bug; all 19 were fixed (72 statements). Deliberately
 *      SCOPED to idx > 66 per the task's framing — pre-0066 bare creates (0000/0001/0002/0006/
 *      0007/0008/0009/0016/0017) are an explicit, documented carry-forward boundary (same hazard
 *      class technically applies, but is out of this pass's scope) — see the pinned failure list
 *      in the Pass 2 test below.
 *
 *   3. KNOWN_OUT_OF_BAND_APPLIED_HASHES backfill-list unsoundness — the map backfilled (recorded
 *      a ledger row WITHOUT running the SQL) 10 migrations whose schema was verified present on
 *      ONE SPECIFIC already-existing prod DB. Because the same hash-keyed decision applies
 *      unconditionally on ANY database, a genuinely fresh bootstrap NEVER got their CREATE TABLE/
 *      ADD COLUMN/CREATE INDEX SQL to run at all — a silent, permanent schema gap. All 10 were
 *      re-verified idempotent-safe to just re-apply anywhere (CREATE TABLE IF NOT EXISTS / ADD
 *      COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / drop-then-add constraint / INSERT ...
 *      ON CONFLICT DO NOTHING backed by a real unique index) — the map is now EMPTY (see
 *      migration-journal-utils.ts doc comment) and `computeMigrationPlan` takes it as an
 *      injectable parameter so the backfill MECHANISM stays unit-tested with a synthetic map
 *      (migration-plan-hash-keyed.test.ts).
 *
 *   4. CREATE INDEX expression-grammar bug — 0119_confluence_mtf_dsl.sql's
 *      `ON strategies ((expr) IS NOT NULL)` is a Postgres syntax error (verified empirically
 *      against PGlite: "syntax error at or near IS") because an index expression ending in
 *      IS [NOT] NULL needs an EXTRA wrapping paren per the `index_elem` grammar. Fixed to
 *      `ON strategies (((expr) IS NOT NULL))`.
 *
 * PASS 1 (this file, "fresh bootstrap"): apply the full journal, in order, against an empty
 * PGlite instance. Proves classes 1, 3, 4 (+ the 0097 bug) end-to-end.
 *
 * PASS 2 (this file, "file-level rerun-safety"): re-execute the RAW SQL of every journal entry
 * — not filtered through computeMigrationPlan — against the SAME, now-populated instance. This
 * simulates the boot-runner's real hazard: an edited file's changed hash routes it back through
 * `toApply` on the ACTUAL prod DB, where the objects it creates already exist. This is the ONLY
 * way to exercise class 2 (a single fresh pass can never observe a missing IF NOT EXISTS) and is
 * the precondition that was verified BEFORE regenerating migrations-hash-manifest.json for the
 * 23 files this pass edited. The failures pinned in PASS2_KNOWN_NONIDEMPOTENT are TWO classes —
 * the pre-0066 carry-forward boundary AND "superseded by design" (see the register's own note at
 * its declaration; do not re-derive the reason from this line) — an assertion (not a skip) so a
 * NEW non-idempotent regression anywhere in the 201-file journal fails this test loudly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { computeMigrationPlan } from "../lib/migration-journal-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readUtf8StripBom(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function hashOf(e: JournalEntry): string | null {
  try {
    const p = path.join(MIGRATIONS_DIR, `${e.tag}.sql`);
    if (!fs.existsSync(p)) return null;
    return crypto.createHash("sha256").update(readUtf8StripBom(p)).digest("hex");
  } catch {
    return null;
  }
}

function splitStatements(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Pinned as an allowlist: Pass 2 must fail on EXACTLY this set and nothing else. A new tag
// appearing here is a real regression; a pinned tag disappearing means it was fixed and should
// be removed from this list in the same commit as the fix.
//
// ★ THIS REGISTER NOW HOLDS TWO DISTINCT CLASSES. It previously meant only class (1); class (2)
// was added 2026-07-28. Recorded explicitly because a register whose caption states one reason
// while its contents carry two is a false caption, and the next reader would infer the wrong
// thing about every entry in it.
//
//   (1) PRE-0066 BARE CREATE TABLE/INDEX — carry-forward boundary, documented in the class-2
//       note above, NOT fixed in that pass. These COULD be made idempotent; nobody has.
//
//   (2) SUPERSEDED BY DESIGN — a LATER migration deliberately outlawed the shape this one
//       seeds, so re-applying it is CORRECTLY rejected. Not a defect to fix: the rejection IS
//       the newer constraint doing its job.
//
//       0159_broker_accounts_ab_paper_routing seeds ('paper','traderspost','slumdawg-baseline')
//       and ('…-rl-challenger'). Migration 0208 retypes those rows to the no-egress 'paper_sim'
//       and adds a topology CHECK forbidding paper→traderspost — which is the entire point of
//       item 2, since that pair is what let paper accounts look like live TradersPost accounts
//       to routeOrder().
//
//       A FRESH BOOTSTRAP IS UNAFFECTED: in journal order 0159 seeds before 0208 exists, and
//       0208 then conforms the rows. Only a REPLAY against an already-migrated DB fails, and the
//       boot runner is journal-keyed so it never re-runs 0159 on the tower.
//
//       ★ `ON CONFLICT DO NOTHING` does NOT save it. Conflict arbitration resolves UNIQUE
//       violations; a CHECK is evaluated on the proposed row first, so the statement RAISES
//       rather than skipping. "ON CONFLICT makes a seed idempotent" is true for uniqueness and
//       FALSE for checks — carry that into every future seed.
//
//       REJECTED ALTERNATIVES: (a) loosening 0208's CHECK to tolerate paper→traderspost re-opens
//       exactly the hole item 2 closes; (b) a BEFORE INSERT trigger normalising traderspost→
//       paper_sim for firm_id='paper' WOULD make both migrations replayable, but it silently
//       REWRITES a caller's requested value on the money path and would mask a genuine mis-seed
//       as success — trading an honest, documented exception for hidden magic. Editing 0159 in
//       place is not an option: it is applied and hash-pinned (file-drift-after-apply class).
const PASS2_KNOWN_NONIDEMPOTENT = new Set([
  // class (1) — pre-0066 bare creates
  "0000_previous_nuke",
  "0001_flashy_hercules",
  "0002_equal_nova",
  "0006_deep_analysis_pipeline",
  "0007_matrix_correlations",
  "0008_decay_analysis_column",
  "0009_strategy_evolution",
  "0016_sanity_cross_validation",
  "0017_add_indexes",
  // class (2) — superseded by design (see note above)
  "0159_broker_accounts_ab_paper_routing",
]);

describe("fresh-bootstrap migration replay (deep-scan land 2026-07-10)", () => {
  let journal: { entries: JournalEntry[] };
  let pg: PGlite;

  beforeAll(async () => {
    journal = JSON.parse(readUtf8StripBom(JOURNAL_PATH));
    // PGlite WASM cold-start can take 10-30s on a cold cache (mirrors other pglite suites'
    // documented tower behavior) — loaded once here, reused across both passes below.
    pg = new PGlite({ extensions: { pgcrypto } });
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  it(
    "PASS 1 — full journal (201 entries) applies cleanly against an empty DB, zero backfilled",
    async () => {
      const plan = computeMigrationPlan(journal.entries, new Set(), new Set(), hashOf);

      // Class 3 proof: with the (now-empty) real KNOWN_OUT_OF_BAND_APPLIED_HASHES default,
      // NOTHING is silently skipped via backfill on a fresh bootstrap.
      expect(plan.toBackfill).toEqual([]);
      expect(plan.toApply.length).toBe(journal.entries.length);

      for (const entry of plan.toApply) {
        const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
        expect(fs.existsSync(sqlPath), `missing SQL for ${entry.tag}`).toBe(true);
        const statements = splitStatements(readUtf8StripBom(sqlPath));
        for (const stmt of statements) {
          try {
            await pg.exec(stmt);
          } catch (err) {
            throw new Error(
              `PASS 1 failed at idx=${entry.idx} tag=${entry.tag}: ${(err as Error).message}\n` +
                `statement: ${stmt.slice(0, 200)}`,
            );
          }
        }
      }
    },
    120_000,
  );

  it("PASS 1 proof — the 10 formerly-backfilled migrations' schema now actually exists", async () => {
    // Direct schema-existence check for a representative sample of the 10 migrations that used
    // to be silently backfilled (SQL never run) before KNOWN_OUT_OF_BAND_APPLIED_HASHES was
    // emptied. If any of these queries fail, the class-3 fix regressed.
    const checks: Array<{ label: string; sql: string }> = [
      { label: "system_parameters (0044a)", sql: "SELECT 1 FROM system_parameters LIMIT 0" },
      { label: "system_parameter_history (0044a)", sql: "SELECT 1 FROM system_parameter_history LIMIT 0" },
      { label: "lifecycle_shadow_signals (0160)", sql: "SELECT 1 FROM lifecycle_shadow_signals LIMIT 0" },
      { label: "needs_archetype_queue (0162)", sql: "SELECT 1 FROM needs_archetype_queue LIMIT 0" },
      { label: "slumhouse_users (0164)", sql: "SELECT 1 FROM slumhouse_users LIMIT 0" },
      {
        label: "strategies.paper_account_routing column (0159)",
        sql: "SELECT paper_account_routing FROM strategies LIMIT 0",
      },
      {
        label: "backtests.compliance_mode column (0148)",
        sql: "SELECT compliance_mode FROM backtests LIMIT 0",
      },
    ];
    for (const check of checks) {
      await expect(pg.query(check.sql), check.label).resolves.toBeDefined();
    }
  });

  it(
    "PASS 2 — re-applying every journal entry's raw SQL against the now-populated DB fails ONLY on the pinned pre-0066 carry-forward set",
    async () => {
      const failures: Array<{ tag: string; idx: number; error: string }> = [];
      for (const entry of journal.entries) {
        const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const statements = splitStatements(readUtf8StripBom(sqlPath));
        try {
          for (const stmt of statements) {
            await pg.exec(stmt);
          }
        } catch (err) {
          failures.push({ tag: entry.tag, idx: entry.idx, error: (err as Error).message });
        }
      }

      const failedTags = new Set(failures.map((f) => f.tag));
      const unexpected = failures.filter((f) => !PASS2_KNOWN_NONIDEMPOTENT.has(f.tag));
      const missingExpected = [...PASS2_KNOWN_NONIDEMPOTENT].filter((t) => !failedTags.has(t));

      expect(
        unexpected,
        `UNEXPECTED non-idempotent migration(s) — a file outside the pinned register is NOT safe to ` +
          `re-apply. This means editing it (even to fix an unrelated bug) would crash-loop prod once its ` +
          `hash changes. Before adding it to PASS2_KNOWN_NONIDEMPOTENT, read that register's note and ` +
          `state WHICH class it belongs to: (1) pre-0066 bare-create carry-forward, or (2) superseded ` +
          `by design. If it is neither, it is a REGRESSION and the migration is what needs fixing, not ` +
          `the list. Details: ${JSON.stringify(unexpected, null, 2)}`,
      ).toEqual([]);
      expect(
        missingExpected,
        `Pinned migration(s) unexpectedly became idempotent-safe — remove them from ` +
          `PASS2_KNOWN_NONIDEMPOTENT (and consider regenerating migrations-hash-manifest.json if you ` +
          `intentionally fixed them). NOTE THE TWO CLASSES: for a class-(1) pre-0066 entry this is good ` +
          `news. For a class-(2) "superseded by design" entry it is NOT — it means the LATER constraint ` +
          `that was supposed to reject this migration has stopped rejecting it, so check that constraint ` +
          `still exists before deleting the line: ${missingExpected.join(", ")}`,
      ).toEqual([]);
    },
    120_000,
  );
});
