/**
 * Wave 8 Track A1 — one-shot apply of migration 0107 to Railway Postgres.
 *
 * Wave 7 shipped the n8n-execution-scrape cron (5-min interval) but the
 * onConflictDoNothing({ target: executionId }) requires the partial unique
 * index this migration creates. Without it, the cron raises silently every
 * 5 min and n8n_execution_log stays empty.
 *
 * Uses the Wave 6 Operator Queue proven pattern:
 *   1. Run the migration SQL directly via sql.unsafe (idempotent IF NOT EXISTS)
 *   2. Insert a __drizzle_migrations row with the SQL hash + current ms
 *      so future Drizzle runs treat it as canonically applied.
 *   3. Bump the journal `when` to current ms so Drizzle's watermark logic
 *      stays consistent on future runs (the journal had `when` set to noon
 *      UTC today which may or may not be < max(created_at); we make it safe).
 */
import "dotenv/config";
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const sql = postgres(process.env.DATABASE_URL!);

const MIGRATION_FILE = path.resolve(
  process.cwd(),
  "src/server/db/migrations/0107_n8n_execution_log_unique_execution.sql",
);
const JOURNAL_FILE = path.resolve(
  process.cwd(),
  "src/server/db/migrations/meta/_journal.json",
);
const TAG = "0107_n8n_execution_log_unique_execution";

async function main() {
  const ddl = fs.readFileSync(MIGRATION_FILE, "utf8");
  const hash = crypto.createHash("sha256").update(ddl).digest("hex");

  console.log(`[0107] SQL hash: ${hash}`);

  // 1) Check if already applied by hash
  const existing = await sql<{ id: number }[]>`
    SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${hash} LIMIT 1
  `;
  if (existing.length > 0) {
    console.log(`[0107] Already applied (drizzle.__drizzle_migrations id=${existing[0].id}). Skipping DDL.`);
  } else {
    console.log(`[0107] Applying DDL...`);
    await sql.unsafe(ddl);
    console.log(`[0107] DDL applied.`);

    const nowMs = Date.now();
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${nowMs})
    `;
    console.log(`[0107] __drizzle_migrations row inserted (created_at=${nowMs}).`);
  }

  // 2) Verify both indexes exist
  const idx = await sql<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'n8n_execution_log'
      AND indexname IN ('uq_n8n_exec_execution_id', 'idx_n8n_exec_started_at')
    ORDER BY indexname
  `;
  console.log(`[0107] Indexes present:`, idx.map((r) => r.indexname));
  if (idx.length !== 2) {
    throw new Error(`Expected 2 indexes, got ${idx.length}`);
  }

  // 3) Bump journal `when` to current ms (safety against future Drizzle skips)
  const journal = JSON.parse(fs.readFileSync(JOURNAL_FILE, "utf8"));
  const entry = journal.entries.find((e: { tag: string }) => e.tag === TAG);
  if (!entry) {
    throw new Error(`Journal entry for ${TAG} not found`);
  }
  const oldWhen = entry.when;
  entry.when = Date.now();
  fs.writeFileSync(JOURNAL_FILE, JSON.stringify(journal, null, 2) + "\n");
  console.log(`[0107] Journal when bumped: ${oldWhen} -> ${entry.when}`);

  await sql.end();
  console.log(`[0107] DONE.`);
}

main().catch((e) => {
  console.error("[0107] FAILED:", e);
  process.exit(1);
});
