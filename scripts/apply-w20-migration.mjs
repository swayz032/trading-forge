/**
 * W20 Migration Applicator
 * Applies migration 0089 (Prop-Firm Survival Twin / B14) directly against
 * Railway PostgreSQL.
 *
 * Why this exists: drizzle-kit migrate is broken in this repo (see CLAUDE.md
 * "Drizzle snapshot drift notice"). All migrations 0061+ are applied via
 * direct sql.unsafe() the same way 0085-0088 were applied (W19).
 *
 * Usage:
 *   node scripts/apply-w20-migration.mjs
 *
 * Idempotent: uses CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS,
 * so re-running is a no-op once applied. The "already exists" branch in the
 * try/catch protects against any postgres-side races.
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

const MIGRATIONS = ["0089_prop_firm_survival.sql"];

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 20 });

console.log("W20 Migration Applicator (B14 Prop-Firm Survival Twin)");
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

// Verify the new table exists
console.log("\nVerifying firm_adversarial_priors table...");
const tableRows = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'firm_adversarial_priors'
`;
if (tableRows.length === 1) {
  console.log("  OK: firm_adversarial_priors exists");
} else {
  console.error("  MISSING: firm_adversarial_priors not found!");
  await sql.end();
  process.exit(1);
}

// Verify the new columns on strategy_firm_eligibility
console.log("\nVerifying strategy_firm_eligibility additive columns...");
const colRows = await sql`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'strategy_firm_eligibility'
    AND column_name IN (
      'survival_probability',
      'survival_curve',
      'survival_evidence_weight',
      'survival_last_fitted_at'
    )
`;
const expected = [
  "survival_probability",
  "survival_curve",
  "survival_evidence_weight",
  "survival_last_fitted_at",
];
const found = new Set(colRows.map((r) => r.column_name));
let missing = false;
for (const col of expected) {
  if (!found.has(col)) {
    console.error(`  MISSING: strategy_firm_eligibility.${col} not found!`);
    missing = true;
  }
}
if (missing) {
  await sql.end();
  process.exit(1);
}
// All four must be NULLABLE (additive contract)
for (const row of colRows) {
  if (row.is_nullable !== "YES") {
    console.error(
      `  ERROR: strategy_firm_eligibility.${row.column_name} is not nullable (is_nullable=${row.is_nullable})`,
    );
    await sql.end();
    process.exit(1);
  }
}
console.log(`  OK: 4/4 additive columns exist and are NULLABLE`);

// Verify indexes
console.log("\nVerifying firm_adversarial_priors indexes...");
const idxRows = await sql`
  SELECT indexname FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'firm_adversarial_priors'
`;
const idxNames = new Set(idxRows.map((r) => r.indexname));
const expectedIdx = [
  "idx_firm_priors_firm",
  "idx_firm_priors_event",
  "idx_firm_priors_recent",
  "idx_firm_priors_unique",
];
let idxMissing = false;
for (const idx of expectedIdx) {
  if (!idxNames.has(idx)) {
    console.error(`  MISSING: index ${idx} not found!`);
    idxMissing = true;
  }
}
if (idxMissing) {
  await sql.end();
  process.exit(1);
}
console.log(`  OK: 4/4 expected indexes present (3 lookup + 1 unique)`);

await sql.end();
console.log("\nW20 migration 0089 applied successfully.");
