/**
 * W19 Migration Applicator
 * Applies migrations 0085, 0086, 0087 directly against Railway PostgreSQL.
 * Usage: node scripts/apply-w19-migrations.mjs
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

const MIGRATIONS = [
  "0085_contract_specs_authoritative.sql",
  "0086_daily_statistics.sql",
  "0087_opening_auction_imbalance.sql",
];

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 20 });

console.log("W19 Migration Applicator");
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

// Verify tables exist
console.log("\nVerifying tables exist...");
const tables = ["contract_specs_authoritative", "daily_statistics", "opening_auction_imbalance"];
for (const table of tables) {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  if (rows.length > 0) {
    console.log(`  OK: ${table} exists`);
  } else {
    console.error(`  MISSING: ${table} not found!`);
    await sql.end();
    process.exit(1);
  }
}

await sql.end();
console.log("\nAll W19 migrations applied successfully.");
