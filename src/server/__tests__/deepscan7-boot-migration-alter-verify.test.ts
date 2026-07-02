// deepscan7 D1: unit coverage for the ALTER TABLE ... ADD COLUMN extractor used by
// the boot-migration runner's phantom-apply verification (the 0146/0148 incident
// class — pure-ALTER migrations previously got ZERO post-apply verification).
// Pure-function test — no live DB (a dummy DATABASE_URL lets the module load;
// drizzle connects lazily, never here). Mirrors deepscan6-boot-migration-verify.
import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL ||= "postgres://ci:ci@localhost:5432/ci_deepscan7";

interface AlteredColumn {
  table: string;
  column: string;
}

let extractAlteredColumns: (statements: string[]) => AlteredColumn[];
let runPendingMigrations: (correlationId?: string | null) => Promise<void>;

beforeAll(async () => {
  ({ extractAlteredColumns, runPendingMigrations } = await import(
    "../lib/boot-migration-runner.js"
  ));
});

describe("deepscan7 D1 — extractAlteredColumns", () => {
  it("extracts a plain ALTER TABLE ... ADD COLUMN", () => {
    expect(
      extractAlteredColumns(["ALTER TABLE backtests ADD COLUMN firm_rules_version TEXT"]),
    ).toEqual([{ table: "backtests", column: "firm_rules_version" }]);
  });

  it("handles ADD COLUMN IF NOT EXISTS (the 0146/0148 phantom-apply shape)", () => {
    expect(
      extractAlteredColumns([
        "ALTER TABLE backtests ADD COLUMN IF NOT EXISTS compliance_mode TEXT",
      ]),
    ).toEqual([{ table: "backtests", column: "compliance_mode" }]);
  });

  it("handles quoted + schema-qualified names and lowercases them", () => {
    const got = extractAlteredColumns([
      'ALTER TABLE "strategies" ADD COLUMN "frozen_policy_hash" TEXT',
      "alter table public.Strategies add column IF NOT EXISTS regime_trained_on text",
    ]);
    expect(got).toEqual([
      { table: "strategies", column: "frozen_policy_hash" },
      { table: "strategies", column: "regime_trained_on" },
    ]);
  });

  it("extracts multiple ADD COLUMN clauses from one ALTER statement", () => {
    const got = extractAlteredColumns([
      "ALTER TABLE strategies ADD COLUMN a_col INT, ADD COLUMN IF NOT EXISTS b_col TEXT",
    ]);
    expect(got).toEqual([
      { table: "strategies", column: "a_col" },
      { table: "strategies", column: "b_col" },
    ]);
  });

  it("handles multiple ;-separated ALTER statements in one breakpoint chunk", () => {
    const got = extractAlteredColumns([
      "ALTER TABLE t1 ADD COLUMN c1 INT; ALTER TABLE t2 ADD COLUMN c2 TEXT;",
    ]);
    expect(got).toEqual([
      { table: "t1", column: "c1" },
      { table: "t2", column: "c2" },
    ]);
  });

  it("dedupes repeated (table, column) pairs across statements", () => {
    const got = extractAlteredColumns([
      "ALTER TABLE t1 ADD COLUMN c1 INT",
      "ALTER TABLE t1 ADD COLUMN IF NOT EXISTS c1 INT",
    ]);
    expect(got).toEqual([{ table: "t1", column: "c1" }]);
  });

  it("ignores non-ADD-COLUMN ALTER statements and non-ALTER statements", () => {
    const got = extractAlteredColumns([
      "ALTER TABLE t1 DROP COLUMN old_col",
      "ALTER TABLE t1 ALTER COLUMN c1 SET NOT NULL",
      "CREATE TABLE t2 (id INT)",
      "INSERT INTO audit_log (action) VALUES ('x')",
    ]);
    expect(got).toEqual([]);
  });

  it("does not false-match a CREATE TABLE column named add_column-ish text", () => {
    // A CREATE TABLE body must not be parsed as an ALTER target.
    const got = extractAlteredColumns([
      "CREATE TABLE widgets (id INT, add_column_notes TEXT)",
    ]);
    expect(got).toEqual([]);
  });

  it("skips the drizzle migrations bookkeeping table", () => {
    expect(
      extractAlteredColumns([
        "ALTER TABLE drizzle.__drizzle_migrations ADD COLUMN extra TEXT",
      ]),
    ).toEqual([]);
  });
});

describe("deepscan7 D1 — runPendingMigrations correlationId param", () => {
  it("accepts an optional correlationId and no-ops cleanly when disabled", async () => {
    // Signature contract: optional param, default preserved. With the kill switch
    // off the runner returns before touching the DB, so this exercises the new
    // signature without a live connection.
    const prev = process.env.BOOT_MIGRATION_ENABLED;
    process.env.BOOT_MIGRATION_ENABLED = "false";
    try {
      await expect(runPendingMigrations("boot-test-123")).resolves.toBeUndefined();
      await expect(runPendingMigrations()).resolves.toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.BOOT_MIGRATION_ENABLED;
      else process.env.BOOT_MIGRATION_ENABLED = prev;
    }
  });
});
