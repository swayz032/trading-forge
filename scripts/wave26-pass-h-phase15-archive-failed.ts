/**
 * Wave 26 Pass H Phase 1.5 — archive smoke-failed strategies per dispatch Step 8 decision gate.
 * Sub-checks 6 (ea=null, expected "ict_bias_aligned_continuation") and 7 (absorbed_sub_concepts only 1 name) FAILED.
 */
import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  const reason = "wave26_pass_h_phase1_5_smoke_failed_checks_6_and_7";

  // The 3 fresh strategies created by re-ingest (correlation 66bcbffc):
  // 912c3417 (MES) / c426c1b3 (MNQ) / af85d0e2 (MCL)
  const ids = [
    "912c3417-9256-454c-90e7-cb01468f846c",
    "c426c1b3-73c0-4106-89b0-998d5935ab61",
    "af85d0e2-5a8e-4bd4-82a5-36f5b460d4d4",
  ];

  for (const id of ids) {
    const r: any = await db.execute(sql`
      UPDATE strategies
      SET archived_at = NOW(),
          archive_reason = ${reason}
      WHERE id = ${id}::uuid
        AND archived_at IS NULL
    `);
    console.log(`archived ${id} rowCount=${r.rowCount ?? "n/a"}`);
  }

  const post: any = await db.execute(sql`
    SELECT id, name, symbol, archived_at, archive_reason
    FROM strategies WHERE id::text IN ('912c3417-9256-454c-90e7-cb01468f846c','c426c1b3-73c0-4106-89b0-998d5935ab61','af85d0e2-5a8e-4bd4-82a5-36f5b460d4d4')
  `);
  console.log("=== POST archive state ===");
  console.log(JSON.stringify(post, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
