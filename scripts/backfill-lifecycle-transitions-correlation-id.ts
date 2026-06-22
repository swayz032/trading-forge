/**
 * backfill-lifecycle-transitions-correlation-id.ts
 *
 * Wave 6 Fix 1 — best-effort backfill of correlation_id on existing
 * lifecycle_transitions rows that were written before migration 0106.
 *
 * STRATEGY:
 *   For each lifecycle_transitions row with correlation_id IS NULL,
 *   find the most-recent audit_log row for the same entityId (strategy_id)
 *   within ±10 seconds of the lifecycle_transitions.created_at, that has
 *   a non-null correlation_id. Use that correlation_id as the backfill value.
 *
 * RATIONALE:
 *   The lifecycle_transitions dual-write contract always fires inside the same
 *   db.transaction() that writes the paired audit_log row. So both rows should
 *   share the same created_at timestamp (±1s DB clock variance). The ±10s
 *   window is intentionally generous to survive any burst-commit latency.
 *
 * LIMITATIONS (expected):
 *   Many rows will remain NULL after backfill because their paired audit_log
 *   row was itself written without correlation_id (the 79% gap Wave 6 Fix 2
 *   addresses). This is correct — we log the counts as evidence.
 *
 * IDEMPOTENT: Re-runnable. Already-backfilled rows (correlation_id IS NOT NULL)
 * are skipped by the WHERE clause.
 *
 * RUN AFTER applying migration 0106 to Railway Postgres:
 *   npx tsx scripts/backfill-lifecycle-transitions-correlation-id.ts
 */

import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { insertAuditRow } from "../src/server/lib/audit-log-helper.js";

const BATCH_SIZE = 1000;
const WINDOW_SECONDS = 10;

// audit_log.entity_id is UUID-typed; system-level scripts generate a run UUID
// so each backfill invocation is queryable as its own entity.
const RUN_ID = randomUUID();

interface BackfillCandidate extends Record<string, unknown> {
  id: string;
  strategy_id: string;
  created_at: Date;
}

interface AuditMatch extends Record<string, unknown> {
  correlation_id: string;
}

async function backfillBatch(candidates: BackfillCandidate[]): Promise<number> {
  let backfilled = 0;

  for (const row of candidates) {
    // Find best audit_log match: same entity, within ±WINDOW_SECONDS, non-null correlation_id
    // Order by closest timestamp first, then by most-recent (in case of tie).
    const matches = await db.execute<AuditMatch>(sql`
      SELECT correlation_id
      FROM audit_log
      WHERE entity_id = ${row.strategy_id}
        AND entity_type = 'strategy'
        AND correlation_id IS NOT NULL
        AND created_at BETWEEN
          ${row.created_at}::timestamptz - interval '${sql.raw(String(WINDOW_SECONDS))} seconds'
          AND
          ${row.created_at}::timestamptz + interval '${sql.raw(String(WINDOW_SECONDS))} seconds'
      ORDER BY
        ABS(EXTRACT(EPOCH FROM (created_at - ${row.created_at}::timestamptz))) ASC,
        created_at DESC
      LIMIT 1
    `);

    const match = [...matches][0];
    if (!match?.correlation_id) continue;

    await db.execute(sql`
      UPDATE lifecycle_transitions
      SET correlation_id = ${match.correlation_id}
      WHERE id = ${row.id}
        AND correlation_id IS NULL
    `);

    backfilled++;
  }

  return backfilled;
}

async function main(): Promise<void> {
  console.log("[backfill] Starting lifecycle_transitions.correlation_id backfill...");

  // Count total null rows before starting
  const totalResult = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) as count
    FROM lifecycle_transitions
    WHERE correlation_id IS NULL
  `);
  const totalNullRows =
    parseInt(([...totalResult][0])?.count ?? "0", 10);

  console.log(`[backfill] Rows with NULL correlation_id: ${totalNullRows}`);

  if (totalNullRows === 0) {
    console.log("[backfill] Nothing to backfill. Exiting.");
    await insertAuditRow({
      action: "lifecycle_transitions.correlation_id_backfilled",
      entityType: "system",
      entityId: RUN_ID,
      status: "success",
      decisionAuthority: "system",
      input: { script: "backfill-lifecycle-transitions-correlation-id.ts", run_id: RUN_ID },
      result: {
        total_null_before: 0,
        backfilled: 0,
        remaining_null: 0,
        note: "No rows needed backfill",
      },
      correlationId: RUN_ID,
    });
    return;
  }

  let offset = 0;
  let totalBackfilled = 0;

  // Process in batches with explicit per-batch commits
  while (true) {
    const batchResult = await db.execute<BackfillCandidate>(sql`
      SELECT id, strategy_id, created_at
      FROM lifecycle_transitions
      WHERE correlation_id IS NULL
      ORDER BY created_at ASC
      LIMIT ${BATCH_SIZE}
      OFFSET ${offset}
    `);

    const candidates: BackfillCandidate[] = [...batchResult];

    if (!candidates || candidates.length === 0) break;

    console.log(
      `[backfill] Processing batch offset=${offset}, size=${candidates.length}...`,
    );

    // Each batch runs in its own transaction for explicit commit boundaries
    const batchBackfilled = await db.transaction(async () => {
      return backfillBatch(candidates);
    });

    totalBackfilled += batchBackfilled;
    offset += candidates.length;

    console.log(
      `[backfill] Batch done. Backfilled this batch: ${batchBackfilled}. Running total: ${totalBackfilled}.`,
    );

    if (candidates.length < BATCH_SIZE) break;
  }

  // Count remaining null rows
  const remainingResult = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) as count
    FROM lifecycle_transitions
    WHERE correlation_id IS NULL
  `);
  const remainingNull =
    parseInt(([...remainingResult][0])?.count ?? "0", 10);

  console.log(`[backfill] Complete.`);
  console.log(`  Rows backfilled:  ${totalBackfilled}`);
  console.log(`  Remaining null:   ${remainingNull}`);
  console.log(
    `  (${remainingNull} rows remain NULL because their paired audit_log row also lacked correlation_id — expected, Wave 6 Fix 2 addresses audit_log gap)`,
  );

  // Write audit evidence row
  await insertAuditRow({
    action: "lifecycle_transitions.correlation_id_backfilled",
    entityType: "system",
    entityId: RUN_ID,
    status: "success",
    decisionAuthority: "system",
    input: {
      script: "backfill-lifecycle-transitions-correlation-id.ts",
      run_id: RUN_ID,
      batch_size: BATCH_SIZE,
      window_seconds: WINDOW_SECONDS,
    },
    result: {
      total_null_before: totalNullRows,
      backfilled: totalBackfilled,
      remaining_null: remainingNull,
      note:
        "Best-effort backfill via audit_log join. Remaining NULLs expected (audit_log gap covered by Wave 6 Fix 2).",
    },
    correlationId: RUN_ID,
  });

  console.log("[backfill] Audit evidence row written.");
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
