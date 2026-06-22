/**
 * wave25-style-d-legacy-backfill.ts — Wave 25 Pass 2, Y-2
 *
 * One-time idempotent script that migrates legacy positions with
 * currentExitStyle='D' AND entryTime < '2026-05-23' to Style C.
 *
 * Why:
 *   paper-execution-service.ts:2214-2259 still routes positions with
 *   currentExitStyle='D' AND entryTime < STYLE_D_DEPRECATION_DATE to the live
 *   style_d_handler. Without this script that branch is permanent dead code
 *   for any surviving legacy positions. Style D is DEAD per W23F.N (2026-05-19).
 *
 * Safety:
 *   - Dry-run mode (default): prints list without mutating
 *   - Apply mode (--apply): requires --confirm flag
 *   - Idempotent: positions already on Style C are skipped
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/wave25-style-d-legacy-backfill.ts            # dry-run
 *   npx tsx -r dotenv/config scripts/wave25-style-d-legacy-backfill.ts --apply    # errors — requires --confirm
 *   npx tsx -r dotenv/config scripts/wave25-style-d-legacy-backfill.ts --apply --confirm
 *
 * Wave 26 candidate:
 *   After 30 days of zero 'position.exit_style_migrated' events (i.e. this script
 *   has run on prod and no new Style D positions are being created), remove the
 *   style_d_handler branch from paper-execution-service.ts:2257-2259 entirely.
 *   The guard (W24-style-d-runtime-deprecation) will have done its job.
 */

import { db } from "../src/server/db/index.js";
import { paperPositions, auditLog } from "../src/server/db/schema.js";
import { eq, and, lt, sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const CONFIRM = process.argv.includes("--confirm");

/** Date after which Style D is fully deprecated (W23F.N). */
const STYLE_D_DEPRECATION_DATE = "2026-05-23T00:00:00.000Z";

/** Audit action for each migrated position (consumed by observability dashboards). */
const AUDIT_ACTION = "position.exit_style_migrated";

interface LegacyPosition {
  id: string;
  sessionId: string;
  symbol: string;
  side: string;
  entryTime: string | null;
  currentExitStyle: string | null;
}

async function main(): Promise<void> {
  console.log("=== Wave 25 Y-2: Style D Legacy Backfill ===");
  console.log(`Mode: ${APPLY ? (CONFIRM ? "APPLY (mutating)" : "APPLY (missing --confirm — will error)") : "DRY-RUN"}`);
  console.log(`Deprecation cutoff: entryTime < ${STYLE_D_DEPRECATION_DATE}`);
  console.log("");

  if (APPLY && !CONFIRM) {
    console.error("ERROR: --apply requires --confirm flag. Re-run with both flags to proceed.");
    console.error("  npx tsx -r dotenv/config scripts/wave25-style-d-legacy-backfill.ts --apply --confirm");
    process.exit(1);
  }

  // SELECT all open positions with currentExitStyle='D' AND entryTime < deprecation date.
  // Filter: status IS NULL (open positions have no exitTime in paper_positions;
  // exitTime column is the canonical close indicator per paper-execution-service.ts).
  // paperPositions has no strategyId column — strategy is via sessionId -> paperSessions join.
  // Inventory script doesn't need strategy_id; the SQL UPDATE filters on positionId alone.
  const rows = await db
    .select({
      id: paperPositions.id,
      sessionId: paperPositions.sessionId,
      symbol: paperPositions.symbol,
      side: paperPositions.side,
      entryTime: paperPositions.entryTime,
      currentExitStyle: paperPositions.currentExitStyle,
    })
    .from(paperPositions)
    .where(
      and(
        eq(paperPositions.currentExitStyle, "D"),
        lt(paperPositions.entryTime, new Date(STYLE_D_DEPRECATION_DATE)),
      ),
    ) as unknown as LegacyPosition[];

  if (rows.length === 0) {
    console.log("No legacy Style D positions found. Nothing to migrate.");
    process.exit(0);
  }

  console.log(`Found ${rows.length} legacy Style D position(s) to migrate:`);
  console.log("");

  for (const pos of rows) {
    console.log(
      `  [${pos.id}] session=${pos.sessionId} ` +
      `symbol=${pos.symbol} side=${pos.side} entryTime=${pos.entryTime ?? "null"}`,
    );
  }

  console.log("");

  if (!APPLY) {
    console.log("DRY-RUN: no mutations performed. Re-run with --apply --confirm to migrate.");
    process.exit(0);
  }

  // Apply mode: migrate each position and insert audit row.
  const migratedAt = new Date().toISOString();
  let migratedCount = 0;
  let errorCount = 0;

  for (const pos of rows) {
    try {
      // Update currentExitStyle to 'C'
      await db
        .update(paperPositions)
        .set({ currentExitStyle: "C" })
        .where(eq(paperPositions.id, pos.id));

      // Insert audit row documenting the migration (idempotency: position id is entityId)
      await db.insert(auditLog).values({
        action: AUDIT_ACTION,
        entityType: "position",
        entityId: pos.id,
        decisionAuthority: "system",
        result: {
          positionId: pos.id,
          sessionId: pos.sessionId,
          symbol: pos.symbol,
          fromStyle: "D",
          toStyle: "C",
          reason: "wave25_legacy_backfill",
          migratedAt,
          entryTime: pos.entryTime,
        } as Record<string, unknown>,
        status: "success",
        correlationId: null,
        createdAt: new Date(),
      });

      console.log(`  MIGRATED: ${pos.id} (D → C)`);
      migratedCount++;
    } catch (err) {
      console.error(`  ERROR migrating ${pos.id}: ${err instanceof Error ? err.message : String(err)}`);
      errorCount++;
    }
  }

  console.log("");
  console.log(`=== Migration complete: ${migratedCount} migrated, ${errorCount} errors ===`);

  if (errorCount > 0) {
    process.exit(1);
  }

  // Wave 26 reminder
  console.log("");
  console.log(
    "Wave 26 candidate: after 30 days of zero 'position.exit_style_migrated' audit events, " +
    "remove the style_d_handler branch from paper-execution-service.ts:2257-2259 (the " +
    "dead branch guarded by callExitHandler).",
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
