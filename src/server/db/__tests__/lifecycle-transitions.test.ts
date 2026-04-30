/**
 * Tests for lifecycle_transitions table (Tier 0.1, migration 0064).
 *
 * Two layers (mirrors audit_log append-only test pattern, migration 0058):
 *   1. Migration-text invariants — verify the migration file declares the
 *      table, all expected columns, and the two indexes. Runs everywhere; no DB needed.
 *   2. Live DB enforcement — when DATABASE_URL is set, query
 *      information_schema.tables / columns and pg_indexes to confirm
 *      the table + columns + indexes actually exist after migration.
 *      Skipped when DATABASE_URL is not set (e.g. in unit-test CI).
 *
 * The migration-text test ensures the schema can never silently regress in
 * source even if the live test is skipped.
 *
 * Why this table exists (Tier 0.1 of the Gemini Quantum Blueprint):
 *   Lifecycle history currently lives in audit_log.action="strategy.lifecycle"
 *   JSONB blobs. The blobs are queryable but not indexable for the high-volume
 *   quantum-agreement queries Tier 7 (graduation) needs. A first-class typed
 *   table with quantum_agreement_score / quantum_advantage_delta columns makes
 *   "show me all strategies with low quantum-classical agreement over 30 days"
 *   a single indexed SQL query.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "src/server/db/migrations/0064_lifecycle_transitions_table.sql"
);

describe("Migration 0064: lifecycle_transitions table", () => {
  it("migration file exists", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("declares the lifecycle_transitions table", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?lifecycle_transitions/i);
  });

  it("declares all required base columns", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    // Required columns (per Tier 0.1 spec)
    expect(sql).toMatch(/\bid\s+uuid\b/i);
    expect(sql).toMatch(/\bstrategy_id\s+uuid\b/i);
    expect(sql).toMatch(/\bfrom_state\s+text\b/i);
    expect(sql).toMatch(/\bto_state\s+text\b/i);
    expect(sql).toMatch(/\bdecision_authority\s+text\b/i);
    expect(sql).toMatch(/\breason\s+text\b/i);
    expect(sql).toMatch(/\bbacktest_id\s+uuid\b/i);
    expect(sql).toMatch(/\bforge_score\s+numeric\b/i);
    expect(sql).toMatch(/\bmc_survival_rate\s+numeric\b/i);
    expect(sql).toMatch(/\bcreated_at\s+timestamp\b/i);
  });

  it("declares all quantum challenger evidence columns", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/\bquantum_agreement_score\s+numeric\b/i);
    expect(sql).toMatch(/\bquantum_advantage_delta\s+numeric\b/i);
    expect(sql).toMatch(/\bquantum_fallback_triggered\s+boolean\b/i);
    expect(sql).toMatch(/\bquantum_classical_disagreement_pct\s+numeric\b/i);
    expect(sql).toMatch(/\bcloud_qmc_run_id\s+uuid\b/i);
  });

  it("declares foreign keys to strategies and backtests", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(/REFERENCES\s+strategies\s*\(\s*id\s*\)/i);
    expect(sql).toMatch(/REFERENCES\s+backtests\s*\(\s*id\s*\)/i);
  });

  it("creates the strategy_id + created_at composite index", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_lifecycle_transitions_strategy_created/i
    );
  });

  it("creates the partial quantum_agreement_score index", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?idx_lifecycle_transitions_quantum_agreement/i
    );
    // Partial index condition: WHERE quantum_agreement_score IS NOT NULL
    expect(sql).toMatch(/WHERE\s+quantum_agreement_score\s+IS\s+NOT\s+NULL/i);
  });

  it("registered in drizzle journal", () => {
    const journalPath = resolve(
      process.cwd(),
      "src/server/db/migrations/meta/_journal.json"
    );
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const tags: string[] = journal.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain("0064_lifecycle_transitions_table");
  });

  it("schema.ts exports lifecycleTransitions Drizzle table", () => {
    const schemaPath = resolve(process.cwd(), "src/server/db/schema.ts");
    const ts = readFileSync(schemaPath, "utf8");
    expect(ts).toMatch(/export\s+const\s+lifecycleTransitions\s*=\s*pgTable\s*\(\s*["']lifecycle_transitions["']/);
    // Columns the runtime code will write
    expect(ts).toMatch(/strategyId\s*:\s*uuid\(\s*["']strategy_id["']\s*\)/);
    expect(ts).toMatch(/fromState\s*:\s*text\(\s*["']from_state["']\s*\)/);
    expect(ts).toMatch(/toState\s*:\s*text\(\s*["']to_state["']\s*\)/);
    expect(ts).toMatch(/decisionAuthority\s*:\s*text\(\s*["']decision_authority["']\s*\)/);
    expect(ts).toMatch(/quantumAgreementScore\s*:\s*numeric\(\s*["']quantum_agreement_score["']\s*\)/);
  });
});

// ─── Live DB enforcement (only when DATABASE_URL is set) ────────────────────
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)(
  "lifecycle_transitions — live DB",
  () => {
    it("table exists in information_schema", async () => {
      const { client } = await import("../index.js");
      const rows = await client<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'lifecycle_transitions'
      `;
      expect(rows.length).toBe(1);
    });

    it("has all expected columns with correct types", async () => {
      const { client } = await import("../index.js");
      const rows = await client<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'lifecycle_transitions'
      `;
      const colMap = new Map(rows.map((r) => [r.column_name, r.data_type]));
      expect(colMap.get("id")).toBe("uuid");
      expect(colMap.get("strategy_id")).toBe("uuid");
      expect(colMap.get("from_state")).toBe("text");
      expect(colMap.get("to_state")).toBe("text");
      expect(colMap.get("decision_authority")).toBe("text");
      expect(colMap.get("backtest_id")).toBe("uuid");
      expect(colMap.get("forge_score")).toBe("numeric");
      expect(colMap.get("mc_survival_rate")).toBe("numeric");
      expect(colMap.get("quantum_agreement_score")).toBe("numeric");
      expect(colMap.get("quantum_advantage_delta")).toBe("numeric");
      expect(colMap.get("quantum_fallback_triggered")).toBe("boolean");
      expect(colMap.get("quantum_classical_disagreement_pct")).toBe("numeric");
      expect(colMap.get("cloud_qmc_run_id")).toBe("uuid");
      expect(colMap.get("created_at")).toBe("timestamp without time zone");
    });

    it("has both expected indexes", async () => {
      const { client } = await import("../index.js");
      const rows = await client<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'lifecycle_transitions'
      `;
      const names = rows.map((r) => r.indexname);
      expect(names).toContain("idx_lifecycle_transitions_strategy_created");
      expect(names).toContain("idx_lifecycle_transitions_quantum_agreement");
    });

    it("FK to strategies exists with NOT NULL constraint", async () => {
      const { client } = await import("../index.js");
      const rows = await client<{ is_nullable: string }[]>`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'lifecycle_transitions'
          AND column_name = 'strategy_id'
      `;
      expect(rows[0]?.is_nullable).toBe("NO");
    });
  }
);
