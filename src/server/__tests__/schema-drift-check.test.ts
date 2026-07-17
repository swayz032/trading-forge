// Fix-wave telemetry-honesty-registry-dashboards (2026-07-17) — HIGH finding:
// computeSchemaDrift() (src/server/lib/schema-drift-check.ts) only ever compared
// column NAME existence against schema.ts, never data_type/nullable, so a column
// that exists live but has drifted to the wrong type was invisible to the exact
// check built to catch schema drift.
//
// This suite:
//   1. Unit-tests the type-family normalization helpers directly (the anti-noise
//      logic — timestamp vs timestamptz, text[] vs ARRAY+udt_name, numeric(p,s)
//      vs numeric — all empirically grounded against a real PGlite-mirrored table,
//      see the long comment in schema-drift-check.ts).
//   2. Regression-tests computeSchemaDrift() against the REAL current schema.ts
//      (via the real, unmocked collectDeclaredSchema()) with a synthetic
//      queryRows() that reports realistic live rows for every declared column —
//      proving the normalization does NOT false-positive on the real, current
//      schema (the exact failure mode a naive exact-string comparison would hit).
//   3. RED-PROOFs: mutates one synthetic live row's type family and one's
//      nullability and confirms computeSchemaDrift() now reports exactly those
//      as typeMismatches / nullableMismatches — this is the injected-drift proof
//      the finding asks for.
import { describe, expect, it, vi } from "vitest";

// schema-drift-check.ts imports ../db/index.js directly (for the boot-canary
// path), which throws "DATABASE_URL environment variable is required" at
// module-collection time outside a real DB environment. Mock it the same way
// credential-loader.test.ts does — computeSchemaDrift()/collectDeclaredSchema()
// under test here never touch `db` (they take an injected queryRows callback).
vi.mock("../db/index.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

import {
  canonicalizeDrizzleSqlType,
  canonicalizeLiveSqlType,
  collectDeclaredSchema,
  computeSchemaDrift,
  type DeclaredColumn,
} from "../lib/schema-drift-check.js";

describe("canonicalizeDrizzleSqlType / canonicalizeLiveSqlType (anti-noise normalization)", () => {
  it("treats drizzle's timezone-less timestamp() as the same family as live TIMESTAMPTZ", () => {
    // Empirically confirmed against the real schema.ts + PGlite-mirrored DDL:
    // `timestamp("col")` (no withTimezone) reports drizzle-side "timestamp" while
    // every migrated live column is TIMESTAMPTZ ("timestamp with time zone").
    expect(canonicalizeDrizzleSqlType("timestamp")).toBe(canonicalizeLiveSqlType("timestamp with time zone", null));
  });

  it("treats drizzle's explicit withTimezone timestamp the same as the implicit one", () => {
    expect(canonicalizeDrizzleSqlType("timestamp with time zone")).toBe(canonicalizeDrizzleSqlType("timestamp"));
  });

  it("strips numeric precision/scale so numeric(12,4) matches live 'numeric'", () => {
    expect(canonicalizeDrizzleSqlType("numeric(12, 4)")).toBe(canonicalizeLiveSqlType("numeric", null));
    expect(canonicalizeDrizzleSqlType("numeric(20, 8)")).toBe(canonicalizeLiveSqlType("numeric", null));
  });

  it("resolves array types via udt_name and matches drizzle's [] suffix form", () => {
    expect(canonicalizeDrizzleSqlType("text[]")).toBe(canonicalizeLiveSqlType("ARRAY", "_text"));
  });

  it("does NOT collapse genuinely different type families", () => {
    expect(canonicalizeDrizzleSqlType("text")).not.toBe(canonicalizeLiveSqlType("integer", null));
    expect(canonicalizeDrizzleSqlType("jsonb")).not.toBe(canonicalizeLiveSqlType("text", null));
    expect(canonicalizeDrizzleSqlType("uuid")).not.toBe(canonicalizeLiveSqlType("text", null));
    expect(canonicalizeDrizzleSqlType("boolean")).not.toBe(canonicalizeLiveSqlType("integer", null));
  });
});

/**
 * Empirically-grounded mapping from every distinct `getSQLType()` string
 * actually produced by the real schema.ts (verified via a one-off scan: 17
 * distinct strings across 1447 columns) to the live information_schema.columns
 * shape a correctly-migrated Postgres database reports for it. The
 * timestamp/timestamptz and array rows are the two cases this fix-wave exists
 * to tolerate without false-positiving; see schema-drift-check.ts.
 */
const REALISTIC_LIVE_SHAPE_BY_SQL_TYPE: Record<string, { data_type: string; udt_name: string | null }> = {
  bigserial: { data_type: "bigint", udt_name: "int8" },
  boolean: { data_type: "boolean", udt_name: "bool" },
  bytea: { data_type: "bytea", udt_name: "bytea" },
  date: { data_type: "date", udt_name: "date" },
  integer: { data_type: "integer", udt_name: "int4" },
  jsonb: { data_type: "jsonb", udt_name: "jsonb" },
  numeric: { data_type: "numeric", udt_name: "numeric" },
  real: { data_type: "real", udt_name: "float4" },
  text: { data_type: "text", udt_name: "text" },
  "text[]": { data_type: "ARRAY", udt_name: "_text" },
  timestamp: { data_type: "timestamp with time zone", udt_name: "timestamptz" },
  "timestamp with time zone": { data_type: "timestamp with time zone", udt_name: "timestamptz" },
  uuid: { data_type: "uuid", udt_name: "uuid" },
};

function realisticLiveShapeFor(sqlType: string): { data_type: string; udt_name: string | null } {
  if (sqlType.startsWith("numeric(")) return { data_type: "numeric", udt_name: "numeric" };
  const shape = REALISTIC_LIVE_SHAPE_BY_SQL_TYPE[sqlType];
  if (!shape) {
    throw new Error(
      `realisticLiveShapeFor: unmapped sqlType "${sqlType}" — the real schema.ts now uses a getSQLType() ` +
        `variant this test fixture doesn't know about yet; add a mapping above before trusting this suite.`,
    );
  }
  return shape;
}

interface SyntheticLiveRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  udt_name: string | null;
}

