/**
 * Wave 26 Pass H Phase 1.5 — pre-state DB verification (dispatch step 0).
 */
import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  const r1: any = await db.execute(sql`
    SELECT param_name, current_value FROM system_parameters WHERE param_name='pipeline_mode'
  `);
  console.log("=== PIPELINE_MODE ===");
  console.log(JSON.stringify(r1, null, 2));

  const r2: any = await db.execute(sql`
    SELECT id, name, archive_reason FROM strategies
    WHERE id::text LIKE 'cf8a9552%' OR id::text LIKE '66ad5518%' OR id::text LIKE 'ae1ecf9f%'
  `);
  console.log("=== ARCHIVED ROLLBACK STRATEGIES (cf8a9552 / 66ad5518 / ae1ecf9f) ===");
  console.log(JSON.stringify(r2, null, 2));

  const r3: any = await db.execute(sql`
    SELECT config->'entry_quality'->>'factor_quality' AS fq, COUNT(*) AS n
    FROM strategies
    WHERE archived_at IS NULL
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  console.log("=== FACTOR_QUALITY DISTRIBUTION (active strategies) ===");
  console.log(JSON.stringify(r3, null, 2));

  const r4: any = await db.execute(sql`
    SELECT COUNT(*) AS active FROM strategies WHERE archived_at IS NULL
  `);
  console.log("=== ACTIVE STRATEGY COUNT ===");
  console.log(JSON.stringify(r4, null, 2));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
