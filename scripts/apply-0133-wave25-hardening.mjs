// Wave 25 Hardening operator-action automation
// Apply migration 0133_webhook_latency_audit.sql (idempotent composite index)

import postgres from "postgres";
import { readFileSync } from "fs";

const envContent = readFileSync(".env", "utf-8");
const dbUrlLine = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const dbUrl = dbUrlLine?.split("=").slice(1).join("=").trim();
if (!dbUrl) {
  console.error("FATAL: DATABASE_URL not found in .env");
  process.exit(1);
}
const sql = postgres(dbUrl, { max: 1 });

async function main() {
  console.log("Wave 25 Hardening — Migration 0133 apply");
  console.log("==========================================\n");

  // Step 1: apply migration SQL (idempotent — CREATE INDEX IF NOT EXISTS)
  const migrationSql = readFileSync(
    "src/server/db/migrations/0133_webhook_latency_audit.sql",
    "utf-8",
  );
  await sql.unsafe(migrationSql);
  console.log("[1/4] migration 0133 SQL applied (idempotent)");

  // Step 2: verify composite index exists on audit_log
  const idx = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'audit_log'
      AND indexdef ILIKE '%action%'
      AND indexdef ILIKE '%created_at%'
  `;
  if (idx.length === 0) {
    throw new Error("composite index on audit_log(action, created_at) NOT present");
  }
  console.log(`[2/4] verified: ${idx.length} composite index(es) on audit_log`);
  for (const i of idx) {
    console.log(`       - ${i.indexname}`);
  }

  // Step 3: ensure drizzle migrations journal has 0133 tracked (if drizzle table exists)
  try {
    const drizzleTbl = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    `;
    if (drizzleTbl.length > 0) {
      const existing = await sql`
        SELECT hash, created_at FROM drizzle.__drizzle_migrations
        WHERE hash LIKE '%0133%'
      `;
      if (existing.length === 0) {
        console.log(
          "[3/4] note: drizzle.__drizzle_migrations has no 0133 entry — boot-migration-runner will pick up on next restart",
        );
      } else {
        console.log(
          `[3/4] verified: drizzle tracking has 0133 entry (created_at=${existing[0].created_at.toISOString()})`,
        );
      }
    } else {
      console.log(
        "[3/4] note: drizzle.__drizzle_migrations table absent — pure idempotent apply path; boot-runner will create on next start",
      );
    }
  } catch (e) {
    console.log(`[3/4] drizzle tracking check skipped (${e.message})`);
  }

  // Step 4: write operator-receipt audit_log row (audit_log requires status NOT NULL)
  const auditRow = await sql`
    INSERT INTO audit_log (action, entity_type, status, result, decision_authority, created_at)
    VALUES (
      'migration.0133_applied',
      'migration',
      'success',
      ${sql.json({
        migration: "0133_webhook_latency_audit.sql",
        applied_by: "operator",
        method: "scripts/apply-0133-wave25-hardening.mjs",
        idempotent: true,
        wave: "25-hardening",
        index_created: "audit_log_action_created_at_idx",
      })}::jsonb,
      'human',
      NOW()
    )
    RETURNING id, created_at
  `;
  console.log(
    `[4/4] audit_log receipt written: id=${auditRow[0].id} at ${auditRow[0].created_at.toISOString()}`,
  );

  await sql.end();
  console.log("\n✅ Migration 0133 finalized — webhook latency monitor now has composite index for efficient queries");
}

main().catch(async (e) => {
  console.error("\nFATAL:", e.message);
  if (e.stack) console.error(e.stack);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
