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
 * TYPE + NULLABLE DRIFT (fix-wave telemetry-honesty-registry-dashboards,
 * 2026-07-17 — HIGH finding): the check above only ever compared column NAME
 * existence, so a column that exists but has silently drifted to the wrong
 * live type (e.g. a `jsonb` column altered to `text` out-of-band, or a
 * `NOT NULL` constraint dropped live) was invisible — the exact class of bug
 * "schema-drift-check" exists to catch. Now also compares each column's
 * declared SQL type family (via drizzle's `getSQLType()`) and declared
 * `.notNull()` against `information_schema.columns.data_type` (+ `udt_name`
 * for array element types) and `is_nullable`.
 *
 * Comparison is FAMILY-level, not exact-string, by design: `getSQLType()` and
 * Postgres's `information_schema.columns.data_type` use different
 * vocabularies for the *same* type even with zero drift —
 * `timestamp("col")` (no `withTimezone`) reports drizzle-side `"timestamp"`
 * while every migrated live column is `TIMESTAMPTZ` → live
 * `"timestamp with time zone"` (verified empirically against the real
 * schema.ts + PGlite-mirrored DDL: this pairing recurs on essentially every
 * `created_at`/`updated_at` column in the schema — a pre-existing,
 * long-standing, harmless declaration gap, not incident-worthy drift).
 * Likewise `text[]` (drizzle) vs `ARRAY`+`udt_name:"_text"` (live), and
 * `numeric(12, 4)` (drizzle, precision baked into the type string) vs
 * `numeric` (live — Postgres reports precision/scale in separate columns,
 * never in `data_type`). `canonicalizeSqlTypeFamily()` normalizes both sides
 * to the same small vocabulary (integer/bigint/smallint/numeric/real/double
 * precision/boolean/text/uuid/json/bytea/date/timestamp/time/array<...>) so
 * these known-benign formatting differences don't drown genuine cross-family
 * drift (text vs integer, jsonb vs text, etc.) in false positives.
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

export interface SchemaColumnTypeMismatch {
  table: string;
  column: string;
  declaredType: string;
  liveType: string;
}

export interface SchemaColumnNullableMismatch {
  table: string;
  column: string;
  declaredNotNull: boolean;
  liveNullable: boolean;
}

export interface SchemaDriftReport {
  missingTables: string[];
  missingColumns: { table: string; column: string }[];
  typeMismatches: SchemaColumnTypeMismatch[];
  nullableMismatches: SchemaColumnNullableMismatch[];
  tablesChecked: number;
  columnsChecked: number;
}

export interface DeclaredColumn {
  name: string;
  /** Raw drizzle `Column.getSQLType()` string, e.g. "timestamp", "text[]", "numeric(12, 4)". */
  sqlType: string;
  notNull: boolean;
}

/** Collect (table -> declared columns, with type + nullability) from every pgTable export in schema.ts. */
export function collectDeclaredSchema(): Map<string, DeclaredColumn[]> {
  const declared = new Map<string, DeclaredColumn[]>();
  for (const exported of Object.values(schema)) {
    if (!(exported instanceof PgTable)) continue;
    const cfg = getTableConfig(exported as PgTable);
    declared.set(
      cfg.name,
      cfg.columns.map((c) => ({ name: c.name, sqlType: c.getSQLType(), notNull: c.notNull })),
    );
  }
  return declared;
}

/**
 * Postgres/drizzle type-name aliases that resolve to the SAME family. Keys are
 * lowercased, precision/length-stripped base type names from EITHER side
 * (drizzle's `getSQLType()` or `information_schema.columns.data_type`/`udt_name`).
 */
const SQL_TYPE_FAMILY_ALIASES: Record<string, string> = {
  int4: "integer",
  int: "integer",
  integer: "integer",
  serial: "integer",
  int8: "bigint",
  bigint: "bigint",
  bigserial: "bigint",
  int2: "smallint",
  smallint: "smallint",
  smallserial: "smallint",
  numeric: "numeric",
  decimal: "numeric",
  real: "real",
  float4: "real",
  "double precision": "double precision",
  float8: "double precision",
  boolean: "boolean",
  bool: "boolean",
  text: "text",
  varchar: "text",
  "character varying": "text",
  character: "text",
  char: "text",
  bpchar: "text",
  uuid: "uuid",
  json: "json",
  jsonb: "json",
  bytea: "bytea",
  date: "date",
  timestamp: "timestamp",
  "timestamp without time zone": "timestamp",
  "timestamp with time zone": "timestamp",
  timestamptz: "timestamp",
  time: "time",
  "time without time zone": "time",
  "time with time zone": "time",
  timetz: "time",
  inet: "inet",
  cidr: "cidr",
  macaddr: "macaddr",
};

function stripTypeParams(rawType: string): string {
  return rawType.replace(/\(.*\)$/, "").trim();
}

/** Strip a leading Postgres array-udt underscore prefix: "_text" -> "text", "_int4" -> "int4". */
function stripArrayUdtPrefix(udtName: string): string {
  return udtName.startsWith("_") ? udtName.slice(1) : udtName;
}

function familyOf(baseType: string): string {
  const key = stripTypeParams(baseType).toLowerCase();
  return SQL_TYPE_FAMILY_ALIASES[key] ?? key;
}

/**
 * Canonicalize a drizzle `getSQLType()` string into a comparable type family,
 * e.g. `"numeric(12, 4)"` -> `"numeric"`, `"text[]"` -> `"array<text>"`,
 * `"timestamp with time zone"` -> `"timestamp"`.
 */
export function canonicalizeDrizzleSqlType(rawType: string): string {
  const trimmed = rawType.trim();
  if (trimmed.endsWith("[]")) {
    return `array<${familyOf(trimmed.slice(0, -2))}>`;
  }
  return familyOf(trimmed);
}

/**
 * Canonicalize a live `information_schema.columns` row into the same type
 * family vocabulary. Postgres reports array columns as `data_type: "ARRAY"`
 * with the element type only in `udt_name` (e.g. `"_text"`), so `udtName` is
 * required to resolve array element families.
 */
export function canonicalizeLiveSqlType(dataType: string, udtName: string | null | undefined): string {
  if (dataType.toUpperCase() === "ARRAY") {
    const elementType = udtName ? stripArrayUdtPrefix(udtName) : "unknown";
    return `array<${familyOf(elementType)}>`;
  }
  return familyOf(dataType);
}

interface LiveColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  udt_name?: string | null;
}