/** Build a live-row set that exactly matches the real declared schema (zero drift by construction). */
function buildMatchingLiveRows(declared: Map<string, DeclaredColumn[]>): SyntheticLiveRow[] {
  const rows: SyntheticLiveRow[] = [];
  for (const [table, cols] of declared) {
    for (const col of cols) {
      const shape = realisticLiveShapeFor(col.sqlType);
      rows.push({
        table_name: table,
        column_name: col.name,
        data_type: shape.data_type,
        udt_name: shape.udt_name,
        is_nullable: col.notNull ? "NO" : "YES",
      });
    }
  }
  return rows;
}

describe("computeSchemaDrift against the real, current schema.ts", () => {
  it("reports zero type/nullable mismatches when live rows realistically mirror schema.ts (no false positives)", async () => {
    const declared = collectDeclaredSchema();
    const liveRows = buildMatchingLiveRows(declared);

    const report = await computeSchemaDrift(async () => liveRows);

    expect(report.missingTables).toEqual([]);
    expect(report.missingColumns).toEqual([]);
    expect(report.typeMismatches).toEqual([]);
    expect(report.nullableMismatches).toEqual([]);
    expect(report.tablesChecked).toBeGreaterThan(0);
    expect(report.columnsChecked).toBeGreaterThan(0);
  });

  it("RED-PROOF: flags a column whose live type family genuinely diverges from schema.ts", async () => {
    const declared = collectDeclaredSchema();
    const liveRows = buildMatchingLiveRows(declared);

    // Pick a real, currently-declared `text` column and corrupt its live type
    // to "integer" — a genuine cross-family drift (the exact bug class the
    // finding describes: "a column that exists but has drifted to the wrong
    // type is invisible to the exact check built to catch schema drift").
    const target = liveRows.find((r) => r.table_name === "strategies" && r.column_name === "name");
    expect(target, "fixture assumption: strategies.name must exist in schema.ts").toBeDefined();
    target!.data_type = "integer";
    target!.udt_name = "int4";

    const report = await computeSchemaDrift(async () => liveRows);

    expect(report.missingTables).toEqual([]);
    expect(report.missingColumns).toEqual([]);
    expect(report.typeMismatches).toEqual([
      { table: "strategies", column: "name", declaredType: "text", liveType: "integer" },
    ]);
  });

  it("RED-PROOF: flags a column whose live nullability genuinely diverges from schema.ts", async () => {
    const declared = collectDeclaredSchema();
    const liveRows = buildMatchingLiveRows(declared);

    // strategies.name is declared .notNull() — flip its live is_nullable to "YES"
    // (a live NOT NULL constraint that was dropped out-of-band).
    const target = liveRows.find((r) => r.table_name === "strategies" && r.column_name === "name");
    expect(target).toBeDefined();
    target!.is_nullable = "YES";

    const report = await computeSchemaDrift(async () => liveRows);

    expect(report.typeMismatches).toEqual([]);
    expect(report.nullableMismatches).toEqual([
      { table: "strategies", column: "name", declaredNotNull: true, liveNullable: true },
    ]);
  });

  it("still reports missing tables and missing columns (pre-existing behavior preserved)", async () => {
    const declared = collectDeclaredSchema();
    const liveRows = buildMatchingLiveRows(declared).filter(
      (r) => r.table_name !== "strategies" && !(r.table_name === "backtests" && r.column_name === "status"),
    );

    const report = await computeSchemaDrift(async () => liveRows);

    expect(report.missingTables).toContain("strategies");
    expect(report.missingColumns).toContainEqual({ table: "backtests", column: "status" });
  });
});
