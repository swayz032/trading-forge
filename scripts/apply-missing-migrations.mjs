#!/usr/bin/env node
/**
 * Custom migrator: applies missing migrations one-at-a-time with full error visibility.
 * Compares journal vs __drizzle_migrations by tag (using `when` field as the unique key).
 * For each missing migration, runs SQL inside a transaction; commits + records on success.
 *
 * SAFE: each migration is its own transaction. Failures roll back. NOTICE-level
 * "already exists" responses are tolerated.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "src/server/db/migrations");
const journalPath = path.join(migrationsDir, "meta/_journal.json");

const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => {
    const eq = l.indexOf("=");
    return [l.slice(0, eq).trim(), l.slice(eq + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);

const url = env.DATABASE_URL || env.PG_URL || env.POSTGRES_URL;
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));

  // Get applied migrations by `created_at` (which is journal's `when`)
  const applied = await sql`SELECT created_at::text AS when_str FROM drizzle.__drizzle_migrations`;
  const appliedWhens = new Set(applied.map((r) => r.when_str));

  console.log(`Journal has ${journal.entries.length} entries; ${applied.length} applied per __drizzle_migrations`);

  const missing = journal.entries.filter((e) => !appliedWhens.has(String(e.when)));
  console.log(`${missing.length} missing migrations to apply\n`);

  for (const entry of missing) {
    const file = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) {
      console.log(`SKIP ${entry.tag}: file missing on disk`);
      continue;
    }

    const content = fs.readFileSync(file, "utf8");
    // HIGH#2 (freshscan4 2026-07-12): the stamped ledger hash MUST EXACTLY mirror
    // boot-migration-runner's readUtf8StripBom (BOM strip + CRLF→LF normalize) — the sibling
    // stamp-applied-migrations.cjs was patched for this exact crash-loop class (deep-scan 2026-07-11)
    // but this tool was left hashing raw CRLF bytes. On this CRLF tower (core.autocrlf=true) a
    // post-DB-restore run of this recovery tool seeded CRLF-content hashes the runtime could NEVER
    // match → every stamped baseline is misclassified pending and re-executed on the next boot → a
    // non-idempotent baseline (bare CREATE TABLE / ADD CONSTRAINT in 0000/0002/0006) raises "already
    // exists" → tx rollback → fail-closed boot block → NSSM crash-loop. Normalize ONLY the hash input;
    // the executed SQL below stays byte-identical (Postgres accepts CRLF regardless).
    let hashContent = content;
    if (hashContent.charCodeAt(0) === 0xFEFF) hashContent = hashContent.slice(1);
    hashContent = hashContent.replace(/\r\n/g, "\n");
    const hash = crypto.createHash("sha256").update(hashContent).digest("hex");

    // Drizzle splits on --> statement-breakpoint markers
    const stmts = content
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    process.stdout.write(`[${entry.idx}] ${entry.tag} (${stmts.length} stmt) ... `);
    try {
      await sql.begin(async (tx) => {
        for (const stmt of stmts) {
          await tx.unsafe(stmt);
        }
        // Record in __drizzle_migrations
        await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`;
      });
      console.log("OK");
    } catch (err) {
      console.log("FAIL");
      console.error(`  ERROR in ${entry.tag}:`);
      console.error(`  ${err.message}`);
      if (err.position) console.error(`  position: ${err.position}`);
      if (err.detail) console.error(`  detail: ${err.detail}`);
      // Continue to next migration — don't halt; gives full picture of what's broken
    }
  }

  console.log("\nDone. Re-running diagnostic...");
} finally {
  await sql.end({ timeout: 5 });
}
