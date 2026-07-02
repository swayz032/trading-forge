// deepscan6 O6: unit coverage for the post-apply table extractor used by the
// boot-migration runner's phantom-apply verification. Pure-function test — no live DB
// (a dummy DATABASE_URL lets the module load; drizzle connects lazily, never here).
import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL ||= "postgres://ci:ci@localhost:5432/ci_deepscan6";

let extractCreatedTables: (statements: string[]) => string[];

beforeAll(async () => {
  ({ extractCreatedTables } = await import("../lib/boot-migration-runner.js"));
});

describe("deepscan6 O6 — extractCreatedTables", () => {
  it("extracts a plain CREATE TABLE", () => {
    expect(extractCreatedTables(["CREATE TABLE strategy_health_scores (id BIGSERIAL)"])).toEqual([
      "strategy_health_scores",
    ]);
  });

  it("handles IF NOT EXISTS + quoted + schema-qualified names", () => {
    const got = extractCreatedTables([
      'CREATE TABLE IF NOT EXISTS "quantum_rl_runs" (id INT)',
      "create table public.lifecycle_shadow_signals (id int)",
    ]);
    expect(got.sort()).toEqual(["lifecycle_shadow_signals", "quantum_rl_runs"]);
  });

  it("ignores the migrations bookkeeping table and non-CREATE statements", () => {
    const got = extractCreatedTables([
      "CREATE TABLE drizzle.__drizzle_migrations (hash text)",
      "ALTER TABLE strategies ADD COLUMN foo text",
      "INSERT INTO audit_log (action) VALUES ('x')",
    ]);
    expect(got).toEqual([]);
  });

  it("dedupes and returns multiple distinct tables", () => {
    const got = extractCreatedTables([
      "CREATE TABLE a (id int); CREATE TABLE b (id int);",
      "CREATE TABLE a (id int)",
    ]);
    expect(got.sort()).toEqual(["a", "b"]);
  });
});
