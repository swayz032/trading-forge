// Wave 27 Pass 1 master close-out audit row
// Writes audit_log row: action='wave.27_pass1_master_closed' with full Phase A→E summary.
// Idempotent for operator to run. Companion JSON: docs/wave-27-pass1-master-audit-row.json

import postgres from "postgres";
import { readFileSync } from "fs";

const envContent = readFileSync(".env", "utf-8");
const dbUrlLine = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const dbUrl = dbUrlLine?.split("=").slice(1).join("=").trim();
if (!dbUrl) {
  console.error("DATABASE_URL not found in .env");
  process.exit(1);
}

const payloadJson = readFileSync("docs/wave-27-pass1-master-audit-row.json", "utf-8");
const payload = JSON.parse(payloadJson);

const sql = postgres(dbUrl, { max: 1 });

async function main() {
  // audit_log has no `metadata` column on prod schema — merge orchestration metadata into result jsonb.
  // entity_id is uuid-typed and nullable — 'wave-27-pass1' lives in result.entity_label.
  const mergedResult = {
    ...payload.result,
    entity_label: payload.entity_label,
  };

  const auditRow = await sql`
    INSERT INTO audit_log (action, entity_type, entity_id, result, status, decision_authority, created_at)
    VALUES (
      ${payload.action},
      ${payload.entity_type},
      NULL,
      ${sql.json(mergedResult)},
      ${payload.status},
      ${payload.decision_authority},
      NOW()
    )
    RETURNING id, created_at
  `;
  console.log("wave.27_pass1_master_closed audit row written:", auditRow[0].id, "at", auditRow[0].created_at);

  const cnt = await sql`
    SELECT COUNT(*)::int as count FROM audit_log WHERE action = 'wave.27_pass1_master_closed'
  `;
  console.log("wave.27_pass1_master_closed rows in audit_log:", cnt[0].count);

  await sql.end();
  console.log("\nWave 27 Pass 1 master close-out COMPLETE");
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
