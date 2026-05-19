/**
 * Cross-Source Validation Migration Applicator (Pass 18)
 * Applies migration 0103 directly against Railway PostgreSQL.
 *
 * Why this exists: drizzle-kit migrate is broken in this repo (see CLAUDE.md
 * "Drizzle snapshot drift notice"). All migrations 0061+ are applied via
 * direct sql.unsafe(); this mirrors scripts/apply-scout-drain-samples-migration.mjs.
 *
 * Usage:
 *   node scripts/apply-cross-source-validation-migration.mjs
 *
 * Idempotent: IF NOT EXISTS guards everywhere — re-running is a no-op.
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

const MIGRATIONS = ["0103_cross_source_validation.sql"];

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 20 });

console.log("Pass 18 Migration Applicator (Cross-Source Strategy Validation)");
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

// ─── Verification ────────────────────────────────────────────────────────────

console.log("\nVerifying strategy_pending_buckets table...");
const bucketsRows = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'strategy_pending_buckets'
`;
if (bucketsRows.length === 1) {
  console.log("  OK: strategy_pending_buckets exists");
} else {
  console.error("  MISSING: strategy_pending_buckets not found!");
  await sql.end();
  process.exit(1);
}

const bucketsColRows = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'strategy_pending_buckets'
`;
const bucketsColNames = new Set(bucketsColRows.map((r) => r.column_name));
const expectedBucketsCols = [
  "id", "fingerprint_hash", "market", "entry_archetype", "exit_type",
  "source_count", "distinct_providers", "status",
  "first_seen_at", "last_seen_at", "graduated_at", "graduated_strategy_id",
];
let missingBuckets = false;
for (const c of expectedBucketsCols) {
  if (!bucketsColNames.has(c)) {
    console.error(`  MISSING column: ${c}`);
    missingBuckets = true;
  }
}
if (missingBuckets) { await sql.end(); process.exit(1); }
console.log(`  OK: ${expectedBucketsCols.length}/${expectedBucketsCols.length} expected columns present`);

// Unique constraint on fingerprint_hash
const bucketsConstraints = await sql`
  SELECT constraint_name FROM information_schema.table_constraints
  WHERE table_schema = 'public' AND table_name = 'strategy_pending_buckets'
    AND constraint_type = 'UNIQUE'
`;
const constraintNames = new Set(bucketsConstraints.map((r) => r.constraint_name));
if (!constraintNames.has("strategy_pending_buckets_fingerprint_hash_key")) {
  console.error("  MISSING: fingerprint_hash unique constraint not found");
  await sql.end();
  process.exit(1);
}
console.log("  OK: fingerprint_hash unique constraint present");

console.log("\nVerifying strategy_pending_mentions table...");
const mentionsRows = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'strategy_pending_mentions'
`;
if (mentionsRows.length === 1) {
  console.log("  OK: strategy_pending_mentions exists");
} else {
  console.error("  MISSING: strategy_pending_mentions not found!");
  await sql.end();
  process.exit(1);
}

const mentionsColRows = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'strategy_pending_mentions'
`;
const mentionsColNames = new Set(mentionsColRows.map((r) => r.column_name));
const expectedMentionsCols = [
  "id", "bucket_id", "source_provider", "source_url", "extracted_idea",
  "is_cross_validation_result", "cross_validator_confidence", "created_at",
];
let missingMentions = false;
for (const c of expectedMentionsCols) {
  if (!mentionsColNames.has(c)) {
    console.error(`  MISSING column: ${c}`);
    missingMentions = true;
  }
}
if (missingMentions) { await sql.end(); process.exit(1); }
console.log(`  OK: ${expectedMentionsCols.length}/${expectedMentionsCols.length} expected columns present`);

// (bucket_id, source_url) unique constraint
const mentionsConstraints = await sql`
  SELECT constraint_name FROM information_schema.table_constraints
  WHERE table_schema = 'public' AND table_name = 'strategy_pending_mentions'
    AND constraint_type = 'UNIQUE'
`;
const mentionsConstraintNames = new Set(mentionsConstraints.map((r) => r.constraint_name));
if (!mentionsConstraintNames.has("strategy_pending_mentions_bucket_url_unique")) {
  console.error("  MISSING: (bucket_id, source_url) unique constraint not found");
  await sql.end();
  process.exit(1);
}
console.log("  OK: (bucket_id, source_url) unique constraint present");

await sql.end();
console.log("\nMigration 0103 applied successfully. Cross-source validation tables are live.");
