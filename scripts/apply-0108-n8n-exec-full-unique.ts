/**
 * Wave 8 — apply 0108 (drop partial unique index, recreate as full unique).
 *
 * 0107 created a partial index `WHERE execution_id IS NOT NULL` which
 * causes Postgres 42P10 on the Wave 7 scraper's
 * `ON CONFLICT (execution_id)` clause. Drizzle's `onConflictDoNothing(
 * { target: column })` does not emit the partial predicate, so the spec
 * doesn't match the index. Full unique index preserves the multi-NULL
 * semantic (Postgres treats NULLs as not-equal-to-each-other for
 * uniqueness) and matches the scraper's ON CONFLICT spec.
 *
 * Also appends the journal entry for 0108 (was not yet added since this
 * migration was written this session).
 */
import "dotenv/config";
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const sql = postgres(process.env.DATABASE_URL!);
const MIGRATION_FILE = path.resolve(
  process.cwd(),
  "src/server/db/migrations/0108_n8n_execution_log_full_unique_index.sql",
);
const JOURNAL_FILE = path.resolve(
  process.cwd(),
  "src/server/db/migrations/meta/_journal.json",
);
const TAG = "0108_n8n_execution_log_full_unique_index";

async function main() {
  const ddl = fs.readFileSync(MIGRATION_FILE, "utf8");
  const hash = crypto.createHash("sha256").update(ddl).digest("hex");
  console.log(`[0108] SQL hash: ${hash}`);

  const existing = await sql<{ id: number }[]>`
    SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${hash} LIMIT 1
  `;
  if (existing.length > 0) {
    console.log(`[0108] Already applied (id=${existing[0].id}). Skipping DDL.`);
  } else {
    console.log(`[0108] Applying DDL...`);
    await sql.unsafe(ddl);
    const nowMs = Date.now();
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${nowMs})
    `;
    console.log(`[0108] Applied + __drizzle_migrations row inserted (created_at=${nowMs}).`);
  }

  // Verify index is now non-partial.
  const idxDef = await sql<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname='public' AND indexname='uq_n8n_exec_execution_id'
  `;
  console.log(`[0108] Index def: ${idxDef[0]?.indexdef ?? "MISSING"}`);
  if (!idxDef[0] || idxDef[0].indexdef.includes("WHERE")) {
    throw new Error(`Expected non-partial unique index; got: ${idxDef[0]?.indexdef}`);
  }

  // Append journal entry if missing.
  const journal = JSON.parse(fs.readFileSync(JOURNAL_FILE, "utf8"));
  const existingEntry = journal.entries.find((e: { tag: string }) => e.tag === TAG);
  if (!existingEntry) {
    const lastIdx = Math.max(...journal.entries.map((e: { idx: number }) => e.idx));
    journal.entries.push({
      idx: lastIdx + 1,
      version: "7",
      when: Date.now(),
      tag: TAG,
      breakpoints: true,
    });
    fs.writeFileSync(JOURNAL_FILE, JSON.stringify(journal, null, 2) + "\n");
    console.log(`[0108] Journal entry appended (idx=${lastIdx + 1}).`);
  } else {
    console.log(`[0108] Journal entry already present.`);
  }

  await sql.end();
  console.log(`[0108] DONE.`);
}

main().catch((e) => {
  console.error("[0108] FAILED:", e);
  process.exit(1);
});
