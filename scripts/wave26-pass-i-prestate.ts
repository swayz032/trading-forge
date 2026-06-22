/**
 * Wave 26 Pass I — pre-state DB verification (de4lPhAWke8 + counts).
 */
import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  const r1: any = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM strategies
    WHERE config->>'source_url' LIKE '%dE4lPhAWke8%'
  `);
  console.log("=== STRATEGIES WITH dE4lPhAWke8 (any state) ===");
  console.log(JSON.stringify(r1, null, 2));

  const r1b: any = await db.execute(sql`
    SELECT id, name, archived_at, lifecycle_state, config->>'source_url' AS src
    FROM strategies
    WHERE config->>'source_url' LIKE '%dE4lPhAWke8%'
  `);
  console.log("=== STRATEGIES WITH dE4lPhAWke8 DETAIL ===");
  console.log(JSON.stringify(r1b, null, 2));

  const r2: any = await db.execute(sql`
    SELECT COUNT(DISTINCT m.bucket_id)::int AS n FROM strategy_pending_mentions m
    WHERE m.source_url LIKE '%dE4lPhAWke8%'
  `);
  console.log("=== PENDING BUCKETS WITH dE4lPhAWke8 mentions ===");
  console.log(JSON.stringify(r2, null, 2));

  const r2b: any = await db.execute(sql`
    SELECT b.id, b.status, b.concept_name, b.market, b.graduated_at, b.graduated_strategy_id
    FROM strategy_pending_buckets b
    WHERE b.id IN (
      SELECT DISTINCT bucket_id FROM strategy_pending_mentions
      WHERE source_url LIKE '%dE4lPhAWke8%'
    )
  `);
  console.log("=== PENDING BUCKET DETAIL ===");
  console.log(JSON.stringify(r2b, null, 2));

  const r3: any = await db.execute(sql`
    SELECT COUNT(*)::int AS active FROM strategies WHERE archived_at IS NULL
  `);
  console.log("=== ACTIVE STRATEGY COUNT ===");
  console.log(JSON.stringify(r3, null, 2));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
