/**
 * Live-schema drift canary — CLI probe.
 *
 * Shared logic lives in src/server/lib/schema-drift-check.ts (also consumed by
 * the boot-time canary in src/server/index.ts). See that file for the full
 * incident history (bias_state 0134 class: journal-marked-applied migrations
 * whose DDL never executed on the production DB → 2 months of silently
 * swallowed bias_state INSERT failures behind green engine audits).
 *
 * USAGE:
 *   npx tsx scripts/check-live-schema-drift.ts            # human report, exit 1 on drift
 *   npx tsx scripts/check-live-schema-drift.ts --json     # machine-readable
 *   (DATABASE_URL must be set; read-only — information_schema queries only.)
 */
import { computeSchemaDrift } from "../src/server/lib/schema-drift-check.js";

(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, { ssl: "require", max: 1 });
  try {
    const report = await computeSchemaDrift(async (text) => {
      return (await sql.unsafe(text)) as unknown as Array<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        udt_name?: string | null;
      }>;
    });
    // Nullable mismatches are advisory-only (see schema-drift-check.ts docstring) — they
    // are always printed/returned but do not affect the exit code, matching the boot
    // canary's severity treatment (structural absence + type mismatches are the
    // throws-or-corrupts-data class this canary exists to fail loudly on).
    const hasDrift =
      report.missingTables.length > 0 ||
      report.missingColumns.length > 0 ||
      report.typeMismatches.length > 0;

    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Checked ${report.tablesChecked} tables / ${report.columnsChecked} columns against live DB.`);
      if (!hasDrift && report.nullableMismatches.length === 0) {
        console.log("NO DRIFT: every schema.ts table/column exists live with matching type + nullability.");
      } else {
        for (const t of report.missingTables) console.log(`MISSING TABLE:  ${t}`);
        for (const c of report.missingColumns) console.log(`MISSING COLUMN: ${c.table}.${c.column}`);
        for (const m of report.typeMismatches) {
          console.log(`TYPE MISMATCH:  ${m.table}.${m.column} (declared=${m.declaredType}, live=${m.liveType})`);
        }
        for (const n of report.nullableMismatches) {
          console.log(
            `NULLABLE MISMATCH (advisory): ${n.table}.${n.column} (declaredNotNull=${n.declaredNotNull}, liveNullable=${n.liveNullable})`,
          );
        }
      }
    }
    process.exit(hasDrift ? 1 : 0);
  } finally {
    await sql.end();
  }
})().catch((err) => {
  console.error("schema drift check failed:", err);
  process.exit(2);
});
