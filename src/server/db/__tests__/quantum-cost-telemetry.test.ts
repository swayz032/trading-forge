/**
 * Tests for quantum_run_costs table (Tier 0.2, migration 0065).
 *
 * Two layers (mirrors lifecycle_transitions test pattern):
 *   1. Migration-text invariants — verify the migration file declares the
 *      table, all expected columns, and the index. Runs everywhere; no DB needed.
 *   2. Live DB enforcement — when DATABASE_URL is set, query
 *      information_schema.tables / columns and pg_indexes to confirm
 *      the table + columns + index actually exist after migration.
 *      Skipped when DATABASE_URL is not set (e.g. in unit-test CI).
 *
 * Why this table exists (Tier 0.2 of the Gemini Quantum Blueprint):
 *   Every quantum module must emit per-run wall-clock + (if cloud) QPU-seconds
 *   + dollars. Without a typed cost table, "is quantum worth the compute?" is
 *   unanswerable at graduation time (Tier 7).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "src/server/db/migrations/0065_quantum_cost_telemetry.sql"
);

describe("Migration 0065: quantum_run_costs table", () => {
  it("migration file exists", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("declares the quantum_run_costs table", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?quantum_run_costs/i);
  });

  it("declares all required columns", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/\bid\s+uuid\b/i);
    expect(sql).toMatch(/\bmodule_name\s+text\b/i);
    expect(sql).toMatch(/\bbacktest_id\s+uuid\b/i);
    expect(sql).toMatch(/\bstrategy_id\s+uuid\b/i);
    expect(sql).toMatch(/\bwall_clock_ms\s+integer\b/i);
    expect(sql).toMatch(/\bqpu_seconds\s+numeric\b/i);
    expect(sql).toMatch(/\bcost_dollars\s+numeric\b/i);
    expect(sql).toMatch(/\bcache_hit\s+boolean\b/i);
    expect(sql).toMatch(/\bstatus\s+text\b/i);
    expect(sql).toMatch(/\berror_message\s+text\b/i);
    expect(sql).toMatch(/\bcreated_at\s+timestamp\b/i);
  });

  it("declares foreign keys to backtests and strategies", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/REFERENCES\s+backtests\s*\(\s*id\s*\)/i);
    expect(sql).toMatch(/REFERENCES\s+strategies\s*\(\s*id\s*\)/i);
  });

  it("creates the module_name + created_at composite index", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_quantum_run_costs_module_created/i
    );
  });

  it("registered in drizzle journal", () => {
    const journalPath = resolve(
      process.cwd(),
      "src/server/db/migrations/meta/_journal.json"
    );
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const tags: string[] = journal.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain("0065_quantum_cost_telemetry");
  });

  it("schema.ts exports quantumRunCosts Drizzle table", () => {
    const schemaPath = resolve(process.cwd(), "src/server/db/schema.ts");
    const ts = readFileSync(schemaPath, "utf8");
    expect(ts).toMatch(/export\s+const\s+quantumRunCosts\s*=\s*pgTable\s*\(\s*["']quantum_run_costs["']/);
    expect(ts).toMatch(/moduleName\s*:\s*text\(\s*["']module_name["']\s*\)/);
    expect(ts).toMatch(/wallClockMs\s*:\s*integer\(\s*["']wall_clock_ms["']\s*\)/);
    expect(ts).toMatch(/qpuSeconds\s*:\s*numeric\(\s*["']qpu_seconds["']\s*\)/);
    expect(ts).toMatch(/costDollars\s*:\s*numeric\(\s*["']cost_dollars["']\s*\)/);
  });
});

// ─── Live DB enforcement (only when DATABASE_URL is set) ────────────────────
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)(
  "quantum_run_costs — live DB",
  () => {
    it("table exists in information_schema", async () => {
      const { client } = await import("../index.js");
      const rows = await client<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'quantum_run_costs'
      `;
      expect(rows.length).toBe(1);
    });

    it("has all expected columns with correct types", async () => {
      const { client } = await import("../index.js");
      const rows = await client<{ column_name: string; data_type: string; is_nullable: string }[]>`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'quantum_run_costs'
      `;
      const colMap = new Map(rows.map((r) => [r.column_name, r]));
      expect(colMap.get("id")?.data_type).toBe("uuid");
      expect(colMap.get("module_name")?.data_type).toBe("text");
      expect(colMap.get("module_name")?.is_nullable).toBe("NO");
      expect(colMap.get("backtest_id")?.data_type).toBe("uuid");
      expect(colMap.get("strategy_id")?.data_type).toBe("uuid");
      expect(colMap.get("wall_clock_ms")?.data_type).toBe("integer");
      expect(colMap.get("wall_clock_ms")?.is_nullable).toBe("NO");
      expect(colMap.get("qpu_seconds")?.data_type).toBe("numeric");
      expect(colMap.get("cost_dollars")?.data_type).toBe("numeric");
      expect(colMap.get("cache_hit")?.data_type).toBe("boolean");
      expect(colMap.get("status")?.data_type).toBe("text");
      expect(colMap.get("status")?.is_nullable).toBe("NO");
    });

    it("has the expected index", async () => {
      const { client } = await import("../index.js");
      const rows = await client<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'quantum_run_costs'
      `;
      const names = rows.map((r) => r.indexname);
      expect(names).toContain("idx_quantum_run_costs_module_created");
    });
  }
);
