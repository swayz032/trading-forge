import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== RECENT llm.retry_attempt rows (last 10) ===");
  const r1: any = await db.execute(sql`
    SELECT created_at, status, error_message, result
    FROM audit_log
    WHERE action = 'llm.retry_attempt'
      AND created_at >= now() - interval '30 minutes'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.log(JSON.stringify(r1, null, 2));

  console.log("\n=== Recent extraction-related audit rows since 13:00 UTC ===");
  const r2: any = await db.execute(sql`
    SELECT created_at, action, status, error_message, result
    FROM audit_log
    WHERE created_at >= '2026-05-26T13:00:00Z'
      AND (action LIKE 'llm.%' OR action LIKE 'extraction.%' OR action LIKE 'scout.%')
    ORDER BY created_at DESC
    LIMIT 30
  `);
  console.log(JSON.stringify(r2, null, 2));

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
