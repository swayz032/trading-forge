#!/usr/bin/env node
/**
 * scripts/restore-n8n-data.mjs <backup-file.json.gz>
 *
 * Companion to scripts/backup-n8n-data.mjs. Restores the recovery-essential
 * n8n schema tables from a logical backup. Use after a destructive incident
 * (e.g. accidental schema drop, bad migration) once n8n has been brought back
 * up cleanly on the same N8N_ENCRYPTION_KEY.
 *
 * SAFETY GATES:
 *   1. Refuses to run unless RESTORE_CONFIRM=YES (env var)
 *   2. Refuses to run if the `n8n` schema is missing
 *   3. TRUNCATE-then-INSERT per table inside a single transaction
 *
 * Restoration target: same Railway Postgres referenced by DATABASE_URL.
 */

import "dotenv/config";
import postgres from "postgres";
import { promises as fs } from "node:fs";
import zlib from "node:zlib";
import { promisify } from "node:util";

const gunzip = promisify(zlib.gunzip);

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/restore-n8n-data.mjs <backup-file.json.gz>");
    process.exit(2);
  }
  if (process.env.RESTORE_CONFIRM !== "YES") {
    console.error("Refusing to run without RESTORE_CONFIRM=YES — this TRUNCATEs n8n tables.");
    process.exit(2);
  }

  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL / DATABASE_PUBLIC_URL not set");

  const compressed = await fs.readFile(file);
  const raw = await gunzip(compressed);
  const dump = JSON.parse(raw.toString("utf-8"));
  if (dump.schema !== "n8n") {
    throw new Error(`backup schema mismatch: expected "n8n", got ${dump.schema}`);
  }

  const sql = postgres(url, { ssl: "require" });
  try {
    const [{ exists: schemaExists }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata WHERE schema_name = 'n8n'
      ) AS exists
    `;
    if (!schemaExists) {
      throw new Error("n8n schema does not exist — boot n8n first to recreate schema");
    }

    const ordered = [
      "user", "user_api_keys", "role", "scope", "role_scope",
      "role_mapping_rule", "role_mapping_rule_project",
      "project", "project_relation", "project_secrets_provider_access",
      "settings", "tag_entity", "credentials_entity", "workflow_entity",
      "shared_workflow", "shared_credentials", "workflows_tags",
      "variables", "webhook_entity",
    ];

    await sql.begin(async (tx) => {
      for (const t of [...ordered].reverse()) {
        try {
          await tx.unsafe(`TRUNCATE n8n."${t}" CASCADE`);
        } catch (err) {
          console.warn(`[restore] truncate skipped for ${t}:`, err.message);
        }
      }
      for (const t of ordered) {
        const rows = dump.tables[t];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        for (const row of rows) {
          const cols = Object.keys(row);
          const vals = cols.map((c) => row[c]);
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
          const colList = cols.map((c) => `"${c}"`).join(", ");
          await tx.unsafe(
            `INSERT INTO n8n."${t}" (${colList}) VALUES (${placeholders})`,
            vals,
          );
        }
        console.log(`[restore] ${t}: ${rows.length} rows`);
      }
    });

    console.log("[restore] complete — operator MUST restart n8n service to reload caches");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[restore-n8n-data] FAILED:", err);
  process.exit(1);
});
