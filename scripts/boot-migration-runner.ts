/**
 * scripts/boot-migration-runner.ts — CLI wrapper for the boot migration runner.
 *
 * This script re-exports the runPendingMigrations() function from
 * src/server/lib/boot-migration-runner.ts, which is the compiled module
 * wired into src/server/index.ts.
 *
 * Can be invoked directly for operator dry-runs:
 *   npx tsx scripts/boot-migration-runner.ts
 *
 * ENV vars respected (same as the server wiring):
 *   BOOT_MIGRATION_ENABLED=true
 *   BOOT_MIGRATION_ALLOW_NO_BACKUP=false
 *   BOOT_MIGRATION_BACKUP_DIR
 *   BOOT_MIGRATION_TIMEOUT_MS=300000
 */

// Re-export for importers
export { runPendingMigrations } from "../src/server/lib/boot-migration-runner.js";

// ─── CLI entry point ──────────────────────────────────────────────────────────
// When run directly (not imported), execute immediately.
// import.meta.url check is the ESM equivalent of `require.main === module`.

import { fileURLToPath } from "node:url";
import process from "node:process";

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(
    process.argv[1].replace(/\\/g, "/").split("/scripts/")[1] ?? "",
  );

if (
  isMain ||
  process.argv[1]?.includes("boot-migration-runner")
) {
  import("../src/server/load-env.js").catch(() => {
    // load-env is optional in scripts context
  });

  const { runPendingMigrations } = await import("../src/server/lib/boot-migration-runner.js");
  try {
    await runPendingMigrations();
    console.log("boot-migration-runner: completed successfully");
    process.exit(0);
  } catch (err) {
    console.error("boot-migration-runner: FAILED —", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
