/**
 * Scout Drain Samples Migration Applicator (Pass 10)
 * Applies migration 0090 directly against Railway PostgreSQL.
 *
 * Why this exists: drizzle-kit migrate is broken in this repo (see CLAUDE.md
 * "Drizzle snapshot drift notice"). All migrations 0061+ are applied via
 * direct sql.unsafe(); this mirrors scripts/apply-w20-migration.mjs.
 *
 * Usage:
 *   node scripts/apply-scout-drain-samples-migration.mjs
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS,
 * so re-running is a no-op once applied.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const DATABASE_URL = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_PUBLIC_URL or DATABASE_URL not set");
  process.exit(1);
}

const MIGRATIONS = ["0090_scout_drain_samples.sql"];

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 20 });

console.log("Pass 10 Migration Applicator (Scout Observability — drain samples)");
console.log("Connecting to Railway PostgreSQL...");

for (const filename of MIGRATIONS) {
  const path = resolve(PROJECT_ROOT, "src/server/db/migrations", filename);
  const ddl = readFileSync(path, "utf-8");

  console.log(`\nApplying ${filename}...`);
  try {
    await sql.unsafe(ddl);
    console.log(`  OK: ${filename}`);
  } catch (err) {
    if (err.message?.includes("already exists")) {
      console.log(`  SKIP: ${filename} — table/index already exists`);
    } else {
      console.error(`  ERROR: ${filename}: ${err.message}`);
      await sql.end();
      process.exit(1);
    }
  }
}

// Verify the table exists with expected columns + index
console.log("\nVerifying scout_drain_samples table...");
const tableRows = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'scout_drain_samples'
`;
if (tableRows.length === 1) {
  console.log("  OK: scout_drain_samples exists");
} else {
  console.error("  MISSING: scout_drain_samples not found!");
  await sql.end();
  process.exit(1);
}

const colRows = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'scout_drain_samples'
`;
const colNames = new Set(colRows.map((r) => r.column_name));
const expected = ["id", "sampled_at", "scouted_count", "pipeline_mode"];
let missing = false;
for (const c of expected) {
  if (!colNames.has(c)) {
    console.error(`  MISSING column: ${c}`);
    missing = true;
  }
}
if (missing) {
  await sql.end();
  process.exit(1);
}
console.log(`  OK: ${expected.length}/${expected.length} expected columns present`);

const idxRows = await sql`
  SELECT indexname FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'scout_drain_samples'
`;
const idxNames = new Set(idxRows.map((r) => r.indexname));
if (!idxNames.has("idx_scout_drain_samples_sampled_at")) {
  console.error("  MISSING: idx_scout_drain_samples_sampled_at not found");
  await sql.end();
  process.exit(1);
}
console.log("  OK: recency index present");

await sql.end();
console.log("\nMigration 0090 applied successfully.");
