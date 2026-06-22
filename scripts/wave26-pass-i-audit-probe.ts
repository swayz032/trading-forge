import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  const corrId = process.argv[2] || "fd9ee2d1-fe93-42d9-ab22-be90445dcff9";
  console.log(`=== AUDIT ROWS for correlation_id=${corrId} ===`);
  const r1: any = await db.execute(sql`
    SELECT created_at, action, status,
           input,
           result,
           error_message
    FROM audit_log
    WHERE correlation_id = ${corrId}
    ORDER BY created_at ASC
    LIMIT 200
  `);
  console.log(JSON.stringify(r1, null, 2));

  console.log("\n=== RECENT llm.transcript_extractor_call rows (last 5) ===");
  const r2: any = await db.execute(sql`
    SELECT created_at, status, correlation_id, error_message,
           result->>'model' AS model,
           result->>'provider' AS provider,
           result->>'fellback' AS fellback,
           result->>'fallback_reason' AS fallback_reason,
           result->>'duration_ms' AS duration_ms,
           result->>'transcript_chars' AS transcript_chars
    FROM audit_log
    WHERE action = 'llm.transcript_extractor_call'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log(JSON.stringify(r2, null, 2));

  console.log("\n=== RECENT extraction.config_used rows (last 5) ===");
  const r3: any = await db.execute(sql`
    SELECT created_at, status, correlation_id, result
    FROM audit_log
    WHERE action = 'extraction.config_used'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log(JSON.stringify(r3, null, 2));

  console.log("\n=== RECENT scout.operator_ingested rows (last 5) ===");
  const r4: any = await db.execute(sql`
    SELECT created_at, status, correlation_id,
           input->>'video_id' AS video_id,
           result
    FROM audit_log
    WHERE action = 'scout.operator_ingested'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log(JSON.stringify(r4, null, 2));

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
