/**
 * W23H.7 — Fresh-start wipe script.
 *
 * Wipes all strategies (and their dependent rows) that are NOT in a
 * protected lifecycle state, preserving the forensic audit trail via
 * tombstone. Intended to be run by the operator before head-start
 * populate (W23H.8) so the library restarts under full Wave 23H shape.
 *
 * Usage:
 *   npx tsx scripts/wipe-strategy-bucket-fresh-start.ts               # dry-run (default)
 *   npx tsx scripts/wipe-strategy-bucket-fresh-start.ts --apply       # execute wipe
 *   npx tsx scripts/wipe-strategy-bucket-fresh-start.ts --apply --i-understand-production
 *
 * Safety guards (REFUSE to proceed if ANY are true):
 *   1. Any strategy in lifecycle_state IN ('PILOT','DEPLOYED') — would kill live trading
 *   2. Any account_strategy_assignments row with released_to_family=true AND status='active'
 *      — would orphan family Pine alerts
 *   3. DATABASE_URL matches a Railway production URL pattern AND --apply given but
 *      --i-understand-production is NOT given
 *
 * Cascade delete order (FK-respecting):
 *   strategy_pending_mentions
 *   → strategy_pending_buckets (TRUNCATE — not FK-linked to strategies; clear entirely)
 *   → strategy_export_artifacts
 *   → account_strategy_assignments
 *   → lifecycle_transitions
 *   → backtest_results  (table alias: backtests)
 *   → walk_forward_results  (table alias: walk_forward_windows)
 *   → bias_state (rows where active_strategy_id matches)
 *   → strategies
 *
 * Audit preservation:
 *   audit_log rows are NOT deleted. Instead their entity_id is NULLed and a
 *   tombstone metadata blob is appended to result JSONB. The append-only trigger
 *   on audit_log would normally reject UPDATEs — therefore this script uses a
 *   special bypass UPDATE that the trigger explicitly allows when the action
 *   field is prefixed "tombstone:". (The trigger allows: NEW.action = 'tombstone:'
 *   || OLD.action — see migration notes below.)
 *
 * NOTE: The audit_log table has an append-only trigger installed in migration 0058.
 * That trigger prevents all UPDATE and DELETE on audit_log rows. To preserve the
 * forensic trail WITHOUT violating the immutability contract, this script does NOT
 * update audit_log rows at all. Instead, it emits a single summary
 * `bulk_strategy_wipe.completed` audit INSERT that records which strategy IDs were
 * wiped and how many audit_log rows they had — giving forensic accountability
 * without touching existing rows.
 */

import "dotenv/config";
import postgres from "postgres";

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
export const IS_APPLY = args.has("--apply");
export const IS_DRY_RUN = !IS_APPLY;
export const IS_UNDERSTAND_PROD = args.has("--i-understand-production");

// ─── Production-URL detection ─────────────────────────────────────────────────

export const PROD_URL_PATTERN = /switchback\.proxy\.rlwy\.net|railway\.app/;

export function detectProductionUrl(dbUrl: string): boolean {
  return PROD_URL_PATTERN.test(dbUrl);
}

// ─── Safety check functions (exported for unit tests) ────────────────────────

export interface ProtectedStrategy {
  id: string;
  name: string;
  lifecycle_state: string;
}

export interface ActiveFamilyAssignment {
  id: number;
  account_id: string;
  strategy_id: string;
}

export interface WipeScope {
  strategies: Array<{ id: string; name: string; lifecycle_state: string }>;
  strategyIds: string[];
}

export interface WipeCounts {
  strategies: number;
  pendingMentions: number;
  pendingBuckets: number;
  exportArtifacts: number;
  accountAssignments: number;
  lifecycleTransitions: number;
  backtestRows: number;
  walkForwardRows: number;
  biasStateRows: number;
  auditLogRows: number;
}

// ─── Main logic ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  const isProd = detectProductionUrl(dbUrl);

  if (IS_APPLY && isProd && !IS_UNDERSTAND_PROD) {
    console.error(
      "REFUSING: DATABASE_URL points at a Railway production instance.\n" +
      "Pass --i-understand-production alongside --apply to confirm you intend to wipe production.\n" +
      "Example: npx tsx scripts/wipe-strategy-bucket-fresh-start.ts --apply --i-understand-production",
    );
    process.exit(1);
  }

  const sql = postgres(dbUrl);

  try {
    await run(sql, IS_APPLY);
  } finally {
    await sql.end();
  }
}

/**
 * Core wipe logic. Exported for testability — callers can inject a mock sql
 * client. Returns the final WipeCounts for assertions.
 */
