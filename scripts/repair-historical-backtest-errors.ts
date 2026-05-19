/**
 * Repair Historical Backtest error_message Column
 *
 * Wave 6 Fix 3: The Python startup banner "All N context layers imported and
 * callable." was incorrectly stored as error_message on completed backtest rows
 * where Python exited with code != 0 but emitted only the informational banner
 * to stderr.
 *
 * This script identifies rows where:
 *   - status = 'completed'  (backtest produced valid results)
 *   - error_message LIKE '%All % context layers imported and callable%'
 *     (spurious banner stored as error)
 *
 * And clears the error_message column to null on those rows.
 *
 * OPERATOR RUNS MANUALLY — do not execute automatically.
 *
 * Usage:
 *   npx tsx scripts/repair-historical-backtest-errors.ts [--dry-run]
 *
 * Options:
 *   --dry-run   Preview affected rows without updating (default: dry-run)
 *   --execute   Actually perform the update
 */

import { db } from "../src/server/db/index.js";
import { backtests } from "../src/server/db/schema.js";
import { and, eq, like, isNotNull } from "drizzle-orm";

const isDryRun = !process.argv.includes("--execute");

if (isDryRun) {
  console.log("[repair-historical-backtest-errors] DRY RUN — pass --execute to apply changes");
} else {
  console.log("[repair-historical-backtest-errors] EXECUTE mode — will update rows");
}

async function main() {
  // Find affected rows: completed backtests with the banner as error_message
  const affected = await db
    .select({
      id: backtests.id,
      strategyId: backtests.strategyId,
      errorMessage: backtests.errorMessage,
      createdAt: backtests.createdAt,
    })
    .from(backtests)
    .where(
      and(
        eq(backtests.status, "completed"),
        isNotNull(backtests.errorMessage),
        like(backtests.errorMessage as unknown as string, "%All % context layers imported and callable%"),
      ),
    );

  console.log(`[repair-historical-backtest-errors] Found ${affected.length} affected row(s)`);

  if (affected.length === 0) {
    console.log("[repair-historical-backtest-errors] No rows to repair. Done.");
    return;
  }

  for (const row of affected) {
    console.log(`  - backtest ${row.id} (strategy ${row.strategyId}, created ${row.createdAt})`);
    console.log(`    error_message: "${row.errorMessage}"`);
  }

  if (isDryRun) {
    console.log("\n[repair-historical-backtest-errors] DRY RUN complete. Pass --execute to clear these error_message values.");
    return;
  }

  // Execute: clear error_message on all affected rows
  let updatedCount = 0;
  for (const row of affected) {
    await db
      .update(backtests)
      .set({ errorMessage: null })
      .where(eq(backtests.id, row.id));
    updatedCount++;
    console.log(`  [updated] ${row.id}`);
  }

  console.log(`\n[repair-historical-backtest-errors] Updated ${updatedCount} row(s). error_message cleared.`);
}

main().catch((err) => {
  console.error("[repair-historical-backtest-errors] Fatal error:", err);
  process.exit(1);
});
