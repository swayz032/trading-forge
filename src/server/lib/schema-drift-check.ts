/**
 * Live-schema drift canary — shared logic (2026-07-17, goalscan-r2 wave,
 * Fable advisor ruling: "the manual probe becomes an automated canary").
 *
 * THE CLASS THIS GUARDS (three documented instances, one class — contracts
 * drifted and mocks hid it):
 *   1. backtester reader drift (historical).
 *   2. quantum_rl_agent._load_production_state_at() SELECTing bias_state
 *      columns that exist in NO migration (imagined schema; unit tests passed
 *      only because they mocked the cursor).
 *   3. Live DB missing bias_state.structure_state / backtest_matrix.correlations
 *      / the entire transcript_fetch_outcomes table — migrations 0134/0007/0118
 *      journal-marked applied but DDL never executed on production. The 0134
 *      gap killed bias_state persistence SILENTLY for ~2 months (every INSERT
 *      threw into a swallowed logger.warn while bias_engine audits stayed
 *      green). Forward-fixed by migration 0203.
 *
 * WHAT IT DOES: introspects every pgTable exported from schema.ts via drizzle's
 * getTableConfig and compares (table, column) pairs against the connected DB's
 * information_schema. Missing tables/columns = drift. Extra live objects are
 * NOT flagged (additive live state is benign).
 *
 * CONSUMERS:
 *   - scripts/check-live-schema-drift.ts  (CLI probe / CI-adjacent use)
 *   - runBootSchemaDriftCanary()          (fire-and-forget at server boot:
 *     audit row + Discord WARN on drift; NEVER fail-closed — a drift REPORT
 *     must not brick the API; the boot-migration runner remains the enforcement
 *     layer for migration application itself)
 */
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { db } from "../db/index.js";
import { logger } from "./logger.js";
import { insertAuditRow } from "./audit-log-helper.js";

export interface SchemaDriftReport {
  missingTables: string[];
  missingColumns: { table: string; column: string }[];
  tablesChecked: number;
  columnsChecked: number;
}

/** Collect (table -> declared column names) from every pgTable export in schema.ts. */
export function collectDeclaredSchema(): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  for (const exported of Object.values(schema)) {
    if (!(exported instanceof PgTable)) continue;
    const cfg = getTableConfig(exported as PgTable);
    declared.set(
      cfg.name,
      cfg.columns.map((c) => c.name),
    );
  }
  return declared;
}

/**
 * Compare declared schema vs a live DB's information_schema.
 * `queryRows` abstracts the driver so the tsx CLI (postgres.js) and the server
 * boot path (drizzle db.execute) reuse identical comparison logic.
 */
export async function computeSchemaDrift(
  queryRows: (sqlText: string) => Promise<Array<{ table_name: string; column_name: string }>>,
): Promise<SchemaDriftReport> {
  const declared = collectDeclaredSchema();
  const liveRows = await queryRows(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'`,
  );
  const live = new Map<string, Set<string>>();
  for (const row of liveRows) {
    if (!live.has(row.table_name)) live.set(row.table_name, new Set());
    live.get(row.table_name)!.add(row.column_name);
  }

  const missingTables: string[] = [];
  const missingColumns: { table: string; column: string }[] = [];
  let columnsChecked = 0;

  for (const [table, cols] of declared) {
    const liveCols = live.get(table);
    if (!liveCols) {
      missingTables.push(table);
      continue;
    }
    for (const col of cols) {
      columnsChecked++;
      if (!liveCols.has(col)) missingColumns.push({ table, column: col });
    }
  }

  return {
    missingTables: missingTables.sort(),
    missingColumns: missingColumns.sort((a, b) =>
      `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`),
    ),
    tablesChecked: declared.size,
    columnsChecked,
  };
}

/**
 * Boot-time canary: run the drift check against the server's own DB handle.
 * Fire-and-forget (never throws, never blocks boot). On drift: warn audit row
 * (queryable surface) + logger. On clean: info audit row so "the canary ran"
 * is itself auditable (a canary that only speaks on failure can die silently).
 */
export async function runBootSchemaDriftCanary(): Promise<SchemaDriftReport | null> {
  try {
    const report = await computeSchemaDrift(async (text) => {
      const result = await db.execute(sql.raw(text));
      return (result as unknown as { rows?: Array<{ table_name: string; column_name: string }> }).rows
        ?? (result as unknown as Array<{ table_name: string; column_name: string }>);
    });
    const driftCount = report.missingTables.length + report.missingColumns.length;
    if (driftCount > 0) {
      logger.error(
        { missingTables: report.missingTables, missingColumns: report.missingColumns },
        "schema-drift-canary: LIVE DB IS MISSING schema.ts objects — writes naming them will THROW (bias_state 0134 class)",
      );
      await insertAuditRow({
        action: "boot.schema_drift_detected",
        entityType: "scheduler",
        entityId: "schema-drift-canary",
        decisionAuthority: "system",
        status: "warning",
        result: {
          missing_tables: report.missingTables,
          missing_columns: report.missingColumns.map((c) => `${c.table}.${c.column}`),
          tables_checked: report.tablesChecked,
          columns_checked: report.columnsChecked,
          note: "Code writing/reading these objects throws at runtime. Fix FORWARD with a new idempotent migration (never re-run an applied one).",
        },
      }).catch(() => { /* audit fail-soft */ });
    } else {
      await insertAuditRow({
        action: "boot.schema_drift_clean",
        entityType: "scheduler",
        entityId: "schema-drift-canary",
        decisionAuthority: "system",
        status: "success",
        result: { tables_checked: report.tablesChecked, columns_checked: report.columnsChecked },
      }).catch(() => { /* audit fail-soft */ });
    }
    return report;
  } catch (err) {
    logger.warn({ err: String(err) }, "schema-drift-canary: check failed (non-blocking)");
    return null;
  }
}