export async function run(
  sql: postgres.Sql,
  apply: boolean,
): Promise<WipeCounts> {
  console.log(
    apply
      ? "=== WIPE STRATEGY BUCKET — APPLY MODE ==="
      : "=== WIPE STRATEGY BUCKET — DRY-RUN MODE ===",
  );
  if (!apply) {
    console.log("(Pass --apply to execute the wipe)\n");
  }

  // ── Guard 1: PILOT or DEPLOYED strategies ──────────────────────────────────
  const protectedRows = await sql<ProtectedStrategy[]>`
    SELECT id::text, name, lifecycle_state
    FROM strategies
    WHERE lifecycle_state IN ('PILOT', 'DEPLOYED')
  `;

  if (protectedRows.length > 0) {
    console.error(
      `REFUSING: ${protectedRows.length} strateg${protectedRows.length === 1 ? "y" : "ies"} in PILOT or DEPLOYED state — wipe would kill live trading:`,
    );
    for (const s of protectedRows) {
      console.error(`  ${s.id}  |  ${s.name}  |  ${s.lifecycle_state}`);
    }
    process.exit(1);
  }

  // ── Guard 2: active family assignments ─────────────────────────────────────
  const familyRows = await sql<ActiveFamilyAssignment[]>`
    SELECT id, account_id::text, strategy_id::text
    FROM account_strategy_assignments
    WHERE released_to_family = true AND status = 'active'
  `;

  if (familyRows.length > 0) {
    console.error(
      `REFUSING: ${familyRows.length} active family assignment${familyRows.length === 1 ? "" : "s"} with released_to_family=true — wipe would orphan Pine alerts:`,
    );
    for (const a of familyRows) {
      console.error(`  assignment_id=${a.id}  account=${a.account_id}  strategy=${a.strategy_id}`);
    }
    process.exit(1);
  }

  // ── Determine wipe scope ───────────────────────────────────────────────────
  const eligibleRows = await sql<Array<{ id: string; name: string; lifecycle_state: string }>>`
    SELECT id::text, name, lifecycle_state
    FROM strategies
    WHERE lifecycle_state NOT IN ('PILOT', 'DEPLOYED')
    ORDER BY created_at ASC
  `;

  const strategyIds = eligibleRows.map((r) => r.id);

  console.log("Planned wipe scope:");
  console.log(`  strategies eligible:       ${eligibleRows.length}`);

  if (eligibleRows.length === 0) {
    console.log("\nNothing to wipe — bucket is already empty.");

    if (apply) {
      // Emit idempotent completion audit even when there's nothing to do
      await sql`
        INSERT INTO audit_log (action, entity_type, entity_id, result, status, decision_authority)
        VALUES (
          'bulk_strategy_wipe.completed',
          'system',
          NULL,
          ${sql.json({
            wiped_count: 0,
            tombstoned_audit_rows: 0,
            reason: "wave23h_reset_fresh_start",
            idempotent_noop: true,
            timestamp: new Date().toISOString(),
          })},
          'success',
          'system'
        )
      `;
      console.log("\nEmitted bulk_strategy_wipe.completed { wiped_count: 0 } audit.");
    }

    return buildEmptyWipeCounts();
  }

  // ── Count dependent rows (for dry-run reporting + apply verification) ───────
  const counts = await countDependentRows(sql, strategyIds);

  console.log(`  strategy_pending_mentions: ${counts.pendingMentions}`);
  console.log(`  strategy_pending_buckets:  ${counts.pendingBuckets} (entire table — TRUNCATE)`);
  console.log(`  strategy_export_artifacts: ${counts.exportArtifacts}`);
  console.log(`  account_strategy_assignments: ${counts.accountAssignments}`);
  console.log(`  lifecycle_transitions:     ${counts.lifecycleTransitions}`);
  console.log(`  backtests:                 ${counts.backtestRows}`);
  console.log(`  walk_forward_windows:      ${counts.walkForwardRows}`);
  console.log(`  bias_state (linked rows):  ${counts.biasStateRows}`);
  console.log(`  audit_log (to tombstone):  ${counts.auditLogRows}`);

  if (!apply) {
    console.log("\n[DRY-RUN] No changes written. Pass --apply to execute.\n");
    return counts;
  }

  // ── APPLY: execute wipe inside a single transaction ────────────────────────
  console.log("\nExecuting wipe transaction...");

  await sql.begin(async (tx) => {
    // Delete in FK-respecting order

    // 1. strategy_pending_mentions (references strategy via bucket — not direct FK,
    //    but semantically linked; wipe all to avoid orphaned mention rows)
    await tx`DELETE FROM strategy_pending_mentions WHERE strategy_id = ANY(${strategyIds}::uuid[])`;

    // 2. strategy_pending_buckets — this table has no direct FK to strategies.
    //    TRUNCATE the entire table so the bucket is clean for head-start populate.
    await tx`TRUNCATE strategy_pending_buckets`;

    // 3. strategy_export_artifacts
    await tx`DELETE FROM strategy_export_artifacts WHERE strategy_id = ANY(${strategyIds}::uuid[])`;

    // 4. account_strategy_assignments
    await tx`DELETE FROM account_strategy_assignments WHERE strategy_id = ANY(${strategyIds}::uuid[])`;

    // 5. lifecycle_transitions
    await tx`DELETE FROM lifecycle_transitions WHERE strategy_id = ANY(${strategyIds}::uuid[])`;

    // 6. backtests (cascade should take backtest_trades, monte_carlo_runs, etc.)
    await tx`DELETE FROM backtests WHERE strategy_id = ANY(${strategyIds}::uuid[])`;

    // 7. walk_forward_windows
    await tx`DELETE FROM walk_forward_windows WHERE strategy_id = ANY(${strategyIds}::uuid[])`;

    // 8. bias_state rows referencing wiped strategies
    await tx`DELETE FROM bias_state WHERE active_strategy_id = ANY(${strategyIds}::uuid[])`;

    // 9. strategies (root table — last)
    await tx`DELETE FROM strategies WHERE id = ANY(${strategyIds}::uuid[])`;

    // 10. Final audit INSERT (audit_log is append-only — no UPDATE/DELETE)
    await tx`
      INSERT INTO audit_log (action, entity_type, entity_id, result, status, decision_authority)
      VALUES (
        'bulk_strategy_wipe.completed',
        'system',
        NULL,
        ${sql.json({
          wiped_count: strategyIds.length,
          tombstoned_audit_rows: counts.auditLogRows,
          reason: "wave23h_reset_fresh_start",
          wiped_strategy_ids: strategyIds,
          timestamp: new Date().toISOString(),
        })},
        'success',
        'system'
      )
    `;
  });

  console.log(
    `\nWipe complete: ${strategyIds.length} strateg${strategyIds.length === 1 ? "y" : "ies"} removed.`,
  );
  console.log(
    `audit_log rows preserved (${counts.auditLogRows} rows referenced; strategy IDs recorded in bulk_strategy_wipe.completed).`,
  );

  return counts;
}

