#!/usr/bin/env node
/**
 * Diagnose migration state — compare disk migrations vs __drizzle_migrations vs runtime tables.
 * Read-only. Prints a JSON report.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "src/server/db/migrations");
const journalPath = path.join(migrationsDir, "meta/_journal.json");

// Load env
const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const eq = l.indexOf("=");
      return [l.slice(0, eq).trim(), l.slice(eq + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const url = env.DATABASE_URL || env.PG_URL || env.POSTGRES_URL;
if (!url) {
  console.error("No DATABASE_URL in .env");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  // 1. Files on disk
  const sqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // 2. Journal entries
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const journalTags = new Set(journal.entries.map((e) => e.tag));

  // 3. __drizzle_migrations table
  let drizzleMigs = [];
  try {
    drizzleMigs = await sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`;
  } catch (e) {
    console.error("Could not read __drizzle_migrations:", e.message);
  }

  // 4. Tables that should exist post-0030
  const keyTables = [
    "system_parameters",       // 0045
    "mutation_outcomes",        // 0031
    "agent_health_status",      // 0039
    "evolution_lineage",        // 0040
    "subsystem_metrics",        // 0048
    "prompt_versions",          // 0049
    "contract_rolls",           // 0051
    "idempotency_keys",         // 0047
  ];
  const tableExistence = {};
  for (const t of keyTables) {
    const r = await sql`SELECT to_regclass(${t}) AS exists`;
    tableExistence[t] = r[0].exists !== null;
  }

  console.log(JSON.stringify({
    summary: {
      sqlFilesOnDisk: sqlFiles.length,
      journalEntries: journal.entries.length,
      drizzleMigsApplied: drizzleMigs.length,
      filesNotInJournal: sqlFiles.filter((f) => !journalTags.has(f.replace(/\.sql$/, ""))).length,
    },
    sqlFilesNotInJournal: sqlFiles.filter((f) => !journalTags.has(f.replace(/\.sql$/, ""))),
    drizzleMigsApplied: drizzleMigs.map((m) => ({ id: m.id, hash: m.hash?.slice(0, 12), at: m.created_at })),
    keyTablesExist: tableExistence,
  }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
