#!/usr/bin/env node
/**
 * scripts/backup-n8n-data.mjs
 *
 * Wave 11 (2026-05-17) — defense-in-depth backup for the Railway n8n Postgres
 * schema. The Wave 9 destructive-redeploy incident wiped 29 workflows + 29
 * credentials because n8n was on ephemeral sqlite with no volume. n8n now runs
 * on Postgres schema `n8n` inside the existing postgres-volume, but a bad
 * migration, dropped schema, or operator slip could still wipe state. This
 * script takes a logical backup of the n8n recovery-critical tables to a
 * single gzipped JSON file. Restoration: `node scripts/restore-n8n-data.mjs`.
 *
 * Output: backups/n8n/n8n-data-YYYY-MM-DD.json.gz
 * Retention: keep newest 14 files; older are deleted.
 *
 * Invoked by the `n8n-data-backup-daily` scheduler cron OR runnable manually.
 *
 * Tables backed up (recovery-essential — schema is recreated by n8n migrations):
 *   user, user_api_keys, settings, role, role_scope, scope,
 *   role_mapping_rule, role_mapping_rule_project,
 *   project, project_relation, project_secrets_provider_access,
 *   credentials_entity, workflow_entity, shared_workflow, shared_credentials,
 *   tag_entity, workflows_tags, variables, webhook_entity
 */

import "dotenv/config";
import postgres from "postgres";
import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

const gzip = promisify(zlib.gzip);

const TABLES = [
  "user",
  "user_api_keys",
  "settings",
  "role",
  "role_scope",
  "scope",
  "role_mapping_rule",
  "role_mapping_rule_project",
  "project",
  "project_relation",
  "project_secrets_provider_access",
  "credentials_entity",
  "workflow_entity",
  "shared_workflow",
  "shared_credentials",
  "tag_entity",
  "workflows_tags",
  "variables",
  "webhook_entity",
];

const RETENTION_DAYS = 14;

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export async function runBackup({ outDir = "backups/n8n", logger = console } = {}) {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL / DATABASE_PUBLIC_URL not set");

  const sql = postgres(url, { ssl: "require" });
  const startedAt = Date.now();
  const dump = {
    schema: "n8n",
    backupVersion: 1,
    takenAt: new Date().toISOString(),
    tables: {},
    rowCounts: {},
  };

  // HIGH finding (2026-07-17 telemetry-honesty scan): a per-table read failure
  // used to be swallowed (dump.tables[t] = null, warn-only) while the backup
  // still wrote a .json.gz file and returned a success result. restore-n8n-data.mjs
  // TRUNCATEs every table unconditionally then only re-INSERTs tables where
  // Array.isArray(rows) is true — so a backup with even ONE failed table
  // (e.g. workflow_entity) restores as a silent full wipe of that table,
  // with the backup file itself giving no indication anything was wrong.
  // Any per-table read failure now aborts the whole backup loudly instead of
  // being recorded as a partial success.
  try {
    for (const t of TABLES) {
      let rows;
      try {
        rows = await sql.unsafe(`SELECT * FROM n8n."${t}"`);
      } catch (err) {
        logger.error(`[backup-n8n-data] FAILED reading table ${t}:`, err.message);
        throw new Error(
          `backup-n8n-data: failed reading table "${t}" — aborting backup (no partial/incomplete backup file will be written): ${err.message}`,
        );
      }
      dump.tables[t] = rows;
      dump.rowCounts[t] = rows.length;
    }
  } finally {
    await sql.end();
  }

  await fs.mkdir(outDir, { recursive: true });
  const filename = `n8n-data-${isoDate()}.json.gz`;
  const finalPath = path.join(outDir, filename);
  const tmpPath = `${finalPath}.tmp`;
  const gzipped = await gzip(Buffer.from(JSON.stringify(dump)));
  await fs.writeFile(tmpPath, gzipped);
  await fs.rename(tmpPath, finalPath);

  await rotate(outDir, logger);

  return {
    path: finalPath,
    bytes: gzipped.length,
    rowCounts: dump.rowCounts,
    durationMs: Date.now() - startedAt,
  };
}

async function rotate(outDir, logger) {
  const entries = await fs.readdir(outDir);
  const files = entries
    .filter((f) => /^n8n-data-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f))
    .sort()
    .reverse();
  const stale = files.slice(RETENTION_DAYS);
  for (const f of stale) {
    try {
      await fs.unlink(path.join(outDir, f));
      logger.info?.(`[backup-n8n-data] rotated out ${f}`);
    } catch (err) {
      logger.warn?.(`[backup-n8n-data] rotation failed for ${f}:`, err.message);
    }
  }
}

import { fileURLToPath } from "node:url";
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runBackup()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("[backup-n8n-data] FAILED:", err);
      process.exit(1);
    });
}