/**
 * Count all dependent rows for the given strategy IDs.
 * Pure read — no side effects. Exported for tests.
 */
export async function countDependentRows(
  sql: postgres.Sql,
  strategyIds: string[],
): Promise<WipeCounts> {
  if (strategyIds.length === 0) {
    return buildEmptyWipeCounts();
  }

  const [
    mentionsRes,
    bucketsRes,
    artifactsRes,
    assignmentsRes,
    transitionsRes,
    backtestsRes,
    wfRes,
    biasRes,
    auditRes,
  ] = await Promise.all([
    sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM strategy_pending_mentions WHERE strategy_id = ANY(${strategyIds}::uuid[])`,
    sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM strategy_pending_buckets`,
    sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM strategy_export_artifacts WHERE strategy_id = ANY(${strategyIds}::uuid[])`,
    sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM account_strategy_assignments WHERE strategy_id = ANY(${strategyIds}::uuid[])`,
    sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM lifecycle_transitions WHERE strategy_id = ANY(${strategyIds}::uuid[])`,
    sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM backtests WHERE strategy_id = ANY(${strategyIds}::uuid[])`,
    sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM walk_forward_windows WHERE strategy_id = ANY(${strategyIds}::uuid[])`,
    sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM bias_state WHERE active_strategy_id = ANY(${strategyIds}::uuid[])`,
    sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM audit_log WHERE entity_type = 'strategy' AND entity_id = ANY(${strategyIds}::uuid[])`,
  ]);

  return {
    strategies: strategyIds.length,
    pendingMentions: mentionsRes[0].n,
    pendingBuckets: bucketsRes[0].n,
    exportArtifacts: artifactsRes[0].n,
    accountAssignments: assignmentsRes[0].n,
    lifecycleTransitions: transitionsRes[0].n,
    backtestRows: backtestsRes[0].n,
    walkForwardRows: wfRes[0].n,
    biasStateRows: biasRes[0].n,
    auditLogRows: auditRes[0].n,
  };
}

function buildEmptyWipeCounts(): WipeCounts {
  return {
    strategies: 0,
    pendingMentions: 0,
    pendingBuckets: 0,
    exportArtifacts: 0,
    accountAssignments: 0,
    lifecycleTransitions: 0,
    backtestRows: 0,
    walkForwardRows: 0,
    biasStateRows: 0,
    auditLogRows: 0,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────
// Only run main() when invoked directly (not when imported by tests).

const isMain =
  process.argv[1] != null &&
  (process.argv[1].endsWith("wipe-strategy-bucket-fresh-start.ts") ||
    process.argv[1].endsWith("wipe-strategy-bucket-fresh-start.js"));

if (isMain) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
