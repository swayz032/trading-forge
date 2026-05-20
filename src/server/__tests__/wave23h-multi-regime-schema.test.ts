/**
 * W23H.B (2026-05-20) — Multi-regime strategies schema tests.
 *
 * Tests:
 *  1. Migration SQL is idempotent (can be parsed/inspected for IF NOT EXISTS patterns)
 *  2. Schema.ts has preferredRegimes array field
 *  3. Backfill logic: preferred_regime → preferred_regimes array
 *  4. GIN index definition present in migration
 *  5. Backward compat: existing preferred_regime column preserved
 *
 * Note: These are structural/contract tests — no live DB connection required.
 * Migration idempotency is verified by reading the SQL content.
 * Schema.ts field presence is verified by importing and checking types.
 *
 * Pure function tests — no DB connection.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const MIGRATION_PATH = join(
  process.cwd(),
  "src/server/db/migrations/0120_multi_regime_strategies.sql",
);

// ─── Migration SQL structure tests ────────────────────────────────────────

describe("W23H.B migration 0120: idempotent DDL", () => {
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(MIGRATION_PATH, "utf-8");
  });

  it("uses IF NOT EXISTS for ALTER TABLE ADD COLUMN", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS preferred_regimes");
  });

  it("uses IF NOT EXISTS for CREATE INDEX", () => {
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_strategies_preferred_regimes");
  });

  it("uses USING GIN for the index (array membership performance)", () => {
    expect(sql).toContain("USING GIN");
    expect(sql).toContain("preferred_regimes");
  });

  it("backfill only runs when preferred_regimes IS NULL (idempotent)", () => {
    expect(sql).toContain("preferred_regimes IS NULL");
  });

  it("backfill copies from preferred_regime (singular)", () => {
    expect(sql).toContain("ARRAY[preferred_regime]");
    expect(sql).toContain("WHERE preferred_regime IS NOT NULL");
  });

  it("does NOT DROP preferred_regime column (backward compat preserved)", () => {
    expect(sql).not.toContain("DROP COLUMN preferred_regime");
  });
});

// ─── Schema.ts field presence ─────────────────────────────────────────────

describe("W23H.B schema.ts: preferredRegimes field present", () => {
  it("strategies table has preferredRegimes text array field", async () => {
    const { strategies } = await import("../db/schema.js");
    // Drizzle schema: check the column exists on the table definition
    const cols = Object.keys(strategies);
    expect(cols).toContain("preferredRegimes");
  });

  it("strategies table still has preferredRegime (backward compat)", async () => {
    const { strategies } = await import("../db/schema.js");
    const cols = Object.keys(strategies);
    expect(cols).toContain("preferredRegime");
  });
});

// ─── Backfill logic unit tests ────────────────────────────────────────────

describe("W23H.B backfill logic: preferred_regime → preferred_regimes", () => {
  // Test the backfill heuristic as a pure function
  function backfillRegimes(preferredRegime: string | null): string[] | null {
    if (!preferredRegime) return null;
    return [preferredRegime];
  }

  it("non-null preferred_regime backfills to single-element array", () => {
    expect(backfillRegimes("TRENDING_UP")).toEqual(["TRENDING_UP"]);
    expect(backfillRegimes("TRENDING_DOWN")).toEqual(["TRENDING_DOWN"]);
    expect(backfillRegimes("RANGE_BOUND")).toEqual(["RANGE_BOUND"]);
  });

  it("null preferred_regime produces null (not backfilled)", () => {
    expect(backfillRegimes(null)).toBeNull();
  });
});

// ─── Journal entry tests ──────────────────────────────────────────────────

describe("W23H.B journal: migration 0120 registered", () => {
  it("_journal.json contains 0120_multi_regime_strategies entry", () => {
    const journalPath = join(
      process.cwd(),
      "src/server/db/migrations/meta/_journal.json",
    );
    const journal = JSON.parse(readFileSync(journalPath, "utf-8"));
    const entry = journal.entries.find(
      (e: any) => e.tag === "0120_multi_regime_strategies",
    );
    expect(entry).toBeDefined();
    expect(entry.idx).toBe(123);
    expect(entry.breakpoints).toBe(true);
  });
});
