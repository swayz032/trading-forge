/**
 * Pass 19 Cleanup Script — Pre-cross-validation residue removal.
 *
 * This script:
 *   5a. Marks the broken compile-invalid strategy as GRAVEYARD.
 *   5b. Marks the 2 Pass-16 manual-injection strategies as RETIRED.
 *   5c. Expires stale system_journal rows with no strategy_id.
 *   5d. Writes audit_log entries for each action.
 *
 * SAFETY: Uses only lifecycle/status updates — no DELETE. All rows remain
 * queryable for audit. Idempotent — safe to run multiple times.
 *
 * Usage: node scripts/pass19-cleanup.mjs [--dry-run]
 */

import postgres from "postgres";
import { randomUUID } from "crypto";

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Strategy IDs — do not change ────────────────────────────────────────────
// These are the 3 pre-cross-validation residue rows identified in the Pass 19
// audit. Hard-coded here (no magic numbers in queries — IDs are explicit constants).
const BROKEN_STRATEGY_ID   = "a6247ac5-488e-4fa2-b6f9-455f9401583f"; // compile-invalid (config.valid=false)
const MANUAL_STRATEGY_IDS  = [
  "840292c7-ff4a-406c-ae12-3c0e87c40b86",   // Pass-16 manual injection #1
  "759b15e2-88ae-43c9-a1a6-c0c7812b97bc",   // Pass-16 manual injection #2
];

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  // ─── DB connection ────────────────────────────────────────────────────────
  const ssl = dbUrl.includes("railway") || dbUrl.includes("ssl=true")
    ? { rejectUnauthorized: false }
    : undefined;
  const sql = postgres(dbUrl, { ssl, max: 1 });

  console.log(`Pass 19 cleanup — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);

  try {
    // ─── 5a. Mark broken strategy as GRAVEYARD ───────────────────────────
    const broken = await sql`
      SELECT id, name, lifecycle_state, tags
      FROM strategies
      WHERE id = ${BROKEN_STRATEGY_ID}
    `;

    if (broken.length === 0) {
      console.log(`5a. Broken strategy ${BROKEN_STRATEGY_ID} not found — skipped (already deleted or never existed)`);
    } else {
      const row = broken[0];
      console.log(`5a. Broken strategy: id=${row.id} name=${row.name} current_state=${row.lifecycle_state}`);
      if (!DRY_RUN) {
        const result = await sql`
          UPDATE strategies
          SET lifecycle_state = 'GRAVEYARD',
              tags = ARRAY['broken','compile_invalid','pre-pass19'],
              updated_at = NOW()
          WHERE id = ${BROKEN_STRATEGY_ID}
            AND lifecycle_state != 'GRAVEYARD'
        `;
        console.log(`5a. => GRAVEYARD (rows updated: ${result.count})`);
      } else {
        console.log(`5a. => [DRY RUN] would set GRAVEYARD`);
      }
    }

    // ─── 5b. Mark 2 Pass-16 manual strategies as RETIRED ─────────────────
    let retiredCount = 0;
    for (const sid of MANUAL_STRATEGY_IDS) {
      const manual = await sql`
        SELECT id, name, lifecycle_state, tags
        FROM strategies
        WHERE id = ${sid}
      `;

      if (manual.length === 0) {
        console.log(`5b. Manual strategy ${sid} not found — skipped`);
        continue;
      }

      const row = manual[0];
      console.log(`5b. Manual strategy: id=${row.id} name=${row.name} current_state=${row.lifecycle_state}`);
      if (!DRY_RUN) {
        const result = await sql`
          UPDATE strategies
          SET lifecycle_state = 'RETIRED',
              tags = ARRAY['pre-cross-validation','pass-16-manual-injection'],
              updated_at = NOW()
          WHERE id = ${sid}
            AND lifecycle_state NOT IN ('RETIRED','GRAVEYARD')
        `;
        retiredCount += result.count ?? 0;
        console.log(`5b. => RETIRED (rows updated: ${result.count})`);
      } else {
        console.log(`5b. => [DRY RUN] would set RETIRED`);
        retiredCount++;
      }
    }

    // ─── 5c. Expire stale system_journal rows with no strategy_id ─────────
    const staleCountResult = await sql`
      SELECT COUNT(*)::int AS n
      FROM system_journal
      WHERE status IN ('scouted','testing','failed','rejected')
        AND strategy_id IS NULL
        AND created_at < '2026-05-12'
    `;
    const nStale = parseInt(staleCountResult[0].n, 10);
    console.log(`5c. Stale system_journal rows (no strategy_id, pre-2026-05-12): ${nStale}`);

    let expiredCount = 0;
    if (!DRY_RUN) {
      const result = await sql`
        UPDATE system_journal
        SET status = 'expired',
            analyst_notes = COALESCE(analyst_notes, '') || ' [pass19 cleanup: pre-cross-validation residue]'
        WHERE status IN ('scouted','testing','failed','rejected')
          AND strategy_id IS NULL
          AND created_at < '2026-05-12'
      `;
      expiredCount = result.count ?? 0;
      console.log(`5c. => Expired ${expiredCount} rows`);
    } else {
      expiredCount = nStale;
      console.log(`5c. => [DRY RUN] would expire ${nStale} rows`);
    }

    // ─── 5d. Audit log entries ─────────────────────────────────────────────
    if (!DRY_RUN) {
      const auditId = randomUUID();
      const correlationId = randomUUID();
      await sql`
        INSERT INTO audit_log (
          id, action, entity_type, input, result,
          status, decision_authority, correlation_id, created_at
        ) VALUES (
          ${auditId},
          'data.pass19_cleanup',
          'strategies',
          ${{}}::jsonb,
          ${sql.json({
            table: "strategies",
            broken_graveyard_id: BROKEN_STRATEGY_ID,
            manual_retired_ids: MANUAL_STRATEGY_IDS,
            retired_count: retiredCount,
            stale_journal_expired: expiredCount,
          })},
          'completed',
          'pass19_cleanup_script',
          ${correlationId},
          NOW()
        )
      `;
      console.log(`5d. Audit log row written (id=${auditId})`);
    } else {
      console.log(`5d. [DRY RUN] would write audit log row`);
    }

    // ─── Summary ──────────────────────────────────────────────────────────
    console.log(`\nSummary:`);
    console.log(`  Broken strategies set to GRAVEYARD: ${DRY_RUN ? "(dry run)" : broken.length > 0 ? "1" : "0 (not found)"}`);
    console.log(`  Manual strategies set to RETIRED: ${DRY_RUN ? "(dry run)" : retiredCount}`);
    console.log(`  Journal rows expired: ${DRY_RUN ? "(dry run)" : expiredCount}`);
    console.log(DRY_RUN ? "\nDry run complete — no changes written." : "\nCleanup complete.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
