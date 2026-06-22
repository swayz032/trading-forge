/**
 * Wave 26 Pass H Phase 1.5 — destructive cleanup of dE4lPhAWke8 state.
 * Order: nullify bucket→strategy FK refs → delete mentions → delete buckets → delete strategies.
 */
import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  // 1. Find dE4lPhAWke8 buckets via mentions
  const dE4Buckets: any = await db.execute(sql`
    SELECT DISTINCT b.id, b.concept_name, b.entry_archetype, b.market, b.graduated_strategy_id
    FROM strategy_pending_buckets b
    JOIN strategy_pending_mentions m ON m.bucket_id = b.id
    WHERE m.source_url LIKE '%dE4lPhAWke8%'
  `);
  console.log("=== dE4lPhAWke8 buckets ===");
  console.log(JSON.stringify(dE4Buckets, null, 2));
  const bucketIds: string[] = (dE4Buckets as any[]).map((r: any) => r.id);

  // 2. Find all buckets whose graduated_strategy_id points at the 3 target strategies
  //    (FK ON DELETE NO ACTION blocks until we either NULL these refs or delete the buckets)
  const referencingBuckets: any = await db.execute(sql`
    SELECT id, concept_name, graduated_strategy_id
    FROM strategy_pending_buckets
    WHERE graduated_strategy_id::text LIKE 'cf8a9552%'
       OR graduated_strategy_id::text LIKE '66ad5518%'
       OR graduated_strategy_id::text LIKE 'ae1ecf9f%'
  `);
  console.log("=== buckets referencing rollback strategies ===");
  console.log(JSON.stringify(referencingBuckets, null, 2));

  // 3. Delete mentions for dE4lPhAWke8 buckets first
  let totalMentions = 0;
  for (const bid of bucketIds) {
    const r: any = await db.execute(sql`
      DELETE FROM strategy_pending_mentions WHERE bucket_id = ${bid}::uuid
    `);
    totalMentions += r.rowCount ?? 0;
  }
  console.log("=== mentions deleted (dE4 buckets) ===", totalMentions);

  // 4. Delete the dE4lPhAWke8 buckets themselves
  let bucketsDel = 0;
  for (const bid of bucketIds) {
    const r: any = await db.execute(sql`DELETE FROM strategy_pending_buckets WHERE id = ${bid}::uuid`);
    bucketsDel += r.rowCount ?? 0;
  }
  console.log("=== buckets deleted ===", bucketsDel);

  // 5. Catch any orphan mentions still referencing dE4lPhAWke8 source_url
  const orphMent: any = await db.execute(sql`
    DELETE FROM strategy_pending_mentions WHERE source_url LIKE '%dE4lPhAWke8%'
  `);
  console.log("=== orphan mentions deleted ===", orphMent.rowCount ?? 0);

  // 6. Now we can delete the 3 archived rollback strategies (FK references cleared)
  const delStrats: any = await db.execute(sql`
    DELETE FROM strategies
    WHERE id::text LIKE 'cf8a9552%' OR id::text LIKE '66ad5518%' OR id::text LIKE 'ae1ecf9f%'
  `);
  console.log("=== strategies (rollback) deleted ===", delStrats.rowCount ?? 0);

  // 7. Catch any other strategies still referencing dE4lPhAWke8
  const delAnyStrats: any = await db.execute(sql`
    DELETE FROM strategies WHERE config->>'source_url' LIKE '%dE4lPhAWke8%'
  `);
  console.log("=== strategies (any dE4lPhAWke8 src_url) deleted ===", delAnyStrats.rowCount ?? 0);

  // 8. Verify clean
  const ps: any = await db.execute(sql`SELECT COUNT(*) AS n FROM strategies WHERE config->>'source_url' LIKE '%dE4lPhAWke8%'`);
  const pm: any = await db.execute(sql`SELECT COUNT(*) AS n FROM strategy_pending_mentions WHERE source_url LIKE '%dE4lPhAWke8%'`);
  const pb: any = await db.execute(sql`
    SELECT COUNT(*) AS n FROM strategy_pending_buckets b
    WHERE EXISTS (SELECT 1 FROM strategy_pending_mentions m WHERE m.bucket_id = b.id AND m.source_url LIKE '%dE4lPhAWke8%')
  `);
  console.log("=== POST strategies dE4 ===", JSON.stringify(ps));
  console.log("=== POST mentions dE4 ===", JSON.stringify(pm));
  console.log("=== POST buckets dE4 ===", JSON.stringify(pb));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