/**
 * Compare declared schema vs a live DB's information_schema.
 * `queryRows` abstracts the driver so the tsx CLI (postgres.js) and the server
 * boot path (drizzle db.execute) reuse identical comparison logic.
 */
export async function computeSchemaDrift(
  queryRows: (sqlText: string) => Promise<Array<LiveColumnRow>>,
): Promise<SchemaDriftReport> {
  const declared = collectDeclaredSchema();
  const liveRows = await queryRows(
    `SELECT table_name, column_name, data_type, is_nullable, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public'`,
  );
  const live = new Map<string, Map<string, LiveColumnRow>>();
  for (const row of liveRows) {
    if (!live.has(row.table_name)) live.set(row.table_name, new Map());
    live.get(row.table_name)!.set(row.column_name, row);
  }

  const missingTables: string[] = [];
  const missingColumns: { table: string; column: string }[] = [];
  const typeMismatches: SchemaColumnTypeMismatch[] = [];
  const nullableMismatches: SchemaColumnNullableMismatch[] = [];
  let columnsChecked = 0;

  for (const [table, cols] of declared) {
    const liveCols = live.get(table);
    if (!liveCols) {
      missingTables.push(table);
      continue;
    }
    for (const col of cols) {
      columnsChecked++;
      const liveCol = liveCols.get(col.name);
      if (!liveCol) {
        missingColumns.push({ table, column: col.name });
        continue;
      }

      const declaredFamily = canonicalizeDrizzleSqlType(col.sqlType);
      const liveFamily = canonicalizeLiveSqlType(liveCol.data_type, liveCol.udt_name);
      if (declaredFamily !== liveFamily) {
        typeMismatches.push({
          table,
          column: col.name,
          declaredType: col.sqlType,
          liveType: liveCol.data_type,
        });
      }

      const liveNullable = liveCol.is_nullable === "YES";
      if (col.notNull === liveNullable) {
        // declared NOT NULL (notNull=true) but live nullable, or vice versa.
        nullableMismatches.push({
          table,
          column: col.name,
          declaredNotNull: col.notNull,
          liveNullable,
        });
      }
    }
  }

  return {
    missingTables: missingTables.sort(),
    missingColumns: missingColumns.sort((a, b) =>
      `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`),
    ),
    typeMismatches: typeMismatches.sort((a, b) =>
      `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`),
    ),
    nullableMismatches: nullableMismatches.sort((a, b) =>
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
 *
 * Severity split (fix-wave telemetry-honesty-registry-dashboards, 2026-07-17):
 * missing tables/columns AND type-family mismatches escalate to WARNING —
 * both are the "code writing/reading this throws or silently corrupts data at
 * runtime" class this canary exists to catch. Nullable mismatches (declared
 * `.notNull()` vs a live column that doesn't enforce NOT NULL, or vice versa)
 * are reported in the audit payload on EVERY run (never hidden) but do NOT
 * escalate severity: an app-level not-null commitment the DB doesn't enforce
 * is a common, low-risk migration pattern (e.g. a column added to an
 * already-populated table without a backfill+constraint), not the
 * throws-at-runtime class the WARNING severity is reserved for. This is an
 * observability judgment call, not a correctness gap — `nullableMismatches`
 * is always present on the returned `SchemaDriftReport` for any caller
 * (`scripts/check-live-schema-drift.ts`) that wants to review it directly.
 */
export async function runBootSchemaDriftCanary(): Promise<SchemaDriftReport | null> {
  try {
    const report = await computeSchemaDrift(async (text) => {
      const result = await db.execute(sql.raw(text));
      return (result as unknown as { rows?: Array<LiveColumnRow> }).rows
        ?? (result as unknown as Array<LiveColumnRow>);
    });
    const driftCount = report.missingTables.length + report.missingColumns.length + report.typeMismatches.length;
    const nullableNote = report.nullableMismatches.length > 0
      ? `${report.nullableMismatches.length} nullable-constraint mismatch(es) present (advisory — not counted toward drift status).`
      : "no nullable-constraint mismatches.";
    if (driftCount > 0) {
      logger.error(
        { missingTables: report.missingTables, missingColumns: report.missingColumns, typeMismatches: report.typeMismatches },
        "schema-drift-canary: LIVE DB IS MISSING or MISTYPED schema.ts objects — writes naming them will THROW or silently corrupt data (bias_state 0134 class)",
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
          type_mismatches: report.typeMismatches.map(
            (t) => `${t.table}.${t.column} (declared=${t.declaredType}, live=${t.liveType})`,
          ),
          nullable_mismatches_advisory: report.nullableMismatches.map(
            (n) => `${n.table}.${n.column} (declaredNotNull=${n.declaredNotNull}, liveNullable=${n.liveNullable})`,
          ),
          tables_checked: report.tablesChecked,
          columns_checked: report.columnsChecked,
          note:
            `Code writing/reading missing/mistyped objects throws or silently corrupts data at runtime. ` +
            `Fix FORWARD with a new idempotent migration (never re-run an applied one). ${nullableNote}`,
        },
      }).catch(() => { /* audit fail-soft */ });
    } else {
      await insertAuditRow({
        action: "boot.schema_drift_clean",
        entityType: "scheduler",
        entityId: "schema-drift-canary",
        decisionAuthority: "system",
        status: "success",
        result: {
          tables_checked: report.tablesChecked,
          columns_checked: report.columnsChecked,
          nullable_mismatches_advisory: report.nullableMismatches.map(
            (n) => `${n.table}.${n.column} (declaredNotNull=${n.declaredNotNull}, liveNullable=${n.liveNullable})`,
          ),
          note: nullableNote,
        },
      }).catch(() => { /* audit fail-soft */ });
    }
    return report;
  } catch (err) {
    logger.warn({ err: String(err) }, "schema-drift-canary: check failed (non-blocking)");
    return null;
  }
}
