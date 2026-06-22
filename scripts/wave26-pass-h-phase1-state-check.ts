/**
 * Wave 26 Pass H Phase 1 — pre/post DB state check
 */
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  const r1 = await db.execute(sql`
    SELECT config->'entry_quality'->'factor_quality' as fq_raw,
           config->'entry_quality'->>'factor_quality' as fq_text,
           COUNT(*) as n
    FROM strategies
    WHERE archived_at IS NULL
    GROUP BY 1, 2
    ORDER BY 3 DESC
  `);
  console.log("=== DISTRIBUTION (raw JSONB + text extract) ===");
  console.log(JSON.stringify(r1.rows, null, 2));

  const r2 = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE config->>'source_url' IS NOT NULL) as src,
      COUNT(*) FILTER (WHERE config->>'entry_archetype' IS NOT NULL) as ea,
      COUNT(*) FILTER (WHERE config->>'source_bucket_id' IS NOT NULL) as bid,
      COUNT(*) as total
    FROM strategies
    WHERE archived_at IS NULL
  `);
  console.log("=== STAMPING ===");
  console.log(JSON.stringify(r2.rows, null, 2));

  const r3 = await db.execute(sql`
    SELECT config->>'entry_indicator' as ei, COUNT(*) as n
    FROM strategies
    WHERE archived_at IS NULL
      AND config->'entry_quality'->>'factor_quality' = 'thin'
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  console.log("=== THIN BREAKDOWN by entry_indicator ===");
  console.log(JSON.stringify(r3.rows, null, 2));

  const r4 = await db.execute(sql`
    SELECT key, value FROM system_parameters WHERE key='pipeline_mode'
  `);
  console.log("=== PIPELINE_MODE ===");
  console.log(JSON.stringify(r4.rows, null, 2));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
